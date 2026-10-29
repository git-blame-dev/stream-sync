import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { DependencyFactory } from '../../../src/utils/dependency-factory';
import { YouTubePlatform } from '../../../src/platforms/youtube';
import { mkdirSync, writeFileSync, renameSync, unlinkSync, readFileSync } from 'node:fs';
import type { DisplayQueueItem } from '../../../src/interfaces/DisplayQueue';
import { createGuiTransportService } from '../../../src/services/gui/gui-transport-service';
import { OBSViewerCountObserver } from '../../../src/observers/obs-viewer-count-observer';
import { secrets } from '../../../src/core/secrets';
import { TWITCH_OAUTH_SCOPES } from '../../../src/auth/twitch-oauth-scopes';
import { TwitchAuth } from '../../../src/auth/TwitchAuth';
import { InnertubeService } from '../../../src/services/innertube-service';
import { InnertubeFactory } from '../../../src/factories/innertube-factory';
import { createFundingGoalService } from '../../../src/services/funding-goal-service';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { createDonationSpamDetection, createSpamDetectionConfig } from '../../../src/utils/spam-detection';
import { noOpLogger } from '../../helpers/mock-factories';
import { AppRuntime } from '../../../src/runtime/AppRuntime';
import { PlatformEvents } from '../../../src/interfaces/PlatformEvents';
import { CommandCooldownService } from '../../../src/services/CommandCooldownService';
import { PlatformLifecycleService } from '../../../src/services/PlatformLifecycleService';
import { OBSEffectsManager } from '../../../src/obs/effects';
import { NotificationManager } from '../../../src/notifications/NotificationManager';
import { createMainPresentationFixture } from '../../helpers/main-presentation-fixture';
import { captureStdout, captureStderr } from '../../helpers/output-capture';
import { advanceTimersByTime, getTimerCount, useFakeTimers, useRealTimers } from '../../helpers/bun-timers';

let h: Awaited<ReturnType<typeof createMainPresentationFixture>>;
let stdout: ReturnType<typeof captureStdout>;
let stderr: ReturnType<typeof captureStderr>;
let exitCode: typeof process.exitCode;
beforeEach(async () => {
  stdout = captureStdout(); stderr = captureStderr(); exitCode = process.exitCode;
  h = await createMainPresentationFixture();
  h.config.logging.file.enabled = false;
  h.config.logging.chat.enabled = false;
  expect(h.config.general.envFileReadEnabled).toBe(false);
  expect(h.config.general.envFileWriteEnabled).toBe(false);
  await h.start();
});
afterEach(async () => {
  try { await h?.dispose(); }
  finally { useRealTimers(); process.exitCode = exitCode; stdout.restore(); stderr.restore(); }
});
const items = (): DisplayQueueItem[] => h.queue.state.queue.flatMap(item => Array.isArray(item.children) ? item.children as DisplayQueueItem[] : [item as DisplayQueueItem]);
const base = { userId: 'synthetic-user', timestamp: '2024-01-01T00:00:00.000Z' };
const gift = { ...base, id: 'synthetic-gift', giftType: 'Synthetic gift', giftCount: 1, amount: 5, currency: 'USD' };

describe('AppRuntime with production main owners', () => {
  it('rejects invalid constructor dependencies before executing their callable shapes', () => {
    const deps = h.runtime.dependencies;
    expect(() => new AppRuntime(h.config, { ...deps, eventBus: null } as never)).toThrow('AppRuntime missing required dependencies');
    expect(() => new AppRuntime(h.config, { ...deps, eventBus: { subscribe: null, emit() {} } } as never)).toThrow('AppRuntime requires eventBus.subscribe function');
    expect(() => new AppRuntime(h.config, { ...deps, platformLifecycleService: { getAllPlatforms: null } } as never)).toThrow('AppRuntime requires platformLifecycleService.getAllPlatforms function');
  });

  it('constructs without a command parser and releases its own additional subscriptions', async () => {
    const baseline = h.bus.getListenerSummary();
    const runtime = new AppRuntime(h.config, { ...h.runtime.dependencies, commandParser: null } as never);
    // The actual supplied owners belong to this lifetime; retire both runtimes.
    await runtime.rollbackStartup();
    await h.runtime.rollbackStartup();
    expect(h.bus.listenerCount(PlatformEvents.VFX_COMMAND_RECEIVED)).toBe(0);
    expect(baseline[PlatformEvents.VFX_COMMAND_RECEIVED]).toBeGreaterThan(0);
  });

  it('emits readiness from concrete lifecycle and cooldown owners', () => {
    const events: unknown[] = [];
    const unsubscribe = h.bus.subscribe(PlatformEvents.SYSTEM_READY, value => events.push(value));
    try {
      const payload = h.runtime.emitSystemReady({ correlationId: 'synthetic-ready' });
      expect(payload).toMatchObject({ correlationId: 'synthetic-ready', services: expect.arrayContaining(['notificationManager', 'vfxCommandService']) });
      expect(Number.isFinite(Date.parse(payload.timestamp))).toBe(true);
      expect(payload.platforms).toEqual((h.runtime.platformLifecycleService as PlatformLifecycleService).getStatus());
      expect(payload.cooldowns).toEqual((h.runtime.commandCooldownService as CommandCooldownService).getStatus());
      expect(payload.degraded).toBeUndefined();
      expect(events).toEqual([payload]);
    } finally { unsubscribe(); }
  });

  it('derives failed readiness and healthy recovery from the real lifecycle health owner', async () => {
    const lifecycle = h.runtime.platformLifecycleService as PlatformLifecycleService;
    await lifecycle.markPlatformFailure('twitch', new Error('synthetic external failure'));
    const degraded = h.runtime.emitSystemReady({});
    expect(degraded.degraded).toBe(true);
    expect(degraded.degradationReasons).toContain('platform-initialization-failed');
    lifecycle.markPlatformReady('twitch');
    expect(h.runtime.emitSystemReady({}).degraded).toBeUndefined();
  });

  it('admits social notifications through validation, preparation and the real queue', async () => {
    for (const [method, type, platform] of [
      ['handleFollowNotification', 'platform:follow', 'twitch'],
      ['handleShareNotification', 'platform:share', 'tiktok'],
      ['handleRaidNotification', 'platform:raid', 'twitch'],
    ] as const) {
      expect(await h.runtime[method](platform, 'synthetic-viewer', { ...base, viewerCount: 3 })).toMatchObject({ success: true });
      expect(items().some(item => item.type === type && item.data.username === 'synthetic-viewer')).toBe(true);
    }
    expect(h.queue.state.queue).toHaveLength(3);
  });

  it('returns actual manager rejection and recovers after gifts are enabled', async () => {
    h.config.youtube.giftsEnabled = false;
    expect(await h.runtime.handleGiftNotification('youtube', 'synthetic-viewer', gift)).toMatchObject({ success: false });
    expect(h.queue.state.queue).toHaveLength(0);
    h.config.youtube.giftsEnabled = true;
    expect(await h.runtime.handleGiftNotification('youtube', 'synthetic-viewer', gift)).toMatchObject({ success: true });
    expect(h.queue.state.queue).toHaveLength(1);
    expect(items()[0]?.type).toBe('platform:gift');
  });

  for (const fault of [new Error('Synthetic manager logging Error'), 'Synthetic manager logging string']) {
    it(`contains actual manager logging rejection (${fault instanceof Error ? 'Error' : 'string'}) and admits healthy recovery`, async () => {
      const manager = h.runtime.notificationManager as NotificationManager;
      const logger = manager.logger;
      const enabled = h.config.youtube.giftsEnabled;
      const handling = spyOn(manager, 'handleNotification');
      const diagnostic = '[youtube] platform:gift notifications disabled, skipping for synthetic-viewer';
      let diagnosticCalls = 0;
      h.config.youtube.giftsEnabled = false;
      manager.logger = { ...noOpLogger, debug: (message: unknown) => {
        if (message === diagnostic) { diagnosticCalls++; throw fault; }
      } };
      try {
        expect(await h.runtime.handleGiftNotification('youtube', 'synthetic-viewer', gift)).toEqual({
          success: false, error: fault instanceof Error ? fault.message : fault,
          notificationType: 'platform:gift', platform: 'youtube', username: 'synthetic-viewer',
        });
        expect(diagnosticCalls).toBe(1);
        expect(handling).toHaveBeenCalledTimes(1);
        await expect(handling.mock.results[0]?.value).rejects.toBe(fault);
        expect(items()).toHaveLength(0);
        expect(h.rows).toHaveLength(0);
        manager.logger = logger;
        h.config.youtube.giftsEnabled = true;
        expect(await h.runtime.handleGiftNotification('youtube', 'synthetic-viewer', gift)).toMatchObject({ success: true });
        expect(handling).toHaveBeenCalledTimes(2);
        expect(items()).toHaveLength(1);
        expect(items()[0]).toMatchObject({ type: 'platform:gift', platform: 'youtube', data: { username: 'synthetic-viewer', amount: 5 } });
      } finally {
        manager.logger = logger; h.config.youtube.giftsEnabled = enabled;
        try { await h.runtime.shutdown(); } finally { handling.mockRestore(); }
      }
    });
  }

  it('preserves anonymous and marked YouTube jewels inputs through the actual manager', async () => {
    expect(await h.runtime.handleGiftNotification('twitch', undefined, { ...gift, userId: undefined, isAnonymous: true, currency: 'bits' })).toMatchObject({ success: true });
    expect(await h.runtime.handleGiftNotification('youtube', 'synthetic-viewer', { ...gift, id: 'synthetic-jewels', userId: undefined, amount: undefined, currency: 'jewels', metadata: { missingFields: ['amount', 'userId'] } })).toMatchObject({ success: true });
    expect(items()[0]?.data).toMatchObject({ isAnonymous: true, currency: 'bits' });
    expect(items()[1]?.data.amount).toBeUndefined();
    expect(items()[1]?.data.userId).toBeUndefined();
    const handling = spyOn(h.runtime.notificationManager!, 'handleNotification');
    try {
      expect(await h.runtime.handleGiftNotification('youtube', 'synthetic-viewer', { ...gift, id: 'synthetic-jewels-with-amount', userId: undefined, amount: 300, currency: 'jewels', metadata: { missingFields: ['userId'] } })).toMatchObject({ success: true });
      expect(handling.mock.calls[0]?.[2]).toMatchObject({ amount: 300, metadata: { missingFields: ['userId'] } });
    } finally { handling.mockRestore(); }
    expect(items()[2]?.data).toMatchObject({ amount: 300, currency: 'jewels' });
    expect(items()[2]?.data.userId).toBeUndefined();
  });

  it('preserves explicit avatars for membership, gifted membership and envelope preparation', async () => {
    const avatarUrl = 'https://synthetic.invalid/avatar.png';
    expect(await h.runtime.handlePaypiggyNotification('twitch', 'synthetic-viewer', { ...base, tier: '1000', months: 10, avatarUrl })).toMatchObject({ success: true });
    expect(await h.runtime.handleGiftPaypiggyEvent('youtube', 'synthetic-viewer', { ...base, giftCount: 1, avatarUrl })).toMatchObject({ success: true });
    expect(await h.runtime.handleEnvelopeNotification('tiktok', { ...gift, username: 'synthetic-viewer', avatarUrl })).toMatchObject({ success: true });
    expect(h.queue.state.queue).toHaveLength(3);
    for (const item of items()) expect(item.data.avatarUrl).toBe(avatarUrl);
  });

  it('contains malformed resub, gifted membership and envelope errors and admits later valid input', async () => {
    expect(await h.runtime.handleResubNotification('twitch', 'synthetic-viewer', { tier: '1000', months: 3 })).toMatchObject({ success: false, notificationType: 'platform:paypiggy' });
    expect(await h.runtime.handleGiftPaypiggyNotification('twitch', 'synthetic-viewer', base)).toMatchObject({ success: false, notificationType: 'platform:giftpaypiggy' });
    expect(await Reflect.apply(h.runtime.handleEnvelopeNotification, h.runtime, ['tiktok', null])).toMatchObject({ success: false, notificationType: 'platform:envelope' });
    expect(h.queue.state.queue).toHaveLength(0);
    expect(await h.runtime.handleResubNotification('twitch', 'synthetic-viewer', { ...base, tier: '1000', months: 3, message: 'Synthetic resub' })).toMatchObject({ success: true });
    expect(h.queue.state.queue).toHaveLength(1);
  });

  it('routes chat through the actual router and queue, containing invalid input', async () => {
    await h.runtime.handleChatMessage('twitch', { ...base, username: 'synthetic-viewer', message: 'Synthetic chat' });
    expect(items().some(item => item.type === 'chat' && typeof item.data.message === 'object' && item.data.message !== null && 'text' in item.data.message && item.data.message.text === 'Synthetic chat')).toBe(true);
    const count = h.queue.state.queue.length;
    await h.runtime.handleChatMessage('twitch', {});
    expect(h.queue.state.queue).toHaveLength(count);
    expect(h.runtime.isStarted).toBe(true);
  });

  it('validates stream detection payloads and keeps ignored/empty updates inert', async () => {
    await expect(h.runtime.handleStreamDetected('youtube', {})).rejects.toThrow('requires newStreamIds array');
    await expect(h.runtime.handleStreamDetected('', {})).rejects.toThrow('requires platform');
    await expect(Reflect.apply(h.runtime.handleStreamDetected, h.runtime, ['youtube', null])).rejects.toThrow('requires data');
    await h.runtime.handleStreamDetected('youtube', { eventType: 'unrelated' });
    await h.runtime.handleStreamDetected('youtube', { type: 'stream-detected', newStreamIds: [] });
    expect(h.runtime.getPlatforms()).toEqual({});
    expect(h.runtime.isStarted).toBe(true);
    expect(Reflect.get(h.runtime, 'recordPlatformConnection')).toBeUndefined();
  });

  it('retains the public YouTube reconnect seam with actual initialization, contained failure and recovery', async () => {
    let failing = false;
    const failure = new Error('Synthetic YouTube initialization logging failure');
    const logger = { ...noOpLogger, info: (message: unknown) => {
      if (failing && message === 'Initializing YouTube platform with retry system...') throw failure;
    } };
    const config = { ...h.config.youtube, username: 'synthetic-channel', enabled: false,
      enableAPI: false, dataLoggingEnabled: false, envFileReadEnabled: false, envFileWriteEnabled: false };
    const dependencies = new DependencyFactory().createYoutubeDependencies(config, { config: h.config, logger });
    let platform: YouTubePlatform | undefined;
    let restore = () => {};
    const previous = h.runtime.youtube;
    try {
      platform = new YouTubePlatform(config, dependencies);
      h.runtime.youtube = platform as unknown as NonNullable<AppRuntime['youtube']>;
      const initialize = spyOn(platform, 'initialize');
      const warning = spyOn(h.runtime.logger, 'warn');
      restore = () => { initialize.mockRestore(); warning.mockRestore(); };
      const event = { eventType: 'stream-detected', newStreamIds: ['synthetic-video'] };
      await expect(h.runtime.handleStreamDetected('youtube', event)).resolves.toBeUndefined();
      expect(initialize.mock.calls).toEqual([[{}, true]]);
      await expect(initialize.mock.results[0]?.value).resolves.toBeUndefined();
      expect(platform.isInitialized).toBe(true);
      await h.runtime.handleStreamDetected('youtube', { eventType: 'unrelated', newStreamIds: ['synthetic-ignored'] });
      await h.runtime.handleStreamDetected('youtube', { eventType: 'stream-detected', newStreamIds: [] });
      await h.runtime.handleStreamDetected('twitch', event);
      expect(initialize).toHaveBeenCalledTimes(1);
      failing = true;
      await expect(h.runtime.handleStreamDetected('youtube', event)).resolves.toBeUndefined();
      expect(initialize.mock.calls).toEqual([[{}, true], [{}, true]]);
      await expect(initialize.mock.results[1]?.value).rejects.toBe(failure);
      expect(warning.mock.calls.filter(call => call[0] === '[EventHandler] YouTube reconnection attempted but may have already been processed')).toEqual([
        ['[EventHandler] YouTube reconnection attempted but may have already been processed', 'AppRuntime'],
      ]);
      expect(h.runtime.isStarted).toBe(true);
      failing = false;
      await h.runtime.handleStreamDetected('youtube', event);
      expect(initialize.mock.calls).toEqual([[{}, true], [{}, true], [{}, true]]);
      await expect(initialize.mock.results[2]?.value).resolves.toBeUndefined();
      expect(platform.isInitialized).toBe(true);
    } finally {
      failing = false;
      if (previous === undefined) delete h.runtime.youtube; else h.runtime.youtube = previous;
      try { await platform?.cleanup(); }
      finally { try { await dependencies.innertubeService.dispose(); } finally { restore(); } }
    }
    expect(platform?.isInitialized).toBe(false);
    expect(platform?.getConnectionState()).toMatchObject({ isConnected: false, isMonitoring: false, totalConnections: 0 });
    expect(() => dependencies.innertubeService.withMetadataOperation({}, async () => true)).toThrow('disposed');
  });

  for (const mode of ['shutdown', 'rollbackStartup'] as const) {
    it(`retires actual queue, effects, cooldown, viewer and funding owners during ${mode}`, async () => {
      const runtime = h.runtime;
      const cooldown = runtime.commandCooldownService as CommandCooldownService;
      const unrelated: unknown[] = [];
      const unsubscribe = h.bus.subscribe('platform:event', event => unrelated.push(event));
      try {
        cooldown.updateUserCooldown('synthetic-user');
        cooldown.updateGlobalCooldown('synthetic-command');
        await h.funding.adjust(5);
        expect(cooldown.cleanupInterval).not.toBeNull();
        const stopping = runtime[mode]();
        expect(runtime.isStarted).toBe(false);
        expect(() => h.queue.addItem({ type: 'chat', platform: 'twitch', data: { message: 'Synthetic retired row' } })).toThrow('stopped');
        expect(runtime.viewerCountSystem.isPolling).toBe(false);
        expect(cooldown.cleanupInterval).toBeNull();
        await stopping;
        expect(cooldown.userLastCommand.size).toBe(0);
        expect(cooldown.globalCommandCooldowns.size).toBe(0);
        expect(runtime.viewerCountSystem.observers.size).toBe(0);
        expect(runtime.viewerCountSystem.pollingHandles).toEqual({});
        expect(runtime.viewerCountSystem.memoryOptimizationInterval).toBeNull();
        expect(h.bus.listenerCount(PlatformEvents.VFX_COMMAND_RECEIVED)).toBe(0);
        expect(h.bus.listenerCount(PlatformEvents.STREAM_STATUS)).toBe(0);
        expect((await h.persistedFunding()).currentMicros).toBe(5_000_000);
        await expect(h.funding.adjust(1)).rejects.toThrow('disposed');
        const effects = runtime.dependencies.obs?.effectsManager as OBSEffectsManager;
        await expect(effects.triggerMediaAction('synthetic-source', 'synthetic-action')).rejects.toThrow('disposed');
        h.bus.emit('platform:event', { retained: true });
        expect(unrelated).toEqual([{ retained: true }]);
        await runtime[mode]();
        await expect(runtime.start()).rejects.toThrow('stopped');
      } finally { unsubscribe(); }
    });
  }

  it('coalesces concurrent shutdown and preserves the successful-exit deadline and event order', async () => {
    useFakeTimers();
    const exits: unknown[] = [];
    const events: unknown[] = [];
    const exit = spyOn(process, 'exit').mockImplementation(((code: unknown) => { exits.push(code); }) as never);
    const unsubscribe = h.bus.subscribe(PlatformEvents.SYSTEM_SHUTDOWN, value => events.push(value));
    try {
      const first = h.runtime.shutdown();
      expect(h.runtime.shutdown()).toBe(first);
      await first;
      expect(events).toEqual([{ reason: 'manual-shutdown', mode: 'exit' }]);
      expect(process.exitCode).toBe(0);
      expect(exits).toEqual([]);
      advanceTimersByTime(1999); expect(exits).toEqual([]);
      advanceTimersByTime(1); expect(exits).toEqual([0]);
      unsubscribe();
      await h.dispose();
    } finally { await h.runtime.shutdown(); unsubscribe(); exit.mockRestore(); }
  });

  it('rejects repeated start without reacquiring the actual owners', async () => {
    const manager = h.runtime.notificationManager;
    expect(manager).toBeInstanceOf(NotificationManager);
    await expect(h.runtime.start()).rejects.toThrow('already started');
    expect(h.runtime.notificationManager).toBe(manager);
  });


  for (const mode of ['shutdown', 'rollbackStartup'] as const) {
    it(`joins an actual supplied Innertube owner and held external transport during ${mode}`, async () => {
      const entered = Promise.withResolvers<void>();
      const aborted = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let transportFinished = false;
      InnertubeFactory.configure({ importer: async () => ({ Innertube: { create: async options => ({
        getInfo: () => (options!.fetch as typeof fetch)('https://synthetic.invalid/metadata'),
      }) } }) });
      const owner = new InnertubeService(InnertubeFactory as ConstructorParameters<typeof InnertubeService>[0], { logger: noOpLogger, fetch: async (_url, init) => {
        entered.resolve();
        await new Promise<void>(resolve => init!.signal!.addEventListener('abort', () => { aborted.resolve(); resolve(); }, { once: true }));
        await release.promise;
        transportFinished = true;
        throw new Error('Synthetic transport retired');
      } });
      const runtime = new AppRuntime(h.config, { ...h.runtime.dependencies, innertubeService: owner });
      await runtime.startViewerCountSystemEarly();
      const metadata = owner.withMetadataOperation({}, client => client.getInfo('synthetic-video')).catch(error => error);
      let retirement: Promise<void> | undefined;
      try {
        await entered.promise;
        let completed = false;
        retirement = runtime[mode]().then(() => { completed = true; });
        await aborted.promise;
        expect(runtime.viewerCountSystem.isPolling).toBe(false);
        expect(completed).toBe(false);
        expect(transportFinished).toBe(false);
        expect(() => owner.withMetadataOperation({}, async () => true)).toThrow('disposed');
        release.resolve();
        await retirement;
        expect(await metadata).toBeInstanceOf(Error);
        expect(transportFinished).toBe(true);
      } finally {
        release.resolve(); await retirement; await runtime.rollbackStartup(); await owner.dispose(); await metadata;
        InnertubeFactory.configure();
      }
    });

    for (const diagnosticFails of [false, true]) {
      it(`retires actual detector before held funding during ${mode}, diagnostic failure ${diagnosticFails}`, async () => {
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const filePath = join(h.dir, 'held-funding.json');
        const funding = await createFundingGoalService({
          config: h.config.fundingGoal, monetizationValuesConfig: h.config.monetizationValues,
          eventBus: h.bus, filePath,
          // Native disk effects complete synchronously after release so advancing
          // Bun's fake clock cannot stall a native async filesystem completion.
          fs: { ...fs, mkdir: async path => { mkdirSync(path, { recursive: true, mode: 0o700 }); },
            writeFile: async (path, contents) => { entered.resolve(); await release.promise; writeFileSync(path, contents, { encoding: 'utf8', mode: 0o600 }); },
            rename: async (from, to) => { renameSync(from, to); }, unlink: async path => { unlinkSync(path); } },
        });
        const manager = h.runtime.notificationManager as NotificationManager;
        const previousDetector = manager.donationSpamDetector;
        const previousFunding = h.runtime.fundingGoal;
        const aggregation = spyOn(manager, 'handleAggregatedDonation');
        const disposalEntered = Promise.withResolvers<void>();
        const dispose = funding.dispose.bind(funding);
        let fundingDisposal: Promise<void> | undefined;
        const disposing = spyOn(funding, 'dispose').mockImplementation(() => {
          fundingDisposal = dispose();
          disposalEntered.resolve();
          return fundingDisposal;
        });
        useFakeTimers();
        const timerBaseline = getTimerCount();
        let diagnosticCalls = 0;
        const detector = createDonationSpamDetection(createSpamDetectionConfig({ enabled: true,
          lowValueThreshold: 10, detectionWindow: 10, maxIndividualNotifications: 1 }, { logger: noOpLogger }), {
          logger: { ...noOpLogger, debug: (message: unknown) => {
            if (message === 'Periodic cleanup interval cleared') {
              diagnosticCalls++;
              if (diagnosticFails) throw new Error('Synthetic detector cleanup logging failure');
            }
          } }, onAggregatedDonation: payload => manager.handleAggregatedDonation(payload),
        });
        manager.donationSpamDetector = detector;
        h.runtime.fundingGoal = funding;
        let adjustment: Promise<void> | undefined;
        let stopping: Promise<void> | undefined;
        try {
          expect(await h.runtime.handleGiftNotification('tiktok', 'synthetic-viewer', { ...gift, amount: 1, currency: 'coins' })).toMatchObject({ success: true });
          expect(await h.runtime.handleGiftNotification('tiktok', 'synthetic-viewer', { ...gift, id: 'synthetic-held-repeat', amount: 1, currency: 'coins' })).toMatchObject({ success: false, suppressed: true });
          expect(detector.getStatistics().trackedUsers).toBe(1);
          expect(Object.values(detector.donationSpamTracker).some(tracker => tracker.aggregationTimer !== null)).toBe(true);
          expect(getTimerCount()).toBe(timerBaseline + 2);
          adjustment = funding.adjust(5);
          await entered.promise;
          let completed = false;
          stopping = h.runtime[mode]().then(() => { completed = true; });
          expect(detector.cleanupInterval).toBeNull();
          expect(detector.getStatistics().trackedUsers).toBe(0);
          expect(diagnosticCalls).toBe(1);
          expect(getTimerCount()).toBe(timerBaseline);
          await disposalEntered.promise;
          expect(disposing).toHaveBeenCalledTimes(1);
          let fundingRetired = false;
          expect(disposing.mock.results[0]?.value).toBe(fundingDisposal);
          void fundingDisposal?.then(() => { fundingRetired = true; });
          expect(fundingRetired).toBe(false);
          expect(completed).toBe(false);
          advanceTimersByTime(10_000);
          expect(aggregation).not.toHaveBeenCalled();
          expect(getTimerCount()).toBe(timerBaseline);
          expect(fundingRetired).toBe(false);
          expect(completed).toBe(false);
          expect(funding.snapshot.currentUsd).toBe(0);
          release.resolve();
          await Promise.all([adjustment, stopping]);
          expect(completed).toBe(true);
          expect(fundingRetired).toBe(true);
          expect(JSON.parse(readFileSync(filePath, 'utf8')).currentMicros).toBe(5_000_000);
          await expect(funding.adjust(1)).rejects.toThrow('disposed');
        } finally {
          release.resolve();
          try {
            await Promise.allSettled([adjustment, stopping]);
            detector.destroy(); previousDetector?.destroy?.();
            const retired = await Promise.allSettled([h.runtime.shutdown(), funding.dispose(), h.funding.dispose()]);
            const failed = retired.find(result => result.status === 'rejected');
            if (failed?.status === 'rejected') throw failed.reason;
          } finally {
            manager.donationSpamDetector = previousDetector; h.runtime.fundingGoal = previousFunding;
            aggregation.mockRestore(); disposing.mockRestore(); useRealTimers();
          }
        }
      });
    }

    it(`retires the actual effects owner before a held OBS SDK settings call resumes during ${mode}`, async () => {
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const finished = Promise.withResolvers<void>();
      const requests: string[] = [];
      const call = h.socket.call.bind(h.socket);
      h.socket.call = async (method, data) => {
        requests.push(method);
        if (method === 'SetInputSettings') {
          entered.resolve(); await release.promise; finished.resolve();
        }
        return call(method, data);
      };
      const effects = h.runtime.dependencies.obs?.effectsManager as OBSEffectsManager;
      const playing = effects.playMediaInOBS({ mediaSource: 'synthetic-source', filename: 'synthetic-media', vfxFilePath: '/synthetic' }, false).catch(error => error);
      try {
        await entered.promise;
        await h.runtime[mode]();
        expect(await playing).toMatchObject({ message: expect.stringContaining('disposed') });
        release.resolve(); await finished.promise;
        await playing;
        expect(requests).toEqual(['SetInputSettings']);
        await expect(effects.triggerMediaAction('synthetic-source', 'synthetic-action')).rejects.toThrow('disposed');
      } finally { release.resolve(); await finished.promise; await playing; }
    });
  }

  it('updates the real viewer store and retires its polling handles', async () => {
    await h.runtime.updateViewerCount('twitch', 7);
    expect(h.runtime.viewerCountSystem.getViewerCount('twitch')).toBe(7);
    await h.runtime.shutdown();
    expect(h.runtime.viewerCountSystem.pollingHandles).toEqual({});
  });

  for (const diagnostic of ['info', 'debug'] as const) {
    it(`preserves resource retirement and the forced-exit deadline when ${diagnostic} logging throws`, async () => {
      useFakeTimers();
      const logger = h.runtime.logger;
      h.runtime.logger = { ...logger, ...noOpLogger, [diagnostic]: () => { throw new Error('synthetic logging sink failure'); } };
      const exits: unknown[] = [];
      const exit = spyOn(process, 'exit').mockImplementation(((code: unknown) => { exits.push(code); }) as never);
      try {
        await h.runtime.shutdown();
        expect((h.runtime.commandCooldownService as CommandCooldownService).cleanupInterval).toBeNull();
        expect(h.runtime.viewerCountSystem.observers.size).toBe(0);
        advanceTimersByTime(1999); expect(exits).toEqual([]);
        advanceTimersByTime(1); expect(exits).toEqual([0]);
      } finally { await h.runtime.shutdown(); h.runtime.logger = logger; exit.mockRestore(); }
    });
  }


  for (const [state, reason] of [
    ['recovering', 'platform-recovering'], ['initializing', 'platform-initializing'], ['monitoring', null],
  ] as const) {
    it(`derives ${state} readiness from actual lifecycle state without a status stub`, () => {
      const lifecycle = h.runtime.platformLifecycleService as PlatformLifecycleService;
      lifecycle.updatePlatformHealth('youtube', { state });
      const payload = h.runtime.emitSystemReady({});
      expect(payload.degraded).toBe(reason ? true : undefined);
      expect(payload.degradationReasons).toEqual(reason ? [reason] : undefined);
      expect(payload.platforms).toMatchObject({ platformHealth: { youtube: { state } } });
    });
  }

  it('preserves suppression results produced by the real spam detector', async () => {
    const detector = createDonationSpamDetection(createSpamDetectionConfig({ enabled: true, lowValueThreshold: 10, detectionWindow: 10, maxIndividualNotifications: 1 }, { logger: noOpLogger }), { logger: noOpLogger });
    const manager = h.runtime.notificationManager as NotificationManager;
    const previous = manager.donationSpamDetector;
    manager.donationSpamDetector = detector;
    try {
      expect(await h.runtime.handleGiftNotification('tiktok', 'synthetic-viewer', { ...gift, amount: 1, currency: 'coins' })).toMatchObject({ success: true });
      expect(await h.runtime.handleGiftNotification('tiktok', 'synthetic-viewer', { ...gift, id: 'synthetic-repeat', amount: 1, currency: 'coins' })).toMatchObject({ success: false, suppressed: true, reason: 'spam_detection', notificationType: 'platform:gift', platform: 'tiktok' });
      expect(items()).toHaveLength(1);
      await h.runtime.shutdown();
      expect(detector.cleanupInterval).toBeNull();
      expect(detector.getStatistics().trackedUsers).toBe(0);
    } finally { detector.destroy(); manager.donationSpamDetector = previous; }
  });

  it('normalizes an error gift using the real validator and payload builder', async () => {
    const result = await h.runtime.handleGiftNotification('twitch', 'synthetic-viewer', { ...base, isError: true, giftType: '', giftCount: -2, amount: -5, currency: '' });
    expect(result).toMatchObject({ success: true });
    expect(items()).toHaveLength(1);
    expect(items()[0]?.data.giftType).toBeUndefined();
  });

  it('rejects a missing gift username through the real unified validation path', async () => {
    expect(await h.runtime.handleGiftNotification('twitch', '', gift)).toMatchObject({ success: false, notificationType: 'platform:gift', error: 'Missing username for gift notification' });
    expect(items()).toHaveLength(0);
  });


  it('retires real supplied auth without acquiring disabled Twitch monitoring', async () => {
    const auth = new TwitchAuth({ tokenStorePath: join(h.dir, 'synthetic-tokens.json'), clientId: 'synthetic-client', logger: noOpLogger });
    const runtime = new AppRuntime(h.config, { ...h.runtime.dependencies, twitchAuth: auth });
    try {
      await runtime.shutdown();
      await expect(auth.initialize()).rejects.toThrow('disposed');
      await expect(auth.refreshTokens()).rejects.toThrow('disposed');
      expect(runtime.platforms).toEqual({});
    } finally { await runtime.shutdown(); await auth.dispose(); }
  });

  for (const diagnostic of ['Registering event handlers...', 'Event handlers registered successfully', 'Constructor completed']) {
    it(`unwinds real constructor subscriptions after ${diagnostic}`, () => {
      const baseline = h.bus.getListenerSummary();
      const failure = new Error('Synthetic constructor logging sink failure');
      const logging = { ...h.runtime.logger, ...noOpLogger, debug: (message: unknown) => { if (message === diagnostic) throw failure; } };
      expect(() => new AppRuntime(h.config, { ...h.runtime.dependencies, logging })).toThrow(failure);
      expect(h.bus.getListenerSummary()).toEqual(baseline);
    });
  }


  for (const mode of ['shutdown', 'rollbackStartup', 'automatic-rollback'] as const) {
    it(`joins actual early OBS observer initialization during ${mode}`, async () => {
      h.config.twitch.viewerCountEnabled = true;
      h.config.twitch.viewerCountSource = 'synthetic-early-viewers';
      if (mode === 'automatic-rollback') { h.config.gui.enableOperator = true; h.config.gui.host = ''; }
      const runtime = new AppRuntime(h.config, h.runtime.dependencies);
      await runtime.updateViewerCount('twitch', 7);
      const observer = new OBSViewerCountObserver(h.obs, noOpLogger, { config: h.config,
        getViewerCountSnapshot: platform => runtime.viewerCountSystem.getViewerCountSnapshot(platform),
      });
      runtime.viewerCountSystem.addObserver(observer);
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const call = h.socket.call.bind(h.socket);
      h.socket.call = async (method, data) => {
        if (method === 'SetInputSettings' && data?.inputName === 'synthetic-early-viewers') { entered.resolve(); await release.promise; }
        return call(method, data);
      };
      const early = runtime.startViewerCountSystemEarly();
      const repeated = runtime.startViewerCountSystemEarly();
      let stopping: Promise<unknown> | undefined;
      try {
        await entered.promise;
        let completed = false;
        stopping = (mode === 'automatic-rollback' ? runtime.start().catch(error => error) : runtime[mode]()).then(value => { completed = true; return value; });
        await Promise.resolve();
        expect(completed).toBe(false);
        expect(runtime.viewerCountSystem.observers.size).toBe(1);
        release.resolve();
        await Promise.all([early, repeated]);
        const outcome = await stopping;
        if (mode === 'automatic-rollback') expect(outcome).toMatchObject({ message: 'GUI transport requires non-empty host' });
        expect(runtime.viewerCountSystem.observers.size).toBe(0);
        expect(runtime.viewerCountSystem.isPolling).toBe(false);
        expect(runtime.viewerCountSystem.memoryOptimizationInterval).toBeNull();
        expect(runtime.viewerCountSystem.pollingHandles).toEqual({});
      } finally { release.resolve(); await early; await repeated; await stopping; await runtime.rollbackStartup(); }
    });
  }


  it('keeps the lifetime stopped when an actual readiness subscriber requests shutdown', async () => {
    const runtime = new AppRuntime(h.config, h.runtime.dependencies);
    let stopping: Promise<void> | undefined;
    const unsubscribe = h.bus.subscribe(PlatformEvents.SYSTEM_READY, () => { stopping = runtime.shutdown(); });
    try {
      await expect(runtime.start()).rejects.toThrow('stopped');
      await stopping;
      expect(runtime.isStarted).toBe(false);
      await expect(runtime.start()).rejects.toThrow('stopped');
    } finally { await runtime.shutdown(); unsubscribe(); }
  });

  it('coalesces shutdown reentered synchronously from an external logging sink', async () => {
    const logger = h.runtime.logger;
    let reentered: Promise<void> | undefined;
    h.runtime.logger = { ...logger, ...noOpLogger, info: (message: unknown) => {
      if (message === 'Shutting down application...') reentered = h.runtime.shutdown();
    } };
    try {
      const first = h.runtime.shutdown();
      expect(reentered).toBe(first);
      await first;
      expect(h.runtime.isStarted).toBe(false);
    } finally { await h.runtime.shutdown(); h.runtime.logger = logger; }
  });

  it('handles absent manager, chat router and user tracking as explicit invalid runtime state', async () => {
    const manager = h.runtime.notificationManager;
    const router = h.runtime.chatNotificationRouter;
    const tracking = h.runtime.userTrackingService;
    try {
      Reflect.set(h.runtime, 'notificationManager', null);
      expect(await h.runtime.handleUnifiedNotification('platform:follow', 'twitch', 'synthetic-viewer', base)).toMatchObject({ success: false, error: 'Notification manager not available for platform:follow notification' });
      Reflect.set(h.runtime, 'chatNotificationRouter', null);
      await h.runtime.handleChatMessage('twitch', { ...base, username: 'synthetic-viewer', message: 'Synthetic invalid state' });
      expect(items()).toHaveLength(0);
      Reflect.set(h.runtime, 'userTrackingService', null);
      expect(() => h.runtime.isFirstMessage('synthetic-user')).toThrow('UserTrackingService not available');
    } finally {
      h.runtime.notificationManager = manager; h.runtime.chatNotificationRouter = router; h.runtime.userTrackingService = tracking;
    }
  });

  it('keeps gift preparation with the actual manager when the runtime VFX reference is absent', async () => {
    const vfx = h.runtime.vfxCommandService;
    try {
      Reflect.set(h.runtime, 'vfxCommandService', null);
      expect(await h.runtime.handleGiftNotification('twitch', 'synthetic-viewer', gift)).toMatchObject({ success: true });
      expect(items()).toHaveLength(1);
    } finally { h.runtime.vfxCommandService = vfx; }
  });

  it('rejects missing VFX at startup as invalid runtime state and releases actual acquired owners', async () => {
    const runtime = new AppRuntime(h.config, h.runtime.dependencies);
    Reflect.set(runtime, 'vfxCommandService', null);
    try {
      await expect(runtime.start()).rejects.toThrow('VFXCommandService unavailable for runtime startup');
      expect(runtime.isStarted).toBe(false);
      expect(runtime.viewerCountSystem.observers.size).toBe(0);
    } finally { await runtime.rollbackStartup(); }
  });


  for (const failure of ['invalid', 'outage', 'partial-startup'] as const) {
    it(`owns actual accepted Twitch monitoring and reports real lifecycle failure on ${failure}`, async () => {
      const previous = { ...secrets.twitch };
      const tokenStorePath = join(h.dir, 'synthetic-monitor-tokens.json');
      await fs.writeFile(tokenStorePath, JSON.stringify({ twitch: { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh' } }));
      secrets.twitch.clientSecret = 'synthetic-secret';
      let broken = false;
      let requests = 0;
      let now = 0;
      const auth = new TwitchAuth({ tokenStorePath, clientId: 'synthetic-client', expectedUsername: 'synthetic-viewer', logger: noOpLogger,
        monitoringNow: () => now,
        httpClient: { get: async () => {
          requests++;
          if (broken) throw failure === 'invalid' ? { response: { status: 401 } } : new Error('Synthetic provider unavailable');
          return { data: { user_id: 'synthetic-user', login: 'synthetic-viewer', client_id: 'synthetic-client', scopes: [...TWITCH_OAUTH_SCOPES] } };
        }, post: async () => { throw new Error('Unexpected synthetic token refresh'); } },
      });
      // This supplied lifecycle deliberately has no platform acquisitions. The
      // test establishes monitor admission and its real health callback, while
      // provider teardown is exercised by runtime-platform-retirement.
      const lifecycle = new PlatformLifecycleService({ config: {}, logger: noOpLogger });
      const config = { ...h.config, twitch: { ...h.config.twitch, enabled: true }, gui: { ...h.config.gui, ...(failure === 'partial-startup' ? { enableOperator: true, host: '' } : {}) } };
      const guiTransportService = createGuiTransportService({ config, eventBus: h.bus, logger: noOpLogger });
      const runtime = new AppRuntime(config, { ...h.runtime.dependencies, twitchAuth: auth, guiTransportService, platformLifecycleService: lifecycle as unknown as ConstructorParameters<typeof AppRuntime>[1]['platformLifecycleService'] });
      const monitoring = spyOn(auth, 'startValidationMonitoring');
      try {
        await auth.initialize();
        expect(auth.isReady()).toBe(true);
        if (failure === 'partial-startup') {
          await expect(runtime.start()).rejects.toThrow('GUI transport requires non-empty host');
          expect(monitoring).toHaveBeenCalledTimes(1);
          expect(auth.isReady()).toBe(false);
          await expect(auth.refreshTokens()).rejects.toThrow('disposed');
          expect(runtime.isStarted).toBe(false);
          return;
        }
        await runtime.start();
        const options = monitoring.mock.calls[0]?.[0];
        expect(options).toBeDefined();
        if (!options) throw new Error('Runtime did not acquire real auth monitoring');
        // Start uses real OBS pacing. Restart only the actual monitor sleep on
        // the controlled clock, preserving the runtime-created callback.
        await auth.stopValidationMonitoring();
        useFakeTimers();
        auth.startValidationMonitoring(options);
        const initialRequests = requests;
        broken = true;
        const advance = async (ms: number) => { now += ms; advanceTimersByTime(ms); for (let index = 0; index < 80; index++) await Promise.resolve(); };
        await advance(3_600_000);
        if (failure === 'outage') {
          expect(auth.isReady()).toBe(true);
          for (let index = 0; index < 10; index++) await advance(30_000);
        }
        expect(requests).toBeGreaterThan(initialRequests);
        expect(auth.isReady()).toBe(false);
        expect(lifecycle.getStatus().platformHealth.twitch?.state).toBe('failed');
        expect(secrets.twitch.accessToken).toBe('synthetic-access');
        await runtime.shutdown();
        const retiredRequests = requests;
        await advance(3_600_000);
        expect(requests).toBe(retiredRequests);
        await expect(auth.refreshTokens()).rejects.toThrow('disposed');
      } finally {
        await runtime.shutdown(); await auth.dispose(); await h.runtime.shutdown();
        useRealTimers(); monitoring.mockRestore(); Object.assign(secrets.twitch, previous);
      }
    });
  }


  it('credits only canonical source contributions in actual presentation accounting', async () => {
    h.queue.addItem({ type: 'platform:gift', platform: 'youtube', data: { id: 'synthetic-display-only', username: 'synthetic-viewer', amount: 10, currency: 'USD', displayMessage: 'Synthetic display-only gift' } });
    await h.drain();
    expect(h.funding.snapshot.currentUsd).toBe(0);
    expect(await h.runtime.handleGiftNotification('youtube', 'synthetic-viewer', gift)).toMatchObject({ success: true });
    await h.drain();
    expect(h.funding.snapshot.currentUsd).toBe(5);
    expect((await h.persistedFunding()).currentMicros).toBe(5_000_000);
  });

  it('uses the real connected OBS manager fallback when the event service reference is absent', async () => {
    const service = h.runtime.obsEventService;
    const disconnect = spyOn(h.socket, 'disconnect');
    Reflect.set(h.runtime, 'obsEventService', undefined);
    try {
      expect(h.obs.isConnected()).toBe(true);
      await h.runtime.shutdown();
      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(h.obs.isConnected()).toBe(false);
    } finally {
      // Invalid-state coverage deliberately hid an owner: release it explicitly.
      h.runtime.obsEventService = service;
      await service.disconnect?.(); service.destroy?.();
      disconnect.mockRestore();
    }
  });


  it('contains an actual early viewer initialization logging failure without starting polling', async () => {
    let failures = 0;
    const logging = { ...noOpLogger, info: (message: unknown) => {
      if (typeof message === 'string' && message.startsWith('Viewer count system initialized')) throw new Error('Synthetic viewer initialization logging failure');
    }, error: () => { failures++; } };
    const runtime = new AppRuntime(h.config, { ...h.runtime.dependencies, logging });
    try {
      await runtime.startViewerCountSystemEarly();
      expect(failures).toBe(1);
      expect(runtime.viewerCountSystem.isPolling).toBe(false);
      expect(runtime.viewerCountSystem.memoryOptimizationInterval).toBeNull();
    } finally { await runtime.rollbackStartup(); }
  });

  it("throws when unified notification options are missing", async () => {
    const runtime = h.runtime;
    await expect(
      Reflect.apply(runtime.handleUnifiedNotification, runtime, [
        "platform:follow",
        "twitch",
        "test-user",
      ]),
    ).rejects.toThrow("handleUnifiedNotification requires options");
  });

  it("enforces required fields for gift notifications", async () => {
    const runtime = h.runtime;

    await expect(
      runtime.handleGiftNotification("twitch", "test-user", {
        type: "platform:gift",
        userId: "test-user-id",
      }),
    ).rejects.toThrow("handleGiftNotification requires timestamp");
  });

  it("rejects null amount on a marked amountless YouTube jewels gift", async () => {
    const runtime = h.runtime;

    await expect(runtime.handleGiftNotification("youtube", "test-youtube-gifter", {
      type: "platform:gift",
      timestamp: "2024-01-01T00:00:00.000Z",
      giftType: "Let em cook",
      giftCount: 1,
      amount: null,
      currency: "jewels",
      id: "yt-jewels-gift-runtime-null-1",
      metadata: {
        missingFields: ["amount", "userId"],
      },
    })).rejects.toThrow("Gift notification requires giftType, giftCount, amount, and currency");
  });

  it("validates giftpaypiggy event requirements", async () => {
    const runtime = h.runtime;

    await expect(
      runtime.handleGiftPaypiggyEvent("twitch", "test-user", {
        giftCount: 2,
        userId: "test-user-id",
        timestamp: "2024-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow("handleGiftPaypiggyEvent requires tier and giftCount");
  });

  it("validates resub events require tier, months, and message", async () => {
    const runtime = h.runtime;

    await expect(
      runtime.handleResubEvent("twitch", "test-user", {
        tier: "1000",
        months: 3,
      }),
    ).rejects.toThrow("handleResubEvent requires tier, months, and message");
  });

  it("validates raid inputs", async () => {
    const runtime = h.runtime;

    await expect(
      runtime.handleRaidNotification("twitch", "test-raider", {}),
    ).resolves.toMatchObject({
      success: false,
      error: "Missing userId for platform:raid notification",
    });
    await expect(
      runtime.handleRaidNotification("twitch", "test-raider", undefined as unknown as Parameters<AppRuntime["handleRaidNotification"]>[2]),
    ).rejects.toThrow("handleRaidNotification requires options");
  });

  it("requires options when emitting system ready", async () => {
    const runtime = h.runtime;

    expect(() => Reflect.apply(runtime.emitSystemReady, runtime, [])).toThrow(
      "emitSystemReady requires options",
    );
  });

  it("requires a command for farewell notifications", async () => {
    const runtime = h.runtime;

    await expect(
      runtime.handleFarewellNotification("twitch", "test-user", {}),
    ).rejects.toThrow("handleFarewellNotification requires command");
  });
});
