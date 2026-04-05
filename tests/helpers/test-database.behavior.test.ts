const { describe, it, expect, beforeEach, afterEach } = require('bun:test');

const testClock = require('./test-clock');
const { resetTestIds } = require('./test-id');
const {
    TestDataStore,
    TestStateManager,
    TestEnvironment,
    createTestDataFactory,
    waitForCondition,
    createMockTimer
} = require('./test-database');

describe('test-database behavior', () => {
    beforeEach(() => {
        testClock.reset();
        resetTestIds();
        delete global.testEnv;
    });

    afterEach(() => {
        testClock.useRealTime();
        delete global.testEnv;
    });

    it('manages datastore entries, metadata, and aggregate stats', () => {
        const store = new TestDataStore();

        testClock.set(1000);
        store.set('first', { value: 1 });
        testClock.advance(100);
        store.set('second', { value: 2 });

        expect(store.has('first')).toBe(true);
        expect(store.keys()).toEqual(['first', 'second']);

        expect(store.get('first').value).toBe(1);
        expect(store.get('first').value).toBe(1);
        expect(store.get('second').value).toBe(2);

        const stats = store.getStats();
        expect(stats.totalEntries).toBe(2);
        expect(stats.totalAccesses).toBe(3);
        expect(stats.averageAccessCount).toBe(1.5);
        expect(stats.oldestEntry).toBe('first');
        expect(stats.newestEntry).toBe('second');

        expect(store.delete('first')).toBe(true);
        expect(store.delete('missing')).toBe(false);

        store.clear();
        expect(store.keys().length).toBe(0);
        expect(store.getStats().totalEntries).toBe(0);
    });

    it('tracks test state lifecycle, cleanup execution, and snapshots', async () => {
        const manager = new TestStateManager();

        expect(manager.endTest()).toBe(0);

        manager.startTest('first-test', 'suite-a');
        testClock.advance(10);
        manager.startTest('second-test', 'suite-b');

        manager.addCleanupTask(async () => {}, 'success cleanup');
        manager.addCleanupTask(async () => {
            throw new Error('cleanup failure');
        }, 'failing cleanup');

        const sourceState = { nested: { value: 1 } };
        manager.saveSnapshot('snapshot-a', sourceState);
        sourceState.nested.value = 2;

        expect(manager.getSnapshot('snapshot-a').nested.value).toBe(1);

        const executionTime = manager.endTest();
        expect(executionTime).toBeGreaterThanOrEqual(0);

        const cleanupResults = await manager.executeCleanup();
        expect(cleanupResults.length).toBe(2);
        expect(cleanupResults[0].success).toBe(true);
        expect(cleanupResults[1].success).toBe(false);
        expect(cleanupResults[1].error).toContain('cleanup failure');

        manager.clearSnapshots();
        expect(manager.getSnapshot('snapshot-a')).toBeNull();
    });

    it('initializes environment and context helpers with cleanup contracts', async () => {
        const environment = new TestEnvironment();
        environment.initialize({ cleanupMode: 'manual', isolationLevel: 'suite', retryAttempts: 5 });

        expect(global.testEnv).toBeDefined();
        expect(global.testEnv.config.isolationLevel).toBe('suite');
        expect(global.testEnv.config.retryAttempts).toBe(5);

        const context = environment.createTestContext('test-context');
        context.startTest('context-test');
        context.setData('key', 'value');
        expect(context.getData('key')).toBe('value');
        expect(context.hasData('key')).toBe(true);

        context.addCleanup(async () => {}, 'context cleanup');
        const cleanupResults = await context.cleanup();
        expect(cleanupResults.length).toBe(1);
        expect(cleanupResults[0].success).toBe(true);

        environment.dataStore.set('shared', { value: true });
        environment.stateManager.saveSnapshot('global-snapshot', { ok: true });
        environment.reset();

        const stats = environment.getStats();
        expect(stats.dataStore.totalEntries).toBe(0);
        expect(stats.stateManager.snapshotCount).toBe(0);
    });

    it('supports automatic cleanup mode initialization', () => {
        const environment = new TestEnvironment();

        expect(() => environment.initialize({ cleanupMode: 'automatic' })).not.toThrow();
        expect(global.testEnv.config.cleanupMode).toBe('automatic');
    });

    it('creates deterministic data factories for supported entity types', () => {
        testClock.set(5000);

        const user = createTestDataFactory('user')({ username: 'test-user' });
        const notification = createTestDataFactory('notification')({ message: 'test-message' });
        const config = createTestDataFactory('config')({ timeout: 2500 });
        const event = createTestDataFactory('event')({ type: 'test-event' });
        const fallback = createTestDataFactory('unknown')();

        expect(user.id.startsWith('user-')).toBe(true);
        expect(user.username).toBe('test-user');
        expect(notification.id.startsWith('notification-')).toBe(true);
        expect(notification.message).toBe('test-message');
        expect(config.timeout).toBe(2500);
        expect(event.type).toBe('test-event');
        expect(fallback).toEqual({});
    });

    it('waits for conditions with success, timeout, and error paths', async () => {
        let attempts = 0;

        await expect(waitForCondition(() => {
            attempts += 1;
            return attempts >= 2;
        }, 100, 10)).resolves.toBeUndefined();
        expect(attempts).toBeGreaterThanOrEqual(2);

        await expect(waitForCondition(() => false, 20, 5)).rejects.toThrow('Condition not met');
        await expect(waitForCondition(() => {
            throw new Error('condition exploded');
        }, 20, 5)).rejects.toThrow('condition exploded');
    });

    it('provides controllable mock timer operations', () => {
        const timer = createMockTimer(100);

        expect(timer.now()).toBe(100);
        timer.advance(50);
        expect(timer.now()).toBe(150);
        timer.set(200);
        expect(timer.now()).toBe(200);
        timer.reset();
        expect(timer.now()).toBe(100);
    });
});
