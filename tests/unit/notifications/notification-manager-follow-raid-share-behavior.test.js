
const NotificationManager = require('../../../src/notifications/NotificationManager');
const constants = require('../../../src/core/constants');
const { createMockLogger } = require('../../helpers/mock-factories');

describe('NotificationManager follow/raid/share behavior', () => {
    let queuedItems;
    let displayQueue;
    let configService;
    let eventBus;
    let vfxCommandService;
    let manager;

    beforeEach(() => {
        queuedItems = [];
        displayQueue = {
            addItem: jest.fn((item) => queuedItems.push(item)),
            getQueueLength: jest.fn(() => queuedItems.length)
        };

        configService = {
            areNotificationsEnabled: jest.fn().mockReturnValue(true),
            getNotificationSettings: jest.fn().mockReturnValue({ enabled: true }),
            getTTSConfig: jest.fn().mockReturnValue({ enabled: true }),
            getPlatformConfig: jest.fn().mockReturnValue({}),
            getCLIOverrides: jest.fn().mockReturnValue({}),
            get: jest.fn((section) => {
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
            isDebugEnabled: jest.fn().mockReturnValue(false)
        };

        vfxCommandService = {
            getVFXConfig: jest.fn().mockImplementation(async (commandKey) => ({
                commandKey,
                filename: `${commandKey}.mp4`
            })),
            executeCommand: jest.fn().mockResolvedValue({ success: true }),
            executeCommandForKey: jest.fn().mockResolvedValue({ success: true })
        };

        eventBus = {
            emit: jest.fn(),
            on: jest.fn(),
            off: jest.fn()
        };

        manager = new NotificationManager({
            logger: createMockLogger('debug', { captureConsole: true }),
            displayQueue,
            configService,
            eventBus,
            constants,
            textProcessing: { formatChatMessage: jest.fn() },
            obsGoals: { processDonationGoal: jest.fn() },
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
        expect(queued.type).toBe('share');
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
            notificationType: 'share',
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
            notificationType: 'follow',
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

    test('throws when notification toggle check fails', async () => {
        configService.areNotificationsEnabled.mockImplementation(() => { throw new Error('config crash'); });

        await expect(manager.handleNotification('platform:follow', 'tiktok', {
            username: 'ResilientUser',
            userId: 'follow-err'
        })).rejects.toThrow('config crash');

        expect(queuedItems).toHaveLength(0);
    });
});
