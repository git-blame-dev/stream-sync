import { expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { DisplayQueue } from '../../src/obs/display-queue';
import { createOBSGoalsManager } from '../../src/obs/goals';
import { GoalTracker } from '../../src/utils/goal-tracker';
import { createFundingGoalService } from '../../src/services/funding-goal-service';
import { createNotificationContribution } from '../../src/notifications/notification-contribution';
import { PRIORITY_LEVELS } from '../../src/core/constants';
import { noOpLogger } from '../helpers/mock-factories';
import type { DisplayQueueItem } from '../../src/interfaces/DisplayQueue';

const logger = {
    ...noOpLogger, config: {},
    outputs: { console: { write: () => {} }, file: { write: () => {}, config: {}, fileAppender: null } },
    reconfigure: () => {}, log: () => {}, shouldOutput: () => false,
    console: () => {}, emergency: () => {}
};

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

async function harness(blockWrites = false, failWrites = false, nativeGoalsEnabled = true) {
    const eventBus = new EventEmitter();
    const entered = deferred();
    const writes = deferred();
    if (!blockWrites) writes.resolve();
    const persisted = new Map<string, string>();
    const values = { tiktokGiftUnitUsd: 0.005, twitchBitUsd: 0.01, youtubeJewelUsd: 0.01,
        tiktokMembershipUsd: 2.1, twitchMembershipUsd: 3.5, youtubeMembershipUsd: 3.89 };
    const funding = await createFundingGoalService({
        config: { enabled: true, id: 'test-presentation', label: 'Test goal', targetUsd: 100 },
        monetizationValuesConfig: values, filePath: '/test-only/presented-funding.json',
        fs: {
            readFile: async path => {
                const value = persisted.get(path);
                if (value === undefined) throw Object.assign(new Error('test missing'), { code: 'ENOENT' });
                return value;
            },
            mkdir: async () => {},
            writeFile: async (path, data) => {
                entered.resolve();
                await writes.promise;
                if (failWrites) throw new Error('test persistence failure');
                persisted.set(path, data);
            },
            rename: async (from, to) => { persisted.set(to, persisted.get(from)!); persisted.delete(from); },
            unlink: async path => { persisted.delete(path); }
        }
    });
    const goalsConfig = { enabled: nativeGoalsEnabled, twitchGoalEnabled: true, twitchGoalSource: 'test-goal',
        twitchGoalTarget: 1000, twitchGoalCurrency: 'bits' };
    const tracker = new GoalTracker({ logger, config: { goals: goalsConfig, monetizationValues: values } });
    const goals = createOBSGoalsManager({ isConnected: () => true }, {
        config: { goals: goalsConfig }, logger, goalTracker: tracker,
        updateTextSource: async () => {}
    });
    await goals.initializeGoalDisplay();
    const presented: DisplayQueueItem[] = [];
    const queue = new DisplayQueue({ call: async () => ({}) }, {
        autoProcess: false, maxQueueSize: 2, rowIntervalMs: 0,
        ttsNotificationsEnabled: false, obs: { ttsTxt: 'test-tts' }
    }, { PRIORITY_LEVELS }, eventBus, {
        sourcesManager: { updateTextSource: async () => {}, clearTextSource: async () => {} },
        goalsManager: goals,
        onPresentationStarted: item => {
            presented.push(item);
            return funding.processPresentedContributions(
                Array.isArray(item.data.contributions) ? item.data.contributions : []);
        }
    });
    const source = (id: string, amount = 10) => createNotificationContribution('twitch', 'platform:gift', {
        id, timestamp: '2026-01-01T00:00:00.000Z', amount, currency: 'bits', giftCount: 1
    });
    const add = (contributions = [source('test-gift')], amount = 10) => queue.addItem({
        type: 'platform:gift', platform: 'twitch', data: {
            username: 'Test Donor', amount, currency: 'bits', giftCount: 1,
            displayMessage: 'Test gift', contributions: Object.freeze(contributions)
        }
    });
    return { queue, funding, tracker, eventBus, entered, writes, source, add, persisted, presented };
}

it('does not credit raw bus traffic, admission, or unseen work retired on stop; manual controls remain separate', async () => {
    const h = await harness();
    try {
        h.eventBus.emit('platform:event', h.source('test-muted'));
        h.add();
        expect(h.funding.snapshot.currentUsd).toBe(0);
        expect(h.tracker.getGoalState('twitch')?.current).toBe(0);
        await h.queue.stop();
        expect(h.funding.snapshot.currentUsd).toBe(0);
        expect(h.tracker.getGoalState('twitch')?.current).toBe(0);
        await h.funding.adjust(2);
        expect(h.funding.snapshot.currentUsd).toBe(2);
        expect(h.tracker.getGoalState('twitch')?.current).toBe(0);
    } finally { await h.queue.stop(); await h.funding.dispose(); }
});

it('credits native and USD only on presentation and deduplicates individual plus partial residual with v1 identities', async () => {
    const h = await harness();
    try {
        h.add([h.source('test-first')]);
        await h.queue.processQueue();
        expect(h.tracker.getGoalState('twitch')?.current).toBe(10);
        expect(h.funding.snapshot.currentUsd).toBe(0.1);
        h.add([h.source('test-first'), h.source('test-residual', 20), h.source('test-residual', 20)], 20);
        await h.queue.processQueue();
        expect(h.tracker.getGoalState('twitch')?.current).toBe(30);
        expect(h.funding.snapshot.currentUsd).toBe(0.3);
        const state = JSON.parse(h.persisted.get('/test-only/presented-funding.json')!);
        expect(state.version).toBe(1);
        expect(state.processedEventKeys).toHaveLength(2);
    } finally { await h.queue.stop(); await h.funding.dispose(); }
});

it('holds queue capacity and stop through qualified funding persistence while retiring pending work', async () => {
    const h = await harness(true);
    try {
        h.add();
        h.add([h.source('test-unseen')]);
        const running = h.queue.processQueue();
        await h.entered.promise;
        expect(h.queue.getQueueLength()).toBe(2);
        expect(() => h.add([h.source('test-over-capacity')])).toThrow('capacity');
        let stopped = false;
        const stopping = h.queue.stop().then(() => { stopped = true; });
        await Promise.resolve();
        expect(stopped).toBe(false);
        h.writes.resolve();
        await Promise.all([running, stopping]);
        expect(h.funding.snapshot.currentUsd).toBe(0.1);
        expect(h.tracker.getGoalState('twitch')?.current).toBe(10);
        expect(h.queue.getQueueLength()).toBe(0);
    } finally { h.writes.resolve(); await h.queue.stop(); await h.funding.dispose(); }
});

it('does not replay successful native accounting when the independent funding owner fails', async () => {
    const h = await harness(false, true);
    try {
        h.add();
        await h.queue.processQueue();
        expect(h.tracker.getGoalState('twitch')?.current).toBe(10);
        expect(h.funding.snapshot.currentUsd).toBe(0);
        await h.queue.processQueue();
        expect(h.tracker.getGoalState('twitch')?.current).toBe(10);
        expect(h.funding.snapshot.revision).toBe(0);
        expect(h.queue.getQueueLength()).toBe(0);
    } finally { await h.queue.stop(); await h.funding.dispose(); }
});

it('credits funding once when the real native manager declines a disabled goal', async () => {
    const h = await harness(false, false, false);
    try {
        h.add();
        await h.queue.processQueue();
        expect(h.tracker.getGoalState('twitch')?.current).toBe(0);
        expect(h.presented[0]?.data.goalOutcome).toBe('not-applied');
        expect(h.presented[0]?.data.goalProcessed).not.toBe(true);
        expect(h.funding.snapshot.currentUsd).toBe(0.1);
        expect(h.funding.snapshot.revision).toBe(1);
        h.add();
        await h.queue.processQueue();
        expect(h.tracker.getGoalState('twitch')?.current).toBe(0);
        expect(h.funding.snapshot.currentUsd).toBe(0.1);
        expect(h.funding.snapshot.revision).toBe(1);
    } finally { await h.queue.stop(); await h.funding.dispose(); }
});
