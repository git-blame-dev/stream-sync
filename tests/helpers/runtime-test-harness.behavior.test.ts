import { afterEach, describe, expect, it } from 'bun:test';
import { createTestAppRuntime } from './runtime-test-harness';
import { EventBus, createEventBus } from '../../src/core/EventBus';
import { UserTrackingService } from '../../src/services/UserTrackingService';
import { AppRuntime } from '../../src/runtime/AppRuntime';
import { useFakeTimers, useRealTimers, getTimerCount } from './bun-timers';
import { isRecord } from '../../src/utils/record-contracts';

describe('runtime test dependency injection', () => {
    const runtimes: AppRuntime[] = [];
    afterEach(async () => { await Promise.all(runtimes.splice(0).map(runtime => runtime.shutdown())); });
    const createHarness = (options: Parameters<typeof createTestAppRuntime>[1] = {}) => {
        const harness = createTestAppRuntime({}, options);
        runtimes.push(harness.runtime);
        return harness;
    };
    it('forwards runtime lifecycle options and exposes the final injected owners', async () => {
        const owner = createEventBus();
        const bus = {
            emit: (name: string, payload: unknown) => owner.emit(name, payload),
            subscribe: (name: string, handler: (payload: Record<string, unknown>) => void | Promise<void>) =>
                owner.subscribe(name, payload => {
                    if (!isRecord(payload)) throw new TypeError('Expected synthetic runtime event record');
                    return handler(payload);
                })
        };
        const neural = { ensureStarted: async () => {}, stop: async () => {} };
        const onShutdownComplete = () => {};
        const harness = createHarness({
            neuralTtsProcessManager: neural,
            onShutdownComplete,
            gracefulExitService: undefined,
            overrides: { eventBus: bus }
        });
        expect(harness.dependencies.neuralTtsProcessManager).toBe(neural);
        expect(harness.dependencies.onShutdownComplete).toBe(onShutdownComplete);
        expect(harness.dependencies.gracefulExitService).toBeDefined();
        expect(harness.eventBus).toBe(bus);
        expect(harness.notificationManager).toBe(harness.dependencies.notificationManager);
        let observed: unknown;
        const unsubscribe = harness.eventBus.subscribe('system:ready', value => { observed = value; });
        try {
            bus.emit('system:ready', { synthetic: true });
            expect(observed).toEqual({ synthetic: true });
            await harness.dependencies.commandCooldownService.dispose();
        } finally { if (typeof unsubscribe === 'function') unsubscribe(); }
    });

    it('uses real event delivery and first-message state by default', () => {
        const harness = createHarness();
        const tracking = harness.dependencies.userTrackingService;
        if (!(tracking instanceof UserTrackingService)) throw new TypeError('Expected real first-message owner');
        expect(tracking.isFirstMessage('synthetic-viewer', { platform: 'twitch' })).toBe(true);
        expect(tracking.isFirstMessage('synthetic-viewer', { platform: 'twitch' })).toBe(false);
        expect(harness.eventBus).toBeInstanceOf(EventBus);
        harness.dependencies.commandCooldownService.dispose();
    });

    it('retires acquired cooldown resources when the runtime rejects invalid required input', () => {
        useFakeTimers();
        const baseline = getTimerCount();
        try {
            expect(() => createTestAppRuntime({}, { overrides: {
                eventBus: null as unknown as ConstructorParameters<typeof AppRuntime>[1]['eventBus'],
            } })).toThrow('AppRuntime missing required dependencies: eventBus');
            expect(getTimerCount()).toBe(baseline);
        } finally { useRealTimers(); }
    });

    it('preserves an explicitly unavailable optional runtime owner', () => {
        const harness = createHarness({ twitchAuth: null, dependencyFactory: null });
        expect(harness.dependencies.twitchAuth).toBeNull();
        expect(harness.dependencies.dependencyFactory).toBeNull();
    });
});
