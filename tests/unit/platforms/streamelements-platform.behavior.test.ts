import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { AppLogger } from '../../../src/core/logger/types';
import { StreamElementsPlatform } from '../../../src/platforms/streamelements';
import { noOpLogger } from '../../helpers/mock-factories';
import { createRecordingLogger } from '../../helpers/recording-logger';
import { useFakeTimers, useRealTimers, advanceTimersByTime } from '../../helpers/bun-timers';

class TestWebSocket extends EventEmitter {
  static OPEN = 1;
  static instances: TestWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  constructor(readonly url: string) {
    super();
    TestWebSocket.instances.push(this);
  }
  send(frame: string) { this.sent.push(frame); }
  close() { this.readyState = 3; this.emit('close', 1000); }
  open() { this.readyState = 1; this.emit('open'); }
  receive(frame: unknown) { this.emit('message', Buffer.from(JSON.stringify(frame))); }
  acknowledge(error: unknown = null, nonce = this.subscription().nonce) {
    this.receive({ type: 'response', nonce, error, data: { message: 'Successfully subscribed to topic', room: 'test-room' } });
  }
  subscription(): { type: string; nonce: string; data: Record<string, unknown> } {
    return JSON.parse(this.sent[0]!);
  }
}

const platforms: StreamElementsPlatform[] = [];
const createPlatform = (config: { enabled?: boolean; jwtToken?: string; dataLoggingEnabled?: boolean; dataLoggingPath?: string } = {}, logger: Pick<AppLogger, 'debug' | 'info' | 'warn' | 'error'> = noOpLogger) => {
  const retries: string[] = [];
  const resets: string[] = [];
  const events: unknown[] = [];
  const rawEvents: unknown[] = [];
  const platform = new StreamElementsPlatform({ enabled: true, jwtToken: 'test-only-jwt', dataLoggingEnabled: false, ...config }, {
    logger,
    WebSocketCtor: TestWebSocket,
    retrySystem: {
      incrementRetryCount: (name) => { retries.push(name); return 10; },
      resetRetryCount: (name) => { resets.push(name); },
    },
    eventBus: { emit: (name, payload) => events.push({ name, payload }) },
    rawEventLogWriter: { writeRawEvent: async (entry) => { rawEvents.push(entry); return { fileName: 'test-only.ndjson', filePath: '/tmp/test-only.ndjson' }; } },
  });
  platforms.push(platform);
  return { platform, retries, resets, events, rawEvents };
};
const socket = () => TestWebSocket.instances.at(-1)!;
const activity = (data: Record<string, unknown> = {}, fields: Record<string, unknown> = {}, envelope: Record<string, unknown> = {}) => ({
  type: 'message', topic: 'channel.activities', room: 'test-room',
  data: { type: 'follow', provider: 'youtube', createdAt: '2026-01-01T00:00:00.000Z', data: { displayName: ' Test Viewer ', providerId: ' test-provider-id ', ...data }, ...fields }, ...envelope,
});
async function ready(config: Parameters<typeof createPlatform>[0] = {}) {
  const fixture = createPlatform(config);
  const pending = fixture.platform.initialize();
  socket().open();
  socket().acknowledge();
  await pending;
  return fixture;
}

beforeEach(() => { TestWebSocket.instances = []; });
afterEach(async () => {
  for (const platform of platforms.splice(0)) await platform.disconnect();
  useRealTimers();
});

describe('StreamElements Astro protocol', () => {
  it('reports confirmed readiness once and keeps healthy delivery and raw capture quiet', async () => {
    const logger = createRecordingLogger();
    const { platform, events, rawEvents } = createPlatform({ dataLoggingEnabled: true, dataLoggingPath: '/tmp/test-only-subscriber-capture' }, logger);
    const pending = platform.initialize();
    const ws = socket();
    ws.open();
    ws.receive({ type: 'welcome' });
    expect(platform.isConnected()).toBe(false);
    expect(logger.entries.filter(entry => entry.level === 'info')).toHaveLength(0);
    ws.acknowledge();
    await pending;
    expect(platform.isConnected()).toBe(true);
    expect(logger.entries.filter(entry => entry.level === 'info')).toHaveLength(1);
    logger.entries.length = 0;
    ws.receive({ type: 'welcome' });
    ws.receive(activity());
    await Promise.resolve();
    expect(events).toHaveLength(1);
    expect(rawEvents).toHaveLength(1);
    expect(logger.entries).toHaveLength(0);
  });

  it('stays pending until its subscription is acknowledged and forwards normalized YouTube subscribers', async () => {
    const { platform, resets, events } = createPlatform();
    const statuses: unknown[] = [];
    let settled = false;
    const pending = platform.initialize({ onConnection: (event) => statuses.push(event) }).then((result) => { settled = true; return result; });
    const ws = socket();
    expect(ws.url).toBe('wss://astro.streamelements.com');
    ws.open();
    const subscription = ws.subscription();
    expect(subscription).toMatchObject({ type: 'subscribe', nonce: expect.any(String), data: { topic: 'channel.activities', token: 'test-only-jwt', token_type: 'jwt' } });
    expect(platform.isConnected()).toBe(false);
    ws.receive({ type: 'welcome' });
    ws.acknowledge(null, 'test-wrong-nonce');
    ws.receive(activity());
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(statuses).toHaveLength(0);
    expect(events).toHaveLength(0);
    expect(resets).toHaveLength(0);
    ws.acknowledge();
    expect(await pending).toEqual({ state: 'ready' });
    expect(platform.isConnected()).toBe(true);
    expect(resets).toEqual(['StreamElements']);
    expect(statuses).toEqual([expect.objectContaining({ status: 'connected', willReconnect: false })]);
    ws.receive(activity());
    expect(events).toEqual([{ name: 'platform:event', payload: { platform: 'youtube', type: 'platform:follow', data: { platform: 'youtube', username: 'Test Viewer', userId: 'test-provider-id', timestamp: '2026-01-01T00:00:00.000Z', source: 'streamelements', sourceType: 'streamelements:follow' } } }]);
  });

  it('rejects subscription errors immediately without provider text or retries', async () => {
    useFakeTimers();
    const logger = createRecordingLogger();
    const { platform, retries } = createPlatform({}, logger);
    const pending = platform.initialize();
    const rejection = pending.catch((error: unknown) => error);
    socket().open();
    socket().acknowledge({ message: 'test-private-provider-error test-only-jwt' });
    expect(await rejection).toMatchObject({ message: expect.stringContaining('subscription') });
    expect(platform.isConnected()).toBe(false);
    expect(socket().readyState).toBe(3);
    advanceTimersByTime(60000);
    expect(retries).toHaveLength(0);
    expect(TestWebSocket.instances).toHaveLength(1);
    expect(JSON.stringify(logger.entries)).not.toContain('test-private-provider-error');
    expect(JSON.stringify(logger.entries)).not.toContain('test-only-jwt');
  });

  it.each(['callback', 'listener'])('contains a throwing subscriber %s and processes the next frame', async (target) => {
    const logger = createRecordingLogger();
    const { platform } = createPlatform({}, logger);
    let calls = 0;
    const handler = () => { if (++calls === 1) throw new Error('test-private-handler-error'); };
    if (target === 'listener') platform.on('platform:event', handler);
    const pending = platform.initialize(target === 'callback' ? { onFollow: handler } : {});
    socket().open(); socket().acknowledge(); await pending;
    expect(() => socket().receive(activity())).not.toThrow();
    expect(() => socket().receive(activity())).not.toThrow();
    expect(calls).toBe(2);
    expect(platform.isConnected()).toBe(true);
    expect(JSON.stringify(logger.entries)).not.toContain('test-private-handler-error');
    expect(logger.entries.some((entry) => entry.level === 'error')).toBe(true);
  });

  it.each(['err_deadline_exceeded', 'err_internal_error', 'rate_limit_exceeded'])('recovers from transient subscription error %s', async (errorCode) => {
    useFakeTimers();
    const { platform, retries } = createPlatform();
    const pending = platform.initialize(); socket().open(); socket().acknowledge(errorCode);
    expect(await pending).toMatchObject({ state: 'recovering' });
    expect(retries).toEqual(['StreamElements']);
    advanceTimersByTime(10);
    socket().open(); socket().acknowledge();
    await Promise.resolve();
    expect(platform.isConnected()).toBe(true);
    expect(TestWebSocket.instances).toHaveLength(2);
  });

  it('backs off on a nonce-less rate limit response while subscribing', async () => {
    useFakeTimers();
    const { platform, retries } = createPlatform();
    const pending = platform.initialize(); socket().open();
    socket().receive({ type: 'response', error: 'rate_limit_exceeded' });
    expect(await pending).toMatchObject({ state: 'recovering' });
    expect(retries).toEqual(['StreamElements']);
    advanceTimersByTime(10);
    expect(TestWebSocket.instances).toHaveLength(2);
  });

  it('ignores incomplete responses and accepts documented success without an error field', async () => {
    const { platform } = createPlatform();
    const pending = platform.initialize();
    socket().open();
    socket().receive({ type: 'response', nonce: socket().subscription().nonce });
    expect(platform.isConnected()).toBe(false);
    socket().receive({ type: 'response', nonce: socket().subscription().nonce, data: { topic: 'channel.activities', message: 'successfully subscribed to topic', room: 'test-room' } });
    expect(await pending).toEqual({ state: 'ready' });
  });

  it('filters other providers, activity types, topics and malformed payloads', async () => {
    const { events } = await ready();
    for (const frame of [
      activity({}, { provider: 'twitch' }), activity({}, { type: 'subscriber' }),
      activity({}, {}, { topic: 'channel.tips' }), activity({}, {}, { type: 'event' }),
      activity({}, { data: null }), activity({}, { data: { displayName: 123 } }),
      activity({ displayName: '  ', username: '' }), null, [], 'test-string',
      { type: 'message', topic: 'channel.activities', data: 'test-invalid' },
    ]) socket().receive(frame);
    expect(events).toHaveLength(0);
  });

  it('uses username, userId and timestamp fallbacks and the injected follow handler', async () => {
    const { platform, events } = createPlatform();
    const follows: unknown[] = [];
    const pending = platform.initialize({ onFollow: (event) => follows.push(event) });
    socket().open(); socket().acknowledge(); await pending;
    socket().receive(activity({ displayName: '', username: ' test-handle ', providerId: '', userId: ' test-user-id ' }, { provider: 'YouTube', createdAt: undefined }));
    socket().receive(activity({ displayName: 'test-fallback', providerId: '', userId: '' }));
    expect(follows).toEqual([
      expect.objectContaining({ username: 'test-handle', userId: 'test-user-id', timestamp: expect.any(String) }),
      expect.objectContaining({ username: 'test-fallback', userId: 'test-fallback' }),
    ]);
    expect(Number.isNaN(Date.parse((follows[0] as { timestamp: string }).timestamp))).toBe(false);
    expect(events).toHaveLength(0);
  });

  it('keeps routine logs free of incoming identities, payloads and unknown frame types', async () => {
    const logger = createRecordingLogger();
    const { platform } = createPlatform({}, logger);
    const pending = platform.initialize(); socket().open(); socket().acknowledge(); await pending;
    socket().receive(activity({ displayName: 'test-private-name', providerId: 'test-private-id' }));
    socket().receive({ type: 'test-private-type', data: 'test-private-text' });
    socket().receive(activity({ displayName: '', username: '', raw: 'test-private-raw' }));
    expect(JSON.stringify(logger.entries)).not.toContain('test-private');
  });

  it('optionally writes accepted raw activity through the external log writer', async () => {
    const { rawEvents } = await ready({ dataLoggingEnabled: true, dataLoggingPath: '/tmp/test-only-stream-elements' });
    socket().receive(activity());
    await Promise.resolve();
    expect(rawEvents).toEqual([expect.objectContaining({ platform: 'streamelements', eventType: 'follow', payload: activity() })]);
  });

  it('does not connect when disabled and rejects a missing token', async () => {
    const disabled = createPlatform({ enabled: false }).platform;
    expect(await disabled.initialize()).toEqual({ state: 'monitoring' });
    const missing = createPlatform({ jwtToken: '' }).platform;
    await expect(missing.initialize()).rejects.toThrow('invalid configuration');
    expect(TestWebSocket.instances).toHaveLength(0);
  });

  it('returns ready without creating a second socket when initialized again', async () => {
    const { platform } = await ready();
    expect(await platform.initialize()).toEqual({ state: 'ready' });
    expect(TestWebSocket.instances).toHaveLength(1);
  });
});

describe('StreamElements connection ownership', () => {
  it.each(['opening', 'subscribing'])('bounds the %s attempt and recovers using a new nonce', async (phase) => {
    useFakeTimers();
    const { platform, retries } = createPlatform();
    const pending = platform.initialize();
    const expired = socket();
    if (phase === 'subscribing') expired.open();
    advanceTimersByTime(15000);
    expect(await pending).toMatchObject({ state: 'recovering' });
    expect(expired.readyState).toBe(3);
    expect(expired.eventNames()).toHaveLength(0);
    expect(retries).toEqual(['StreamElements']);
    advanceTimersByTime(10);
    const replacement = socket();
    expect(replacement).not.toBe(expired);
    expired.emit('open'); expired.emit('close', 1006, 'test-stale-close');
    replacement.open();
    if (phase === 'subscribing') expect(replacement.subscription().nonce).not.toBe(expired.subscription().nonce);
    replacement.acknowledge();
    await Promise.resolve();
    expect(platform.isConnected()).toBe(true);
  });

  it.each(['opening', 'subscribing'])('cancels %s without stale recovery', async (phase) => {
    useFakeTimers();
    const { platform } = createPlatform();
    const pending = platform.initialize();
    const rejection = pending.catch((error: unknown) => error);
    if (phase === 'subscribing') socket().open();
    await platform.disconnect(); expect(await rejection).toMatchObject({ message: expect.stringContaining('cancelled') });
    expect(socket().eventNames()).toHaveLength(0);
    advanceTimersByTime(60000);
    expect(TestWebSocket.instances).toHaveLength(1);
    expect(platform.getStatus()).toMatchObject({ isReady: false, hasConnection: false, connectionTime: null });
  });

  it('rejects an early close promptly and schedules only one recovery', async () => {
    useFakeTimers();
    const { platform, retries } = createPlatform();
    const pending = platform.initialize();
    socket().open(); socket().emit('close', 1006, 'test-close');
    expect(await pending).toMatchObject({ state: 'recovering' });
    expect(retries).toEqual(['StreamElements']);
    advanceTimersByTime(10);
    expect(TestWebSocket.instances).toHaveLength(2);
  });

  it('retires a ready socket on an error and recovers even without a close event', async () => {
    useFakeTimers();
    const { platform, retries } = await ready();
    const expired = socket();
    expired.emit('error', new Error('test-network-failure'));
    expect(platform.isConnected()).toBe(false);
    expect(expired.readyState).toBe(3);
    expect(retries).toEqual(['StreamElements']);
    advanceTimersByTime(10);
    expect(TestWebSocket.instances).toHaveLength(2);
  });

  it('handles transport errors during subscription and keeps a single reconnect timer', async () => {
    useFakeTimers();
    const { platform, retries } = createPlatform();
    const pending = platform.initialize(); socket().open();
    socket().emit('error', new Error('connection failed'));
    expect(await pending).toMatchObject({ state: 'recovering' });
    expect(retries).toEqual(['StreamElements']);
    expect(socket().eventNames()).toHaveLength(0);
  });
});
