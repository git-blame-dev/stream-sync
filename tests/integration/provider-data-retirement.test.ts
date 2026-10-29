import { afterEach, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { TwitchPlatform } from '../../src/platforms/twitch';
import { TwitchApiClient } from '../../src/utils/api-clients/twitch-api-client';
import { EnhancedHttpClient } from '../../src/utils/enhanced-http-client';
import { TikTokPlatform } from '../../src/platforms/tiktok';
import { TwitchAuth } from '../../src/auth/TwitchAuth';
import { secrets } from '../../src/core/secrets';
import { noOpLogger as logger } from '../helpers/mock-factories';

const initialAccessToken = secrets.twitch.accessToken;
afterEach(() => { secrets.twitch.accessToken = initialAccessToken; });
class SyntheticConnection extends EventEmitter {
  [key: string]: unknown;
  isConnected = true;
  connect = async () => {};
  disconnect = async () => {};
}
const drain = async () => { for (let n = 0; n < 100; n++) await Promise.resolve(); };
const chat = { chatter_user_id: 'synthetic-viewer', chatter_user_name: 'SyntheticViewer',
  broadcaster_user_id: 'synthetic-channel', timestamp: '2026-01-01T00:00:00Z', message: { text: 'synthetic chat' } };
function twitch(get: (url: string) => Promise<Record<string, unknown>>) {
  secrets.twitch.accessToken = 'synthetic-token';
  const platform = new TwitchPlatform({ enabled: false }, { logger, twitchAuth: new TwitchAuth({ logger, clientId: 'synthetic-client', tokenStorePath: '/tmp/synthetic-unread-token-store.json' }) });
  const http = new EnhancedHttpClient({ logger, axios: {
    get, post: async () => ({}), put: async () => ({}), delete: async () => ({}),
  } });
  platform.apiClient = new TwitchApiClient(null, {}, logger, { enhancedHttpClient: http });
  const events: unknown[] = [];
  platform.on('platform:event', event => events.push(event));
  return { platform, events };
}
for (const outcome of ['success', 'empty', 'failure'] as const) {
  test(`Twitch retired avatar ${outcome} cannot publish or refill caches`, async () => {
    const held = Promise.withResolvers<Record<string, unknown>>();
    const entered = Promise.withResolvers<void>();
    const { platform, events } = twitch(async () => { entered.resolve(); return held.promise; });
    const pending = platform.onMessageHandler(chat);
    await entered.promise;
    await platform.cleanup();
    let replacementCalls = 0;
    platform.handlers = { onChat: () => { replacementCalls++; } };
    if (outcome === 'failure') held.reject(new Error('synthetic failure'));
    else held.resolve({ status: 200, data: { data: outcome === 'empty' ? [] : [{ profile_image_url: 'https://synthetic.invalid/avatar.png' }] } });
    await pending;
    expect(events).toHaveLength(0);
    expect(replacementCalls).toBe(0);
    expect(platform.avatarUrlCache.size).toBe(0);
    expect(platform.avatarLookupMissCache.size).toBe(0);
  });
}
test('Twitch retired badge catalog does not issue the next lookup or commit partial catalogs', async () => {
  const held = Promise.withResolvers<Record<string, unknown>>();
  const entered = Promise.withResolvers<void>();
  const urls: string[] = [];
  const { platform, events } = twitch(async url => { urls.push(url); entered.resolve(); return held.promise; });
  const pending = platform.onMessageHandler({ ...chat, badges: [{ set_id: 'synthetic', id: '1' }] });
  await entered.promise;
  await platform.cleanup();
  held.resolve({ status: 200, data: { data: [{ set_id: 'synthetic', versions: [] }] } });
  await pending;
  expect(urls).toHaveLength(1);
  expect(platform.badgeCatalogCache.loaded).toBe(false);
  expect(platform.badgeCatalogCache.global).toEqual([]);
  expect(events).toHaveLength(0);
});
for (const cancelRecovery of [true, false]) {
  test(`TikTok cleanup(${cancelRecovery}) retires admission before disconnect and nested logging`, async () => {
    const held = Promise.withResolvers<void>();
    const disconnect = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const platform = new TikTokPlatform({ enabled: false, dataLoggingEnabled: true, dataLoggingPath: "/tmp/synthetic-unused" }, { logger });
    let writes = 0;
    platform.rawPlatformDataLoggingService.rawEventLogWriter = {
      resolveLogFileName: () => 'synthetic-unused.jsonl',
      writeRawEvent: async () => { writes++; entered.resolve(); await held.promise; return { fileName: "synthetic-unused.jsonl", filePath: "/tmp/synthetic-unused.jsonl" }; },
    };
    const connection = new SyntheticConnection();
    connection.disconnect = async () => disconnect.promise;
    platform.connection = connection;
    platform.setupEventListeners();
    const events: unknown[] = [];
    platform.on('platform:event', event => events.push(event));
    connection.emit('chat', { comment: 'synthetic chat', user: { uniqueId: 'synthetic-viewer', nickname: 'SyntheticViewer' },
      common: { msgId: 'synthetic-message', createTime: 1767225600 } });
    await entered.promise;
    const cleaning = platform.cleanup(cancelRecovery);
    held.resolve();
    await drain();
    expect(events).toHaveLength(0);
    expect(writes).toBe(1);
    disconnect.resolve();
    await cleaning;
  });
}

for (const outcome of ['success', 'failure'] as const) {
  test(`Twitch retired cheermote ${outcome} cannot refill catalog or start raw/avatar work`, async () => {
    const entered = Promise.withResolvers<void>();
    const held = Promise.withResolvers<Record<string, unknown>>();
    let requests = 0;
    const { platform, events } = twitch(async () => { requests++; entered.resolve(); return held.promise; });
    const pending = platform.handleGiftEvent({ userId: 'synthetic-viewer', username: 'SyntheticViewer',
      timestamp: chat.timestamp, giftType: 'synthetic-cheer', giftCount: 1, amount: 100, currency: 'bits',
      cheermoteInfo: { cleanPrefix: 'SyntheticCheer', tier: 100 } });
    await entered.promise;
    await platform.cleanup();
    if (outcome === 'failure') held.reject(new Error('synthetic catalog failure'));
    else held.resolve({ status: 200, data: { data: [] } });
    await pending;
    expect(requests).toBe(1);
    expect(platform.cheermoteCatalogCache).toEqual({ broadcasterId: '', catalog: [], loaded: false });
    expect(platform.avatarLookupMissCache.size).toBe(0);
    expect(events).toHaveLength(0);
  });
}
for (const degraded of [false, true]) {
  test(`Twitch retired ${degraded ? 'degraded' : 'standard'} monetary avatar cannot publish`, async () => {
    const entered = Promise.withResolvers<void>();
    const held = Promise.withResolvers<Record<string, unknown>>();
    const { platform, events } = twitch(async () => { entered.resolve(); return held.promise; });
    const pending = platform.handlePaypiggyEvent({ userId: 'synthetic-viewer', username: 'SyntheticViewer', months: 1,
      ...(degraded ? {} : { timestamp: chat.timestamp }) });
    await entered.promise;
    await platform.cleanup();
    held.reject(new Error('synthetic lookup failure'));
    await pending;
    expect(events).toHaveLength(0);
    expect(platform.avatarLookupMissCache.size).toBe(0);
  });
}

test('Twitch stale avatar completion cannot overwrite a replacement owner cache or invoke its handlers', async () => {
  const held = Promise.withResolvers<Record<string, unknown>>();
  const entered = Promise.withResolvers<void>();
  let requests = 0;
  const { platform, events } = twitch(async () => {
    if (++requests === 1) { entered.resolve(); return held.promise; }
    return { status: 200, data: { data: [{ profile_image_url: 'https://synthetic.invalid/new.png' }] } };
  });
  const old = platform.onMessageHandler(chat);
  await entered.promise;
  await platform.cleanup();
  let replacementCalls = 0;
  platform.handlers = { onChat: () => { replacementCalls++; } };
  await platform.onMessageHandler(chat);
  held.resolve({ status: 200, data: { data: [{ profile_image_url: 'https://synthetic.invalid/old.png' }] } });
  await old;
  expect(events).toHaveLength(1);
  expect(replacementCalls).toBe(1);
  expect([...platform.avatarUrlCache.values()]).toEqual(['https://synthetic.invalid/new.png']);
});

for (const nested of [false, true]) for (const rejection of [false, true]) {
  test(`TikTok same-connection reregistration fences ${nested ? 'nested' : 'ingress'} raw-log ${rejection ? 'failure' : 'success'} continuations`, async () => {
    const held = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const platform = new TikTokPlatform({ enabled: false, dataLoggingEnabled: true, dataLoggingPath: '/tmp/synthetic-unused' }, { logger });
    let writes = 0;
    platform.rawPlatformDataLoggingService.rawEventLogWriter = {
      resolveLogFileName: () => 'synthetic-unused.jsonl',
      writeRawEvent: async () => {
        if (++writes === (nested ? 2 : 1)) { entered.resolve(); await held.promise; }
        return { fileName: 'synthetic-unused.jsonl', filePath: '/tmp/synthetic-unused.jsonl' };
      },
    };
    const connection = new SyntheticConnection();
    platform.connection = connection;
    platform.setupEventListeners();
    const events: unknown[] = [];
    platform.on('platform:event', event => events.push(event));
    const payload = { comment: 'synthetic chat', user: { uniqueId: 'synthetic-viewer', nickname: 'SyntheticViewer' },
      common: { msgId: 'synthetic-old', createTime: 1767225600 } };
    connection.emit('chat', payload);
    await entered.promise;
    platform.cleanupEventListeners();
    platform.setupEventListeners();
    if (rejection) held.reject(new Error('synthetic delayed raw failure'));
    else held.resolve();
    await drain();
    expect(events).toHaveLength(0);
    connection.emit('chat', { ...payload, common: { ...payload.common, msgId: 'synthetic-new' } });
    await drain();
    expect(events).toHaveLength(1);
    await platform.cleanup();
  });
}
for (const cancelRecovery of [true, false]) {
  test(`TikTok cleanup(${cancelRecovery}) intentionally flushes each admitted aggregate exactly once`, async () => {
    const platform = new TikTokPlatform({ enabled: false, giftAggregationEnabled: true }, { logger });
    const events: unknown[] = [];
    platform.on('platform:event', event => events.push(event));
    await platform.handleStandardGift({ platform: 'tiktok', userId: 'synthetic-viewer', username: 'SyntheticViewer',
      giftType: 'synthetic-rose', giftCount: 2, repeatCount: 2, unitAmount: 1, amount: 2, currency: 'coins',
      id: 'synthetic-gift', timestamp: chat.timestamp });
    expect(events).toHaveLength(0);
    await platform.cleanup(cancelRecovery);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'platform:gift', data: { giftCount: 2, amount: 2, isAggregated: true } });
    await platform.cleanup(cancelRecovery);
    expect(events).toHaveLength(1);
  });
}

for (const family of ['chat', 'monetary'] as const) {
  test(`Twitch retired ${family} raw logging cannot begin enrichment`, async () => {
    const held = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    let requests = 0;
    const { platform, events } = twitch(async () => { requests++; return { status: 200, data: { data: [] } }; });
    const { RawPlatformDataLoggingService } = await import('../../src/services/RawPlatformDataLoggingService');
    const logging = platform.rawPlatformDataLoggingService;
    if (!(logging instanceof RawPlatformDataLoggingService)) throw new Error('Expected production raw logger');
    platform.config.dataLoggingEnabled = true;
    logging.dataLoggingPath = '/tmp/synthetic-unused';
    logging.rawEventLogWriter = {
      resolveLogFileName: () => 'synthetic-unused.jsonl',
      writeRawEvent: async () => { entered.resolve(); await held.promise; return { fileName: 'synthetic-unused.jsonl', filePath: '/tmp/synthetic-unused.jsonl' }; },
    };
    const pending = family === 'chat' ? platform.onMessageHandler(chat)
      : platform.handlePaypiggyEvent({ userId: 'synthetic-viewer', username: 'SyntheticViewer', months: 1, timestamp: chat.timestamp });
    await entered.promise;
    await platform.cleanup();
    held.reject(new Error('synthetic delayed capture failure'));
    await pending;
    expect(requests).toBe(0);
    expect(events).toHaveLength(0);
  });
}

for (const rejection of [false, true]) {
  test(`Twitch retired channel badge ${rejection ? 'failure' : 'success'} leaves no partial catalog`, async () => {
    const held = Promise.withResolvers<Record<string, unknown>>();
    const entered = Promise.withResolvers<void>();
    let requests = 0;
    const { platform, events } = twitch(async () => {
      if (++requests === 1) return { status: 200, data: { data: [{ set_id: 'synthetic-global' }] } };
      entered.resolve();
      return held.promise;
    });
    const pending = platform.onMessageHandler({ ...chat, badges: [{ set_id: 'synthetic', id: '1' }] });
    await entered.promise;
    await platform.cleanup();
    if (rejection) held.reject(new Error('synthetic channel badge failure'));
    else held.resolve({ status: 200, data: { data: [] } });
    await pending;
    expect(requests).toBe(2);
    expect(platform.badgeCatalogCache).toEqual({ broadcasterId: '', global: [], channel: [], loaded: false });
    expect(events).toHaveLength(0);
  });
}
