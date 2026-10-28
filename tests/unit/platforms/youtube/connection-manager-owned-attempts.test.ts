import { describe, test, expect } from 'bun:test';
import { YouTubeConnectionManager, type YouTubeConnectionAttemptContext } from '../../../../src/platforms/youtube/youtube-connection-manager';
import { noOpLogger } from '../../../helpers/mock-factories';
import { useFakeTimers, useRealTimers, advanceTimersByTime, getTimerCount } from '../../../helpers/bun-timers';

const deferred = <T = void>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(yes => { resolve = yes; });
    return { promise, resolve };
};
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

describe('YouTube manager owned attempts', () => {
    test('pending factory cancellation closes admission before abort and joins actual finally cleanup', async () => {
        const manager = new YouTubeConnectionManager(noOpLogger);
        const finish = deferred(), cleaning = deferred();
        let context: YouTubeConnectionAttemptContext | undefined;
        let admittedAtAbort = true;
        const attempt = manager.connectToStream('synthetic-pending', async (_id, _attempt, scope) => {
            context = scope;
            try {
                await new Promise<void>((_resolve, reject) => scope.signal.addEventListener('abort', () => {
                    admittedAtAbort = manager.hasConnection('synthetic-pending');
                    reject(scope.signal.reason);
                }, { once: true }));
            } finally { cleaning.resolve(); await finish.promise; }
            return {};
        });
        const cleanup = manager.cleanupAllConnections();
        try {
            expect(context?.signal.aborted).toBe(true);
            expect(admittedAtAbort).toBe(false);
            expect(manager.cleanupAllConnections()).toBe(cleanup);
            await cleaning.promise;
            let retired = false;
            void cleanup.then(() => { retired = true; });
            await flush();
            expect(retired).toBe(false);
            expect(manager.getActiveVideoIds()).toEqual([]);
        } finally { finish.resolve(); await cleanup; await attempt; }
    });

    test('adopt publishes an unstarted resource and preserves synchronous early READY', async () => {
        const manager = new YouTubeConnectionManager(noOpLogger);
        const resource = { stop() {} };
        const result = await manager.connectToStream('synthetic-ready', async (id, attempt, scope) => {
            scope.adopt(resource);
            scope.adopt(resource);
            expect(manager.getConnection(id)).toBe(resource);
            manager.setConnectionReady(id, attempt);
            return resource;
        });
        expect(result).toBe(true);
        expect(manager.getConnectionStatus('synthetic-ready')?.state).toBe('ready');
        await manager.cleanupAllConnections();
    });

    for (const mode of ['remove', 'disconnect'] as const) test(`${mode} closes admission before held resource cleanup and permits replacement`, async () => {
        const manager = new YouTubeConnectionManager(noOpLogger);
        const finish = deferred();
        let stops = 0, admittedAtStop = true;
        await manager.connectToStream('synthetic-replace', async () => ({ stop: async () => {
            stops++; admittedAtStop = manager.hasConnection('synthetic-replace'); await finish.promise;
        } }));
        const retirement = mode === 'remove'
            ? manager.removeConnection('synthetic-replace')
            : manager.disconnectFromStream('synthetic-replace');
        try {
            expect(manager.hasConnection('synthetic-replace')).toBe(false);
            expect(admittedAtStop).toBe(false);
            const replacement = {};
            expect(await manager.connectToStream('synthetic-replace', async () => replacement)).toBe(true);
            finish.resolve(); await retirement;
            expect(manager.getConnection('synthetic-replace')).toBe(replacement);
            expect(stops).toBe(1);
        } finally { finish.resolve(); await retirement; await manager.cleanupAllConnections(); }
    });

    test('late acquisition retires exactly its resource while cleanup joins it and leaves new lifecycle intact', async () => {
        const manager = new YouTubeConnectionManager(noOpLogger);
        const release = deferred<{ stop(): void }>();
        let stops = 0;
        const attempt = manager.connectToStream('synthetic-late', () => release.promise);
        const cleanup = manager.cleanupAllConnections();
        manager.startLifecycle();
        const replacement = {};
        expect(await manager.connectToStream('synthetic-late', async () => replacement)).toBe(true);
        release.resolve({ stop: () => { stops++; } });
        await cleanup;
        expect(await attempt).toBe(false);
        expect(stops).toBe(1);
        expect(manager.getConnection('synthetic-late')).toBe(replacement);
        await manager.cleanupAllConnections();
    });

    test('different adoption rejects and retires both resources even when diagnostics throw', async () => {
        const logger = { ...noOpLogger,
            warn: () => { throw new Error('synthetic reporter'); },
            error: () => { throw new Error('synthetic error reporter'); }
        };
        const manager = new YouTubeConnectionManager(logger);
        let first = 0, second = 0;
        const result = await manager.connectToStream('synthetic-conflict', async (_id, _attempt, scope) => {
            scope.adopt({ stop: () => { first++; throw new Error('synthetic stop failure'); }, disconnect: () => { first++; } });
            scope.adopt({ stop: () => { second++; } });
            return {};
        });
        expect(result).toBe(false);
        expect(first).toBe(2);
        expect(second).toBe(1);
        expect(manager.hasConnection('synthetic-conflict')).toBe(false);
    });

    test('reentrant resource stop observes closed admission and cannot remove a fresh replacement', async () => {
        const manager = new YouTubeConnectionManager(noOpLogger);
        const replacement = {};
        let replacementAttempt: Promise<boolean> | undefined;
        let cleanupFromStop: Promise<void> | undefined;
        await manager.connectToStream('synthetic-reentrant', async (_id, _attempt, scope) => {
            const resource = { stop: () => {
                cleanupFromStop = manager.cleanupAllConnections();
                manager.startLifecycle();
                replacementAttempt = manager.connectToStream('synthetic-reentrant', async () => replacement);
            } };
            scope.adopt(resource);
            return resource;
        });
        await manager.removeConnection('synthetic-reentrant');
        await cleanupFromStop;
        expect(await replacementAttempt).toBe(true);
        expect(manager.getConnection('synthetic-reentrant')).toBe(replacement);
        await manager.cleanupAllConnections();
    });

    test('never-settling acquisition retirement has one five-second bound and observes a late resource', async () => {
        useFakeTimers();
        const errors: string[] = [];
        const manager = new YouTubeConnectionManager({ ...noOpLogger, warn: message => { errors.push(message); } });
        const release = deferred<{ stop(): void }>();
        let stops = 0;
        const attempt = manager.connectToStream('synthetic-bound', () => release.promise);
        try {
            const cleanup = manager.cleanupAllConnections();
            let done = false;
            void cleanup.then(() => { done = true; });
            await flush();
            advanceTimersByTime(4999); await flush();
            expect(done).toBe(false);
            advanceTimersByTime(1); await cleanup;
            expect(done).toBe(true);
            expect(await attempt).toBe(false);
            expect(errors.some(message => message.includes('5000'))).toBe(true);
            release.resolve({ stop: () => { stops++; } });
            await flush();
            expect(stops).toBe(1);
            expect(getTimerCount()).toBe(0);
        } finally { release.resolve({ stop() {} }); await flush(); useRealTimers(); }
    });

    test('cleanup with no admitted entries still joins an independently removing pending attempt', async () => {
        const manager = new YouTubeConnectionManager(noOpLogger);
        const release = deferred<{ stop(): void }>();
        const attempt = manager.connectToStream('synthetic-removing', () => release.promise);
        const removal = manager.removeConnection('synthetic-removing');
        const cleanup = manager.cleanupAllConnections();
        let done = false;
        void cleanup.then(() => { done = true; });
        await flush();
        expect(done).toBe(false);
        expect(manager.cleanupAllConnections()).toBe(cleanup);
        release.resolve({ stop() {} });
        await Promise.all([removal, cleanup, attempt]);
        expect(done).toBe(true);
    });

    for (const failure of ['throw', 'different return'] as const) test(`factory ${failure} after adoption retires captured resources once`, async () => {
        const manager = new YouTubeConnectionManager(noOpLogger);
        let first = 0, second = 0;
        const result = await manager.connectToStream('synthetic-failure', async (_id, _attempt, scope) => {
            scope.adopt({ stop: () => { first++; } });
            if (failure === 'throw') throw new Error('synthetic factory error');
            return { stop: () => { second++; } };
        });
        expect(result).toBe(false);
        expect(first).toBe(1);
        expect(second).toBe(failure === 'throw' ? 0 : 1);
        expect(manager.hasConnection('synthetic-failure')).toBe(false);
    });

    test('stale explicit adoption retires its exact resource and cannot change replacement readiness', async () => {
        const manager = new YouTubeConnectionManager(noOpLogger);
        const release = deferred();
        let stops = 0, rejected = false;
        const resource = { stop: () => { stops++; } };
        const old = manager.connectToStream('synthetic-stale', async (id, attempt, scope) => {
            await release.promise;
            try { scope.adopt(resource); }
            catch { rejected = true; }
            manager.setConnectionReady(id, attempt);
            return resource;
        });
        const cleanup = manager.cleanupAllConnections();
        manager.startLifecycle();
        const replacement = {};
        await manager.connectToStream('synthetic-stale', async () => replacement);
        release.resolve(); await cleanup;
        expect(await old).toBe(false);
        expect(rejected).toBe(true);
        expect(stops).toBe(1);
        expect(manager.getConnection('synthetic-stale')).toBe(replacement);
        expect(manager.isConnectionReady('synthetic-stale')).toBe(false);
        await manager.cleanupAllConnections();
    });

    test('acquisition and held cleanup consume one concurrent budget rather than serial five-second waits', async () => {
        useFakeTimers();
        const manager = new YouTubeConnectionManager(noOpLogger);
        const release = deferred(), finish = deferred();
        const resource = { stop: () => finish.promise };
        const attempt = manager.connectToStream('synthetic-concurrent', async (_id, _attempt, scope) => {
            scope.adopt(resource);
            await release.promise;
            return resource;
        });
        try {
            const cleanup = manager.cleanupAllConnections();
            let done = false;
            void cleanup.then(() => { done = true; });
            await flush();
            advanceTimersByTime(4000); await flush();
            release.resolve(); await flush();
            expect(done).toBe(false);
            advanceTimersByTime(999); await flush();
            expect(done).toBe(false);
            advanceTimersByTime(1); await cleanup;
            expect(done).toBe(true);
            expect(await attempt).toBe(false);
            expect(getTimerCount()).toBe(0);
        } finally { release.resolve(); finish.resolve(); await flush(); useRealTimers(); }
    });

    test('normal retirement leaves no timer and throwing shutdown diagnostics cannot skip disconnect', async () => {
        useFakeTimers();
        const logger = { ...noOpLogger, error: () => { throw new Error('synthetic reporter'); } };
        const manager = new YouTubeConnectionManager(logger);
        let disconnected = 0;
        try {
            await manager.connectToStream('synthetic-normal', async () => ({
                stop: () => { throw new Error('synthetic stop'); },
                disconnect: () => { disconnected++; }
            }));
            logger.info = () => { throw new Error('synthetic info reporter'); };
            expect(await manager.disconnectFromStream('synthetic-normal')).toBe(false);
            expect(disconnected).toBe(1);
            expect(manager.getActiveVideoIds()).toEqual([]);
            await manager.cleanupAllConnections();
            expect(getTimerCount()).toBe(0);
        } finally { await manager.cleanupAllConnections(); useRealTimers(); }
    });

    test('retirement joins a late resource introduced by an asynchronous disposer', async () => {
        const manager = new YouTubeConnectionManager(noOpLogger);
        const enterLateAdoption = deferred(), finishLateCleanup = deferred();
        let lateStops = 0;
        await manager.connectToStream('synthetic-late-disposer', async (_id, _attempt, scope) => {
            const resource = { stop: async () => {
                await enterLateAdoption.promise;
                try { scope.adopt({ stop: async () => { lateStops++; await finishLateCleanup.promise; } }); }
                catch { /* Stale adoption must still retire the late resource. */ }
            } };
            scope.adopt(resource);
            return resource;
        });
        const cleanup = manager.cleanupAllConnections();
        let done = false;
        void cleanup.then(() => { done = true; });
        try {
            await flush();
            enterLateAdoption.resolve(); await flush();
            expect(lateStops).toBe(1);
            expect(done).toBe(false);
        } finally { enterLateAdoption.resolve(); finishLateCleanup.resolve(); await cleanup; }
    });

    test('reentrant removal inside the acquiring factory sees published attempt ownership', async () => {
        const manager = new YouTubeConnectionManager(noOpLogger);
        let removal: Promise<void> | undefined;
        let stops = 0;
        const result = await manager.connectToStream('synthetic-acquiring', async (id, _attempt, scope) => {
            const resource = { stop: () => { stops++; } };
            scope.adopt(resource);
            removal = manager.removeConnection(id);
            expect(scope.signal.aborted).toBe(true);
            return resource;
        });
        await removal;
        expect(result).toBe(false);
        expect(stops).toBe(1);
        expect(manager.hasConnection('synthetic-acquiring')).toBe(false);
    });
});
