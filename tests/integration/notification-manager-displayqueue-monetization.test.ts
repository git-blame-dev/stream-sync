import { describe, test, beforeEach, afterEach, expect } from 'bun:test';
import EventEmitter from 'node:events';
import { createHash } from 'node:crypto';
import { PlatformEventRouter } from '../../src/services/PlatformEventRouter';
import NotificationManager from '../../src/notifications/NotificationManager';
import { DisplayQueue } from '../../src/obs/display-queue';
import { createOBSGoalsManager } from '../../src/obs/goals';
import { createOBSSourcesManager } from '../../src/obs/sources';
import { GoalTracker } from '../../src/utils/goal-tracker';
import * as constants from '../../src/core/constants';
import { noOpLogger } from '../helpers/mock-factories';
import { PlatformEvents } from '../../src/interfaces/PlatformEvents';
import { createConfigFixture } from '../helpers/config-fixture';
import type { DisplayQueueItem } from '../../src/interfaces/DisplayQueue';
import { createFundingGoalService } from '../../src/services/funding-goal-service';

const logger = {
    ...noOpLogger, config: {},
    outputs: { console: { write: () => {} }, file: { write: () => {}, config: {}, fileAppender: null } },
    reconfigure: () => {}, log: () => {}, shouldOutput: () => false,
    console: () => {}, emergency: () => {}
};
const values = { tiktokGiftUnitUsd: 0.005, twitchBitUsd: 0.01, youtubeJewelUsd: 0.005,
    tiktokMembershipUsd: 2.1, twitchMembershipUsd: 3.5, youtubeMembershipUsd: 3.89 };
const fixedTimestamp = '2025-01-01T00:00:00.000Z';
type MonetizationType = 'platform:giftpaypiggy' | 'platform:gift' | 'platform:paypiggy' | 'platform:envelope';
type VfxEvent = Record<string, unknown> & { context: { source: string } };
type Flow = { platform: string; type: MonetizationType; expectedCommandKey: string; username: string;
    userId: string; giftType?: string; giftCount?: number; amount?: number; currency?: string };

describe('Monetisation pipeline integration', () => {
    let displayQueue: DisplayQueue;
    let notificationManager: NotificationManager;
    let router: PlatformEventRouter;
    let config: ReturnType<typeof createConfigFixture>;
    let fundingGoal: Awaited<ReturnType<typeof createFundingGoalService>>;
    let tracker: GoalTracker;
    let ingress: Promise<unknown>[];
    let emitter: EventEmitter;
    let recordedEvents: VfxEvent[];
    let rows: DisplayQueueItem[];
    let persisted: Map<string, string>;
    let writes: string[];
    let converterCalls: Array<[number, string]>;

    beforeEach(async () => {
        ingress = [];
        emitter = new EventEmitter();
        recordedEvents = [];
        rows = [];
        persisted = new Map();
        writes = [];
        converterCalls = [];
        const eventBus = {
            emit: emitter.emit.bind(emitter),
            subscribe: (event: string, handler: (payload: unknown) => unknown) => {
                const receive = (payload: unknown) => { ingress.push(Promise.resolve(handler(payload))); };
                emitter.on(event, receive);
                return () => { emitter.off(event, receive); };
            }
        };
        // External VFX playback acknowledges the actual correlated queue request.
        emitter.on(PlatformEvents.VFX_COMMAND_RECEIVED, (event: VfxEvent) => {
            recordedEvents.push(event);
            emitter.emit('vfx:effect-completed', { correlationId: event.correlationId });
        });
        emitter.on('display:row', (item: DisplayQueueItem) => { rows.push(item); });
        fundingGoal = await createFundingGoalService({
            config: { enabled: true, id: 'test-controller', label: 'Test controller', targetUsd: 100 },
            monetizationValuesConfig: values,
            fiatToUsd: (amount, currency) => {
                converterCalls.push([amount, currency]);
                return currency === 'cad' ? amount * 0.75 : null;
            },
            filePath: '/test-only/pipeline-funding.json',
            fs: {
                readFile: async () => { throw Object.assign(new Error('test missing'), { code: 'ENOENT' }); },
                mkdir: async () => {},
                writeFile: async (path, contents) => { writes.push(contents); persisted.set(path, contents); },
                rename: async (from, to) => { persisted.set(to, persisted.get(from)!); persisted.delete(from); },
                unlink: async path => { persisted.delete(path); }
            }
        });
        config = createConfigFixture({
            general: { giftsEnabled: true, paypiggiesEnabled: true },
            twitch: { giftsEnabled: true, paypiggiesEnabled: true },
            youtube: { giftsEnabled: true, paypiggiesEnabled: true },
            tiktok: { giftsEnabled: true, paypiggiesEnabled: true }
        });
        const goalsConfig = { enabled: true,
            twitchGoalEnabled: true, twitchGoalSource: 'test-twitch-goal', twitchGoalTarget: 1000, twitchGoalCurrency: 'bits',
            youtubeGoalEnabled: true, youtubeGoalSource: 'test-youtube-goal', youtubeGoalTarget: 100, youtubeGoalCurrency: 'USD',
            tiktokGoalEnabled: true, tiktokGoalSource: 'test-tiktok-goal', tiktokGoalTarget: 1000, tiktokGoalCurrency: 'coins' };
        const obs = { ensureConnected: async () => {}, isConnected: () => true, isReady: async () => true,
            call: async () => ({ inputSettings: {}, sceneItems: [], scenes: [] }) };
        const sources = createOBSSourcesManager(obs, { logger: noOpLogger });
        tracker = new GoalTracker({ logger, config: { goals: goalsConfig, monetizationValues: values } });
        const goals = createOBSGoalsManager(obs, { logger, config: { goals: goalsConfig }, goalTracker: tracker,
            updateTextSource: sources.updateTextSource });
        await goals.initializeGoalDisplay();
        displayQueue = new DisplayQueue(obs, {
            autoProcess: false, maxQueueSize: 25, rowIntervalMs: 0,
            ttsChatEnabled: false, ttsNotificationsEnabled: false,
            chat: { sourceName: 'test-chat', sceneName: 'test-scene', groupName: 'test-group', platformLogos: {} },
            notification: { sourceName: 'test-notification', sceneName: 'test-scene', groupName: 'test-group', platformLogos: {} },
            obs: { ttsTxt: 'test-tts' }, handcam: { enabled: false },
            gifts: {}, vfx: { vfxFilePath: '/test-only/vfx' }, twitch: {}, youtube: {}, tiktok: {}
        }, constants, eventBus, {
            sourcesManager: sources, goalsManager: goals,
            // Exercise real scheduling/effects without wall-clock presentation waits.
            delay: async () => {}, notificationDelay: async () => {},
            onPresentationStarted: item => fundingGoal.processPresentedContributions(
                Array.isArray(item.data.contributions) ? item.data.contributions : [])
        });
        notificationManager = new NotificationManager({
            logger: noOpLogger, constants,
            obsGoals: { processDonationGoal: (...args: unknown[]) => Reflect.apply(goals.processDonationGoal, goals, args) },
            displayQueue, eventBus, config,
            vfxCommandService: {
                getVFXConfig: async (commandKey: string) => ({ commandKey, command: `!${commandKey}`,
                    filename: `${commandKey}.mp4`, mediaSource: 'test-vfx', vfxFilePath: '/test-only/vfx', duration: 10 })
            },
            userTrackingService: { isFirstMessage: () => false }
        });
        // Thin runtime adapters leave routing, normalization and admission real.
        router = new PlatformEventRouter({ eventBus, notificationManager, config, logger: noOpLogger, runtime: {
            handleGiftNotification: (platform, _username, payload) => notificationManager.handleNotification('platform:gift', platform, payload),
            handleGiftPaypiggyNotification: (platform, _username, payload) => notificationManager.handleNotification('platform:giftpaypiggy', platform, payload),
            handlePaypiggyNotification: (platform, _username, payload) => notificationManager.handleNotification('platform:paypiggy', platform, payload),
            handleEnvelopeNotification: (platform, payload) => notificationManager.handleNotification('platform:envelope', platform, payload)
        } });
    });

    afterEach(async () => {
        router?.dispose();
        try {
            await Promise.all(ingress);
        } finally {
            try {
                await displayQueue?.stop();
            } finally {
                await fundingGoal?.dispose();
                emitter?.removeAllListeners();
            }
        }
    });

    const send = async (platform: string, type: MonetizationType, data: Record<string, unknown>) => {
        emitter.emit('platform:event', { platform, type, data });
        await Promise.all(ingress.splice(0));
    };
    const savedState = () => JSON.parse(persisted.get('/test-only/pipeline-funding.json')!) as {
        version: number; processedEventKeys: string[]; currentMicros: number;
    };
    const flows: Flow[] = [
        { platform: 'youtube', type: 'platform:giftpaypiggy', expectedCommandKey: 'gifts', username: 'Test GiftPilot', userId: 'test-yt-gift-1' },
        { platform: 'youtube', type: 'platform:gift', giftType: 'Super Chat', giftCount: 1, amount: 5, currency: 'USD',
            expectedCommandKey: 'gifts', username: 'Test ChatPilot', userId: 'test-yt-superchat-2' },
        { platform: 'youtube', type: 'platform:gift', giftType: 'Super Sticker', giftCount: 1, amount: 10, currency: 'USD',
            expectedCommandKey: 'gifts', username: 'Test StickerPilot', userId: 'test-yt-sticker-3' },
        { platform: 'twitch', type: 'platform:giftpaypiggy', expectedCommandKey: 'gifts', username: 'Test SubPilot', userId: 'test-tw-giftsubs-4' },
        { platform: 'twitch', type: 'platform:gift', giftType: 'bits', giftCount: 1, amount: 100, currency: 'bits',
            expectedCommandKey: 'gifts', username: 'Test BitsPilot', userId: 'test-tw-bits-5' },
        { platform: 'tiktok', type: 'platform:paypiggy', expectedCommandKey: 'paypiggies', username: 'Test MemberPilot', userId: 'test-tt-member-7' },
        { platform: 'tiktok', type: 'platform:envelope', giftType: 'Treasure Chest', giftCount: 1, amount: 100, currency: 'coins',
            expectedCommandKey: 'envelopes', username: 'Test ChestPilot', userId: 'test-tt-envelope-1' }
    ];

    test.each(flows)('routes %s %s with canonical command key', async flow => {
        const { platform, type, username, userId, expectedCommandKey, giftType, giftCount, amount, currency } = flow;
        const payload = { username, userId, id: `test-event-${userId}`, timestamp: fixedTimestamp,
            ...(type === 'platform:giftpaypiggy' ? { giftCount: 5, tier: '1000' } : {}),
            ...(type === 'platform:paypiggy' ? { membershipLevel: 'Member', months: 2 } : {}),
            ...(giftType ? { giftType } : {}), ...(giftCount ? { giftCount } : {}),
            ...(amount !== undefined ? { amount } : {}), ...(currency ? { currency } : {}) };
        await send(platform, type, payload);
        expect(displayQueue.getQueueLength()).toBe(1);
        const item = displayQueue.queue[0] as DisplayQueueItem;
        expect(item.type).toBe(type);
        expect(item.platform).toBe(platform);
        expect(item.data.username).toBe(username);
        expect(item.data.userId).toBe(userId);
        if (giftCount !== undefined || type === 'platform:giftpaypiggy') expect(item.data.giftCount).toBe(giftCount ?? 5);
        expect(typeof item.data.displayMessage).toBe('string');
        expect(typeof item.data.logMessage).toBe('string');
        expect(item.data.displayMessage).toBeTruthy();
        expect(item.data.logMessage).toBeTruthy();
        expect(item.data.displayMessage).not.toMatch(/undefined|null/i);
        expect(item.data.logMessage).not.toMatch(/undefined|null/i);
        expect(rows).toHaveLength(0);
        expect(fundingGoal.snapshot.currentUsd).toBe(0);
        await displayQueue.processQueue();
        expect(rows).toHaveLength(1);
        expect(recordedEvents).toHaveLength(1);
        expect(recordedEvents[0]).toMatchObject({ commandKey: expectedCommandKey, username, platform, userId,
            context: { source: 'display-queue' } });
        expect(displayQueue.getQueueLength()).toBe(0);
    });

    test('respects paypiggiesEnabled gating', async () => {
        config.general.paypiggiesEnabled = false;
        config.twitch.paypiggiesEnabled = false;
        await send('twitch', 'platform:paypiggy', { username: 'Test GatedMember', userId: 'test-member-1',
            id: 'test-membership-1', timestamp: fixedTimestamp });
        await displayQueue.processQueue();
        expect(displayQueue.getQueueLength()).toBe(0);
        expect(rows).toHaveLength(0);
        expect(recordedEvents).toHaveLength(0);
        expect(fundingGoal.snapshot.currentUsd).toBe(0);
        expect(writes).toHaveLength(0);
    });

    test('credits native and funding goals only when an enabled gift starts presentation', async () => {
        const gift = { username: 'Test GatedGifter', userId: 'test-gifter-1', id: 'test-muted-gift',
            timestamp: fixedTimestamp, bits: 100, giftType: 'bits', giftCount: 1, amount: 100, currency: 'bits' };
        config.general.giftsEnabled = false;
        config.twitch.giftsEnabled = false;
        await send('twitch', 'platform:gift', gift);
        await displayQueue.processQueue();
        expect(displayQueue.getQueueLength()).toBe(0);
        expect(rows).toHaveLength(0);
        expect(recordedEvents).toHaveLength(0);
        expect(tracker.getGoalState('twitch')?.current).toBe(0);
        expect(fundingGoal.snapshot.currentUsd).toBe(0);
        expect(fundingGoal.snapshot.revision).toBe(0);
        expect(persisted.size).toBe(0);
        expect(writes).toHaveLength(0);
        config.general.giftsEnabled = true;
        config.twitch.giftsEnabled = true;
        await send('twitch', 'platform:gift', { ...gift, id: 'test-shown-gift' });
        expect(displayQueue.getQueueLength()).toBe(1);
        expect(tracker.getGoalState('twitch')?.current).toBe(0);
        expect(fundingGoal.snapshot.currentUsd).toBe(0);
        expect(writes).toHaveLength(0);
        await displayQueue.processQueue();
        expect(rows).toHaveLength(1);
        expect(recordedEvents).toHaveLength(1);
        expect(tracker.getGoalState('twitch')?.current).toBe(100);
        expect(fundingGoal.snapshot.currentUsd).toBe(1);
        expect(savedState().processedEventKeys).toHaveLength(1);
        expect(writes).toHaveLength(1);
        await displayQueue.processQueue();
        expect(fundingGoal.snapshot.revision).toBe(1);
        expect(writes).toHaveLength(1);
    });

    test('converts foreign YouTube fiat from the presented original source exactly once', async () => {
        const gift = { username: 'Test ForeignSupporter', userId: 'test-yt-cad-1', id: 'test-foreign-gift-1',
            timestamp: fixedTimestamp, giftCount: 1, giftType: 'Super Chat', amount: 4, currency: 'CAD' };
        await send('youtube', 'platform:gift', gift);
        expect(displayQueue.getQueueLength()).toBe(1);
        expect(fundingGoal.snapshot.currentUsd).toBe(0);
        expect(converterCalls).toEqual([]);
        expect(writes).toHaveLength(0);
        expect((displayQueue.queue[0] as DisplayQueueItem).data.contributions).toEqual([
            { platform: 'youtube', type: 'platform:gift', data: { id: gift.id, timestamp: fixedTimestamp,
                userId: gift.userId, giftCount: 1, giftType: 'Super Chat', amount: 4, currency: 'CAD' } }
        ]);
        await displayQueue.processQueue();
        expect(rows).toHaveLength(1);
        expect(converterCalls).toEqual([[4, 'cad']]);
        expect(fundingGoal.snapshot.currentUsd).toBe(3);
        expect(savedState().version).toBe(1);
        const digest = createHash('sha256').update(JSON.stringify(['youtube', 'platform:gift', gift.id])).digest('hex');
        expect(savedState().processedEventKeys).toEqual([`youtube:platform:gift:sha256:${digest}`]);
        await send('youtube', 'platform:gift', gift);
        await displayQueue.processQueue();
        expect(converterCalls).toEqual([[4, 'cad']]);
        expect(fundingGoal.snapshot.currentUsd).toBe(3);
        expect(writes).toHaveLength(1);
    });

    test('normalizes paypiggy months/levels and builds copy/TTS/log without placeholders', async () => {
        await send('youtube', 'platform:paypiggy', { username: 'Test RenewedMember', userId: 'test-member-22',
            id: 'test-membership-2', timestamp: fixedTimestamp, membershipLevel: 'Test Member Plus', months: 2 });
        expect(displayQueue.getQueueLength()).toBe(1);
        const item = displayQueue.queue[0] as DisplayQueueItem;
        expect(item.data.months).toBe(2);
        expect(item.data.displayMessage).toMatch(/2nd month/i);
        expect(item.data.displayMessage).toContain('Test Member Plus');
        expect(item.data.ttsMessage).toMatch(/2nd month/i);
        expect(item.data.logMessage).not.toMatch(/undefined|null/);
        expect(item.data.displayMessage).not.toMatch(/undefined|null/);
        expect(item.data.ttsMessage).not.toMatch(/undefined|null/);
        await displayQueue.processQueue();
        expect(rows).toHaveLength(1);
        expect(fundingGoal.snapshot.currentUsd).toBe(3.89);
    });
});
