import { expect, spyOn, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TwitchAuth } from '../../src/auth/TwitchAuth';
import { TWITCH_OAUTH_SCOPES } from '../../src/auth/twitch-oauth-scopes';
import { secrets } from '../../src/core/secrets';
import { TwitchPlatform } from '../../src/platforms/twitch';
import { TwitchEventSub } from '../../src/platforms/twitch-eventsub';
import { PlatformLifecycleService } from '../../src/services/PlatformLifecycleService';
import { TwitchApiClient } from '../../src/utils/api-clients/twitch-api-client';
import { EnhancedHttpClient } from '../../src/utils/enhanced-http-client';
import { TwitchViewerCountProvider } from '../../src/utils/viewer-count-providers';
import { createMainPresentationFixture } from '../helpers/main-presentation-fixture';
import { createTwitchConfigFixture } from '../helpers/config-fixture';
import { noOpLogger } from '../helpers/mock-factories';
import { waitFor } from '../helpers/event-driven-testing';

class SyntheticSocket extends EventEmitter {
    static sockets: SyntheticSocket[] = [];
    readyState = 1;
    constructor(_url: string) { super(); SyntheticSocket.sockets.push(this); }
    close() { this.readyState = 3; this.emit('close', 1000, 'synthetic close'); }
    sendEvent(type: string, event: Record<string, unknown>, id: string) {
        this.emit('message', JSON.stringify({ metadata: { message_type: 'notification', message_id: id,
            message_timestamp: '2026-01-01T00:00:00Z', subscription_type: type },
        payload: { subscription: { type, version: '1' }, event } }));
    }
    welcome() { this.emit('message', JSON.stringify({ metadata: { message_type: 'session_welcome' },
        payload: { session: { id: 'synthetic-session', keepalive_timeout_seconds: 30 } } })); }
}

interface TwitchIngressOwners {
    dir?: string;
    auth?: TwitchAuth;
    main?: Awaited<ReturnType<typeof createMainPresentationFixture>>;
    platform?: TwitchPlatform;
    lifecycle?: PlatformLifecycleService;
}

function createSyntheticAuth(dir: string) {
    return new TwitchAuth({ tokenStorePath: join(dir, 'tokens.json'), clientId: 'synthetic-client', expectedUsername: 'synthetic-user', logger: noOpLogger,
        httpClient: { get: async () => ({ data: { client_id: 'synthetic-client', user_id: 'synthetic-user', login: 'synthetic-user', scopes: [...TWITCH_OAUTH_SCOPES] } }),
            post: async () => ({ data: { access_token: 'synthetic-token', refresh_token: 'synthetic-refresh' } }) } });
}

// Local to this ingress test: acquisition and every retirement share one scope.
async function withTwitchIngressOwners(run: (owners: TwitchIngressOwners) => Promise<void>) {
    const previous = { ...secrets.twitch };
    const owners: TwitchIngressOwners = {};
    const errors: unknown[] = [];
    try {
        secrets.twitch.clientSecret = 'synthetic-secret';
        secrets.twitch.refreshToken = 'synthetic-refresh';
        await run(owners);
    } catch (error) {
        errors.push(error);
    } finally {
        try {
            for (const retire of [
                () => owners.platform?.cleanup(),
                () => owners.lifecycle?.dispose(),
                () => owners.main?.dispose(),
                () => owners.auth?.dispose(),
            ]) {
                try { await retire(); }
                catch (error) { errors.push(error); }
            }
        } finally {
            try { Object.assign(secrets.twitch, previous); }
            catch (error) { errors.push(error); }
            finally {
                try { if (owners.dir) await rm(owners.dir, { recursive: true, force: true }); }
                catch (error) { errors.push(error); }
            }
        }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Twitch ingress setup/execution and retirement failed');
}

test('real Twitch ingress drives offline and online store recovery and retires callbacks', async () => {
    SyntheticSocket.sockets = [];
    await withTwitchIngressOwners(async owners => {
        const dir = owners.dir = await mkdtemp(join(tmpdir(), 'synthetic-twitch-ingress-'));
        const auth = owners.auth = createSyntheticAuth(dir);
        const h = owners.main = await createMainPresentationFixture();
        h.config.twitch.viewerCountEnabled = true;
        let attempts = 0;
        const http = new EnhancedHttpClient({ logger: noOpLogger, axios: {
            get: async () => { attempts++; return { data: { data: [{ viewer_count: 17 }] } }; },
            post: async () => ({}), put: async () => ({}), delete: async () => ({})
        } });
        const provider = new TwitchViewerCountProvider(new TwitchApiClient(null, {}, noOpLogger, { enhancedHttpClient: http }), null,
            { channel: 'synthetic-channel' }, null, noOpLogger);
        const axios = { get: async () => ({ data: { data: [] } }), post: async () => ({ data: { data: [{ id: 'synthetic-subscription', status: 'enabled' }] } }), delete: async () => ({ data: {} }) };
        const platform = owners.platform = new TwitchPlatform(createTwitchConfigFixture({ enabled: true, clientId: 'synthetic-client' }),
            { logger: noOpLogger, twitchAuth: auth, axios, WebSocketCtor: SyntheticSocket });
        expect(await auth.refreshTokens()).toBe(true);
        await h.start();
        const store = h.runtime.viewerCountSystem;
        store.platformProvider = () => ({ twitch: provider });
        const lifecycle = owners.lifecycle = new PlatformLifecycleService({ config: { twitch: { enabled: true } }, eventBus: h.bus, logger: noOpLogger });
        platform.handlers = lifecycle.createDefaultEventHandlers('twitch');
        const statuses: Record<string, unknown>[] = [];
        platform.on('platform:event', envelope => { if (envelope.type === 'platform:stream-status') statuses.push(envelope.data); });
        const starting = platform.initializeEventSub('synthetic-broadcaster');
        await waitFor(() => SyntheticSocket.sockets.length === 1, { timeout: 1000, interval: 1 });
        const old = SyntheticSocket.sockets[0]!; old.welcome(); await starting;
        await store.updateViewerCount('twitch', 42);
        old.sendEvent('stream.offline', {}, 'synthetic-offline');
        await waitFor(() => !store.isStreamLive('twitch') && store.getViewerCount('twitch') === 0, { timeout: 1000, interval: 1 });
        expect(store.getViewerCount('twitch')).toBe(0);
        old.sendEvent('stream.online', { id: 'synthetic-stream', started_at: 'invalid', timestamp: '2026-01-01T00:00:00Z' }, 'synthetic-invalid');
        old.sendEvent('stream.online', { id: 'synthetic-stream' }, 'synthetic-missing');
        expect(statuses.filter(s => s.isLive === true)).toHaveLength(0);
        old.sendEvent('stream.online', { id: 'synthetic-stream', started_at: '2026-01-02T03:04:05Z' }, 'synthetic-online');
        await waitFor(() => store.isStreamLive('twitch'), { timeout: 1000, interval: 1 });
        expect(statuses.filter(s => s.isLive === true)).toHaveLength(1);
        expect(statuses.find(s => s.isLive === true)?.timestamp).toBe('2026-01-02T03:04:05.000Z');
        await store.pollPlatform('twitch');
        expect(attempts).toBe(1); expect(store.getViewerCount('twitch')).toBe(17);
        const retiredInstance = platform.eventSub;
        if (!(retiredInstance instanceof TwitchEventSub)) throw new Error('Expected real EventSub');
        const retiredCallback = retiredInstance.listeners('streamOnline')[0] as ((data: unknown) => void) | undefined;
        expect(retiredCallback).toBeDefined();
        await platform.cleanup();
        retiredCallback?.({ startedAt: '2026-01-02T03:04:05Z' });
        old.sendEvent('stream.online', { started_at: '2026-01-02T03:04:05Z' }, 'synthetic-retired');
        expect(statuses.filter(s => s.isLive === true)).toHaveLength(1);
        expect(old.readyState).toBe(3); expect(old.eventNames()).toHaveLength(0);
        expect(retiredInstance.cleanupInterval).toBeNull(); expect(retiredInstance.welcomeTimer).toBeNull();
        expect(retiredInstance.eventNames()).toHaveLength(0);
        platform.isPlannedDisconnection = false;
        platform.handlers = lifecycle.createDefaultEventHandlers('twitch');
        const restarting = platform.initializeEventSub('synthetic-broadcaster');
        await waitFor(() => SyntheticSocket.sockets.length === 2, { timeout: 1000, interval: 1 });
        const replacement = SyntheticSocket.sockets[1]!; replacement.welcome(); await restarting;
        retiredCallback?.({ startedAt: '2026-01-02T03:04:05Z' });
        replacement.sendEvent('stream.online', { started_at: '2026-01-03T03:04:05Z' }, 'synthetic-replacement');
        expect(statuses.filter(s => s.isLive === true)).toHaveLength(2);
        const replacementInstance = platform.eventSub;
        if (!(replacementInstance instanceof TwitchEventSub)) throw new Error('Expected real replacement EventSub');
        await platform.cleanup();
        expect(replacementInstance.cleanupInterval).toBeNull(); expect(replacementInstance.welcomeTimer).toBeNull();
        expect(replacementInstance.eventNames()).toHaveLength(0);
        expect(replacement.readyState).toBe(3); expect(replacement.eventNames()).toHaveLength(0);
        expect(platform.eventSubListeners).toHaveLength(0);
    });
});

test('partial ingress acquisition restores secrets and removes roots after external setup failure', async () => {
    const previous = { ...secrets.twitch };
    const acquired: TwitchIngressOwners = {};
    let setupError: unknown;
    const result = withTwitchIngressOwners(async owners => {
        acquired.dir = owners.dir = await mkdtemp(join(tmpdir(), 'synthetic-twitch-setup-failure-'));
        acquired.auth = owners.auth = createSyntheticAuth(owners.dir);
        expect(await owners.auth.refreshTokens()).toBe(true);
        acquired.main = owners.main = await createMainPresentationFixture();
        owners.main.config.logging.file.enabled = false;
        try { await readFile(join(owners.dir, 'synthetic-missing-setup.json')); }
        catch (error) { setupError = error; throw error; }
    });
    await expect(result).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(result).rejects.toBe(setupError);
    expect(secrets.twitch).toEqual(previous);
    await expect(stat(acquired.dir!)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(acquired.main!.dir)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(acquired.main!.socket.eventNames()).toHaveLength(0);
    await expect(acquired.auth!.refreshTokens()).rejects.toThrow('Twitch auth is disposed');
}, 5000);

test('ingress retirement reports external disposal and setup failures while retiring later owners', async () => {
    const previous = { ...secrets.twitch };
    const acquired: TwitchIngressOwners = {};
    const setupError = new Error('Synthetic setup failed after socket acquisition');
    const disconnectError = new Error('Synthetic external OBS disconnect failed');
    let disconnectAttempts = 0;
    let eventSub: TwitchEventSub | undefined;
    let socket: SyntheticSocket | undefined;
    SyntheticSocket.sockets = [];
    const result = withTwitchIngressOwners(async owners => {
        acquired.dir = owners.dir = await mkdtemp(join(tmpdir(), 'synthetic-twitch-retirement-failure-'));
        acquired.auth = owners.auth = createSyntheticAuth(owners.dir);
        expect(await owners.auth.refreshTokens()).toBe(true);
        acquired.main = owners.main = await createMainPresentationFixture();
        owners.main.config.logging.file.enabled = false;
        await owners.main.start();
        // The simulated external SDK fails; the actual main/OBS owners are intact.
        owners.main.socket.disconnect = async () => { disconnectAttempts++; throw disconnectError; };
        acquired.lifecycle = owners.lifecycle = new PlatformLifecycleService({ config: { twitch: { enabled: true } }, eventBus: owners.main.bus, logger: noOpLogger });
        acquired.platform = owners.platform = new TwitchPlatform(createTwitchConfigFixture({ enabled: true, clientId: 'synthetic-client' }),
            { logger: noOpLogger, twitchAuth: owners.auth, WebSocketCtor: SyntheticSocket,
                axios: { get: async () => ({ data: { data: [] } }), post: async () => ({ data: { data: [{ id: 'synthetic-subscription', status: 'enabled' }] } }), delete: async () => ({ data: {} }) } });
        owners.platform.handlers = owners.lifecycle.createDefaultEventHandlers('twitch');
        const starting = owners.platform.initializeEventSub('synthetic-broadcaster');
        await waitFor(() => SyntheticSocket.sockets.length === 1, { timeout: 1000, interval: 1 });
        socket = SyntheticSocket.sockets[0]!;
        socket.welcome();
        await starting;
        if (!(owners.platform.eventSub instanceof TwitchEventSub)) throw new Error('Expected real EventSub');
        eventSub = owners.platform.eventSub;
        throw setupError;
    });
    await expect(result).rejects.toBeInstanceOf(AggregateError);
    await expect(result).rejects.toMatchObject({ errors: [setupError, disconnectError] });
    expect(disconnectAttempts).toBe(1);
    expect(secrets.twitch).toEqual(previous);
    await expect(stat(acquired.dir!)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(acquired.main!.dir)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(acquired.auth!.refreshTokens()).rejects.toThrow('Twitch auth is disposed');
    expect(acquired.main!.socket.eventNames()).toHaveLength(0);
    expect(acquired.main!.bus.eventNames()).toHaveLength(0);
    expect(acquired.platform!.eventSub).toBeNull();
    expect(acquired.platform!.eventSubListeners).toHaveLength(0);
    expect(socket!.readyState).toBe(3);
    expect(socket!.eventNames()).toHaveLength(0);
    expect(eventSub!.cleanupInterval).toBeNull();
    expect(eventSub!.welcomeTimer).toBeNull();
    expect(eventSub!.eventNames()).toHaveLength(0);
}, 5000);


test('raw EventSub chat and follow reach actual display owners, preserving emoji parts and excluding self chat', async () => {
    SyntheticSocket.sockets = [];
    await withTwitchIngressOwners(async owners => {
        const dir = owners.dir = await mkdtemp(join(tmpdir(), 'synthetic-twitch-chat-ingress-'));
        const auth = owners.auth = createSyntheticAuth(dir);
        const h = owners.main = await createMainPresentationFixture();
        h.config.twitch.greetingsEnabled = false;
        h.config.twitch.messagesEnabled = true;
        h.config.twitch.followsEnabled = true;
        h.config.logging.file.enabled = false;
        const axios = { get: async () => ({ data: { data: [] } }),
            post: async () => ({ data: { data: [{ id: 'synthetic-chat-subscription', status: 'enabled' }] } }),
            delete: async () => ({ data: {} }) };
        const platform = owners.platform = new TwitchPlatform(createTwitchConfigFixture({ enabled: true, clientId: 'synthetic-client' }),
            { logger: noOpLogger, twitchAuth: auth, axios, WebSocketCtor: SyntheticSocket });
        expect(await auth.refreshTokens()).toBe(true);
        await h.start();
        const lifecycle = owners.lifecycle = new PlatformLifecycleService({ config: { twitch: { enabled: true } }, eventBus: h.bus, logger: noOpLogger });
        platform.handlers = lifecycle.createDefaultEventHandlers('twitch');
        const events: Array<{ type: string; data: Record<string, unknown> }> = [];
        platform.on('platform:event', event => { events.push(event); });
        const connecting = platform.initializeEventSub('synthetic-broadcaster');
        await waitFor(() => SyntheticSocket.sockets.length === 1, { timeout: 1000, interval: 1 });
        const socket = SyntheticSocket.sockets[0]!;
        socket.welcome();
        await connecting;
        // Call-through observations join real async ingress; they provide no replacement behavior.
        const chat = spyOn(platform, 'onMessageHandler');
        const follow = spyOn(platform, 'handleFollowEvent');
        try {
            const payload = (userId: string, text: string) => ({ chatter_user_id: userId,
                chatter_user_name: 'Synthetic Chatter', broadcaster_user_id: 'synthetic-broadcaster',
                badges: [], message: { text } });
            socket.sendEvent('channel.chat.message', payload('synthetic-broadcaster', 'Synthetic self message'), 'synthetic-self-chat');
            socket.sendEvent('channel.chat.message', payload('synthetic-chat-user', 'Synthetic hello world!'), 'synthetic-plain-chat');
            socket.sendEvent('channel.chat.message', { ...payload('synthetic-chat-user', 'Synthetic 🌟 SyntheticEmote 🎉'),
                message: { text: 'Synthetic 🌟 SyntheticEmote 🎉', fragments: [
                    { type: 'text', text: 'Synthetic 🌟 ' },
                    { type: 'emote', text: 'SyntheticEmote', emote: { id: 'synthetic-emote', format: ['static'] } },
                    { type: 'text', text: ' 🎉' },
                ] } }, 'synthetic-emoji-chat');
            expect(chat).toHaveBeenCalledTimes(3);
            await Promise.all(chat.mock.results.map(result => result.value));
            const messages = events.filter(event => event.type === 'platform:chat-message');
            expect(messages).toHaveLength(2);
            expect(messages.map(event => event.data.message)).toEqual([
                { text: 'Synthetic hello world!' },
                { text: 'Synthetic 🌟 SyntheticEmote 🎉', parts: [
                    { type: 'text', text: 'Synthetic 🌟 ' },
                    { type: 'emote', platform: 'twitch', emoteId: 'synthetic-emote',
                        imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/synthetic-emote/static/dark/3.0' },
                    { type: 'text', text: ' 🎉' },
                ] },
            ]);
            expect(messages.every(event => event.data.userId === 'synthetic-chat-user' && event.data.username === 'Synthetic Chatter')).toBe(true);
            socket.sendEvent('channel.follow', { user_id: 'synthetic-follower', user_name: 'Synthetic Follower',
                user_login: 'synthetic-follower', broadcaster_user_id: 'synthetic-broadcaster', followed_at: '2026-01-01T00:00:00Z' }, 'synthetic-follow');
            expect(follow).toHaveBeenCalledTimes(1);
            await Promise.all(follow.mock.results.map(result => result.value));
            await waitFor(() => h.queue.getQueueLength() === 3, { timeout: 1000, interval: 1 });
            await h.drain();
            expect(h.rows.map(row => row.type)).toEqual(['chat', 'platform:follow', 'chat']);
            expect(h.rows.filter(row => row.type === 'chat').map(row => row.data.message)).toEqual(messages.map(event => event.data.message));
            expect(h.rows[1]!.data).toMatchObject({ username: 'Synthetic Follower', userId: 'synthetic-follower',
                displayMessage: 'Synthetic Follower just followed!' });
            expect(h.rows.every(row => row.data.userId !== 'synthetic-broadcaster')).toBe(true);
        } finally {
            try { await platform.cleanup(); }
            finally { chat.mockRestore(); follow.mockRestore(); }
        }
    });
});
