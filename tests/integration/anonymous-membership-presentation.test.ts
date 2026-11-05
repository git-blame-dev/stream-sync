import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '../../src/core/EventBus';
import * as constants from '../../src/core/constants';
import { NotificationManager } from '../../src/notifications/NotificationManager';
import { DisplayQueue } from '../../src/obs/display-queue';
import { createOBSGoalsManager } from '../../src/obs/goals';
import { createOBSSourcesManager } from '../../src/obs/sources';
import { GoalTracker } from '../../src/utils/goal-tracker';
import { createFundingGoalService } from '../../src/services/funding-goal-service';
import { UserTrackingService } from '../../src/services/UserTrackingService';
import { OperatorControlService, OPERATOR_CONTROL_KEYS } from '../../src/services/operator/operator-control-service';
import { createTwitchEventSubEventRouter } from '../../src/platforms/twitch/events/event-router';
import { createTwitchEventFactory } from '../../src/platforms/twitch/events/event-factory';
import { createTestAppRuntime } from '../helpers/runtime-test-harness';
import { createConfigFixture } from '../helpers/config-fixture';
import { noOpLogger } from '../helpers/mock-factories';
import type { DisplayQueueItem } from '../../src/interfaces/DisplayQueue';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    const errors: unknown[] = [];
    for (const cleanup of cleanups.splice(0).reverse()) {
        try { await cleanup(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Synthetic membership fixture cleanup failed');
});
async function fixture() {
    const dir = await mkdtemp(join(tmpdir(), 'synthetic-membership-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const bus = new EventBus();
    const values = { tiktokGiftUnitUsd: 0.005, twitchBitUsd: 0.01, youtubeJewelUsd: 0.005,
        tiktokMembershipUsd: 2.1, twitchMembershipUsd: 3.5, youtubeMembershipUsd: 3.89 };
    const goalsConfig = { enabled: true, twitchGoalEnabled: true, twitchGoalSource: 'synthetic-goal', twitchGoalTarget: 10000, twitchGoalCurrency: 'bits' };
    const configOverrides = { general: { envFileReadEnabled: false }, goals: goalsConfig, monetizationValues: values };
    const config = createConfigFixture(configOverrides);
    const logger = { ...noOpLogger, config: {}, outputs: { console: { write: () => {} }, file: { write: () => {}, config: {}, fileAppender: null } },
        reconfigure: () => {}, log: () => {}, shouldOutput: () => false, console: () => {}, emergency: () => {} };
    const tracker = new GoalTracker({ logger, config: { goals: goalsConfig, monetizationValues: values } });
    const obs = { ensureConnected: async () => {}, isConnected: () => true, isReady: async () => true,
        call: async () => ({ inputSettings: {}, sceneItems: [], scenes: [] }) };
    const sources = createOBSSourcesManager(obs, { logger: noOpLogger });
    const goals = createOBSGoalsManager(obs, { config: { goals: goalsConfig }, logger, goalTracker: tracker, updateTextSource: sources.updateTextSource });
    await goals.initializeGoalDisplay();
    const funding = await createFundingGoalService({ config: { enabled: true, id: 'synthetic-goal', label: 'Synthetic goal', targetUsd: 1000 },
        monetizationValuesConfig: values, filePath: join(dir, 'funding.json') });
    cleanups.push(() => funding.dispose());
    const controls = await OperatorControlService.create({ filePath: join(dir, 'controls.json'),
        defaults: Object.fromEntries(OPERATOR_CONTROL_KEYS.map(key => [key, true])) as Record<typeof OPERATOR_CONTROL_KEYS[number], boolean> });
    const presented: DisplayQueueItem[] = [];
    const queue = new DisplayQueue(obs, { autoProcess: false, maxQueueSize: 30, rowIntervalMs: 0,
        ttsChatEnabled: false, ttsNotificationsEnabled: false,
        chat: { sourceName: 'synthetic-chat', sceneName: 'synthetic-scene', groupName: 'synthetic-group', platformLogos: {} },
        notification: { sourceName: 'synthetic-notification', sceneName: 'synthetic-scene', groupName: 'synthetic-group', platformLogos: {} },
        obs: {}, handcam: { enabled: false }, gifts: {}, twitch: {}, youtube: {}, tiktok: {}
    }, constants, bus, { sourcesManager: sources, goalsManager: goals, operatorControls: controls,
        delay: async () => {}, notificationDelay: async () => {}, onPresentationStarted: async item => {
            presented.push(item);
            await funding.processPresentedContributions(Array.isArray(item.data.contributions) ? item.data.contributions : []);
        } });
    cleanups.push(() => queue.stop());
    const tracking = new UserTrackingService();
    const manager = new NotificationManager({ config, logger: noOpLogger, constants, eventBus: bus, displayQueue: queue });
    const { runtime } = createTestAppRuntime(configOverrides, { eventBus: { emit: (name, data) => { bus.emit(name, data); }, subscribe: (name, handler) => bus.subscribe(name, data => handler(data as Record<string, unknown>)) }, displayQueue: queue, notificationManager: manager, userTrackingService: {
        isFirstMessage: (id, context) => tracking.isFirstMessage(typeof id === 'string' ? id : null, context),
        markStreamSupporter: (platform, id) => tracking.markStreamSupporter(platform, id),
        isStreamSupporter: (platform, id) => tracking.isStreamSupporter(platform, id)
    }, logger: noOpLogger });
    cleanups.push(() => runtime.shutdown());
    const factory = createTwitchEventFactory();
    const pending: Promise<void>[] = [];
    const raw = createTwitchEventSubEventRouter({ logger: noOpLogger, emit: (name, payload) => {
        if (name === 'paypiggyGift') pending.push(runtime.platformEventRouter.routeEvent({ platform: 'twitch', type: 'platform:giftpaypiggy', data: factory.createGiftPaypiggyEvent(payload as Record<string, unknown>) }));
    } });
    const send = async (data: Record<string, unknown> = {}) => {
        raw.handleNotificationEvent('channel.subscription.gift', { is_anonymous: true, total: 5, tier: '1000', timestamp: '2026-01-01T00:00:00.000Z', ...data }, { message_timestamp: data.timestamp ?? '2026-01-01T00:00:00.000Z' });
        await Promise.all(pending.splice(0));
    };
    return { send, runtime, queue, tracker, funding, tracking, controls, presented };
}

describe('anonymous gifted membership actual runtime and presentation accounting', () => {
    test('retains source identity, counts native once per item, funding once per retained replay key', async () => {
        const h = await fixture();
        await h.send();
        expect(h.queue.getQueueLength()).toBe(1);
        await h.queue.processQueue();
        expect(h.presented).toHaveLength(1);
        const item = h.presented[0]!;
        expect(item.data.userId).toBeUndefined();
        expect(item.data.username).toBeString();
        expect(item.data.contributions).toEqual([{ platform: 'twitch', type: 'platform:giftpaypiggy', data: {
            timestamp: '2026-01-01T00:00:00.000Z', giftCount: 5, tier: '1000', isAnonymous: true
        } }]);
        expect(h.tracker.getGoalState('twitch')?.current).toBe(1750);
        expect(h.funding.snapshot.currentUsd).toBe(17.5);
        await h.queue.handleNotificationEffects(item);
        expect(h.tracker.getGoalState('twitch')?.current).toBe(1750);
        await h.send();
        await h.queue.processQueue();
        expect(h.tracker.getGoalState('twitch')?.current).toBe(3500);
        expect(h.funding.snapshot.currentUsd).toBe(17.5);
        expect(h.tracking.isStreamSupporter('twitch', 'synthetic-anonymous')).toBe(false);
    });
    test('anonymous complete identity stays out of supporter accounts; partial identity rejects', async () => {
        const h = await fixture();
        await h.send({ user_name: 'Synthetic Viewer', user_id: 'synthetic-anonymous' });
        await h.queue.processQueue();
        expect(h.funding.snapshot.currentUsd).toBe(17.5);
        expect(h.tracking.isStreamSupporter('twitch', 'synthetic-anonymous')).toBe(false);
        await h.send({ user_name: 'Synthetic Partial' });
        expect(h.queue.getQueueLength()).toBe(0);
        await expect(h.runtime.platformEventRouter.routeEvent({ platform: 'twitch', type: 'platform:giftpaypiggy', data: {
            isAnonymous: true, username: 'Synthetic Partial', giftCount: 5, tier: '1000', timestamp: '2026-01-01T00:00:00.000Z'
        } })).rejects.toThrow();
        expect(h.funding.snapshot.currentUsd).toBe(17.5);
    });
    test('errored accepted payload can display without native or funding credit', async () => {
        const h = await fixture();
        await h.runtime.platformEventRouter.routeEvent({ platform: 'twitch', type: 'platform:giftpaypiggy', data: {
            isError: true, isAnonymous: true, giftCount: 5, tier: '1000', timestamp: '2026-01-03T00:00:00.000Z'
        } });
        await h.queue.processQueue();
        expect(h.presented).toHaveLength(1);
        expect(h.tracker.getGoalState('twitch')?.current).toBe(0);
        expect(h.funding.snapshot.currentUsd).toBe(0);
    });
    test('mute and cancellation earn no credit; re-enable and named control present', async () => {
        const h = await fixture();
        await h.controls.setEnabled('giftsEnabled', false);
        await h.send();
        expect(h.queue.getQueueLength()).toBe(0);
        await h.controls.setEnabled('giftsEnabled', true);
        await h.send();
        h.queue.clearQueue();
        await h.queue.processQueue();
        expect(h.tracker.getGoalState('twitch')?.current).toBe(0);
        expect(h.funding.snapshot.currentUsd).toBe(0);
        await h.send();
        await h.queue.processQueue();
        await h.send({ is_anonymous: false, user_name: 'Synthetic Named', user_id: 'synthetic-named', timestamp: '2026-01-02T00:00:00.000Z' });
        await h.queue.processQueue();
        expect(h.tracker.getGoalState('twitch')?.current).toBe(3500);
        expect(h.funding.snapshot.currentUsd).toBe(35);
        expect(h.tracking.isStreamSupporter('twitch', 'synthetic-named')).toBe(true);
    });
});
