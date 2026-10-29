import './runtime';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EventBus } from '../../src/core/EventBus';
import { OBSConnectionManager } from '../../src/obs/connection';
import { DisplayQueueEffects } from '../../src/obs/display-queue-effects';
import { createOBSSourcesManager } from '../../src/obs/sources';
import { createOBSGoalsManager } from '../../src/obs/goals';
import { createTikTokGiftAnimationResolver } from '../../src/services/tiktok-gift-animation/resolver';
import { zipFixture } from '../helpers/bounded-zip-fixture';

export const MEDIA_DURATION_MS = 6000;

export async function createMediaHarness(bus: EventBus, directory: string) {
  const playable = await readFile(join(__dirname, '../fixtures/synthetic-red.mp4'));
  // Pass the resolver's file signature validation while failing native decoding.
  const invalid = Buffer.from('000000186674797069736f6d0000000069736f6d', 'hex');
  const cacheDirectory = join(directory, 'synthetic-media-cache');
  await mkdir(cacheDirectory);
  const profile = { path: 'output.mp4', videoW: 32, videoH: 32, w: 32, h: 32,
    rgbFrame: [0, 0, 32, 32], aFrame: null, durationMs: MEDIA_DURATION_MS };
  const resolver = createTikTokGiftAnimationResolver({
    cacheDirectory,
    downloadArchive: async (url, output, context) => {
      const bytes = zipFixture([
        { name: 'config.json', body: Buffer.from(JSON.stringify({ portrait: profile })) },
        { name: 'output.mp4', body: url.endsWith('/invalid.zip') ? invalid : playable },
      ]);
      await writeFile(output, bytes, { flag: 'wx', signal: context?.signal });
      return { bytes: bytes.length };
    },
  });
  class SyntheticObsSocket extends EventEmitter {
    attempts = 0;
    async connect(): Promise<never> { this.attempts++; throw new Error('Synthetic media test must not connect OBS'); }
    async call(): Promise<never> { this.attempts++; throw new Error('Synthetic media test must not call OBS'); }
    async disconnect() {}
  }
  const socket = new SyntheticObsSocket();
  const obs = new OBSConnectionManager({ obs: socket,
    config: { enabled: false, address: 'ws://synthetic.invalid', password: 'synthetic-password' } });
  const sources = createOBSSourcesManager(obs);
  const goals = createOBSGoalsManager(obs, { config: { goals: { enabled: false } }, updateTextSource: sources.updateTextSource });
  const effects = new DisplayQueueEffects({
    obsManager: obs, sourcesManager: sources, goalsManager: goals,
    eventBus: {
      emit: bus.emit,
      subscribe: (event, handler) => bus.subscribe(event, payload => handler(payload as Record<string, unknown>)),
    },
    config: { obs: {}, gui: { enableDock: true } },
    giftAnimationResolver: resolver,
    delay: async () => { throw new Error('Synthetic media test must not delay'); },
    handleDisplayQueueError: (message, error) => { throw new Error(message, { cause: error }); },
    extractUsername: () => null,
  });
  const baseline = bus.listenerCount('display:gift-animation-settled');
  const order: string[] = [];
  const settlements: Array<{ playbackId: string; reason: string }> = [];
  let playbackId = '';
  let emittedAt = 0n;
  let releaseMs: number | null = null;
  let duration: number | null = null;
  let operation: Promise<void> | undefined;
  let failure: unknown;
  const offEffect = bus.subscribe('display:gift-animation', (payload) => {
    playbackId = (payload as { playbackId: string }).playbackId;
    emittedAt = process.hrtime.bigint();
    order.push('effect');
  });
  const offSettled = bus.subscribe('display:gift-animation-settled', payload => {
    settlements.push(payload as { playbackId: string; reason: string });
    order.push('settled');
  });
  return {
    start(kind: 'playable' | 'invalid') {
      if (operation) throw new Error('Synthetic media harness only owns one playback');
      operation = effects.resolveAndEmitGiftAnimation({
        type: 'platform:gift', platform: 'tiktok',
        data: { enhancedGiftData: { originalData: { asset: { resourceUri: `https://synthetic.invalid/${kind}.zip` } } } },
      }).then(value => {
        duration = value;
        releaseMs = Number(process.hrtime.bigint() - emittedAt) / 1e6;
        order.push('released');
      }, error => { failure = error; order.push('failed'); });
    },
    snapshot() { return { playbackId, settlements: [...settlements], order: [...order], releaseMs, duration,
      failure: failure instanceof Error ? failure.message : failure,
      waiterListeners: bus.listenerCount('display:gift-animation-settled') - baseline - 1 }; },
    async close() {
      try { await effects.dispose(); await operation; }
      finally {
        offEffect(); offSettled();
        obs.dispose();
        await Promise.all([resolver.dispose(), obs.disconnect()]);
      }
      if (socket.attempts !== 0) throw new Error('Synthetic media playback accessed OBS');
      if (socket.eventNames().some(event => socket.listenerCount(event) > 0)) throw new Error('Synthetic OBS owner leaked a transport listener');
      if (failure) throw failure;
      if (bus.listenerCount('display:gift-animation-settled') !== baseline) throw new Error('Synthetic media waiter leaked a subscription');
    },
  };
}
