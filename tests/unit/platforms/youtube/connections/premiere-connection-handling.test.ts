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
  const logger = { ...noOpLogger, warn: (...args: unknown[]) => { diagnostics.push(args); },
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
  return { platform, manager: platform.connectionManager, owner, detector, plans, chats, chat, calls, diagnostics, entered, events,
    connect: (id: string) => platform!.connectionManager.connectToStream(id,
      (videoId, attempt, context) => platform!._createYouTubeConnection(videoId, attempt, context)),
  };
}

import { YouTubeConnectionManager } from '../../../../../src/platforms/youtube/youtube-connection-manager';

describe('Premiere readiness with actual platform validation and default connections', () => {
  test('a currently live Premiere stays stored but not ready until external start', async () => {
    const f = fixture(); f.plans.set('synthetic-premiere', {
      info: { basic_info: { id: 'synthetic-premiere', is_live: true, is_upcoming: false, title: 'Synthetic premiere' } },
    });
    expect(await f.platform.connectToYouTubeStream('synthetic-premiere')).toBe(true);
    expect(f.manager.hasConnection('synthetic-premiere')).toBe(true);
    expect(f.manager.isConnectionReady('synthetic-premiere')).toBe(false);
    expect(f.manager.getActiveVideoIds()).toEqual(['synthetic-premiere']);
    expect(f.manager.getReadyConnectionCount()).toBe(0);
    f.chat('synthetic-premiere').emit('start', { actions: [] }); await checkpoint();
    expect(f.manager.isConnectionReady('synthetic-premiere')).toBe(true);
    expect(f.manager.getConnectionCount()).toBe(1); expect(f.manager.getReadyConnectionCount()).toBe(1);
  });

  test('upcoming without a live signal is rejected before SDK chat acquisition', async () => {
    const f = fixture(); f.plans.set('synthetic-upcoming', { info: { basic_info: { id: 'synthetic-upcoming', is_upcoming: true } } });
    expect(await f.platform.connectToYouTubeStream('synthetic-upcoming')).toBe(false);
    expect(f.manager.getConnectionCount()).toBe(0);
    expect(f.calls).toEqual(['info:synthetic-upcoming']);
    expect(f.diagnostics.flat().some(value => String(value).includes('Stream is upcoming but not yet live'))).toBe(true);
  });

  for (const [name, info] of [
    ['live', { basic_info: { is_live: true } }], ['content', { basic_info: { is_live_content: true } }],
    ['dvr', { basic_info: { is_live_dvr_enabled: true } }],
    ['latency', { basic_info: { is_low_latency_live_stream: true } }],
    ['status', { basic_info: { live_status: 'LIVE_STREAM' } }],
    ['hls', { basic_info: {}, streaming_data: { hls_manifest_url: 'https://synthetic.invalid/live.m3u8' } }],
    ['streamability', { basic_info: {}, playability_status: { liveStreamability: {} } }],
  ] as const) test(`actual validation requires current live state for external ${name} signal`, async () => {
    const f = fixture();
    f.plans.set('synthetic-signal', { info: { ...info, basic_info: { id: 'synthetic-signal', ...info.basic_info } } });
    expect(await f.connect('synthetic-signal')).toBe(name === 'live');
    expect(f.manager.isConnectionReady('synthetic-signal')).toBe(false);
    if (name !== 'live') expect(f.calls).toEqual(['info:synthetic-signal']);
  });

  for (const [count, readyIds] of [[3, [1]], [4, [1, 3]], [3, [0, 2]]] as const)
    test(`reports ${readyIds.length} ready of ${count} independently acquired Premieres`, async () => {
      const f = fixture(); expect(f.manager.getConnectionCount()).toBe(0);
      const ids = Array.from({ length: count }, (_, index) => `synthetic-premiere-${index}`);
      for (const id of ids) {
        f.plans.set(id, { info: { basic_info: { id, is_live: true, is_live_content: true, is_upcoming: false, title: `Synthetic title ${id}` } } });
        expect(await f.connect(id)).toBe(true);
      }
      expect(f.manager.getReadyConnectionCount()).toBe(0);
      for (const index of readyIds) f.chat(ids[index]!).emit('start', { actions: [] });
      await checkpoint();
      expect(f.manager.getConnectionState()).toEqual({ totalConnections: count, readyConnections: readyIds.length,
        activeVideoIds: ids, hasAnyReady: true });
      expect(ids.filter(id => f.manager.isConnectionReady(id))).toEqual(readyIds.map(index => ids[index]!));
      await f.manager.removeConnection(ids[0]!);
      expect(f.manager.hasConnection(ids[0]!)).toBe(false);
      expect(f.calls.filter(call => call === `stop:${ids[0]}`)).toHaveLength(1);
      expect(f.manager.getConnectionCount()).toBe(count - 1);
      expect(f.manager.getReadyConnectionCount()).toBe(readyIds.length - (readyIds.some(index => index === 0) ? 1 : 0));
    });

  test('low-level manager still accepts nullable malformed factory DTO for empty ID', async () => {
    // Public runtime interface robustness seam, deliberately outside the actual platform wrapper.
    // No executed internal collaborator: this callback supplies an invalid value, not a fake connection.
    const manager = new YouTubeConnectionManager(noOpLogger);
    try {
      const connected = await Reflect.apply(manager.connectToStream, manager, ['', async () => null]);
      expect(connected).toBe(true);
      expect(manager.getConnectionCount()).toBe(1);
      expect(manager.getConnection('')).toBeNull();
      expect(manager.isConnectionReady('')).toBe(false);
    } finally { await manager.cleanupAllConnections(); }
  });
});
