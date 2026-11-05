import { afterEach, describe, expect, it } from 'bun:test';
import { createTestAppRuntime } from '../helpers/runtime-test-harness';
import { PlatformLifecycleService } from '../../src/services/PlatformLifecycleService';
import { noOpLogger } from '../helpers/mock-factories';
import { getTimerCount, useFakeTimers, useRealTimers } from '../helpers/bun-timers';

const fixtures: ReturnType<typeof createTestAppRuntime>[] = [];
const fixture = (options: Parameters<typeof createTestAppRuntime>[1] = {}) => {
  const owner = createTestAppRuntime({}, options);
  fixtures.push(owner);
  return owner;
};
afterEach(async () => {
  try { await Promise.all(fixtures.splice(0).map(owner => owner.runtime.shutdown())); }
  finally { useRealTimers(); }
});

describe('AppRuntime system readiness payload', () => {
  it('publishes actual owner status and omits monitoring metrics', () => {
    const { runtime, eventBus } = fixture();
    runtime.commandCooldownService.updateUserCooldown('synthetic-ready-viewer');
    const emitted: unknown[] = [];
    const unsubscribe = eventBus.subscribe('system:ready', value => { emitted.push(value); });
    try {
      const payload = runtime.emitSystemReady({ correlationId: 'synthetic-ready' });
      expect(payload.services).toEqual(expect.arrayContaining(['notificationManager', 'platformLifecycleService']));
      expect(payload.platforms).toEqual(runtime.platformLifecycleService.getStatus?.());
      expect(payload.cooldowns).toEqual(runtime.commandCooldownService.getStatus?.());
      expect(payload.cooldowns).toMatchObject({ activeUsers: 1 });
      expect(payload.correlationId).toBe('synthetic-ready');
      expect(payload.monitoring).toBeUndefined();
      expect(emitted).toEqual([payload]);
    } finally { if (typeof unsubscribe === 'function') unsubscribe(); }
  });

  it('reports degradation from actual lifecycle initialization failure', async () => {
    const { runtime } = fixture();
    const lifecycle = runtime.platformLifecycleService as PlatformLifecycleService;
    lifecycle.config = { youtube: { enabled: true, username: '' } };
    // Validation fails before constructing or connecting a provider.
    await lifecycle.initializePlatform('youtube', class {
      constructor() { throw new Error('Missing username must reject before construction'); }
      async initialize() {} on() {} async cleanup() {}
    });
    const payload = runtime.emitSystemReady({ correlationId: 'synthetic-degraded-ready' });
    expect(payload).toMatchObject({ degraded: true, degradationReasons: ['platform-initialization-failed'] });
    expect(payload.platforms).toMatchObject({ failedPlatforms: [{ name: 'youtube', lastError: 'Missing username' }] });
  });
});

describe('AppRuntime shutdown lifecycle', () => {
  for (const restartRequested of [false, true]) {
    it(`emits shutdown before composition completion with restart ${restartRequested}`, async () => {
      useFakeTimers();
      const events: unknown[] = [];
      const { runtime, eventBus } = fixture({ onShutdownComplete: () => events.push('complete') });
      const unsubscribe = eventBus.subscribe('system:shutdown', value => { events.push(value); });
      const timers = getTimerCount();
      const exitCode = process.exitCode;
      try {
        await runtime.emitSystemShutdown({ reason: 'synthetic-shutdown', restartRequested });
        expect(events).toEqual([{ reason: 'synthetic-shutdown', mode: restartRequested ? 'restart' : 'exit' }, 'complete']);
        expect(getTimerCount()).toBe(timers);
        expect(process.exitCode).toBe(exitCode);
      } finally { if (typeof unsubscribe === 'function') unsubscribe(); }
    });
  }

  it('notifies composition after the external log sink flush settles', async () => {
    const flush = Promise.withResolvers<void>();
    let completed = false;
    const { runtime } = fixture({ logger: { ...noOpLogger, flush: () => flush.promise }, onShutdownComplete: () => { completed = true; } });
    const pending = runtime.emitSystemShutdown({ reason: 'synthetic-flush' });
    expect(completed).toBe(false);
    flush.resolve();
    await pending;
    expect(completed).toBe(true);
  });

  it('retires actual viewer status subscriptions, polling and cooldown resources', async () => {
    useFakeTimers();
    const baseline = getTimerCount();
    const { runtime } = fixture();
    expect(runtime.viewerCountStatusCleanup).toEqual(expect.any(Function));
    expect(getTimerCount()).toBe(baseline + 1);
    await runtime.shutdown();
    expect(runtime.viewerCountStatusCleanup).toBeNull();
    expect(runtime.viewerCountSystem.isPolling).toBe(false);
    expect(getTimerCount()).toBe(baseline);
    await runtime.shutdown();
    expect(getTimerCount()).toBe(baseline);
  });
});
