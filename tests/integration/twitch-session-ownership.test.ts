import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { TwitchPlatform } from '../../src/platforms/twitch';
import { TwitchApiClient } from '../../src/utils/api-clients/twitch-api-client';
import { PlatformEvents } from '../../src/interfaces/PlatformEvents';
import { TwitchEventSub } from '../../src/platforms/twitch-eventsub';
import { secrets } from '../../src/core/secrets';
import { noOpLogger } from '../helpers/mock-factories';
import { useFakeTimers, useRealTimers, advanceTimersByTime, setSystemTime, getTimerCount } from '../helpers/bun-timers';

class TestSocket extends EventEmitter {
    static sockets: TestSocket[] = [];
    readyState = 1;
    constructor(readonly url: string) { super(); TestSocket.sockets.push(this); }
    close() { this.readyState = 3; this.emit('close', 1000, 'test close'); }
    message(type: string, payload: object = {}) {
        this.emit('message', JSON.stringify({ metadata: { message_type: type, message_timestamp: '2026-01-01T00:00:00.000Z' }, payload }));
    }
    welcome(id: string, seconds = 30) {
        this.message('session_welcome', { session: { id, keepalive_timeout_seconds: seconds } });
    }
}
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const advance = async (ms: number) => { await advanceTimersByTime(ms); await flush(); };
const instances: TwitchEventSub[] = [];
let originalToken: string | null;
type Post = (url?: string, payload?: unknown, config?: unknown) => Promise<unknown>;
function fixture(post: Post = async () => ({ data: { data: [{ id: 'test-subscription', status: 'enabled' }] } }), logger = noOpLogger) {
    const eventSub = new TwitchEventSub({ clientId: 'test-client', broadcasterId: 'test-broadcaster' }, {
        logger, WebSocketCtor: TestSocket,
        twitchAuth: { isReady: () => true, getUserId: () => 'test-user', refreshTokens: async () => true },
        axios: { get: async () => ({ data: { data: [] } }), post, delete: async () => ({ data: {} }) },
        RawPlatformDataLoggingService: class { async logRawPlatformData() {} }
    });
    eventSub.requiredSubscriptions = eventSub.requiredSubscriptions.slice(0, 1);
    instances.push(eventSub);
    return eventSub;
}
beforeEach(() => { useFakeTimers(); setSystemTime(new Date('2026-01-01T00:00:00.000Z')); TestSocket.sockets = []; originalToken = secrets.twitch.accessToken; secrets.twitch.accessToken = 'test-only-token'; });
afterEach(async () => { await Promise.all(instances.splice(0).map(instance => instance.cleanup())); secrets.twitch.accessToken = originalToken; useRealTimers(); });

describe('Twitch session ownership through real EventSub and subscription manager', () => {
    for (const status of [429, 403]) test(`later terminal ${status} overrides an earlier transient startup failure`, async () => {
        let posts = 0;
        const eventSub = fixture(async () => {
            posts++;
            if (posts === 1) throw Object.assign(new Error('test connection reset'), { code: 'ECONNRESET' });
            throw { response: { status, headers: { 'retry-after': '120' }, data: { error: status === 403 ? 'Forbidden' : 'Too Many Requests', message: 'test terminal rejection' } } };
        });
        eventSub.requiredSubscriptions.push({ ...eventSub.requiredSubscriptions[0]!, type: 'test.second' });
        let failure: unknown;
        const starting = eventSub.initialize().catch(error => { failure = error; });
        await flush();
        TestSocket.sockets[0]!.welcome('test-later-terminal');
        await flush();
        expect(failure).toBeInstanceOf(Error);
        if (status === 429) expect(failure).toMatchObject({ code: 'EVENTSUB_RETRY_AFTER_EXCEEDS_BUDGET' });
        else expect(failure).toMatchObject({ response: { status } });
        await advance(2000);
        expect(TestSocket.sockets).toHaveLength(1);
        expect(posts).toBe(2);
        await starting;
    });
    test('throwing connected listener cannot strand startup or handoff and later recovery remains available', async () => {
        const eventSub = fixture();
        eventSub.on('eventSubConnected', () => { throw new Error('test observer failed'); });
        let observed = 0;
        let observedOnce = 0;
        eventSub.on('eventSubConnected', () => { observed++; });
        eventSub.once('eventSubConnected', async () => { observedOnce++; throw new Error('test async observer failed'); });
        let settled = false;
        const starting = eventSub.initialize().then(() => { settled = true; });
        void starting.catch(() => {});
        await flush();
        TestSocket.sockets[0]!.welcome('test-throwing-observer');
        await flush();
        expect(settled).toBe(true);
        expect(eventSub.isActive()).toBe(true);
        TestSocket.sockets[0]!.message('session_reconnect', { session: { reconnect_url: 'wss://test.invalid/observer-handoff' } });
        TestSocket.sockets[1]!.welcome('test-observer-promoted');
        await flush();
        expect(eventSub.isActive()).toBe(true);
        // A subsequent migration proves the first operation released its ownership.
        TestSocket.sockets[1]!.message('session_reconnect', { session: { reconnect_url: 'wss://test.invalid/observer-next' } });
        expect(TestSocket.sockets).toHaveLength(3);
        TestSocket.sockets[2]!.welcome('test-observer-next-promoted');
        await flush();
        TestSocket.sockets[2]!.emit('error', new Error('test transport reset after observer failure'));
        const recovering = eventSub._reconnect();
        await flush();
        await advance(1000);
        TestSocket.sockets[3]!.welcome('test-observer-fresh-recovery');
        await recovering;
        expect(eventSub.isActive()).toBe(true);
        expect(observed).toBe(4);
        expect(observedOnce).toBe(1);
        await eventSub.cleanup();
        expect(getTimerCount()).toBe(0);
        expect(TestSocket.sockets.every(socket => socket.readyState === 3)).toBe(true);
        await starting;
    });
    test('terminal startup revocation fences the final POST and startup readiness', async () => {
        let posts = 0;
        let release!: (value: unknown) => void;
        const eventSub = fixture(async () => {
            if (++posts === 2) return new Promise(resolve => { release = resolve; });
            return { data: { data: [{ id: 'test-revoked-first', status: 'enabled' }] } };
        });
        eventSub.requiredSubscriptions.push({ ...eventSub.requiredSubscriptions[0]!, type: 'test.second' });
        let connected = 0;
        eventSub.on('eventSubConnected', () => connected++);
        const starting = eventSub.initialize().catch(error => error);
        await flush();
        const socket = TestSocket.sockets[0]!;
        socket.welcome('test-revoked-startup');
        await flush();
        socket.message('revocation', { subscription: { type: eventSub.requiredSubscriptions[0]!.type, status: 'authorization_revoked' } });
        await flush();
        release({ data: { data: [{ id: 'test-revoked-late', status: 'enabled' }] } });
        await starting;
        expect(eventSub.isActive()).toBe(false);
        expect(connected).toBe(0);
        expect(eventSub.subscriptions.has('test-revoked-late')).toBe(false);
    });
    test('terminal overlap revocation retires both sessions before candidate promotion', async () => {
        const eventSub = fixture();
        const starting = eventSub.initialize();
        await flush();
        const old = TestSocket.sockets[0]!;
        old.welcome('test-revoked-overlap');
        await starting;
        let connected = 0;
        eventSub.on('eventSubConnected', () => connected++);
        old.message('session_reconnect', { session: { reconnect_url: 'wss://test.invalid/revoked-handoff' } });
        old.message('revocation', { subscription: { type: eventSub.requiredSubscriptions[0]!.type, status: 'authorization_revoked' } });
        await flush();
        TestSocket.sockets[1]!.welcome('test-revoked-candidate');
        await flush();
        expect(eventSub.isActive()).toBe(false);
        expect(connected).toBe(0);
        expect(TestSocket.sockets.every(socket => socket.readyState === 3)).toBe(true);
    });
    test('every consecutive rate limit blocks later subscriptions when its minimum exceeds budget', async () => {
        const requests: string[] = [];
        const eventSub = fixture(async (_url, payload) => {
            requests.push((payload as { type: string }).type);
            throw { response: { status: 429, headers: { 'retry-after': requests.length === 1 ? '1' : '120' }, data: { error: 'Too Many Requests', message: 'test repeated limit' } } };
        });
        eventSub.requiredSubscriptions.push({ ...eventSub.requiredSubscriptions[0]!, type: 'test.second' });
        const starting = eventSub.initialize().catch(error => error);
        await flush();
        TestSocket.sockets[0]!.welcome('test-consecutive-rate-limit');
        await flush();
        await advance(999);
        expect(requests).toHaveLength(1);
        await advance(1);
        await starting;
        expect(requests).toEqual([eventSub.requiredSubscriptions[0]!.type, eventSub.requiredSubscriptions[0]!.type]);
    });
    test('throwing diagnostic sink cannot prevent malformed-session retirement', async () => {
        const eventSub = fixture(undefined, { ...noOpLogger, error: () => { throw new Error('test diagnostic sink failed'); } });
        const starting = eventSub.initialize().catch(error => error);
        await flush();
        const socket = TestSocket.sockets[0]!;
        const handler = socket.listeners('message')[0]!;
        await expect(Promise.resolve(handler('test invalid JSON'))).resolves.toBeUndefined();
        expect(await starting).toBeInstanceOf(SyntaxError);
        expect(eventSub.ws).toBeNull();
        expect(socket.readyState).toBe(3);
        expect(socket.listenerCount('message')).toBe(0);
        await eventSub.cleanup();
        expect(getTimerCount()).toBe(0);
    });
    test('consecutive rate limits respect each minimum before any later subscription request', async () => {
        const requests: string[] = [];
        const eventSub = fixture(async (_url, payload) => {
            requests.push((payload as { type: string }).type);
            if (requests.length <= 2) throw { response: { status: 429, headers: { 'retry-after': String(requests.length) }, data: { error: 'Too Many Requests', message: 'test repeated limit' } } };
            return { data: { data: [{ id: `test-after-limit-${requests.length}`, status: 'enabled' }] } };
        });
        eventSub.requiredSubscriptions.push({ ...eventSub.requiredSubscriptions[0]!, type: 'test.second' });
        const starting = eventSub.initialize();
        await flush();
        TestSocket.sockets[0]!.welcome('test-two-minimums');
        await flush();
        await advance(999);
        expect(requests).toHaveLength(1);
        await advance(1);
        expect(requests).toHaveLength(2);
        await advance(1999);
        expect(requests).toHaveLength(2);
        await advance(1);
        await starting;
        expect(requests).toEqual([eventSub.requiredSubscriptions[0]!.type, eventSub.requiredSubscriptions[0]!.type, eventSub.requiredSubscriptions[0]!.type, 'test.second']);
    });
    test('transient startup revocation cancels pending setup and retries only in a fresh session', async () => {
        let posts = 0;
        let release!: (value: unknown) => void;
        const eventSub = fixture(async () => {
            if (++posts === 2) return new Promise(resolve => { release = resolve; });
            return { data: { data: [{ id: `test-startup-revoke-${posts}`, status: 'enabled' }] } };
        });
        eventSub.requiredSubscriptions.push({ ...eventSub.requiredSubscriptions[0]!, type: 'test.second' });
        const starting = eventSub.initialize();
        await flush();
        const old = TestSocket.sockets[0]!;
        old.welcome('test-transient-startup-old');
        await flush();
        old.message('revocation', { subscription: { type: eventSub.requiredSubscriptions[0]!.type, status: 'test-transient' } });
        await flush();
        expect(eventSub.subscriptionsReady).toBe(false);
        expect(posts).toBe(2);
        release({ data: { data: [{ id: 'test-stale-startup-repair', status: 'enabled' }] } });
        await advance(1000);
        TestSocket.sockets[1]!.welcome('test-transient-startup-new');
        await starting;
        expect(eventSub.isActive()).toBe(true);
        expect(eventSub.cleanupInterval).not.toBeNull();
        expect(eventSub.subscriptions.has('test-stale-startup-repair')).toBe(false);
        expect(posts).toBe(4);
    });
    test('transient overlap revocation cancels migration before fresh recovery can restore readiness', async () => {
        let posts = 0;
        const eventSub = fixture(async () => ({ data: { data: [{ id: `test-overlap-revoke-${++posts}`, status: 'enabled' }] } }));
        const starting = eventSub.initialize();
        await flush();
        const old = TestSocket.sockets[0]!;
        old.welcome('test-transient-overlap-old');
        await starting;
        old.message('session_reconnect', { session: { reconnect_url: 'wss://test.invalid/transient-overlap' } });
        const candidate = TestSocket.sockets[1]!;
        old.message('revocation', { subscription: { type: eventSub.requiredSubscriptions[0]!.type, status: 'test-transient' } });
        await flush();
        candidate.welcome('test-stale-overlap-candidate');
        expect(eventSub.isActive()).toBe(false);
        expect(candidate.readyState).toBe(3);
        expect(posts).toBe(1);
        const recovering = eventSub._reconnect();
        await flush();
        await advance(1000);
        TestSocket.sockets[2]!.welcome('test-overlap-fresh');
        await recovering;
        expect(eventSub.sessionId).toBe('test-overlap-fresh');
        expect(eventSub.isActive()).toBe(true);
        expect(posts).toBe(2);
    });
    test('handoff interrupting a pending repair cannot publish its stale HTTP completion', async () => {
        let posts = 0;
        let release!: (value: unknown) => void;
        let signal!: AbortSignal;
        const eventSub = fixture(async (_url, _payload, config) => {
            if (++posts === 2) {
                signal = (config as { signal: AbortSignal }).signal;
                return new Promise(resolve => { release = resolve; });
            }
            return { data: { data: [{ id: `test-interrupted-repair-${posts}`, status: 'enabled' }] } };
        });
        const starting = eventSub.initialize();
        await flush();
        const old = TestSocket.sockets[0]!;
        old.welcome('test-repair-migration-old');
        await starting;
        old.message('revocation', { subscription: { type: eventSub.requiredSubscriptions[0]!.type, status: 'test-transient' } });
        await flush();
        old.message('session_reconnect', { session: { reconnect_url: 'wss://test.invalid/repair-migration' } });
        await flush();
        expect(signal.aborted).toBe(true);
        expect(eventSub.isActive()).toBe(false);
        release({ data: { data: [{ id: 'test-stale-interrupted-repair', status: 'enabled' }] } });
        await flush();
        expect(eventSub.subscriptions.has('test-stale-interrupted-repair')).toBe(false);
        const recovering = eventSub._reconnect();
        await flush();
        await advance(1000);
        TestSocket.sockets[1]!.welcome('test-repair-migration-new');
        await recovering;
        expect(eventSub.isActive()).toBe(true);
        expect(posts).toBe(3);
    });
    test('concurrent initialization shares one startup operation', async () => {
        const eventSub = fixture();
        const starting = eventSub.initialize();
        expect(eventSub.initialize()).toBe(starting);
        await flush();
        expect(TestSocket.sockets).toHaveLength(1);
        TestSocket.sockets[0]!.welcome('test-coalesced-startup');
        await starting;
        expect(eventSub.isActive()).toBe(true);
        await expect(eventSub._connectWebSocket()).rejects.toThrow('already active');
        expect(TestSocket.sockets).toHaveLength(1);
    });
    test('welcome silence expires and loses readiness exactly once', async () => {
        const eventSub = fixture();
        let disconnected = 0;
        eventSub.on('eventSubDisconnected', () => disconnected++);
        const starting = eventSub.initialize();
        await flush();
        TestSocket.sockets[0]!.welcome('test-session', 0.025);
        await starting;
        expect(eventSub.isActive()).toBe(true);
        await advance(45);
        expect(eventSub.isActive()).toBe(false);
        expect(disconnected).toBe(1);
    });
    test('cleanup during startup GET cannot create a late socket', async () => {
        let release!: (value: object) => void;
        const response = new Promise<object>(resolve => { release = resolve; });
        const eventSub = fixture();
        eventSub.axios.get = async () => await response as never;
        const starting = eventSub.initialize().catch(() => {});
        await flush();
        await eventSub.cleanup();
        release({ data: { data: [] } });
        await flush();
        expect(TestSocket.sockets).toHaveLength(0);
        await starting;
    });
    test('notifications and keepalives reset the silence watchdog at deterministic boundaries', async () => {
        const eventSub = fixture();
        const starting = eventSub.initialize();
        await flush();
        const socket = TestSocket.sockets[0]!;
        socket.welcome('test-session-reset', 60);
        await starting;
        await advance(59999);
        expect(eventSub.isActive()).toBe(true);
        socket.message('session_keepalive');
        await advance(59999);
        expect(eventSub.isActive()).toBe(true);
        socket.message('notification', { subscription: { type: 'test-unknown' }, event: {} });
        await advance(59999);
        expect(eventSub.isActive()).toBe(true);
        await advance(1);
        expect(eventSub.isActive()).toBe(false);
        await eventSub.cleanup();
        expect(getTimerCount()).toBe(0);
    });
    test('handoff starts immediately despite exhausted failure allowance, overlaps notifications and preserves subscriptions', async () => {
        let posts = 0;
        const eventSub = fixture(async () => { posts++; return { data: { data: [{ id: 'test-overlap-sub', status: 'enabled' }] } }; });
        const starting = eventSub.initialize();
        await flush();
        const old = TestSocket.sockets[0]!;
        old.welcome('test-old');
        await starting;
        let notifications = 0;
        eventSub.on('streamOnline', () => notifications++);
        eventSub.retryAttempts = eventSub.maxRetryAttempts;
        old.message('session_reconnect', { session: { reconnect_url: 'wss://test.invalid/migrate?test=synthetic' } });
        expect(TestSocket.sockets).toHaveLength(2);
        expect(eventSub.retryAttempts).toBe(eventSub.maxRetryAttempts);
        expect(old.readyState).toBe(1);
        old.message('notification', { subscription: { type: 'stream.online' }, event: { broadcaster_user_id: 'test-broadcaster', started_at: '2026-01-01T00:00:00.000Z' } });
        await flush();
        expect(notifications).toBe(1);
        old.message('session_reconnect', { session: { reconnect_url: 'wss://test.invalid/duplicate' } });
        TestSocket.sockets[1]!.welcome('test-new');
        await flush();
        expect(old.readyState).toBe(3);
        expect(old.listenerCount('message')).toBe(0);
        old.message('session_reconnect', { session: { reconnect_url: 'wss://test.invalid/retired' } });
        old.emit('close', 1006);
        expect(TestSocket.sockets).toHaveLength(2);
        expect(eventSub.sessionId).toBe('test-new');
        expect(eventSub.isActive()).toBe(true);
        expect(posts).toBe(1);
        expect(eventSub.subscriptions.size).toBe(1);
    });
    test('failed planned handoff enters fresh-session recovery while retiring the failed candidate', async () => {
        const eventSub = fixture();
        const starting = eventSub.initialize();
        await flush();
        const old = TestSocket.sockets[0]!;
        old.welcome('test-handoff-failure-old');
        await starting;
        old.message('session_reconnect', { session: { reconnect_url: 'wss://test.invalid/failed-candidate' } });
        const candidate = TestSocket.sockets[1]!;
        candidate.emit('error', new Error('test migration transport failed'));
        await flush();
        expect(candidate.readyState).toBe(3);
        expect(old.readyState).toBe(1);
        expect(eventSub.isActive()).toBe(false);
        expect(eventSub.reconnectUrl).toBeNull();
        expect(eventSub.reconnectTimeout).not.toBeNull();
        expect(eventSub.retryAttempts).toBe(0);
    });
    test('old close before pending welcome preserves migration without subscription recreation', async () => {
        let posts = 0;
        const eventSub = fixture(async () => { posts++; return { data: { data: [{ id: 'test-migrated-sub', status: 'enabled' }] } }; });
        const starting = eventSub.initialize();
        await flush();
        const old = TestSocket.sockets[0]!;
        old.welcome('test-old-closes');
        await starting;
        old.message('session_reconnect', { session: { reconnect_url: 'wss://test.invalid/migrate' } });
        old.readyState = 3;
        old.emit('close', 1006);
        expect(eventSub.isActive()).toBe(false);
        TestSocket.sockets[1]!.welcome('test-promoted');
        await flush();
        expect(eventSub.sessionId).toBe('test-promoted');
        expect(eventSub.isActive()).toBe(true);
        expect(posts).toBe(1);
    });
    test('cleanup during POST aborts request and fences late map/state publication', async () => {
        let release!: (value: unknown) => void;
        let signal!: AbortSignal;
        const eventSub = fixture(async (_url, _payload, config) => {
            signal = (config as { signal: AbortSignal }).signal;
            return new Promise(resolve => { release = resolve; });
        });
        const starting = eventSub.initialize().catch(() => {});
        await flush();
        const socket = TestSocket.sockets[0]!;
        socket.welcome('test-stale-http');
        await flush();
        let connected = 0;
        eventSub.on('eventSubConnected', () => connected++);
        await eventSub.cleanup();
        expect(signal.aborted).toBe(true);
        release({ data: { data: [{ id: 'test-late-sub', status: 'enabled' }] } });
        await starting;
        await flush();
        expect(eventSub.subscriptions.size).toBe(0);
        expect(eventSub.sessionId).toBeNull();
        expect(eventSub.isActive()).toBe(false);
        expect(connected).toBe(0);
    });
    test('cleanup during planned handoff prevents pending promotion and late startup', async () => {
        const eventSub = fixture();
        const starting = eventSub.initialize();
        await flush();
        TestSocket.sockets[0]!.welcome('test-cleanup-old');
        await starting;
        TestSocket.sockets[0]!.message('session_reconnect', { session: { reconnect_url: 'wss://test.invalid/handoff' } });
        const pending = TestSocket.sockets[1]!;
        await eventSub.cleanup();
        pending.welcome('test-orphan');
        await flush();
        expect(pending.readyState).toBe(3);
        expect(eventSub.sessionId).toBeNull();
        expect(TestSocket.sockets).toHaveLength(2);
    });
    test('duplicate error/close schedules one recovery and cleanup cancels reconnect cleanup GET', async () => {
        const eventSub = fixture();
        const starting = eventSub.initialize();
        await flush();
        const socket = TestSocket.sockets[0]!;
        socket.welcome('test-recover');
        await starting;
        let disconnected = 0;
        eventSub.on('eventSubDisconnected', () => disconnected++);
        socket.emit('error', new Error('test network failure'));
        const timer = eventSub.reconnectTimeout;
        socket.emit('close', 1006);
        expect(eventSub.reconnectTimeout).toBe(timer);
        expect(disconnected).toBe(1);
        let release!: (value: unknown) => void;
        let signal!: AbortSignal;
        eventSub.axios.get = async (_url, config) => {
            signal = (config as { signal: AbortSignal }).signal;
            return new Promise<unknown>(resolve => { release = resolve; }) as never;
        };
        const recovering = eventSub._reconnect();
        await flush();
        await eventSub.cleanup();
        expect(signal.aborted).toBe(true);
        release({ data: { data: [] } });
        await recovering;
        expect(TestSocket.sockets).toHaveLength(1);
    });
    test('cleanup during recovery delay prevents a replacement socket', async () => {
        const eventSub = fixture();
        const starting = eventSub.initialize();
        await flush();
        TestSocket.sockets[0]!.welcome('test-delay');
        await starting;
        const recovering = eventSub._reconnect();
        await flush();
        await eventSub.cleanup();
        await recovering;
        expect(TestSocket.sockets).toHaveLength(1);
    });
    test('terminal revocation loses readiness without POST repair; transient repair publishes loss and restoration', async () => {
        let posts = 0;
        const eventSub = fixture(async () => { posts++; return { data: { data: [{ id: `test-repair-${posts}`, status: 'enabled' }] } }; });
        const starting = eventSub.initialize();
        await flush();
        const socket = TestSocket.sockets[0]!;
        socket.welcome('test-revocation');
        await starting;
        const health: boolean[] = [];
        eventSub.on('eventSubDisconnected', () => health.push(false));
        eventSub.on('eventSubConnected', () => health.push(true));
        socket.message('revocation', { subscription: { type: eventSub.requiredSubscriptions[0]!.type, id: 'test-repair-1', status: 'test-transient' } });
        await flush();
        expect(health).toEqual([false, true]);
        expect(eventSub.isActive()).toBe(true);
        expect(posts).toBe(2);
        socket.message('revocation', { subscription: { type: eventSub.requiredSubscriptions[0]!.type, id: 'test-repair-2', status: 'authorization_revoked' } });
        await flush();
        expect(eventSub.isActive()).toBe(false);
        expect(health).toEqual([false, true, false]);
        expect(posts).toBe(2);
        expect(eventSub.reconnectTimeout).toBeNull();
    });
    test('ambiguous POST timeout is not retried', async () => {
        let posts = 0;
        const eventSub = fixture(async () => { posts++; throw Object.assign(new Error('test ambiguous timeout'), { code: 'ETIMEDOUT' }); });
        eventSub.initialStartupMaxAttempts = 1;
        const starting = eventSub.initialize();
        const failed = starting.catch(error => error);
        await flush();
        TestSocket.sockets[0]!.welcome('test-ambiguous');
        expect((await failed).message).toContain('Subscription setup completed with failures');
        expect(posts).toBe(1);
    });
    test('first subscription deadline cancels a stalled POST and cannot publish late success', async () => {
        let release!: (value: unknown) => void;
        const eventSub = fixture(async () => new Promise(resolve => { release = resolve; }));
        eventSub.initialStartupMaxAttempts = 1;
        const starting = eventSub.initialize().catch(error => error);
        await flush();
        TestSocket.sockets[0]!.welcome('test-first-deadline', 0.06);
        await advance(20);
        TestSocket.sockets[0]!.message('session_keepalive');
        await advance(40);
        const error = await starting;
        expect(error.message).toContain('deadline');
        expect(eventSub.isActive()).toBe(false);
        release({ data: { data: [{ id: 'test-too-late', status: 'enabled' }] } });
        await flush();
        expect(eventSub.subscriptions.size).toBe(0);
    });
    test('first successful subscription releases its deadline while readiness still waits for all POSTs', async () => {
        let posts = 0;
        let release!: (value: unknown) => void;
        const eventSub = fixture(async () => {
            posts++;
            if (posts === 2) return new Promise(resolve => { release = resolve; });
            return { data: { data: [{ id: 'test-first-ready', status: 'enabled' }] } };
        });
        eventSub.requiredSubscriptions.push({ ...eventSub.requiredSubscriptions[0]!, type: 'test.second' });
        const starting = eventSub.initialize();
        await flush();
        const socket = TestSocket.sockets[0]!;
        socket.welcome('test-first-then-rest', 0.06);
        await flush();
        for (let i = 0; i < 3; i++) { await advance(30); socket.message('session_keepalive'); }
        expect(eventSub.subscriptionsReady).toBe(false);
        expect(eventSub.isConnected()).toBe(true);
        release({ data: { data: [{ id: 'test-second-ready', status: 'enabled' }] } });
        await starting;
        expect(eventSub.isActive()).toBe(true);
    });
    test('cleanup cancels initial startup retry delay', async () => {
        const eventSub = fixture();
        eventSub.initialStartupRetryDelay = 60;
        const starting = eventSub.initialize().catch(error => error);
        await flush();
        TestSocket.sockets[0]!.emit('error', Object.assign(new Error('test reset'), { code: 'ECONNRESET' }));
        await flush();
        await eventSub.cleanup();
        await starting;
        await advance(70);
        expect(TestSocket.sockets).toHaveLength(1);
    });
    test('remote DELETE timeout releases its operation and cannot mutate local state later', async () => {
        const eventSub = fixture();
        eventSub.axios.get = async () => ({ data: { data: [{ id: 'test-delete', status: 'enabled', transport: { method: 'websocket', session_id: 'test-delete-session' } }] } }) as never;
        let release!: (value: unknown) => void;
        let signal!: AbortSignal;
        eventSub.axios.delete = async (_url, config) => {
            signal = (config as { signal: AbortSignal }).signal;
            return new Promise<unknown>(resolve => { release = resolve; }) as never;
        };
        eventSub.subscriptions.set('test-delete', { id: 'test-delete' });
        const controller = new AbortController();
        const deleting = eventSub._deleteAllSubscriptions({ sessionId: 'test-delete-session', operationContext: { signal: controller.signal, remainingBudgetMs: () => 30 } });
        await flush();
        await advance(30);
        await deleting;
        expect(signal.aborted).toBe(true);
        release({ data: {} });
        await flush();
        expect(eventSub.subscriptions.has('test-delete')).toBe(true);
    });
    test('transient revocation repair failure recovers health through one fresh session', async () => {
        let posts = 0;
        const eventSub = fixture(async () => {
            posts++;
            if (posts === 2) throw new Error('test transient repair failure');
            return { data: { data: [{ id: `test-recovered-${posts}`, status: 'enabled' }] } };
        });
        const starting = eventSub.initialize();
        await flush();
        TestSocket.sockets[0]!.welcome('test-repair-before');
        await starting;
        TestSocket.sockets[0]!.message('revocation', { subscription: { type: eventSub.requiredSubscriptions[0]!.type, status: 'test-transient' } });
        await flush();
        expect(eventSub.isActive()).toBe(false);
        expect(eventSub.reconnectTimeout).not.toBeNull();
        const recovering = eventSub._reconnect();
        await flush();
        await advance(1030);
        expect(TestSocket.sockets).toHaveLength(2);
        TestSocket.sockets[1]!.welcome('test-repair-after');
        await recovering;
        expect(eventSub.isActive()).toBe(true);
        expect(eventSub.sessionId).toBe('test-repair-after');
        expect(posts).toBe(3);
    });
    test('Retry-After beyond first-subscription budget fails without an early retry', async () => {
        let posts = 0;
        const eventSub = fixture(async () => { posts++; throw { response: { status: 429, headers: { 'retry-after': '120' }, data: { error: 'Too Many Requests', message: 'test rate limit' } } }; });
        const starting = eventSub.initialize();
        const failed = starting.catch(error => error);
        await flush();
        TestSocket.sockets[0]!.welcome('test-rate-limit');
        expect((await failed).message).toContain('Subscription setup completed with failures');
        expect(posts).toBe(1);
    });

});


describe('Twitch root platform subscription startup', () => {
    for (const [status, maxAttempts, throwingLogger] of [[429, 1, false], [403, 1, false], [500, 1, false], [429, 2, false], [403, 2, false], [429, 1, true], [403, 1, true]] as const) test(`replacement ${status} ${status === 500 ? 'permits' : 'suppresses'} outer recovery with allowance ${maxAttempts} and ${throwingLogger ? 'throwing' : 'healthy'} logger`, async () => {
        let rejecting = false;
        let posts = 0;
        let replacementPosts = 0;
        let diagnosticFailures = 0;
        let recoveries = 0;
        const auth = { isReady: () => true, getUserId: () => 'test-recovery-user', refreshTokens: async () => true };
        class SyntheticApiClient extends TwitchApiClient {
            constructor() { super(auth, { clientId: 'test-client' }, noOpLogger, {
                enhancedHttpClient: { get: async () => ({ data: { data: [{ id: 'test-recovery-broadcaster' }] } }) }
            }); }
        }
        const platform = new TwitchPlatform({ enabled: true, channel: 'test-recovery-channel', clientId: 'test-client' }, {
            logger: { ...noOpLogger, error: () => { if (throwingLogger) { diagnosticFailures++; throw new Error('test diagnostic sink failed'); } } }, twitchAuth: auth, TwitchApiClient: SyntheticApiClient, WebSocketCtor: TestSocket,
            axios: {
                get: async () => ({ data: { data: [] } }), delete: async () => ({ data: {} }),
                post: async () => {
                    posts++;
                    if (rejecting && throwingLogger && ++replacementPosts === 1) throw Object.assign(new Error('test earlier reset'), { code: 'ECONNRESET' });
                    if (rejecting) throw { response: { status, headers: { 'retry-after': '120' }, data: { error: status === 403 ? 'Forbidden' : status === 500 ? 'Internal Server Error' : 'Too Many Requests', message: 'test replacement rejection' } } };
                    return { data: { data: [{ id: `test-recovery-sub-${posts}`, status: 'enabled' }] } };
                }
            },
            retrySystem: { handleConnectionError: () => { recoveries++; }, handleConnectionSuccess: () => {}, cancelConnectionRetry: () => {} },
            RawPlatformDataLoggingService: class { async logRawPlatformData() {} }
        });
        try {
            const starting = platform.initialize();
            await flush();
            TestSocket.sockets[0]!.welcome('test-before-rejection');
            await starting;
            const eventSub = platform.eventSub;
            if (!(eventSub instanceof TwitchEventSub)) throw new Error('Expected real EventSub instance');
            eventSub.maxRetryAttempts = maxAttempts;
            const disconnected: Array<{ recoveryBlocked?: boolean; authorizationFailure?: boolean; terminal?: boolean }> = [];
            eventSub.on('eventSubDisconnected', payload => disconnected.push(payload as typeof disconnected[number]));
            rejecting = true;
            TestSocket.sockets[0]!.emit('error', new Error('test transport reset'));
            const recovering = eventSub._reconnect();
            await flush();
            await advance(1000);
            TestSocket.sockets[1]!.welcome('test-rejected-replacement');
            await recovering;
            if (throwingLogger) {
                expect(replacementPosts).toBe(2);
                expect(diagnosticFailures).toBeGreaterThanOrEqual(2);
            }
            expect(recoveries).toBe(status === 500 ? 1 : 0);
            expect(eventSub.reconnectTimeout).toBeNull();
            const terminal = disconnected.filter(payload => payload.terminal);
            expect(terminal).toHaveLength(1);
            if (status === 429) expect(terminal[0]!.recoveryBlocked).toBe(true);
            if (status === 403) expect(terminal[0]!.authorizationFailure).toBe(true);
            const completedPosts = posts;
            await advance(2000);
            expect(TestSocket.sockets).toHaveLength(2);
            expect(posts).toBe(completedPosts);
        } finally { await platform.cleanup(); }
    });
    for (const throwingObservers of [false, true]) test(`real platform receives early notifications with ${throwingObservers ? 'throwing' : 'healthy'} observers`, async () => {
        let release!: (value: unknown) => void;
        let posts = 0;
        let successes = 0;
        let recoveries = 0;
        const auth = { isReady: () => true, getUserId: () => 'test-root-user', refreshTokens: async () => true };
        class SyntheticApiClient extends TwitchApiClient {
            constructor() { super(auth, { clientId: 'test-client' }, noOpLogger, {
                enhancedHttpClient: { get: async () => ({ data: { data: [{ id: 'test-root-broadcaster' }] } }) }
            }); }
        }
        const platform = new TwitchPlatform({ enabled: true, channel: 'test-root-channel', clientId: 'test-client' }, {
            logger: noOpLogger, twitchAuth: auth, TwitchApiClient: SyntheticApiClient, WebSocketCtor: TestSocket,
            axios: {
                get: async () => ({ data: { data: [] } }), delete: async () => ({ data: {} }),
                post: async () => {
                    posts++;
                    if (posts === 2) return new Promise(resolve => { release = resolve; });
                    return { data: { data: [{ id: `test-root-sub-${posts}`, status: 'enabled' }] } };
                }
            },
            retrySystem: { handleConnectionError: () => { recoveries++; }, handleConnectionSuccess: () => { successes++; if (throwingObservers) throw new Error('test retry observer failed'); }, cancelConnectionRetry: () => {} },
            RawPlatformDataLoggingService: class { async logRawPlatformData() {} }
        });
        const delivered: unknown[] = [];
        platform.on('platform:event', event => { if (event.type === PlatformEvents.STREAM_STATUS) delivered.push(event.data); });
        platform.on('platform:event', event => { if (throwingObservers && event.type === PlatformEvents.PLATFORM_CONNECTION) throw new Error('test platform observer failed'); });
        try {
            const starting = platform.initialize();
            void starting.catch(() => {});
            await flush();
            const socket = TestSocket.sockets[0]!;
            socket.welcome('test-root-session');
            await flush();
            expect(posts).toBe(2);
            socket.message('notification', { subscription: { type: 'stream.offline' }, event: { broadcaster_user_id: 'test-root-broadcaster' } });
            await flush();
            expect(delivered).toHaveLength(1);
            expect(platform.isConnected).toBe(false);
            release({ data: { data: [{ id: 'test-root-second', status: 'enabled' }] } });
            await starting;
            expect(platform.isConnected).toBe(true);
            expect(successes).toBe(1);
            const subscriptionType = 'channel.chat.message';
            socket.message('revocation', { subscription: { id: 'test-root-first', type: subscriptionType, status: 'test-transient' } });
            expect(platform.isConnected).toBe(false);
            await flush();
            expect(platform.isConnected).toBe(true);
            socket.message('revocation', { subscription: { id: 'test-root-terminal', type: subscriptionType, status: 'authorization_revoked' } });
            await flush();
            expect(platform.isConnected).toBe(false);
            expect(platform.getConnectionState().isConnected).toBe(false);
            expect(recoveries).toBe(0);
        } finally { await platform.cleanup(); }
    });
});

test('installed ws CONNECTING disposal retains an error sink until close', async () => {
    useRealTimers();
    const nodeRequire = createRequire(import.meta.url);
    const InstalledSocket = nodeRequire('../../node_modules/ws/lib/websocket.js') as new (url: string) => TestSocket;
    let transport: TestSocket | undefined;
    class TrackedInstalledSocket extends InstalledSocket { constructor(url: string) { super(url); transport = this; } }
    const accepted: import('node:net').Socket[] = [];
    const server = createServer(socket => { accepted.push(socket); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const eventSub = new TwitchEventSub({ clientId: 'test-client', broadcasterId: 'test-broadcaster' }, {
        logger: noOpLogger, WebSocketCtor: TrackedInstalledSocket,
        twitchAuth: { isReady: () => true, getUserId: () => 'test-user', refreshTokens: async () => false },
        axios: { get: async () => ({ data: { data: [] } }), post: async () => ({ data: {} }), delete: async () => ({ data: {} }) },
        RawPlatformDataLoggingService: class { async logRawPlatformData() {} }
    });
    try {
        eventSub.reconnectUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const starting = eventSub._connectWebSocket();
        const rejected = starting.catch(error => error);
        const cleaning = eventSub.cleanup();
        const closed = new Promise<void>(resolve => {
            if (transport?.readyState === 3) resolve();
            else transport?.once('close', () => resolve());
        });
        await cleaning;
        expect((await rejected).message).toContain('retired');
        await closed;
        await flush();
        expect(eventSub.ws).toBeNull();
        expect(transport?.readyState).toBe(3);
        expect(transport?.listenerCount('error')).toBe(0);
        expect(transport?.listenerCount('close')).toBe(0);
    } finally {
        await eventSub.cleanup();
        accepted.forEach(socket => socket.destroy());
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
});
