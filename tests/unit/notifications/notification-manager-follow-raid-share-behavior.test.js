
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const NotificationManager = require('../../../src/notifications/NotificationManager');
const constants = require('../../../src/core/constants');
const { noOpLogger } = require('../../helpers/mock-factories');

describe('NotificationManager follow/raid/share behavior', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let queuedItems;
    let displayQueue;
    let configService;
    let eventBus;
    let vfxCommandService;
    let manager;

    beforeEach(() => {
        queuedItems = [];
        displayQueue = {
            addItem: createMockFn((item) => queuedItems.push(item)),
            getQueueLength: createMockFn(() => queuedItems.length)
        };

        configService = {
            areNotificationsEnabled: createMockFn().mockReturnValue(true),
            getNotificationSettings: createMockFn().mockReturnValue({ enabled: true }),
            getTTSConfig: createMockFn().mockReturnValue({ enabled: true }),
            getPlatformConfig: createMockFn().mockReturnValue({}),
            getCLIOverrides: createMockFn().mockReturnValue({}),
            get: createMockFn((section) => {
                if (section !== 'general') {
                    return {};
                }
                return {
                    userSuppressionEnabled: false,
                    maxNotificationsPerUser: 5,
                    suppressionWindowMs: 60000,
                    suppressionDurationMs: 300000,
                    suppressionCleanupIntervalMs: 300000
                };
            }),
            isDebugEnabled: createMockFn().mockReturnValue(false)
        };

        vfxCommandService = {
            getVFXConfig: createMockFn().mockImplementation(async (commandKey) => ({
                commandKey,
                filename: `${commandKey}.mp4`
            })),
            executeCommand: createMockFn().mockResolvedValue({ success: true }),
            executeCommandForKey: createMockFn().mockResolvedValue({ success: true })
        };

        eventBus = {
            emit: createMockFn(),
            on: createMockFn(),
            off: createMockFn()
        };

        manager = new NotificationManager({
            logger: noOpLogger,
            displayQueue,
            configService,
            eventBus,
            constants,
            textProcessing: { formatChatMessage: createMockFn() },
            obsGoals: { processDonationGoal: createMockFn() },
            vfxCommandService
        });
    });

    test('share notifications queue at raid priority and keep share VFX mapping', async () => {
        const result = await manager.handleNotification('platform:share', 'tiktok', {
            username: 'StreamSharer',
            userId: 'share-1'
        });

        expect(result.success).toBe(true);
        expect(queuedItems).toHaveLength(1);

        const queued = queuedItems[0];
        expect(queued.priority).toBe(constants.PRIORITY_LEVELS.SHARE);
        expect(queued.vfxConfig).toEqual(expect.objectContaining({
            commandKey: 'shares',
            filename: 'shares.mp4'
        }));
        expect(queued.data.displayMessage).toBe('StreamSharer shared the stream');
        expect(queued.type).toBe('platform:share');
    });

    test('share notifications respect per-platform disabled toggles', async () => {
        configService.areNotificationsEnabled.mockImplementation((settingKey, platform) => {
            if (settingKey === 'sharesEnabled' && platform === 'tiktok') {
                return false;
            }
            return true;
        });

        const result = await manager.handleNotification('platform:share', 'tiktok', {
            username: 'MutedSharer',
            userId: 'share-2'
        });

        expect(result).toEqual(expect.objectContaining({
            success: false,
            disabled: true,
            notificationType: 'platform:share',
            platform: 'tiktok'
        }));
        expect(queuedItems).toHaveLength(0);
    });

    test('follow notifications respect per-platform disabled toggles', async () => {
        configService.areNotificationsEnabled.mockImplementation((settingKey, platform) => {
            if (settingKey === 'followsEnabled' && platform === 'twitch') {
                return false;
            }
            return true;
        });

        const result = await manager.handleNotification('platform:follow', 'twitch', {
            username: 'MutedFollower',
            userId: 'follow-1'
        });

        expect(result).toEqual(expect.objectContaining({
            success: false,
            disabled: true,
            notificationType: 'platform:follow',
            platform: 'twitch'
        }));
        expect(queuedItems).toHaveLength(0);
    });

    test('share notifications reject missing usernames', async () => {
        const result = await manager.handleNotification('platform:share', 'youtube', {
            userId: 'share-3'
        });

        expect(result).toEqual(expect.objectContaining({
            success: false,
            error: 'Missing username'
        }));
        expect(queuedItems).toHaveLength(0);
    });

    test('follow notifications carry follow VFX command mapping', async () => {
        await manager.handleNotification('platform:follow', 'youtube', {
            username: 'Follower',
            userId: 'follow-2'
        });

        expect(queuedItems[0].vfxConfig).toEqual(expect.objectContaining({
            commandKey: 'follows'
        }));
    });

    test('follow notifications reject missing usernames', async () => {
        const result = await manager.handleNotification('platform:follow', 'twitch', {
            userId: 'only-id'
        });

        expect(result).toEqual(expect.objectContaining({
            success: false,
            error: 'Missing username'
        }));
        expect(queuedItems).toHaveLength(0);
    });

    test('raid notifications without viewer counts are rejected', async () => {
        const result = await manager.handleNotification('platform:raid', 'twitch', {
            username: 'MysteryRaider',
            userId: 'raid-1'
        });

        expect(result).toEqual(expect.objectContaining({
            success: false,
            error: 'Notification build failed'
        }));
        expect(queuedItems).toHaveLength(0);
    });

    test('raid notifications with zero viewers still route and surface zero count', async () => {
        const result = await manager.handleNotification('platform:raid', 'twitch', {
            username: 'ZeroRaider',
            viewerCount: 0,
            userId: 'raid-0'
        });

        expect(result.success).toBe(true);
        const raidItem = queuedItems[0];
        expect(raidItem.data.displayMessage).toBe('Incoming raid from ZeroRaider with 0 viewers!');
        expect(raidItem.data.ttsMessage).toBe('Incoming raid from ZeroRaider with 0 viewers');
    });

    test('raid notifications carry raid VFX command mapping', async () => {
        await manager.handleNotification('platform:raid', 'youtube', {
            username: 'VfxRaider',
            viewerCount: 25,
            userId: 'raid-vfx'
        });

        expect(queuedItems[0].vfxConfig).toEqual(expect.objectContaining({
            commandKey: 'raids'
        }));
    });

    test('returns disabled when notification toggle check fails instead of throwing', async () => {
        configService.areNotificationsEnabled.mockImplementation(() => { throw new Error('config crash'); });

        const result = await manager.handleNotification('platform:follow', 'tiktok', {
            username: 'ResilientUser',
            userId: 'follow-err'
        });

        expect(result.success).toBe(false);
        expect(result.disabled).toBe(true);
        expect(queuedItems).toHaveLength(0);
    });
});
