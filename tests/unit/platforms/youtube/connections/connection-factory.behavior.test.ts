import { afterEach, describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { setImmediate as checkpoint } from 'node:timers/promises';
import { YouTubePlatform } from '../../../../../src/platforms/youtube';
import { InnertubeService } from '../../../../../src/services/innertube-service';
import { YouTubeStreamDetectionService } from '../../../../../src/services/youtube-stream-detection-service';
import { ViewerCountExtractionService } from '../../../../../src/services/viewer-count-extraction-service';
import { noOpLogger } from '../../../../helpers/mock-factories';

type Deferred = { promise: Promise<void>; resolve(): void };
type SdkPlan = {
  info?: Record<string, unknown>;
  infoFailure?: unknown;
  chatFailure?: Error;
  startFailure?: Error;
  stopFailure?: unknown;
  filterFailure?: Error;
  earlyStart?: boolean;
  acquire?: Deferred;
  stopGate?: Deferred;
};
const retirements: Array<() => Promise<void>> = [];
afterEach(async () => {
  const results = await Promise.allSettled(retirements.splice(0).reverse().map(retire => retire()));
  const failed = results.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
});
function fixture() {
  const plans = new Map<string, SdkPlan>();
  const chats = new Map<string, Array<EventEmitter & { start(): void; stop(): Promise<void>; applyFilter(filter: string): void }>>();
  const calls: string[] = [], diagnostics: unknown[][] = [];
  const info: unknown[][] = [];
  const logger = { ...noOpLogger, info: (...args: unknown[]) => { info.push(args); }, warn: (...args: unknown[]) => { diagnostics.push(args); },
    error: (...args: unknown[]) => { diagnostics.push(args); } };
  const entered = new Map<string, Deferred>();
  const releases = new Set<Deferred>();
  const owner = new InnertubeService({ createWithTimeout: async () => ({
    getInfo: async (id: string) => {
      calls.push(`info:${id}`);
      const plan = plans.get(id) ?? {};
      entered.get(id)?.resolve();
      if (plan.acquire) { releases.add(plan.acquire); await plan.acquire.promise; }
      if ('infoFailure' in plan) throw plan.infoFailure;
      const chat = Object.assign(new EventEmitter(), {
        start() {
          calls.push(`start:${id}`);
          if (plan.startFailure) throw plan.startFailure;
          if (plan.earlyStart) chat.emit('start', { actions: [] });
        },
        async stop() {
          calls.push(`stop:${id}`);
          if (plan.stopGate) { releases.add(plan.stopGate); await plan.stopGate.promise; }
          if ('stopFailure' in plan) throw plan.stopFailure;
        },
        applyFilter(filter: string) {
          calls.push(`filter:${id}:${filter}`);
          if (plan.filterFailure) throw plan.filterFailure;
        },
      });
      chats.set(id, [...(chats.get(id) ?? []), chat]);
      return { basic_info: { id, is_live: true },
        page: [{}, { current_video_endpoint: { payload: { videoId: id } } }],
        livechat: { continuation: 'SYNTHETIC_CHAT_CONTINUATION', is_replay: false }, ...plan.info,
        getLiveChat: async () => {
          calls.push(`chat:${id}`);
          if (plan.chatFailure) throw plan.chatFailure;
          return chat;
        } };
    },
  }) }, { logger });
  const detector = new YouTubeStreamDetectionService(owner, { logger });
  let platform: YouTubePlatform | undefined;
  retirements.push(async () => {
    for (const plan of plans.values()) { plan.acquire?.resolve(); plan.stopGate?.resolve(); }
    for (const release of releases) release.resolve();
    try { await platform?.cleanup(); } finally { try { await detector.cleanup(); } finally { await owner.dispose(); } }
  });
  platform = new YouTubePlatform({ enabled: true, enableAPI: false, chatMode: 'live',
    dataLoggingEnabled: false, envFileReadEnabled: false, envFileWriteEnabled: false }, {
    logger, innertubeService: owner, streamDetectionService: detector,
    viewerExtractionService: new ViewerCountExtractionService(owner, { logger }),
  });
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  platform.on('platform:event', event => { events.push(event); });
  const chat = (id: string) => {
    const value = chats.get(id)?.at(-1);
    if (!value) throw new Error(`Missing synthetic SDK chat ${id}`);
    return value;
  };
  return { platform, manager: platform.connectionManager, owner, detector, plans, chats, chat, calls, diagnostics, entered, events, info,
    connect: (id: string) => platform!.connectionManager.connectToStream(id,
      (videoId, attempt, context) => platform!._createYouTubeConnection(videoId, attempt, context)),
  };
}
const direct = (name = 'Synthetic viewer') => ({ author: { id: 'UC_SYNTHETIC', name }, text: 'Synthetic hello' });
const messages = (f: ReturnType<typeof fixture>) => f.events.filter(event => event.type === 'platform:chat-message');

import { createYouTubeConnectionFactory } from '../../../../../src/platforms/youtube/connections/youtube-connection-factory';

describe('default YouTube factory with actual platform owners', () => {
  test('validates constructor inputs without executing an internal substitute', () => {
    expect(() => createYouTubeConnectionFactory()).toThrow('requires platform instance');
    const f = fixture();
    expect(() => createYouTubeConnectionFactory({ platform: f.platform._createConnectionFactoryPlatformAdapter() }))
      .toThrow('requires positive innertubeCreationTimeoutMs');
    for (const budget of [0, -1, Number.NaN]) {
      expect(() => createYouTubeConnectionFactory({ platform: f.platform._createConnectionFactoryPlatformAdapter(), innertubeCreationTimeoutMs: budget }))
        .toThrow('requires positive innertubeCreationTimeoutMs');
    }
  });

  for (const unavailable of [false, true]) test(`rejects real VOD validation before chat acquisition (unavailable=${unavailable})`, async () => {
    const f = fixture();
    f.plans.set('synthetic-vod', { info: { basic_info: { is_live: false } },
      ...(unavailable ? { chatFailure: new Error('Live Chat is not available') } : {}) });
    const controller = new AbortController();
    await expect(f.platform._youtubeConnectionFactory.createConnection('synthetic-vod', {
      signal: controller.signal, adopt() { throw new Error('Rejected VOD must not adopt'); },
    })).rejects.toThrow('Stream validation failed: Video is not live content (replay/VOD or unverified broadcast)');
    expect(f.calls).toEqual(['info:synthetic-vod']);
  });

  test('adopts the actual managed resource before start and preserves setup error identity', async () => {
    const f = fixture();
    const controller = new AbortController();
    const adopted: unknown[] = [];
    const connection = await f.platform._youtubeConnectionFactory.createConnection('synthetic-adopt', {
      signal: controller.signal, adopt(value) { adopted.push(value); },
    });
    try {
      expect(adopted).toEqual([connection]);
      expect(f.calls).toEqual(['info:synthetic-adopt', 'chat:synthetic-adopt']);
    } finally { await connection.stop(); }
    expect(f.calls.at(-1)).toBe('stop:synthetic-adopt');
    const failure = new Error('Synthetic getLiveChat failure');
    f.plans.set('synthetic-failed', { chatFailure: failure });
    await expect(f.platform._youtubeConnectionFactory.createConnection('synthetic-failed', {
      signal: controller.signal, adopt() { throw new Error('Failed setup must not adopt'); },
    })).rejects.toBe(failure);
  });

  test('start failure retires the adopted SDK even when SDK stop fails, and a fresh attempt recovers', async () => {
    const f = fixture();
    f.plans.set('synthetic-start', { startFailure: new Error('Synthetic start failed'), stopFailure: new Error('Synthetic stop failed') });
    expect(await f.connect('synthetic-start')).toBe(false);
    expect(f.manager.hasConnection('synthetic-start')).toBe(false);
    expect(f.calls.filter(call => call === 'stop:synthetic-start')).toHaveLength(1);
    f.plans.delete('synthetic-start');
    expect(await f.connect('synthetic-start')).toBe(true);
    f.chat('synthetic-start').emit('chat-update', direct());
    await checkpoint();
    expect(messages(f)).toHaveLength(1);
  });

  for (const [mode, selected, expected] of [
    ['live', 0, 'LIVE_CHAT'], ['top', 1, 'TOP_CHAT'], ['live', 1, null],
  ] as const) test(`external start selects ${mode} from menu index ${selected}`, async () => {
    const f = fixture(); f.platform.config.chatMode = mode;
    expect(await f.connect('synthetic-mode')).toBe(true);
    expect(f.manager.isConnectionReady('synthetic-mode')).toBe(false);
    f.chat('synthetic-mode').emit('start', { header: { view_selector: { sub_menu_items: [
      { selected: selected === 0, continuation: 'synthetic-top' },
      { selected: selected === 1, continuation: selected === 1 ? null : 'synthetic-live' },
    ] } }, actions: [{ item: { type: 'LiveChatTextMessage' } }] });
    await checkpoint();
    expect(f.manager.isConnectionReady('synthetic-mode')).toBe(true);
    expect(f.calls.filter(call => call.startsWith('filter:'))).toEqual(expected ? [`filter:synthetic-mode:${expected}`] : []);
    expect(messages(f)).toEqual([]);
  });

  test('missing selector and failed external filter preserve readiness and subsequent chat', async () => {
    const f = fixture();
    f.plans.set('synthetic-mode', { filterFailure: new Error('Synthetic filter failed') });
    expect(await f.connect('synthetic-mode')).toBe(true);
    const chat = f.chat('synthetic-mode');
    chat.emit('start', { actions: [] }); await checkpoint();
    expect(f.calls.filter(call => call.startsWith('filter:'))).toEqual([]);
    expect(f.manager.isConnectionReady('synthetic-mode')).toBe(true);
    chat.emit('start', { header: { view_selector: { sub_menu_items: [
      { selected: true, continuation: 'top' }, { selected: false, continuation: 'live' },
    ] } } });
    await checkpoint();
    expect(f.diagnostics.flat().some(value => String(value).includes('Synthetic filter failed'))).toBe(true);
    chat.emit('chat-update', direct()); await checkpoint();
    expect(messages(f)).toHaveLength(1);
  });

  for (const [field, value] of [
    ['timestamp_usec', '1704067200000000'], ['timestamp', 1704067200000],
  ] as const) test(`normalizes direct SDK chat and preserves ${field}`, async () => {
    const f = fixture(); expect(await f.connect('synthetic-chat')).toBe(true);
    f.chat('synthetic-chat').emit('chat-update', { ...direct(), [field]: value });
    await checkpoint();
    expect(messages(f)).toHaveLength(1);
    expect(messages(f)[0]?.data).toMatchObject({ platform: 'youtube', username: 'Synthetic viewer',
      userId: 'UC_SYNTHETIC', message: { text: 'Synthetic hello' }, timestamp: '2024-01-01T00:00:00.000Z' });
  });

  test('rejects missing direct identity and complex missing authors, then dispatches a healthy complex action', async () => {
    const f = fixture(); expect(await f.connect('synthetic-chat')).toBe(true);
    const chat = f.chat('synthetic-chat');
    chat.emit('chat-update', { author: { name: 'Synthetic missing ID' }, text: 'Synthetic reject' });
    chat.emit('chat-update', { type: 'AddChatItemAction', item: { type: 'LiveChatTickerSponsorItem', id: 'synthetic-missing' } });
    chat.emit('chat-update', { type: 'AddChatItemAction', item: { type: 'LiveChatTextMessage', id: 'synthetic-valid',
      author: { id: 'UC_SYNTHETIC', name: 'Synthetic complex' }, message: { text: 'Synthetic complex text' } } });
    await checkpoint();
    expect(messages(f)).toHaveLength(1);
    expect(messages(f)[0]?.data).toMatchObject({ username: 'Synthetic complex', message: { text: 'Synthetic complex text' } });
  });

  test('real batch extraction filters a system action while preserving the following viewer message', async () => {
    const f = fixture(); expect(await f.connect('synthetic-batch')).toBe(true);
    f.chat('synthetic-batch').emit('chat-update', { actions: [
      { addChatItemAction: { item: { type: 'LiveChatPlaceholderItem', id: 'synthetic-skip',
        author: { id: 'UC_SYNTHETIC_SKIP', name: 'Synthetic skipped' }, message: { text: 'Synthetic skip' } } } },
      { addChatItemAction: { item: { type: 'LiveChatTextMessage', id: 'synthetic-keep',
        author: { id: 'UC_SYNTHETIC_KEEP', name: 'Synthetic kept' }, message: { text: 'Synthetic kept text' } } } },
    ] });
    await checkpoint();
    expect(messages(f)).toHaveLength(1);
    expect(messages(f)[0]?.data).toMatchObject({ username: 'Synthetic kept', userId: 'UC_SYNTHETIC_KEEP',
      message: { text: 'Synthetic kept text' } });
  });

  test('public listener setup preserves SDK start failure and attempts both unowned SDK shutdown methods', async () => {
    const f = fixture(), calls: string[] = [];
    const failure = new Error('Synthetic unowned start failed');
    const raw = Object.assign(new EventEmitter(), {
      start() { throw failure; },
      stop() { calls.push('stop'); throw new Error('Synthetic unowned stop failed'); },
      disconnect() { calls.push('disconnect'); },
    });
    await expect(f.platform._youtubeConnectionFactory.setupConnectionEventListeners(raw, 'synthetic-unowned', 7)).rejects.toBe(failure);
    expect(calls).toEqual(['stop', 'disconnect']);
    expect(f.diagnostics).toContainEqual(expect.arrayContaining([expect.objectContaining({ error: 'Synthetic unowned stop failed' })]));
    raw.removeAllListeners();
  });

  test('real extractor hydrates gift purchase header and modern GiftMessageView authors', async () => {
    const f = fixture(); expect(await f.connect('synthetic-gifts')).toBe(true);
    const chat = f.chat('synthetic-gifts');
    chat.emit('chat-update', { type: 'AddChatItemAction', item: {
      type: 'LiveChatSponsorshipsGiftPurchaseAnnouncement', id: 'synthetic-memberships',
      timestamp_usec: '1704067200000000', author_external_channel_id: 'UC_SYNTHETIC_GIFTER',
      header: { type: 'LiveChatSponsorshipsHeader', author_name: { text: '@SyntheticGifter' },
        author_photo: [{ url: 'https://synthetic.invalid/avatar.png' }], author_badges: [] },
      giftMembershipsCount: 5, message: { text: '' },
    } });
    chat.emit('chat-update', { type: 'AddChatItemAction', item: {
      type: 'GiftMessageView', id: 'synthetic-gift-view', timestamp_usec: '1704067200000000',
      text: { content: 'sent Let em cook' }, author_name: { content: '@SyntheticModern ' },
      gift_image: { sources: [{ url: 'https://synthetic.invalid/gift.png', width: 640, height: 640 }] },
      gift_image_a11y_label: 'Let em cook',
    } });
    await checkpoint();
    const gifts = f.events.filter(event => ['platform:gift', 'platform:giftpaypiggy'].includes(event.type));
    expect(gifts).toHaveLength(2);
    expect(gifts[0]?.data).toMatchObject({ username: 'SyntheticGifter', giftCount: 5 });
    expect(gifts[1]?.data).toMatchObject({ username: 'SyntheticModern', giftCount: 1 });
  });

  for (const error of ['403 forbidden', '503 upstream unavailable', 'Unexpected live chat incremental continuation response', 'end'])
    test(`actual callbacks contain ${error} and allow recovery`, async () => {
      const f = fixture(); expect(await f.connect('synthetic-error')).toBe(true);
      const original = f.chat('synthetic-error');
      if (error === 'end') original.emit('end'); else original.emit('error', new Error(error));
      await checkpoint();
      expect(f.manager.hasConnection('synthetic-error')).toBe(error.startsWith('503'));
      if (!error.startsWith('503')) expect(await f.connect('synthetic-error')).toBe(true);
      f.chat('synthetic-error').emit('chat-update', direct()); await checkpoint();
      expect(messages(f)).toHaveLength(1);
    });

  test('repeated SDK starts announce readiness once and preserve current chat delivery', async () => {
    const f = fixture();
    expect(await f.connect('synthetic-start')).toBe(true);
    const chat = f.chat('synthetic-start');
    f.info.length = 0;
    chat.emit('start', { actions: [] });
    await checkpoint();
    const first = f.info.slice();
    expect(first.some(entry => String(entry[0]).includes('Chat listener started'))).toBe(true);
    chat.emit('start', { actions: [] });
    await checkpoint();
    expect(f.info).toEqual(first);
    expect(f.manager.isConnectionReady('synthetic-start')).toBe(true);
    chat.emit('chat-update', direct());
    await checkpoint();
    expect(messages(f)).toHaveLength(1);
  });

  test('detached generation cannot deliver start, chat, error or end into a successful replacement', async () => {
    const f = fixture(); expect(await f.connect('synthetic-stale')).toBe(true);
    const stale = f.chat('synthetic-stale');
    // Keep external references to the SDK listeners to model already queued late delivery.
    const queued = ['start', 'chat-update', 'error', 'end'].map(event => stale.listeners(event));
    await f.manager.removeConnection('synthetic-stale');
    expect(await f.connect('synthetic-stale')).toBe(true);
    for (const [index, payload] of [{ actions: [] }, direct('Synthetic stale'), new Error('403 stale'), undefined].entries()) {
      for (const listener of queued[index]!) listener(payload);
    }
    await checkpoint();
    expect(f.manager.getConnectionCount()).toBe(1);
    expect(f.manager.isConnectionReady('synthetic-stale')).toBe(false);
    expect(messages(f)).toEqual([]);
    f.chat('synthetic-stale').emit('start', { actions: [] });
    f.chat('synthetic-stale').emit('chat-update', direct('Synthetic current')); await checkpoint();
    expect(f.manager.isConnectionReady('synthetic-stale')).toBe(true);
    expect(messages(f).map(event => event.data.username)).toEqual(['Synthetic current']);
  });
});
