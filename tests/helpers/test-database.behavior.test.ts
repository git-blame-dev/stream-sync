import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
    TestDataStore,
    TestStateManager,
    TestEnvironment,
    createTestDataFactory,
    waitForCondition,
    createMockTimer
} from './test-database';
import testClock from './test-clock';
import { resetTestIds } from './test-id';

describe('test-database behavior', () => {
    let previousEnvironment: PropertyDescriptor | undefined;
    beforeEach(() => {
        previousEnvironment = Object.getOwnPropertyDescriptor(globalThis, 'testEnv');
        testClock.reset();
        resetTestIds();
        Reflect.deleteProperty(globalThis, 'testEnv');
    });

    afterEach(() => {
        testClock.useRealTime();
        Reflect.deleteProperty(globalThis, 'testEnv');
        if (previousEnvironment) Object.defineProperty(globalThis, 'testEnv', previousEnvironment);
    });

    it('manages datastore entries, metadata, and aggregate stats', () => {
        const store = new TestDataStore();

        testClock.set(1000);
        store.set('first', { value: 1 });
        testClock.advance(100);
        store.set('second', { value: 2 });

        expect(store.has('first')).toBe(true);
        expect(store.keys()).toEqual(['first', 'second']);

        expect(store.get<{ value: number }>('first')?.value).toBe(1);
        expect(store.get<{ value: number }>('first')?.value).toBe(1);
        expect(store.get<{ value: number }>('second')?.value).toBe(2);

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

        expect(manager.getSnapshot<{ nested: { value: number } }>('snapshot-a')?.nested.value).toBe(1);

        const executionTime = manager.endTest();
        expect(executionTime).toBeGreaterThanOrEqual(0);

        const cleanupResults = await manager.executeCleanup();
        expect(cleanupResults.length).toBe(2);
        expect(cleanupResults[0]?.success).toBe(true);
        expect(cleanupResults[1]?.success).toBe(false);
        expect(cleanupResults[1]?.error).toContain('cleanup failure');

        manager.clearSnapshots();
        expect(manager.getSnapshot('snapshot-a')).toBeNull();
    });

    it('initializes environment and context helpers with cleanup contracts', async () => {
        const environment = new TestEnvironment();
        environment.initialize({ cleanupMode: 'manual', isolationLevel: 'suite', retryAttempts: 5 });

        expect(globalThis.testEnv).toBeDefined();
        expect(globalThis.testEnv?.config.isolationLevel).toBe('suite');
        expect(globalThis.testEnv?.config.retryAttempts).toBe(5);

        const context = environment.createTestContext('test-context');
        context.startTest('context-test');
        context.setData('key', 'value');
        expect(context.getData<string>('key')).toBe('value');
        expect(context.hasData('key')).toBe(true);

        context.addCleanup(async () => {}, 'context cleanup');
        const cleanupResults = await context.cleanup();
        expect(cleanupResults.length).toBe(1);
        expect(cleanupResults[0]?.success).toBe(true);

        environment.dataStore.set('shared', { value: true });
        environment.stateManager.saveSnapshot('global-snapshot', { ok: true });
        environment.reset();

        const stats = environment.getStats();
        expect(stats.dataStore.totalEntries).toBe(0);
        expect(stats.stateManager.snapshotCount).toBe(0);
    });

    it('runs automatic cleanup in native Bun suite scope with current isolation settings', () => {
        const root = mkdtempSync(path.join(tmpdir(), 'synthetic-test-environment-'));
        try {
            writeFileSync(path.join(root, 'bunfig.toml'), '[test]\n');
            writeFileSync(path.join(root, 'environment.test.ts'), `
import { describe, it, afterAll, expect } from 'bun:test';
import { TestEnvironment } from ${JSON.stringify(import.meta.resolve('./test-database'))};
const environments = [];
const manualEnvironments = [];
for (const isolationLevel of ['test', 'suite', 'global']) {
  describe(isolationLevel, () => {
    const environment = new TestEnvironment();
    environments.push(environment);
    environment.initialize({ isolationLevel: 'test' });
    environment.initialize({ isolationLevel });
    let cleaned = 0;
    it('creates state and a cleanup task', () => {
      environment.dataStore.set('synthetic-entry', true);
      environment.stateManager.saveSnapshot('synthetic-snapshot', { ok: true });
      environment.stateManager.addCleanupTask(() => { cleaned++; }, 'synthetic cleanup');
    });
    it('respects the configured retention boundary', () => {
      expect(cleaned).toBe(1);
      expect(environment.dataStore.has('synthetic-entry')).toBe(isolationLevel !== 'test');
      expect(environment.stateManager.getSnapshot('synthetic-snapshot')).toEqual(isolationLevel === 'test' ? null : { ok: true });
    });
  });
}
for (const initiallyAutomatic of [false, true]) {
  describe(initiallyAutomatic ? 'switched to manual' : 'manual', () => {
    const environment = new TestEnvironment();
    manualEnvironments.push(environment);
    if (initiallyAutomatic) environment.initialize();
    environment.initialize({ cleanupMode: 'manual' });
    it('creates manually owned state', () => {
      environment.dataStore.set('synthetic-manual', true);
      environment.stateManager.saveSnapshot('synthetic-manual', true);
      environment.stateManager.addCleanupTask(() => { throw new Error('must remain queued'); });
    });
    it('does not run automatic cleanup', () => {
      expect(environment.dataStore.has('synthetic-manual')).toBe(true);
      expect(environment.stateManager.getSnapshot('synthetic-manual')).toBe(true);
      expect(environment.stateManager.cleanupQueue.length).toBe(1);
    });
  });
}
describe('last published automatic owner', () => {
  const environment = new TestEnvironment();
  environments.push(environment);
  environment.initialize();
  it('publishes its own reference until suite cleanup', () => {
    expect(globalThis.testEnv.data).toBe(environment.dataStore);
  });
});
afterAll(() => {
  expect(globalThis.testEnv).toBeUndefined();
  for (const environment of environments) {
    expect(environment.dataStore.keys()).toEqual([]);
    expect(environment.stateManager.stateSnapshots.size).toBe(0);
  }
  for (const environment of manualEnvironments) {
    expect(environment.dataStore.has('synthetic-manual')).toBe(true);
    expect(environment.stateManager.getSnapshot('synthetic-manual')).toBe(true);
    expect(environment.stateManager.cleanupQueue.length).toBe(1);
    environment.cleanupAfterSuite();
  }
  expect(globalThis.testEnv).toBeUndefined();
});
`);
            const child = Bun.spawnSync([process.execPath, 'test', '--config', path.join(root, 'bunfig.toml'), path.join(root, 'environment.test.ts')], {
                cwd: root, env: { NODE_ENV: 'test' }, stdout: 'pipe', stderr: 'pipe'
            });
            expect({ code: child.exitCode, output: child.stderr.toString() }).toEqual({
                code: 0, output: expect.stringContaining('11 pass')
            });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it.each(['test', 'suite', 'global'])('cleans queued tasks and preserves %s isolation semantics', async (isolationLevel) => {
        const environment = new TestEnvironment();
        environment.initialize({ cleanupMode: 'manual', isolationLevel });
        const published = globalThis.testEnv;
        environment.dataStore.set('synthetic-entry', true);
        environment.stateManager.saveSnapshot('synthetic-snapshot', { ok: true });
        environment.stateManager.addCleanupTask(() => { throw new Error('synthetic cleanup failure'); }, 'failing cleanup');
        environment.stateManager.addCleanupTask(() => {}, 'successful cleanup');

        const results = await environment.cleanupAfterTest();

        expect(results.map(({ success, description, error }) => ({ success, description, error }))).toEqual([
            { success: false, description: 'failing cleanup', error: 'synthetic cleanup failure' },
            { success: true, description: 'successful cleanup', error: undefined }
        ]);
        expect(environment.stateManager.cleanupQueue).toEqual([]);
        expect(environment.dataStore.has('synthetic-entry')).toBe(isolationLevel !== 'test');
        expect(environment.stateManager.getSnapshot('synthetic-snapshot')).toEqual(isolationLevel === 'test' ? null : { ok: true });
        expect(globalThis.testEnv).toBe(published);
        environment.cleanupAfterSuite();
        expect(environment.dataStore.keys()).toEqual([]);
        expect(environment.stateManager.getSnapshot('synthetic-snapshot')).toBeNull();
        expect(globalThis.testEnv).toBeUndefined();
    });

    it('releases only the exact published global reference, not another owner or a lookalike', () => {
        const first = new TestEnvironment();
        first.initialize({ cleanupMode: 'manual' });
        const second = new TestEnvironment();
        second.initialize({ cleanupMode: 'manual' });
        const newerOwner = globalThis.testEnv;
        first.cleanupAfterSuite();
        expect(globalThis.testEnv).toBe(newerOwner);
        const lookalike = { ...newerOwner! };
        globalThis.testEnv = lookalike;
        second.cleanupAfterSuite();
        expect(globalThis.testEnv).toBe(lookalike);
        second.initialize({ cleanupMode: 'manual' });
        second.cleanupAfterSuite();
        expect(globalThis.testEnv).toBeUndefined();
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
