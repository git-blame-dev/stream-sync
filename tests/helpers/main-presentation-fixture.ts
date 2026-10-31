import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/main';
import { AppRuntime } from '../../src/runtime/AppRuntime';
import { EventBus, createEventBus } from '../../src/core/EventBus';
import { OBSConnectionManager } from '../../src/obs/connection';
import { createGracefulExitService } from '../../src/services/GracefulExitService';
import { acquireSingleInstanceGuard } from '../../src/services/SingleInstanceGuard';
import { createOperatorControlService } from '../../src/services/operator/operator-control-service';
import { createOperatorAppearanceService } from '../../src/services/operator/operator-appearance-service';
import { createFundingGoalService } from '../../src/services/funding-goal-service';
import type { createOBSGoalsManager } from '../../src/obs/goals';
import { createUsdRateService } from '../../src/services/usd-rate-service';
import { createConfigFixture } from './config-fixture';
import { withTimeout } from '../../src/utils/timeout-wrapper';
import type { DisplayQueue } from '../../src/obs/display-queue';
import type { DisplayQueueItem } from '../../src/interfaces/DisplayQueue';

// Only the remote OBS SDK and rate-provider response are simulated. Main
// constructs and wires the runtime, queue, policy and accounting owners.
class SyntheticObsSocket extends EventEmitter {
    readonly writes: Array<Record<string, unknown>> = [];
    async connect() { this.emit('Identified'); return { obsWebSocketVersion: 'synthetic' }; }
    async disconnect() { this.emit('ConnectionClosed'); }
    async call(method: string, data: Record<string, unknown> = {}) {
        if (method === 'GetVersion') return { obsVersion: 'synthetic' };
        if (method === 'GetInputSettings') return { inputSettings: { font: { face: 'Synthetic font' }, color: 123 } };
        if (method === 'SetInputSettings') { this.writes.push(data); return {}; }
        throw new Error(`Unexpected synthetic OBS request: ${method}`);
    }
}

export async function createMainPresentationFixture(options: { operator?: boolean; chatLimit?: number | null; WebSocketCtor?: unknown } = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'synthetic-main-presentation-'));
    const config = createConfigFixture({
        general: { envFileReadEnabled: false, envFileWriteEnabled: false, viewerCountPollingIntervalMs: 0, filterOldMessages: false },
        obs: { enabled: false, ttsChatEnabled: false, ttsNotificationsEnabled: false },
        twitch: { enabled: false }, youtube: { enabled: false }, tiktok: { enabled: false },
        gui: { enableDock: false, enableOverlay: false, enableOperator: options.operator === true, enableNotifications: false, port: 0,
            notificationIdleHoldMs: 0, monetizationIdleHoldMs: 0, notificationTransitionMs: 0 },
        displayQueue: { autoProcess: false, rowIntervalMs: 0 },
        goals: { enabled: true, twitchGoalEnabled: true, twitchGoalSource: 'synthetic-native-goal', twitchGoalCurrency: 'bits', twitchGoalTarget: 10000 },
        fundingGoal: { enabled: true, id: 'synthetic-funding', label: 'Synthetic funding', targetUsd: 100 },
        gifts: { command: '' }, spam: { enabled: false },
    });
    const socket = new SyntheticObsSocket();
    const obs = new OBSConnectionManager({ obs: socket, config: { enabled: true, address: 'ws://synthetic.invalid', password: 'synthetic-password' } });
    let runtime: AppRuntime | undefined;
    let bus: EventBus | undefined;
    let guard: Awaited<ReturnType<typeof acquireSingleInstanceGuard>> | undefined;
    let funding: Awaited<ReturnType<typeof createFundingGoalService>> | undefined;
    const rows: DisplayQueueItem[] = [];
    let unsubscribe: (() => void) | undefined;
    const fundingPath = join(dir, 'funding.json');
    const start = async () => {
        await obs.connect();
        return main({ config, WebSocketCtor: options.WebSocketCtor, onShutdownComplete: () => {}, cliArgs: { chat: options.chatLimit === undefined ? 1000 : options.chatLimit },
            getOBSConnectionManager: () => obs,
            createEventBus: options => {
                bus = createEventBus(options);
                unsubscribe = bus.subscribe('display:row', value => { rows.push(value as DisplayQueueItem); });
                return bus;
            },
            createSingleInstanceGuard: async () => {
                guard = await acquireSingleInstanceGuard({ port: 0 });
                return guard;
            },
            createOperatorControlService: options => createOperatorControlService({ ...options, filePath: join(dir, 'controls.json') }),
            createOperatorAppearanceService: options => createOperatorAppearanceService({ ...options, filePath: join(dir, 'appearance.json') }),
            createFundingGoalService: async options => {
                funding = await createFundingGoalService({ ...options, filePath: fundingPath });
                return funding;
            },
            createUsdRateService: options => createUsdRateService({ ...options, cachePath: join(dir, 'rates.json'),
                fetch: async () => ({ ok: true, status: 200, json: async () => [{ base: 'USD', quote: 'EUR', rate: 0.9 }] }) }),
            createGracefulExitService: (app, count, options) => {
                runtime = app as AppRuntime;
                return createGracefulExitService(app, count, options);
            },
        });
    };
    return {
        config, socket, obs, rows, dir, fundingPath, start,
        get instancePort() { if (!guard) throw new Error('Synthetic main did not acquire instance ownership'); return guard.port; },
        get runtime() { if (!runtime) throw new Error('Synthetic main did not acquire runtime'); return runtime; },
        get bus() { if (!bus) throw new Error('Synthetic main did not acquire bus'); return bus; },
        get queue() { if (!runtime) throw new Error('Synthetic main did not acquire queue'); return runtime.displayQueue as DisplayQueue; },
        get funding() { if (!funding) throw new Error('Synthetic main did not acquire funding'); return funding; },
        nativeGoal() {
            if (!runtime) throw new Error('Synthetic main did not acquire goals');
            return (runtime.dependencies.obs?.goalsManager as ReturnType<typeof createOBSGoalsManager>).getCurrentGoalStatus('twitch');
        },
        async persistedFunding() { return JSON.parse(await readFile(fundingPath, 'utf8')) as Record<string, unknown>; },
        async drain() { if (!runtime) throw new Error('Synthetic main did not acquire runtime'); await withTimeout((runtime.displayQueue as DisplayQueue).processQueue(), 2000); },
        async dispose() {
            let shutdownError: unknown;
            try { if (runtime) await withTimeout(runtime.shutdown(), 3000); }
            catch (error) { shutdownError = error; }
            unsubscribe?.();
            obs.dispose();
            const listenerLeak = bus?.eventNames().some(event => bus!.listenerCount(event) > 0);
            const results = await Promise.allSettled([
                funding?.dispose(), obs.disconnect(), guard?.release(),
            ]);
            await rm(dir, { recursive: true, force: true });
            const failed = results.find(result => result.status === 'rejected');
            if (listenerLeak) throw new Error('Synthetic root owners leaked an event subscription');
            if (socket.eventNames().some(event => socket.listenerCount(event) > 0)) throw new Error('Synthetic root OBS owner leaked a transport listener');
            if (shutdownError) throw shutdownError;
            if (failed?.status === 'rejected') throw failed.reason;

        },
    };
}
