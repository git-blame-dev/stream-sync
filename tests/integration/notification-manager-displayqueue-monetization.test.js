
const { describe, test, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks, spyOn } = require('../helpers/bun-mock-utils');
const EventEmitter = require('events');
const PlatformEventRouter = require('../../src/services/PlatformEventRouter');
const NotificationManager = require('../../src/notifications/NotificationManager');
const { DisplayQueue } = require('../../src/obs/display-queue');
const constants = require('../../src/core/constants');
const { createMockOBSConnection, noOpLogger } = require('../helpers/mock-factories');
const { createTextProcessingManager } = require('../../src/utils/text-processing');
const { PlatformEvents } = require('../../src/interfaces/PlatformEvents');
const { createConfigFixture } = require('../helpers/config-fixture');

describe('Monetisation pipeline integration', () => {
    let eventBus;
    let recordedEvents;
    let displayQueue;
    let notificationManager;
    let router;
    let config;
    const fixedTimestamp = '2025-01-01T00:00:00.000Z';

    const createEventBus = () => {
        const emitter = new EventEmitter();
        return {
            emit: emitter.emit.bind(emitter),
            on: emitter.on.bind(emitter),
            subscribe: (event, handler) => {
                emitter.on(event, handler);
                return () => emitter.off(event, handler);
            }
        };
    };

    beforeEach(() => {
        eventBus = createEventBus();
        recordedEvents = [];
        eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (data) => recordedEvents.push(data));

        const displayQueueConfig = {
            autoProcess: false,
            maxQueueSize: 25,
            ttsEnabled: false,
            chat: { sourceName: 'chat-source', sceneName: 'chat-scene', groupName: 'chat-group', platformLogos: {} },
            notification: { sourceName: 'notif-source', sceneName: 'notif-scene', groupName: 'notif-group', platformLogos: {} },
            obs: { ttsTxt: 'tts-source' },
            vfx: { vfxFilePath: '/test/vfx/path' },
            twitch: { notificationsEnabled: true },
            youtube: { notificationsEnabled: true },
            tiktok: { notificationsEnabled: true }
        };

        const mockObs = createMockOBSConnection();
        mockObs.isReady = createMockFn().mockResolvedValue(true);
        mockObs.call = createMockFn().mockResolvedValue({ success: true });

        displayQueue = new DisplayQueue(mockObs, displayQueueConfig, constants, eventBus);
        displayQueue.playGiftVideoAndAudio = createMockFn().mockResolvedValue();
        displayQueue.isTTSEnabled = createMockFn(() => false);
        displayQueue.getDuration = createMockFn(() => 0);
        spyOn(displayQueue, 'addItem');

        displayQueue.processQueue = createMockFn(async () => {
            while (displayQueue.queue.length > 0) {
                const item = displayQueue.queue.shift();
                const commandKey = item.data?.commandKey || (item.type === 'platform:paypiggy' ? 'paypiggies' : 'gifts');
                eventBus.emit(PlatformEvents.VFX_COMMAND_RECEIVED, {
                    commandKey,
                    username: item.data?.username,
                    platform: item.platform,
                    userId: item.data?.userId,
                    context: { source: 'display-queue' }
                });
            }
        });

        const vfxCommandService = {
            executeCommand: createMockFn(),
            getVFXConfig: createMockFn(async (commandKey) => ({
                commandKey,
                command: `!${commandKey}`,
                filename: `${commandKey}.mp4`,
                mediaSource: 'vfx top',
                vfxFilePath: '/test/vfx/path',
                duration: 10
            }))
        };

        config = createConfigFixture({
            general: {
                userSuppressionEnabled: true,
                maxNotificationsPerUser: 5,
                suppressionWindowMs: 60000,
                suppressionDurationMs: 300000,
                suppressionCleanupIntervalMs: 300000,
                giftsEnabled: true,
                paypiggiesEnabled: true
            },
            twitch: { notificationsEnabled: true },
            youtube: { notificationsEnabled: true },
            tiktok: { notificationsEnabled: true }
        });

        const textProcessing = createTextProcessingManager({ logger: noOpLogger });

        notificationManager = new NotificationManager({
            logger: noOpLogger,
            constants,
            textProcessing,
            obsGoals: { processDonationGoal: createMockFn() },
            displayQueue,
            eventBus,
            config,
            vfxCommandService,
            ttsService: { speak: createMockFn() },
            userTrackingService: { isFirstMessage: createMockFn().mockResolvedValue(false) }
        });

        const runtime = {
            handleGiftNotification: createMockFn((platform, _username, payload) =>
                notificationManager.handleNotification(payload.type || 'platform:gift', platform, payload)
            ),
            handleGiftPaypiggyNotification: createMockFn((platform, _username, payload) =>
                notificationManager.handleNotification('platform:giftpaypiggy', platform, payload)
            ),
            handlePaypiggyNotification: createMockFn((platform, _username, payload) =>
                notificationManager.handleNotification('platform:paypiggy', platform, payload)
            ),
            handleEnvelopeNotification: createMockFn((platform, _username, payload) =>
                notificationManager.handleNotification('platform:envelope', platform, payload)
            )
        };

        router = new PlatformEventRouter({
            eventBus,
            runtime,
            notificationManager,
            config,
            logger: noOpLogger
        });
    });

    afterEach(() => {
        router?.dispose();
        if (displayQueue && typeof displayQueue.stop === 'function') {
            displayQueue.stop();
        }
        clearAllMocks();
        restoreAllMocks();
    });

    const flows = [
        { platform: 'youtube', type: 'platform:giftpaypiggy', expectedCommandKey: 'gifts', username: 'GiftPilot', userId: 'yt-gift-1' },
        { platform: 'youtube', type: 'platform:gift', giftType: 'Super Chat', giftCount: 1, amount: 5, currency: 'USD', expectedCommandKey: 'gifts', username: 'ChatPilot', userId: 'yt-superchat-2' },
        { platform: 'youtube', type: 'platform:gift', giftType: 'Super Sticker', giftCount: 1, amount: 10, currency: 'USD', expectedCommandKey: 'gifts', username: 'StickerPilot', userId: 'yt-sticker-3' },
        { platform: 'twitch', type: 'platform:giftpaypiggy', expectedCommandKey: 'gifts', username: 'SubPilot', userId: 'tw-giftpaypiggy-4' },
        { platform: 'twitch', type: 'platform:gift', giftType: 'bits', giftCount: 1, amount: 100, currency: 'bits', expectedCommandKey: 'gifts', username: 'BitsPilot', userId: 'tw-bits-5' },
        { platform: 'tiktok', type: 'platform:paypiggy', expectedCommandKey: 'paypiggies', username: 'MemberPilot', userId: 'tt-paypiggy-7' },
        { platform: 'tiktok', type: 'platform:envelope', giftType: 'Treasure Chest', giftCount: 1, amount: 100, currency: 'coins', expectedCommandKey: 'gifts', username: 'ChestPilot', userId: 'tt-envelope-1' }
    ];

    test.each(flows)('routes %s %s with canonical command key', async ({ platform, type, expectedCommandKey, username, userId, giftType, giftCount, amount, currency }) => {
        recordedEvents.length = 0;

        const baseData = {
            username,
            userId,
            id: `event-${userId}`,
            timestamp: fixedTimestamp
        };
        const typeData = {
            'platform:giftpaypiggy': { giftCount: 5, tier: '1000' },
            'platform:paypiggy': { membershipLevel: 'Member', months: 2 }
        };
        const payload = {
            ...baseData,
            ...(typeData[type] ?? {}),
            ...(giftType ? { giftType } : {}),
            ...(giftCount ? { giftCount } : {}),
            ...(amount !== undefined ? { amount } : {}),
            ...(currency ? { currency } : {})
        };

        if (type === 'platform:envelope') {
            await notificationManager.handleNotification('platform:envelope', platform, payload);
        } else {
            eventBus.emit('platform:event', {
                platform,
                type,
                data: payload
            });
        }

        await new Promise(setImmediate);
        for (let attempt = 0; attempt < 10 && displayQueue.addItem.mock.calls.length === 0; attempt += 1) {
            await new Promise(setImmediate);
        }

        expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
        const queueItem = displayQueue.addItem.mock.calls[0][0];
        expect(queueItem.data.displayMessage).toBeTruthy();
        expect(queueItem.data.logMessage).toBeTruthy();
        expect(queueItem.data.displayMessage).not.toMatch(/undefined|null/i);
        expect(queueItem.data.logMessage).not.toMatch(/undefined|null/i);

        await displayQueue.processQueue();

        expect(recordedEvents).toHaveLength(1);
        expect(recordedEvents[0].commandKey).toBe(expectedCommandKey);
        expect(recordedEvents[0].username).toBe(username);
        expect(recordedEvents[0].platform).toBe(platform);
        expect(recordedEvents[0].userId).toBe(userId);
        expect(recordedEvents[0].context.source).toBe('display-queue');
    });

    test('respects paypiggiesEnabled gating', async () => {
        config.general.paypiggiesEnabled = false;

        eventBus.emit('platform:event', {
            platform: 'twitch',
            type: 'platform:paypiggy',
            data: { username: 'GatedMember', userId: 'member-1', id: 'paypiggy-1', timestamp: fixedTimestamp }
        });

        await new Promise(setImmediate);
        await displayQueue.processQueue();

        expect(displayQueue.queue).toHaveLength(0);
        expect(recordedEvents).toHaveLength(0);
    });

    test('respects giftsEnabled gating for all gift-like monetisation', async () => {
        config.general.giftsEnabled = false;

        eventBus.emit('platform:event', {
            platform: 'twitch',
            type: 'platform:gift',
            data: {
                username: 'GatedGifter',
                userId: 'gifter-1',
                id: 'gift-1',
                timestamp: fixedTimestamp,
                bits: 100,
                giftType: 'bits',
                giftCount: 1,
                amount: 100,
                currency: 'bits'
            }
        });

        await new Promise(setImmediate);
        await displayQueue.processQueue();

        expect(displayQueue.queue).toHaveLength(0);
        expect(recordedEvents).toHaveLength(0);
    });

    test('normalizes paypiggy months/levels and builds copy/TTS/log without placeholders', async () => {
        eventBus.emit('platform:event', {
            platform: 'youtube',
            type: 'platform:paypiggy',
            data: {
                username: 'RenewedMember',
                userId: 'member-22',
                id: 'paypiggy-2',
                timestamp: fixedTimestamp,
                membershipLevel: 'Test Member Plus',
                months: 2
            }
        });

        await new Promise(setImmediate);

        expect(displayQueue.queue).toHaveLength(1);
        const item = displayQueue.queue[0];
        expect(item.data.months).toBe(2);
        expect(item.data.displayMessage).toMatch(/2nd month/i);
        expect(item.data.displayMessage).toContain('Test Member Plus');
        expect(item.data.ttsMessage).toMatch(/2nd month/i);
        expect(item.data.logMessage).not.toMatch(/undefined|null/);
        expect(item.data.displayMessage).not.toMatch(/undefined|null/);
        expect(item.data.ttsMessage).not.toMatch(/undefined|null/);
    });
});
