import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { createMockFn, type TestMockFn } from './bun-mock-utils';
import {
    MockLifecycleManager,
    globalLifecycleManager,
    setupAutomatedCleanup,
    withLifecycleManagement,
    createManagedMock,
    checkMockIsolation,
    withMockIsolation,
    MockReuseCache,
    createMockReuseKey,
    globalMockCache
} from './mock-lifecycle';
import testClock from './test-clock';

const createDispatcherMock = () => ({
    _mockType: 'NotificationDispatcher',
    dispatchSuperChat: createMockFn<unknown[], Promise<boolean>>(async () => true),
    dispatchMembership: createMockFn<unknown[], Promise<boolean>>(async () => true),
    dispatchGiftMembership: createMockFn<unknown[], Promise<boolean>>(async () => true),
    dispatchSuperSticker: createMockFn<unknown[], Promise<boolean>>(async () => true),
    dispatchFollow: createMockFn<unknown[], Promise<boolean>>(async () => true),
    dispatchRaid: createMockFn<unknown[], Promise<boolean>>(async () => true),
    dispatchMessage: createMockFn<unknown[], Promise<boolean>>(async () => true)
});

type IsolatedMock = {
    _mockType: string;
    action: TestMockFn<[string], unknown>;
};

type DispatcherMock = ReturnType<typeof createDispatcherMock>;

describe('mock-lifecycle behavior', () => {
    beforeEach(() => {
        testClock.reset();
        globalLifecycleManager.reset();
        globalMockCache.clear();
    });

    afterEach(() => {
        testClock.useRealTime();
        globalLifecycleManager.reset();
        globalMockCache.clear();
    });

    it('registers, retrieves, cleans, and resets mocks with performance metrics', async () => {
        const manager = new MockLifecycleManager();
        const mock = createDispatcherMock();

        manager.registerMock('dispatcher', mock, { autoValidate: false });
        await mock.dispatchSuperChat();

        const retrieved = manager.getMock('dispatcher');
        expect(retrieved).toBe(mock);
        expect(manager.getMock('missing')).toBeNull();

        manager.cleanup('dispatcher', {
            clearCalls: true,
            resetImplementations: true,
            validateAfterCleanup: true
        });
        expect(mock.dispatchSuperChat.mock.calls).toHaveLength(0);

        manager.cleanup(null, { removeFromRegistry: true });
        expect(manager.getPerformanceMetrics().activeMocks).toBe(0);

        manager.addCleanupCallback(() => {});
        manager.executeCleanupCallbacks();

        manager.registerMock('dispatcher-2', createDispatcherMock(), { autoValidate: false });
        const metricsBeforeReset = manager.getPerformanceMetrics();
        expect(metricsBeforeReset.totalCleanupOperations).toBeGreaterThanOrEqual(1);
        manager.reset();
        const metrics = manager.getPerformanceMetrics();
        expect(metrics.totalMocksCreated).toBe(0);
        expect(metrics.totalCleanupOperations).toBe(0);
        expect(metrics.activeMocks).toBe(0);
        expect(metrics.memoryUsage.totalMocks).toBe(0);
    });

    it('returns lifecycle hooks that clear calls and run cleanup callbacks', async () => {
        const cleanupHooks = setupAutomatedCleanup({
            clearCallsBeforeEach: true,
            resetImplementationsAfterEach: true,
            validateAfterCleanup: false,
            logPerformanceMetrics: false
        });

        const managed = createManagedMock(createDispatcherMock(), {
            autoValidate: false,
            contractName: 'NotificationDispatcher'
        });

        await managed.dispatchMessage();
        expect(managed.dispatchMessage.mock.calls).toHaveLength(1);

        cleanupHooks.beforeEach();
        expect(managed.dispatchMessage.mock.calls).toHaveLength(0);

        let callbackCount = 0;
        globalLifecycleManager.addCleanupCallback(() => {
            callbackCount += 1;
        });

        cleanupHooks.afterEach();
        cleanupHooks.afterAll();
        expect(callbackCount).toBe(1);
    });

    it('wraps factories with lifecycle management and registers created mocks', () => {
        const wrappedFactory = withLifecycleManagement(
            () => createDispatcherMock(),
            'NotificationDispatcher',
            { autoValidate: false }
        );

        const managed = wrappedFactory();
        expect(managed._mockType).toBe('NotificationDispatcher');
        expect(globalLifecycleManager.getPerformanceMetrics().activeMocks).toBe(1);

        const directManaged = createManagedMock(createDispatcherMock(), {
            autoValidate: false,
            contractName: 'NotificationDispatcher'
        });
        expect(directManaged._mockType).toBe('NotificationDispatcher');
        expect(globalLifecycleManager.getPerformanceMetrics().activeMocks).toBe(2);
    });

    it('reports isolation issues and supports isolation wrappers for test execution', async () => {
        const leakyMock = { action: createMockFn<[string], string>(() => 'ok') };
        leakyMock.action('call');

        const leakyResult = checkMockIsolation([leakyMock]);
        expect(leakyResult.isolated).toBe(false);
        expect(leakyResult.issues[0]).toContain('residual calls');
        expect(leakyResult.warnings[0]).toContain('custom implementation');

        const cleanResult = checkMockIsolation([{ action: createMockFn() }]);
        expect(cleanResult.isolated).toBe(true);

        const createdMocks: IsolatedMock[] = [];
        const wrapped = withMockIsolation(
            async (mock: IsolatedMock, value: string) => {
                mock.action(value);
                mock.action.mockClear();
                return `${mock._mockType}:${value}`;
            },
            [() => {
                const mock: IsolatedMock = {
                    _mockType: 'isolated',
                    action: createMockFn<[string], unknown>()
                };
                createdMocks.push(mock);
                return mock;
            }] as const
        );

        const outcome = await wrapped('payload');
        expect(outcome).toBe('isolated:payload');
        expect(createdMocks[0]?.action.mock.calls).toHaveLength(0);
    });

    it('caches and reuses mocks with configurable cache reset semantics', () => {
        const cache = new MockReuseCache();
        const dispatcherKey = createMockReuseKey<DispatcherMock>('dispatcher');
        const oneUseKey = createMockReuseKey<DispatcherMock>('one-use');

        const first = cache.getOrCreate(dispatcherKey, () => createDispatcherMock());
        first.dispatchFollow('one');
        const second = cache.getOrCreate(dispatcherKey, () => createDispatcherMock());

        expect(second).toBe(first);
        expect(second.dispatchFollow.mock.calls).toHaveLength(0);

        const oneUseFirst = cache.getOrCreate(oneUseKey, () => createDispatcherMock(), { maxUses: 1 });
        const oneUseSecond = cache.getOrCreate(oneUseKey, () => createDispatcherMock(), { maxUses: 1 });
        expect(oneUseSecond).not.toBe(oneUseFirst);

        const statsBeforeClear = cache.getStats();
        expect(statsBeforeClear.totalCachedMocks).toBeGreaterThan(0);
        expect(statsBeforeClear.totalAccesses).toBeGreaterThan(0);

        cache.clear();
        const statsAfterClear = cache.getStats();
        expect(statsAfterClear.totalCachedMocks).toBe(0);
        expect(statsAfterClear.totalAccesses).toBe(0);
    });

    it('shares reusable global cache and lifecycle manager instances', () => {
        const cached = globalMockCache.getOrCreate(createMockReuseKey<DispatcherMock>('global-dispatcher'), () => createDispatcherMock());
        expect(cached._mockType).toBe('NotificationDispatcher');

        globalLifecycleManager.registerMock('global-managed', createDispatcherMock(), { autoValidate: false });
        const metrics = globalLifecycleManager.getPerformanceMetrics();
        expect(metrics.activeMocks).toBe(1);
        expect(metrics.totalMocksCreated).toBe(1);
    });
});
