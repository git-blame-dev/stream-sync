import { afterEach, describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { setImmediate as checkpoint } from 'node:timers/promises';
import { YouTubePlatform } from '../../../src/platforms/youtube';
import { InnertubeService } from '../../../src/services/innertube-service';
import { YouTubeStreamDetectionService } from '../../../src/services/youtube-stream-detection-service';
import { ViewerCountExtractionService } from '../../../src/services/viewer-count-extraction-service';
import { noOpLogger } from '../../helpers/mock-factories';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
};
type SdkPlan = {
  info?: Record<string, unknown>;
  infoFailure?: unknown;
  chatFailure?: Error;
  chatAcquire?: ReturnType<typeof deferred>;
  startFailure?: Error;
  stopFailure?: unknown;
  filterFailure?: Error;
  earlyStart?: boolean;
  acquire?: ReturnType<typeof deferred>;
  stopGate?: ReturnType<typeof deferred>;
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
  const logger = { ...noOpLogger, debug: (...args: unknown[]) => { diagnostics.push(args); },
    warn: (...args: unknown[]) => { diagnostics.push(args); },
    error: (...args: unknown[]) => { diagnostics.push(args); } };
  const entered = new Map<string, ReturnType<typeof deferred>>();
  const releases = new Set<ReturnType<typeof deferred>>();
  const owner = new InnertubeService({ createWithTimeout: async () => ({
    getInfo: async (id: string) => {
      calls.push(`info:${id}`);
      const plan = plans.get(id) ?? {};
      if (!plan.chatAcquire) entered.get(id)?.resolve();
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
          if (plan.chatAcquire) { releases.add(plan.chatAcquire); entered.get(id)?.resolve(); await plan.chatAcquire.promise; }
          if (plan.chatFailure) throw plan.chatFailure;
          return chat;
        } };
    },
  }) }, { logger });
  const detector = new YouTubeStreamDetectionService(owner, { logger });
  let platform: YouTubePlatform | undefined;
  retirements.push(async () => {
    for (const plan of plans.values()) { plan.acquire?.resolve(); plan.chatAcquire?.resolve(); plan.stopGate?.resolve(); }
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
  return { platform, manager: platform.connectionManager, owner, detector, plans, chats, chat, calls, diagnostics, entered, events,
    connect: (id: string) => platform!.connectionManager.connectToStream(id,
      (videoId, attempt, context) => platform!._createYouTubeConnection(videoId, attempt, context)),
  };
}
const direct = (name = 'Synthetic viewer') => ({ author: { id: 'UC_SYNTHETIC', name }, text: 'Synthetic hello' });
const messages = (f: ReturnType<typeof fixture>) => f.events.filter(event => event.type === 'platform:chat-message');

import { YouTubeConnectionManager } from '../../../src/platforms/youtube/youtube-connection-manager';
import { useFakeTimers, useRealTimers, advanceTimersByTime, getTimerCount } from '../../helpers/bun-timers';

const flush = async () => { for (let index = 0; index < 60; index++) await Promise.resolve(); };

describe('YouTube manager through actual platform and default factory', () => {
  test('connects unavailable playback to live chat and announces readiness once, including filter reloads', async () => {
    const f = fixture();
    const id = 'synthetic_A';
    f.plans.set(id, { info: { playability_status: { status: 'UNPLAYABLE' } } });
    expect(await f.platform.connectToYouTubeStream(id)).toBe(true);
    expect(f.manager.isConnectionReady(id)).toBe(false);
    const connected = () => f.events.filter(event => event.type === 'platform:chat-connected');
    expect(connected()).toEqual([]);
    const header = { header: { view_selector: { sub_menu_items: [
      { selected: true }, { selected: false, continuation: 'SYNTHETIC_LIVE_FILTER' }
    ] } } };
    f.chat(id).emit('start', header); await checkpoint();
    f.chat(id).emit('start', header); await checkpoint();
    expect(f.manager.isConnectionReady(id)).toBe(true);
    expect(connected()).toHaveLength(1);
    expect(connected()[0]?.data).toMatchObject({ videoId: id, connectionId: `youtube-${id}` });
    expect(f.calls.filter(call => call === `filter:${id}:LIVE_CHAT`)).toHaveLength(2);
    f.chat(id).emit('chat-update', direct()); await checkpoint();
    expect(messages(f)).toHaveLength(1);
    const old = f.chat(id);
    await f.manager.disconnectFromStream(id);
    expect(await f.platform.connectToYouTubeStream(id)).toBe(true);
    old.emit('start', header); await checkpoint();
    expect(f.manager.isConnectionReady(id)).toBe(false);
    expect(connected()).toHaveLength(1);
    f.chat(id).emit('start', header); await checkpoint();
    expect(connected()).toHaveLength(2);
  });

  test('does not announce chat connected merely because playable acquisition succeeded', async () => {
    const f = fixture();
    expect(await f.platform.connectToYouTubeStream('synthetic_A')).toBe(true);
    expect(f.events.filter(event => event.type === 'platform:chat-connected')).toEqual([]);
  });

  for (const info of [
    { page: [{}, { current_video_endpoint: { payload: { videoId: 'synthetic_B' } } }] },
    { livechat: undefined },
    { livechat: { continuation: 'SYNTHETIC_PRIVATE_CONTINUATION', is_replay: true } },
    { livechat: { continuation: '', is_replay: false } },
  ]) {
    test(`rejects invalid chat before acquisition and safely releases the reservation: ${JSON.stringify(info)}`, async () => {
      const f = fixture();
      f.plans.set('synthetic_A', { info: { ...info,
        playability_status: { status: 'SYNTHETIC_PRIVATE_STATUS', reason: 'SYNTHETIC_PRIVATE_REASON' } } });
      expect(await f.platform.connectToYouTubeStream('synthetic_A')).toBe(false);
      expect(f.calls).toEqual(['info:synthetic_A']);
      expect(f.manager.getConnectionCount()).toBe(0);
      expect(f.events.filter(event => event.type === 'platform:chat-connected')).toEqual([]);
      const admission = f.diagnostics.find(entry => entry[0] === 'YouTube chat admission rejected');
      expect(admission?.[2]).toMatchObject({ broadcast: 'live', playbackStatus: 'UNKNOWN' });
      expect(JSON.stringify(f.diagnostics)).not.toContain('SYNTHETIC_PRIVATE');
      f.plans.delete('synthetic_A');
      expect(await f.platform.connectToYouTubeStream('synthetic_A')).toBe(true);
    });
  }

  test('preserves synchronous external start before factory resolution', async () => {
    const f = fixture(); f.plans.set('synthetic-early', { earlyStart: true });
    expect(await f.connect('synthetic-early')).toBe(true);
    expect(f.manager.getConnectionStatus('synthetic-early')).toMatchObject({ state: 'ready', ready: true });
    expect(f.manager.getReadyConnectionCount()).toBe(1);
    expect(f.events.filter(event => event.type === 'platform:chat-connected')).toHaveLength(1);
  });

  test('tracks registry, metadata, independent readiness, aggregate queries and defensive snapshots', async () => {
    const f = fixture();
    expect(f.manager.getAllConnections()).toEqual([]);
    expect(f.manager.getConnectionStatus('synthetic-missing')).toBeNull();
    expect(f.manager.isConnectionReady('synthetic-missing')).toBe(false);
    for (const id of ['synthetic-one', 'synthetic-two', 'synthetic-three']) {
      expect(await f.manager.connectToStream(id,
        (videoId, attempt, context) => f.platform._createYouTubeConnection(videoId, attempt, context),
        { reason: 'Synthetic detection' })).toBe(true);
      expect(f.manager.getConnectionStatus(id)).toMatchObject({ videoId: id, state: 'connected', ready: false,
        metadata: { reason: 'Synthetic detection', connectedAt: expect.any(String) } });
    }
    expect(f.manager.getAllConnectionData()).toHaveLength(3);
    expect(f.manager.getAllConnections()).toHaveLength(3);
    expect(f.manager.getConnection('synthetic-one')).toBeDefined();
    expect(Number.isFinite(Date.parse(String(f.manager.getConnectionStatus('synthetic-one')?.metadata.connectedAt)))).toBe(true);
    f.chat('synthetic-two').emit('start', { actions: [] }); await checkpoint();
    const summary = { totalConnections: 3, readyConnections: 1,
      activeVideoIds: ['synthetic-one', 'synthetic-two', 'synthetic-three'], hasAnyReady: true };
    expect(f.manager.getConnectionState()).toEqual(summary);
    expect(f.manager.getStats()).toEqual(summary);
    expect(f.manager.hasAnyReady()).toBe(true);
    const listed = f.manager.getAllConnectionData()[0]!;
    const status = f.manager.getConnectionStatus('synthetic-one')!;
    listed.state = 'error'; listed.metadata.reason = 'Synthetic mutation'; status.metadata.reason = 'Synthetic other mutation';
    expect(f.manager.getConnectionStatus('synthetic-one')).toMatchObject({ state: 'connected', metadata: { reason: 'Synthetic detection' } });
    expect(await f.manager.disconnectFromStream('synthetic-two', 'Synthetic removal')).toBe(true);
    expect(f.calls.filter(call => call === 'stop:synthetic-two')).toHaveLength(1);
    expect(f.manager.getActiveVideoIds()).toEqual(['synthetic-one', 'synthetic-three']);
    expect(f.manager.getReadyConnectionCount()).toBe(0);
    for (const id of ['synthetic-one', 'synthetic-three']) expect(await f.manager.disconnectFromStream(id)).toBe(true);
    expect(f.manager.getAllConnections()).toEqual([]);
    expect(f.manager.getConnection('synthetic-one')).toBeUndefined();
    expect(f.manager.getStats()).toEqual({ totalConnections: 0, readyConnections: 0, activeVideoIds: [], hasAnyReady: false });
  });

  test('duplicate pending and connected attempts never acquire a second SDK chat', async () => {
    const f = fixture(), acquire = deferred(), entered = deferred();
    f.plans.set('synthetic-duplicate', { acquire }); f.entered.set('synthetic-duplicate', entered);
    const pending = f.connect('synthetic-duplicate');
    try {
      await entered.promise;
      expect(await f.connect('synthetic-duplicate')).toBe(false);
      expect(f.manager.getConnectionStatus('synthetic-duplicate')?.state).toBe('connecting');
    } finally { acquire.resolve(); }
    expect(await pending).toBe(true);
    expect(await f.connect('synthetic-duplicate')).toBe(false);
    expect(f.calls.filter(call => call === 'info:synthetic-duplicate')).toHaveLength(1);
  });

  test('concurrent disconnect and repeated connect/disconnect cycles preserve exact retirement counts', async () => {
    const f = fixture();
    expect(await f.manager.disconnectFromStream('synthetic-missing')).toBe(false);
    for (let index = 0; index < 5; index++) {
      expect(await f.connect('synthetic-cycle')).toBe(true);
      const outcomes = await Promise.all([f.manager.disconnectFromStream('synthetic-cycle'), f.manager.disconnectFromStream('synthetic-cycle')]);
      expect(outcomes).toEqual([true, false]);
      expect(f.manager.hasConnection('synthetic-cycle')).toBe(false);
    }
    expect(f.calls.filter(call => call === 'stop:synthetic-cycle')).toHaveLength(5);
  });

  for (const failure of [new Error('Synthetic acquisition failure'), 'Synthetic non-Error acquisition failure'])
    test(`contains external SDK failure ${String(failure)} and retries the same ID independently`, async () => {
      const f = fixture(); expect(await f.connect('synthetic-stable')).toBe(true);
      f.plans.set('synthetic-retry', { infoFailure: failure });
      expect(await f.connect('synthetic-retry')).toBe(false);
      expect(f.manager.getConnectionStatus('synthetic-retry')).toBeNull();
      expect(f.manager.getActiveVideoIds()).toEqual(['synthetic-stable']);
      expect(f.diagnostics).toContainEqual(expect.arrayContaining([expect.objectContaining({ error: failure instanceof Error ? failure.message : failure })]));
      f.plans.delete('synthetic-retry');
      expect(await f.connect('synthetic-retry')).toBe(true);
      f.chat('synthetic-retry').emit('chat-update', direct()); await checkpoint();
      expect(messages(f)).toHaveLength(1);
      expect(f.manager.getConnectionCount()).toBe(2);
    });

  test('mixed successful and failed acquisitions preserve only successful streams', async () => {
    const f = fixture();
    for (const [id, fail] of [['synthetic-success1', false], ['synthetic-failure1', true],
      ['synthetic-success2', false], ['synthetic-failure2', true]] as const) {
      if (fail) f.plans.set(id, { infoFailure: new Error('Synthetic network failure') });
      expect(await f.connect(id)).toBe(!fail);
    }
    expect(f.manager.getActiveVideoIds()).toEqual(['synthetic-success1', 'synthetic-success2']);
  });

  for (const failure of [new Error('Synthetic stop failed'), 'Synthetic stop non-Error'])
    test(`shutdown failure detaches exact managed resource and real error handler reports ${String(failure)}`, async () => {
      const f = fixture(); f.plans.set('synthetic-stop', { stopFailure: failure });
      expect(await f.connect('synthetic-stop')).toBe(true);
      expect(await f.manager.disconnectFromStream('synthetic-stop', 'Synthetic stop')).toBe(false);
      expect(f.manager.getConnectionStatus('synthetic-stop')).toBeNull();
      expect(f.calls.filter(call => call === 'stop:synthetic-stop')).toHaveLength(1);
      expect(f.diagnostics).toContainEqual(expect.arrayContaining([expect.objectContaining({ error: failure instanceof Error ? failure.message : failure })]));
      f.plans.delete('synthetic-stop'); expect(await f.connect('synthetic-stop')).toBe(true);
    });

  test('cleanup joins held SDK stop, isolates failure, clears admission and releases each independent owner', async () => {
    const f = fixture(), stopGate = deferred();
    f.plans.set('synthetic-first', { stopFailure: new Error('Synthetic first stop failed') });
    f.plans.set('synthetic-second', { stopGate });
    expect(await f.connect('synthetic-first')).toBe(true); expect(await f.connect('synthetic-second')).toBe(true);
    const cleanup = f.manager.cleanupAllConnections();
    let done = false; void cleanup.then(() => { done = true; });
    try {
      await checkpoint();
      expect(f.manager.getActiveVideoIds()).toEqual([]);
      expect(f.calls.filter(call => call.startsWith('stop:'))).toEqual(['stop:synthetic-first', 'stop:synthetic-second']);
      expect(done).toBe(false);
    } finally { stopGate.resolve(); await cleanup; }
    expect(done).toBe(true);
    expect(await f.connect('synthetic-closed')).toBe(false);
    expect(f.owner.stats.instancesCreated).toBe(2);
  });

  for (const replacementSucceeds of [false, true]) test(`late acquisition cannot affect ${replacementSucceeds ? 'successful' : 'failed'} replacement`, async () => {
    const f = fixture(), acquire = deferred(), entered = deferred();
    f.plans.set('synthetic-replace', { chatAcquire: acquire }); f.entered.set('synthetic-replace', entered);
    const old = f.connect('synthetic-replace'); await entered.promise;
    const removal = f.manager.removeConnection('synthetic-replace');
    try {
      f.plans.set('synthetic-replace', replacementSucceeds ? {} : { chatFailure: new Error('Synthetic replacement failed') });
      expect(await f.connect('synthetic-replace')).toBe(replacementSucceeds);
      const current = f.manager.getConnection('synthetic-replace');
      acquire.resolve(); await removal;
      expect(await old).toBe(false);
      expect(f.manager.getConnection('synthetic-replace')).toBe(current);
      expect(f.manager.hasConnection('synthetic-replace')).toBe(replacementSucceeds);
      expect(f.manager.isConnectionReady('synthetic-replace')).toBe(false);
      expect(f.calls.filter(call => call === 'stop:synthetic-replace')).toHaveLength(1);
      expect(f.chats.get('synthetic-replace')?.[0]?.eventNames()).toEqual([]);
    } finally { acquire.resolve(); await Promise.all([old, removal]); }
  });

  test('new lifecycle can acquire while old cleanup joins a pending SDK operation', async () => {
    const f = fixture(), acquire = deferred(), entered = deferred();
    f.plans.set('synthetic-lifecycle', { chatAcquire: acquire }); f.entered.set('synthetic-lifecycle', entered);
    const old = f.connect('synthetic-lifecycle'); await entered.promise;
    const cleanup = f.manager.cleanupAllConnections();
    try {
      f.manager.startLifecycle(); f.plans.delete('synthetic-lifecycle');
      expect(await f.connect('synthetic-lifecycle')).toBe(true);
      const current = f.manager.getConnection('synthetic-lifecycle');
      const currentChat = f.chat('synthetic-lifecycle');
      acquire.resolve(); await cleanup;
      expect(await old).toBe(false);
      expect(f.manager.getConnection('synthetic-lifecycle')).toBe(current);
      expect(f.calls.filter(call => call === 'stop:synthetic-lifecycle')).toHaveLength(1);
      currentChat.emit('start', { actions: [] }); await checkpoint();
      expect(f.manager.isConnectionReady('synthetic-lifecycle')).toBe(true);
    } finally { acquire.resolve(); await Promise.all([cleanup, old]); }
  });

  test('stale attempt readiness and disconnect cannot mutate a replacement', async () => {
    const f = fixture(); expect(await f.connect('synthetic-generation')).toBe(true);
    const attempt = f.manager.getConnectionStatus('synthetic-generation')!.attemptId;
    await f.manager.removeConnection('synthetic-generation');
    expect(await f.connect('synthetic-generation')).toBe(true);
    const current = f.manager.getConnection('synthetic-generation');
    f.manager.setConnectionReady('synthetic-generation', attempt);
    expect(await f.manager.disconnectFromStream('synthetic-generation', 'Synthetic stale', attempt)).toBe(false);
    expect(f.manager.getConnection('synthetic-generation')).toBe(current);
    expect(f.manager.isConnectionReady('synthetic-generation')).toBe(false);
  });

  test('bounded retirement joins an actual late SDK acquisition and releases native deadline timers', async () => {
    useFakeTimers();
    const f = fixture(), acquire = deferred(), entered = deferred();
    f.plans.set('synthetic-deadline', { acquire }); f.entered.set('synthetic-deadline', entered);
    const pending = f.connect('synthetic-deadline'); await entered.promise;
    const cleanup = f.manager.cleanupAllConnections(); let done = false;
    void cleanup.then(() => { done = true; });
    try {
      await flush(); advanceTimersByTime(4999); await flush(); expect(done).toBe(false);
      advanceTimersByTime(1); await cleanup;
      expect(done).toBe(true); expect(await pending).toBe(false);
      acquire.resolve(); await flush();
      await f.owner.dispose(); await flush();
      expect(f.manager.getConnectionCount()).toBe(0);
      // InnertubeService uses uncancellable native AbortSignal.timeout(10000)
      // for initialization. Bun counts its still pending timeout after retirement.
      expect(getTimerCount()).toBe(1);
      advanceTimersByTime(5000); await flush();
      expect(getTimerCount()).toBe(0);
    } finally {
      acquire.resolve(); await flush();
      try { await f.platform.cleanup(); } finally { try { await f.detector.cleanup(); } finally { await f.owner.dispose(); useRealTimers(); } }
    }
  });

  test('empty video identity never starts a chat connection', async () => {
    const f = fixture(); expect(await f.connect('')).toBe(false);
    expect(f.calls).toEqual(['info:']);
    expect(f.manager.getConnectionCount()).toBe(0);
    expect(f.manager.isConnectionReady('')).toBe(false);
  });

  test('configuration gating uses actual manager configuration', () => {
    for (const [config, api, scraping] of [
      [{ enableAPI: false, streamDetectionMethod: 'youtubei', viewerCountMethod: 'youtubei' }, false, false],
      [{ enableAPI: true, streamDetectionMethod: 'api', viewerCountMethod: 'api' }, true, false],
      [{ streamDetectionMethod: 'scraping' }, false, true],
    ] as const) {
      const manager = new YouTubeConnectionManager(noOpLogger, { config });
      expect(manager.isApiEnabled()).toBe(api); expect(manager.isScrapingEnabled()).toBe(scraping);
    }
  });
});
