
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, spyOn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { createMockOBSManager, noOpLogger } = require('../../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');
const { createRuntimeConstantsFixture, createSourcesConfigFixture } = require('../../helpers/runtime-constants-fixture');
const { createOBSSourcesManager } = require('../../../src/obs/sources');

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

const { DisplayQueue } = require('../../../src/obs/display-queue');

describe('Notification Auto-Clearing Behavior', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let displayQueue;
    let mockObsManager;
    let mockConstants;
    let runtimeConstants;

    beforeEach(() => {
        mockObsManager = createMockOBSManager('connected');

        mockConstants = {
            CHAT_MESSAGE_DURATION: 5000,
            CHAT_TRANSITION_DELAY: 200,
            NOTIFICATION_CLEAR_DELAY: 200,
            PRIORITY_LEVELS: {
                CHAT: 1,
                COMMAND: 2,
                FOLLOW: 2,
                GIFT: 4,
                MEMBER: 3,
                GREETING: 2,
                RAID: 6,
                ENVELOPE: 8,
                REDEMPTION: 3,
                CHEER: 4,
                GIFTPAYPIGGY: 3
            }
        };
        runtimeConstants = createRuntimeConstantsFixture(mockConstants);

        const mockConfig = {
            autoProcess: false,
            chat: {
                sourceName: 'chat_text',
                sceneName: 'main_scene',
                groupName: 'chat_group',
                platformLogos: {
                    tiktok: 'tiktok_logo',
                    twitch: 'twitch_logo',
                    youtube: 'youtube_logo'
                }
            },
            notification: {
                sourceName: 'notification_text',
                sceneName: 'main_scene',
                groupName: 'notification_group',
                platformLogos: {
                    tiktok: 'tiktok_logo',
                    twitch: 'twitch_logo',
                    youtube: 'youtube_logo'
                }
            },
            obs: {
                ttsTxt: 'tts_text'
            }
        };

        // Create REAL sourcesManager with mocked OBS (mock at external boundary only)
        const realSourcesManager = createOBSSourcesManager(mockObsManager, {
            ...createSourcesConfigFixture(),
            logger: noOpLogger,
            ensureOBSConnected: createMockFn().mockResolvedValue(),
            obsCall: mockObsManager.call
        });

        const mockGoalsManager = {
            processDonationGoal: createMockFn().mockResolvedValue({ success: true }),
            processPaypiggyGoal: createMockFn().mockResolvedValue({ success: true }),
            initializeGoalDisplay: createMockFn().mockResolvedValue()
        };

        displayQueue = new DisplayQueue(mockObsManager, mockConfig, mockConstants, null, runtimeConstants, {
            sourcesManager: realSourcesManager,
            goalsManager: mockGoalsManager
        });
    });

    test('should hide notifications after their duration regardless of lingering chat', async () => {
        const chatItem = {
            type: 'chat',
            data: {
                username: 'TestUser',
                message: 'Hello world!'
            },
            platform: 'twitch',
            duration: 5000
        };

        const notificationItem = {
            type: 'platform:follow',
            data: {
                username: 'NewFollower',
                displayMessage: 'NewFollower just followed!'
            },
            platform: 'twitch',
            duration: 3000
        };

        const hideDisplaySpy = spyOn(displayQueue, 'hideCurrentDisplay');
        hideDisplaySpy.mockResolvedValue();

        displayQueue.addItem(chatItem);
        await displayQueue.processQueue();

        expect(displayQueue.lastChatItem).toBeDefined();

        hideDisplaySpy.mockClear();

        displayQueue.addItem(notificationItem);
        await displayQueue.processQueue();

        expect(hideDisplaySpy).toHaveBeenCalledWith(notificationItem);

        hideDisplaySpy.mockRestore();
    });

    test('lingering chat is shown after queue drains and skips OBS ops when OBS not ready', async () => {
        const chatItem = {
            type: 'chat',
            data: {
                username: 'ChatUser',
                message: 'This should linger'
            },
            platform: 'twitch',
            duration: 3000
        };

        const hideDisplaySpy = spyOn(displayQueue, 'hideCurrentDisplay').mockResolvedValue();
        const lingeringChatSpy = spyOn(displayQueue, 'displayLingeringChat');
        const obsReadySpy = spyOn(mockObsManager, 'isReady').mockResolvedValue(false);

        displayQueue.addItem(chatItem);
        await displayQueue.processQueue();

        await displayQueue.displayLingeringChat();

        expect(hideDisplaySpy).not.toHaveBeenCalledWith(chatItem);
        expect(obsReadySpy).toHaveBeenCalled();
        expect(displayQueue.currentDisplay).toBeNull();

        hideDisplaySpy.mockRestore();
        lingeringChatSpy.mockRestore();
        obsReadySpy.mockRestore();
    });

    test('should demonstrate difference in clearing behavior between notifications and chat', async () => {
        const duration = 3000;

        const notificationItem = {
            type: 'command',
            data: {
                username: 'CommandUser',
                displayMessage: 'CommandUser used command hello'
            },
            platform: 'twitch',
            duration: duration
        };

        const chatItem = {
            type: 'chat',
            data: {
                username: 'ChatUser',
                message: 'Regular chat message'
            },
            platform: 'twitch',
            duration: duration
        };

        const hideDisplaySpy = spyOn(displayQueue, 'hideCurrentDisplay');
        hideDisplaySpy.mockResolvedValue();

        displayQueue.addItem(notificationItem);
        await displayQueue.processQueue();

        expect(hideDisplaySpy).toHaveBeenCalledWith(notificationItem);

        hideDisplaySpy.mockClear();

        displayQueue.addItem(chatItem);
        await displayQueue.processQueue();

        expect(hideDisplaySpy).not.toHaveBeenCalledWith(chatItem);

        hideDisplaySpy.mockRestore();
    });
});
