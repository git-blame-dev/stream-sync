import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { DisplayQueue } from '../../src/obs/display-queue';
import { PRIORITY_LEVELS } from '../../src/core/constants';
import { logger } from '../../src/core/logging';
import type { DisplayQueueItem } from '../../src/interfaces/DisplayQueue';
import { createOBSGoalsManager } from '../../src/obs/goals';
import { createOBSSourcesManager } from '../../src/obs/sources';
import { createGoalTracker } from '../../src/utils/goal-tracker';
import { createOperatorControlService, OPERATOR_CONTROL_KEYS, type OperatorControls } from '../../src/services/operator/operator-control-service';
import { noOpLogger } from '../helpers/mock-factories';
import { advanceTimersByTime, useFakeTimers, useRealTimers } from '../helpers/bun-timers';

const silentLogger: typeof logger = { ...logger, ...noOpLogger, log: () => {}, console: () => {}, emergency: () => {} };

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

it('retains a presentation slot until its awaitable accounting settles', async () => {
    const started = deferred();
    const accounting = deferred();
    const queue = new DisplayQueue({ call: async () => ({}) }, {
        autoProcess: false, maxQueueSize: 1, rowIntervalMs: 0,
        ttsNotificationsEnabled: false, obs: {}
    }, { PRIORITY_LEVELS }, { emit: () => {} }, {
        sourcesManager: { updateTextSource: async () => {}, clearTextSource: async () => {} },
        onPresentationStarted: async () => { started.resolve(); await accounting.promise; }
    });
    queue.addItem({ type: 'platform:follow', platform: 'twitch', data: { username: 'synthetic-viewer' } });
    const running = queue.processQueue();
    await started.promise;
    expect(queue.getQueueLength()).toBe(1);
    expect(() => queue.addItem({ type: 'chat', platform: 'twitch', data: { message: 'synthetic' } })).toThrow('capacity');
    accounting.resolve();
    await running;
    await queue.stop();
    expect(queue.getQueueLength()).toBe(0);
});

type Dependencies = NonNullable<ConstructorParameters<typeof DisplayQueue>[4]>;
type QueueConfig = NonNullable<ConstructorParameters<typeof DisplayQueue>[1]>;
type ObsCall = (request: string, payload: Record<string, unknown>) => Promise<unknown>;

function notification(name: string, type = 'platform:follow'): DisplayQueueItem {
    return { type, platform: 'twitch', data: { username: name, ttsMessage: name, amount: 7, currency: 'bits' } };
}

function harness(options: {
    config?: QueueConfig;
    dependencies?: Dependencies;
    call?: ObsCall;
    emit?: (event: string, payload: Record<string, unknown>) => void;
    goalsEnabled?: boolean;
} = {}) {
    const rows: string[] = [];
    const lifecycle: string[] = [];
    const obsCalls: string[] = [];
    const bus = new EventEmitter();
    bus.on('display:row', (row: { data: { username: string } }) => rows.push(row.data.username));
    bus.on('display:notification-lifecycle', (event: { phase: string }) => lifecycle.push(event.phase));
    const obs = {
        ensureConnected: async () => {}, isConnected: () => true, isReady: async () => true,
        call: async (request: string, payload: Record<string, unknown> = {}) => {
            obsCalls.push(request);
            return options.call ? options.call(request, payload) : { inputSettings: {} };
        }
    };
    const sources = createOBSSourcesManager(obs, { logger: noOpLogger });
    const config = { goals: { enabled: options.goalsEnabled !== false, twitchGoalEnabled: true,
        twitchGoalTarget: 100, twitchGoalCurrency: 'bits', twitchGoalSource: 'synthetic-native-goal' } };
    const tracker = createGoalTracker({ logger: silentLogger, config });
    tracker.initializeGoalTracker();
    const goals = createOBSGoalsManager(obs, { logger: silentLogger, config, goalTracker: tracker,
        updateTextSource: sources.updateTextSource });
    const eventBus = {
        emit: (event: string, payload: Record<string, unknown>) => { options.emit?.(event, payload); bus.emit(event, payload); },
        subscribe: (event: string, handler: (payload: Record<string, unknown>) => void) => {
            bus.on(event, handler);
            return () => { bus.off(event, handler); };
        }
    };
    const queue = new DisplayQueue(obs, {
        autoProcess: false, rowIntervalMs: 0, maxQueueSize: 8,
        ttsNotificationsEnabled: false, obs: {}, ...options.config
    }, { PRIORITY_LEVELS }, eventBus,
    { sourcesManager: sources, goalsManager: goals, delay: async () => {}, ...options.dependencies });
    return { queue, tracker, rows, lifecycle, obsCalls };
}

async function operatorControls() {
    return createOperatorControlService({
        defaults: Object.fromEntries(OPERATOR_CONTROL_KEYS.map((key) => [key, true])) as OperatorControls,
        filePath: '/synthetic/operator-controls.json',
        fs: {
            readFile: async () => '{}', mkdir: async () => {}, writeFile: async () => {},
            rename: async () => {}, unlink: async () => {}
        }
    });
}

describe('bounded presentation lifetime with real queue, effects, sources, goals and tracker', () => {
    it('wakes idle shared effects on admission without draining or accelerating a continuously paced chat pump', async () => {
        const ticks = Array.from({ length: 3 }, () => ({ entered: deferred(), release: deferred() }));
        const intervals: number[] = [];
        const qualified: string[] = [];
        const flush = async () => { for (let index = 0; index < 16; index++) await Promise.resolve(); };
        const { queue, rows } = harness({
            config: { rowIntervalMs: 1000, ttsChatEnabled: false, ttsNotificationsEnabled: false },
            dependencies: {
                delay: (ms) => {
                    const tick = ticks[intervals.length];
                    if (!tick) throw new Error('synthetic unexpected pacing interval');
                    intervals.push(ms);
                    tick.entered.resolve();
                    return tick.release.promise;
                },
                onPresentationStarted: (item) => { qualified.push(String(item.data.username)); }
            }
        });
        const chat = (name: string): DisplayQueueItem => ({ type: 'chat', platform: 'twitch', priority: 1,
            data: { username: name, message: 'synthetic message' } });
        queue.addItem(chat('synthetic-chat-one'));
        const running = queue.processQueue();
        try {
            await ticks[0]!.entered.promise;
            await flush();
            expect(queue.getQueueLength()).toBe(0);
            queue.addItem({ ...notification('synthetic-follow'), priority: 5 });
            queue.addItem(chat('synthetic-chat-two'));
            await flush();
            expect(rows).toEqual(['synthetic-chat-one', 'synthetic-follow']);
            expect(intervals).toEqual([1000]);

            ticks[0]!.release.resolve();
            await ticks[1]!.entered.promise;
            await flush();
            expect(queue.getQueueLength()).toBe(0);
            queue.addItem({ ...notification('synthetic-farewell', 'farewell'), priority: 5 });
            queue.addItem(chat('synthetic-chat-three'));
            await flush();
            expect(rows).toEqual(['synthetic-chat-one', 'synthetic-follow', 'synthetic-chat-two', 'synthetic-farewell']);
            expect(intervals).toEqual([1000, 1000]);

            ticks[1]!.release.resolve();
            await ticks[2]!.entered.promise;
            await flush();
            expect(rows).toEqual(['synthetic-chat-one', 'synthetic-follow', 'synthetic-chat-two', 'synthetic-farewell', 'synthetic-chat-three']);
            expect(qualified).toEqual(['synthetic-follow', 'synthetic-farewell']);
            expect(intervals).toEqual([1000, 1000, 1000]);
            expect(queue.getQueueLength()).toBe(0);
        } finally {
            await queue.stop();
            await running;
        }
    });

    it('preserves row-pacing failure propagation while the effects runner awaits work', async () => {
        const entered = deferred();
        let failPacing!: (error: Error) => void;
        const failure = new Error('synthetic pacing failure');
        const { queue } = harness({ dependencies: {
            delay: () => {
                entered.resolve();
                return new Promise<void>((_resolve, reject) => { failPacing = reject; });
            }
        } });
        queue.addItem({ type: 'chat', platform: 'twitch', data: { username: 'synthetic-viewer', message: 'synthetic message' } });
        const outcome = queue.processQueue().then(() => null, (error: unknown) => error);
        await entered.promise;
        failPacing(failure);
        expect(await outcome).toBe(failure);
        await queue.stop();
    });

    it('drains already-qualified native goal projection without passing it an effect cancellation signal', async () => {
        const entered = deferred();
        const release = deferred();
        const projections: string[] = [];
        const { queue, tracker } = harness({ call: async (request, payload) => {
            if (request === 'GetInputSettings') { entered.resolve(); await release.promise; }
            if (request === 'SetInputSettings') projections.push(String(payload.inputName));
            return { inputSettings: { font: 'synthetic-font' } };
        } });
        const paid = notification('synthetic-qualified', 'platform:gift');
        queue.addItem(paid);
        const running = queue.processQueue();
        await entered.promise;
        const stopping = queue.stop();
        expect(queue.getQueueLength()).toBe(1);
        expect(projections).toEqual([]);
        release.resolve();
        await Promise.all([running, stopping]);
        expect(projections).toEqual(['synthetic-native-goal']);
        expect(tracker.getGoalState('twitch')?.current).toBe(7);
        expect(paid.data.goalOutcome).toBe('applied');
    });

    for (const blockedStep of [1, 2]) {
        it(`fences the neural speech ${blockedStep === 1 ? 'health' : 'speak'} continuation after stop`, async () => {
            const entered = deferred();
            const release = deferred();
            let requests = 0;
            let stopping = false;
            const lateRequests: string[] = [];
            const { queue } = harness({
                config: { ttsChatEnabled: true },
                dependencies: {
                    fetch: async (url) => {
                        if (stopping) lateRequests.push(String(url));
                        if (++requests === blockedStep) { entered.resolve(); await release.promise; }
                        return new Response(null, { status: 200 });
                    }
                }
            });
            queue.addItem({ type: 'chat', platform: 'twitch', data: { username: 'synthetic-viewer', message: 'synthetic text' } });
            const running = queue.processQueue();
            await entered.promise;
            stopping = true;
            const stopped = queue.stop();
            release.resolve();
            await Promise.all([running, stopped]);
            expect(lateRequests).toEqual([]);
            expect(requests).toBe(blockedStep);
        });
    }

    it('stop joins an already-issued neural speak request and suppresses subsequent TTS stages', async () => {
        const entered = deferred();
        const release = deferred();
        const calls: string[] = [];
        const { queue } = harness({
            config: { ttsChatEnabled: true },
            dependencies: {
                fetch: async (url, init) => {
                    calls.push(`${init?.method || 'GET'}:${new URL(String(url)).pathname}`);
                    if (String(url).endsWith('/v1/speak')) { entered.resolve(); await release.promise; }
                    return new Response(null, { status: 200 });
                }
            }
        });
        queue.addItem({ type: 'chat', platform: 'twitch', data: { username: 'synthetic-viewer', message: 'synthetic text' } });
        const running = queue.processQueue();
        await entered.promise;
        let retired = false;
        const stopping = queue.stop();
        void stopping.then(() => { retired = true; });
        expect(retired).toBe(false);
        release.resolve();
        await Promise.all([running, stopping]);
        expect(calls).toEqual(['GET:/health', 'POST:/v1/speak']);
    });

    it('passes the effect timeout signal through the neural speech operation, not only the stop signal', async () => {
        useFakeTimers();
        const entered = deferred();
        const response = deferred();
        const calls: string[] = [];
        const { queue } = harness({
            config: { gui: { enableNotifications: true }, ttsNotificationsEnabled: true, effectFallbackMs: 25 },
            dependencies: {
                notificationDelay: async () => {},
                fetch: async (url, init) => {
                    calls.push(`${init?.method || 'GET'}:${new URL(String(url)).pathname}`);
                    entered.resolve();
                    await response.promise;
                    return new Response(null, { status: 200 });
                }
            }
        });
        try {
            queue.addItem(notification('synthetic-timeout'));
            const running = queue.processQueue();
            await entered.promise;
            advanceTimersByTime(25);
            expect(queue.getQueueLength()).toBe(1);
            response.resolve();
            await running;
            expect(calls).toEqual(['GET:/health']);
        } finally {
            response.resolve();
            await queue.stop();
            useRealTimers();
        }
    });

    it('starts a real neural-speaking successor with fresh cancellation state after fallback retirement', async () => {
        useFakeTimers();
        const entered = deferred();
        const response = deferred();
        const order: string[] = [];
        const qualified: string[] = [];
        let healthReads = 0;
        const { queue, tracker, rows, lifecycle } = harness({
            config: { gui: { enableNotifications: true }, ttsNotificationsEnabled: true, effectFallbackMs: 25 },
            dependencies: {
                notificationDelay: async () => {},
                onPresentationStarted: (item) => { qualified.push(String(item.data.username)); },
                fetch: async (url, init) => {
                    const pathname = new URL(String(url)).pathname;
                    if (pathname === '/health') {
                        order.push('health');
                        if (++healthReads === 1) { entered.resolve(); await response.promise; }
                    }
                    if (pathname === '/v1/speak' && init?.method === 'POST') {
                        order.push(`speak:${(JSON.parse(String(init.body)) as { text: string }).text}`);
                    }
                    return new Response(null, { status: 200 });
                }
            },
            emit: (event, payload) => {
                if (event === 'display:row') order.push(`row:${(payload.data as { username: string }).username}`);
            }
        });
        const first = notification('synthetic-timeout', 'platform:gift');
        const successor = notification('synthetic-successor', 'platform:gift');
        try {
            queue.addSequence([first, successor]);
            const running = queue.processQueue();
            await entered.promise;
            advanceTimersByTime(25);
            expect(queue.getQueueLength()).toBe(2);
            expect(order).toEqual(['row:synthetic-timeout', 'health']);
            expect(tracker.getGoalState('twitch')?.current).toBe(7);
            response.resolve();
            await running;
            expect(order).toEqual([
                'row:synthetic-timeout', 'health',
                'row:synthetic-successor', 'health', 'speak:synthetic-successor'
            ]);
            expect(rows).toEqual(['synthetic-timeout', 'synthetic-successor']);
            expect(lifecycle).toEqual(['started', 'exit-started', 'started', 'exit-started']);
            expect(qualified).toEqual(['synthetic-timeout', 'synthetic-successor']);
            expect([first.data.goalOutcome, successor.data.goalOutcome]).toEqual(['applied', 'applied']);
            expect(tracker.getGoalState('twitch')?.current).toBe(14);
            expect(queue.getQueueLength()).toBe(0);
            await queue.processQueue();
            expect(tracker.getGoalState('twitch')?.current).toBe(14);
            expect(qualified).toHaveLength(2);
        } finally {
            response.resolve();
            await queue.stop();
            useRealTimers();
        }
    });

    it('cancels an admitted reserved gift after a control change without accounting it', async () => {
        const controls = await operatorControls();
        const entered = deferred();
        const release = deferred();
        const callbacks: string[] = [];
        const { queue, tracker, rows } = harness({ dependencies: {
            operatorControls: controls,
            onPresentationStarted: async (item) => {
                callbacks.push(String(item.data.username)); entered.resolve(); await release.promise;
            }
        } });
        queue.addSequence([notification('synthetic-active'), notification('synthetic-muted-reservation', 'platform:gift')]);
        const running = queue.processQueue();
        await entered.promise;
        await controls.setEnabled('giftsEnabled', false);
        expect(queue.getQueueLength()).toBe(1);
        release.resolve();
        await running;
        expect(callbacks).toEqual(['synthetic-active']);
        expect(rows).toEqual(['synthetic-active']);
        expect(tracker.getGoalState('twitch')?.current).toBe(0);
        await queue.stop();
    });

    it('wakes row pacing and joins idle runners on repeated stop', async () => {
        const paced = deferred();
        const { queue, rows } = harness({
            config: { rowIntervalMs: 1000 },
            dependencies: { delay: () => { paced.resolve(); return new Promise<void>(() => {}); } }
        });
        queue.addItem({ type: 'chat', platform: 'twitch', data: { username: 'synthetic-first', message: 'synthetic first' } });
        queue.addItem({ type: 'chat', platform: 'twitch', data: { username: 'synthetic-unseen', message: 'synthetic unseen' } });
        const running = queue.processQueue();
        await paced.promise;
        const stopping = queue.stop();
        expect(queue.stop()).toBe(stopping);
        await Promise.all([running, stopping]);
        expect(rows).toEqual(['synthetic-first']);
        expect(queue.getQueueLength()).toBe(0);
        await queue.processQueue();
    });

    it('joins started accounting during stop and never starts accounting for its cancelled successor', async () => {
        const entered = deferred();
        const release = deferred();
        const credited: string[] = [];
        const { queue } = harness({ dependencies: { onPresentationStarted: async (item) => {
            entered.resolve(); await release.promise; credited.push(String(item.data.username));
        } } });
        queue.addSequence([notification('synthetic-qualified'), notification('synthetic-unseen')]);
        const running = queue.processQueue();
        await entered.promise;
        const stopping = queue.stop();
        expect(credited).toEqual([]);
        expect(queue.getQueueLength()).toBe(1);
        release.resolve();
        await Promise.all([running, stopping]);
        expect(credited).toEqual(['synthetic-qualified']);
    });

    it('does not credit a presentation whose row dispatch failed', async () => {
        const callbacks: string[] = [];
        const { queue, tracker } = harness({
            emit: (event) => { if (event === 'display:row') throw new Error('synthetic row dispatch failure'); },
            dependencies: { onPresentationStarted: (item) => { callbacks.push(item.type); } }
        });
        queue.addItem(notification('synthetic-unseen', 'platform:gift'));
        await queue.processQueue();
        expect(tracker.getGoalState('twitch')?.current).toBe(0);
        expect(callbacks).toEqual([]);
        expect(queue.getQueueLength()).toBe(0);
        await queue.stop();
    });
    it('keeps chat row pacing independent while speech and qualified accounting are both blocked', async () => {
        const speechStarted = deferred();
        const speech = deferred();
        const accountingStarted = deferred();
        const accounting = deferred();
        const chatShown = deferred();
        const { queue, rows } = harness({
            config: { maxQueueSize: 3, ttsNotificationsEnabled: true, obs: {} },
            emit: (event, payload) => { if (event === 'display:row' && (payload.data as { username: string }).username === 'synthetic-chat') chatShown.resolve(); },
            dependencies: {
                fetch: async (_url, init) => {
                    if (init?.method === 'POST') { speechStarted.resolve(); await speech.promise; }
                    return new Response(null, { status: 200 });
                },
                onPresentationStarted: async () => { accountingStarted.resolve(); await accounting.promise; }
            }
        });
        queue.addItem(notification('synthetic-active'));
        const running = queue.processQueue();
        await Promise.all([speechStarted.promise, accountingStarted.promise]);
        queue.addItem({ type: 'chat', platform: 'twitch', data: { username: 'synthetic-chat', message: 'synthetic message' } });
        queue.addItem(notification('synthetic-pending'));
        await chatShown.promise;
        expect(rows).toEqual(['synthetic-active', 'synthetic-chat']);
        expect(queue.getQueueLength()).toBe(3);
        expect(() => queue.addItem(notification('synthetic-rejected'))).toThrow('capacity');
        speech.resolve();
        expect(queue.getQueueLength()).toBe(3);
        accounting.resolve();
        await running;
        expect(rows).toEqual(['synthetic-active', 'synthetic-chat', 'synthetic-pending']);
        await queue.stop();
    });

    for (const coordinated of [false, true]) {
        it(`credits native goals once only at presentation start (coordination ${coordinated})`, async () => {
            const { queue, tracker } = harness({ config: { gui: { enableNotifications: coordinated } },
                dependencies: { notificationDelay: async () => {} } });
            const paid = notification('synthetic-paid', 'platform:gift');
            queue.addItem(paid);
            expect(tracker.getGoalState('twitch')?.current).toBe(0);
            await queue.processQueue();
            expect(tracker.getGoalState('twitch')?.current).toBe(7);
            expect(paid.data.goalOutcome).toBe('applied');
            expect(paid.data.goalProcessed).toBe(true);
            await queue.processQueue();
            expect(tracker.getGoalState('twitch')?.current).toBe(7);
            await queue.stop();
        });
    }

    it('does not credit muted, removed, invalid, error or cleared unseen notifications', async () => {
        const controls = await operatorControls();
        const { queue, tracker } = harness({ dependencies: { operatorControls: controls } });
        await controls.setEnabled('giftsEnabled', false);
        queue.addItem(notification('synthetic-muted', 'platform:gift'));
        await controls.setEnabled('giftsEnabled', true);
        queue.addItem(notification('synthetic-removed', 'platform:gift'));
        await controls.setEnabled('giftsEnabled', false);
        await controls.setEnabled('giftsEnabled', true);
        queue.addItem(notification('synthetic-cleared', 'platform:gift'));
        queue.clearQueue();
        queue.addItem({ ...notification('synthetic-error', 'platform:gift'), data: { amount: 7, currency: 'bits', isError: true } });
        queue.addItem({ ...notification('synthetic-invalid', 'platform:gift'), data: { amount: 7 } });
        await queue.processQueue();
        expect(tracker.getGoalState('twitch')?.current).toBe(0);
        expect(queue.getQueueLength()).toBe(0);
        await queue.stop();
    });

    it('does not call rejected native results applied or replay successful mutations after publication failure', async () => {
        const disabled = harness({ goalsEnabled: false });
        const notApplied = notification('synthetic-disabled-goal', 'platform:gift');
        disabled.queue.addItem(notApplied);
        await disabled.queue.processQueue();
        expect(notApplied.data.goalProcessed).not.toBe(true);
        expect(notApplied.data.goalOutcome).toBe('not-applied');
        await disabled.queue.stop();

        const { queue, tracker } = harness({ call: async (request) => {
            if (request === 'SetInputSettings') throw new Error('synthetic goal publication failure');
            return { inputSettings: {} };
        } });
        const paid = notification('synthetic-successful-mutation', 'platform:gift');
        queue.addItem(paid);
        await queue.processQueue();
        expect(tracker.getGoalState('twitch')?.current).toBe(7);
        expect(paid.data.goalOutcome).toBe('applied');
        queue.addItem(paid);
        await queue.processQueue();
        expect(tracker.getGoalState('twitch')?.current).toBe(7);
        await queue.stop();
    });

    it('stops admission synchronously, joins an uncooperative health request, and fences the later speak dispatch', async () => {
        const requested = deferred();
        const response = deferred();
        const requests: string[] = [];
        let signal: AbortSignal | null | undefined;
        const { queue, rows } = harness({
            config: { ttsNotificationsEnabled: true, obs: {} },
            dependencies: { fetch: async (url, init) => {
                requests.push(String(url)); signal = init?.signal; requested.resolve();
                await response.promise;
                return new Response(null, { status: 200 });
            } }
        });
        queue.addSequence([notification('synthetic-active'), notification('synthetic-unseen')]);
        const running = queue.processQueue();
        await requested.promise;
        let stopped = false;
        const stopping = queue.stop();
        void stopping.then(() => { stopped = true; });
        expect(queue.stop()).toBe(stopping);
        expect(signal?.aborted).toBe(true);
        expect(stopped).toBe(false);
        expect(queue.getQueueLength()).toBe(1);
        expect(() => queue.addItem(notification('synthetic-after-stop'))).toThrow('stopped');
        response.resolve();
        await Promise.all([running, stopping]);
        expect(requests).toHaveLength(1);
        expect(rows).toEqual(['synthetic-active']);
        expect(queue.getQueueLength()).toBe(0);
    });

    it('holds the shared lane after a gift sibling fails until every started sibling retires', async () => {
        const requested = deferred();
        const response = deferred();
        const { queue, rows } = harness({
            config: { gifts: { giftVideoSource: 'synthetic-video', giftAudioSource: 'synthetic-audio' } },
            call: async (request, payload) => {
                if (request === 'TriggerMediaInputAction' && payload.inputName === 'synthetic-video') throw new Error('synthetic video failure');
                if (request === 'TriggerMediaInputAction') { requested.resolve(); await response.promise; }
                return { inputSettings: {} };
            }
        });
        queue.addSequence([notification('synthetic-gift', 'platform:gift'), notification('synthetic-next')]);
        const running = queue.processQueue();
        await requested.promise;
        expect(rows).toEqual(['synthetic-gift']);
        expect(queue.getQueueLength()).toBe(2);
        response.resolve();
        await running;
        expect(rows).toEqual(['synthetic-gift', 'synthetic-next']);
        await queue.stop();
    });

    it('fallback aborts but does not replace an unfinished external call, and late resolution cannot dispatch speech', async () => {
        useFakeTimers();
        const requested = deferred();
        const response = deferred();
        let signal: AbortSignal | null | undefined;
        const requests: string[] = [];
        const { queue, rows } = harness({
            config: { gui: { enableNotifications: true }, effectFallbackMs: 25,
                ttsNotificationsEnabled: true, obs: {} },
            dependencies: {
                notificationDelay: async () => {},
                fetch: async (url, init) => {
                    requests.push(String(url)); signal = init?.signal; requested.resolve();
                    await response.promise;
                    return new Response(null, { status: 200 });
                }
            }
        });
        try {
            queue.addSequence([notification('synthetic-timeout'), notification('synthetic-cancelled')]);
            const running = queue.processQueue();
            await requested.promise;
            advanceTimersByTime(25);
            expect(signal?.aborted).toBe(true);
            expect(rows).toEqual(['synthetic-timeout']);
            expect(queue.getQueueLength()).toBe(2);
            const stopping = queue.stop();
            response.resolve();
            await Promise.all([running, stopping]);
            expect(requests).toHaveLength(1);
            expect(rows).toEqual(['synthetic-timeout']);
        } finally {
            response.resolve();
            await queue.stop();
            useRealTimers();
        }
    });
});
