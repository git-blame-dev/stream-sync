
const { describe, test, expect, beforeEach } = require('bun:test');
const { spyOn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { initializeTestLogging } = require('../../helpers/test-setup');
const { createMockOBSManager } = require('../../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');
const { createRuntimeConstantsFixture } = require('../../helpers/runtime-constants-fixture');

// Initialize test infrastructure
initializeTestLogging();
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

        // Mock constants
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

        // Mock config
        const mockConfig = {
            autoProcess: false, // Disable auto-processing for controlled testing
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

        displayQueue = new DisplayQueue(mockObsManager, mockConfig, mockConstants, null, runtimeConstants);
    });

    test('should hide notifications after their duration regardless of lingering chat', async () => {
        // Arrange: Add a chat message first (creates lingering chat)
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

        // Spy on hideCurrentDisplay to verify it's called
        const hideDisplaySpy = spyOn(displayQueue, 'hideCurrentDisplay');
        hideDisplaySpy.mockResolvedValue();

        // Add chat item and process it
        displayQueue.addItem(chatItem);
        await displayQueue.processQueue();

        // Verify chat creates lingering state
        expect(displayQueue.lastChatItem).toBeDefined();

        // Clear the spy to start fresh for notification test
        hideDisplaySpy.mockClear();

        // Act: Add notification and process it
        displayQueue.addItem(notificationItem);
        await displayQueue.processQueue();

        // Assert: Notification should be hidden despite lingering chat being available
        expect(hideDisplaySpy).toHaveBeenCalledWith(notificationItem);

        // Cleanup
        hideDisplaySpy.mockRestore();
    });

    test('lingering chat is shown after queue drains and skips OBS ops when OBS not ready', async () => {
        // Arrange: Add a chat message
        const chatItem = {
            type: 'chat',
            data: {
                username: 'ChatUser',
                message: 'This should linger'
            },
            platform: 'twitch',
            duration: 3000
        };

        // Spy on hideCurrentDisplay and displayLingeringChat to ensure they run
        const hideDisplaySpy = spyOn(displayQueue, 'hideCurrentDisplay').mockResolvedValue();
        const lingeringChatSpy = spyOn(displayQueue, 'displayLingeringChat');
        const obsReadySpy = spyOn(mockObsManager, 'isReady').mockResolvedValue(false);

        // Act: Add chat item and process queue
        displayQueue.addItem(chatItem);
        await displayQueue.processQueue();

        // Manually trigger lingering display and assert OBS gating short-circuits
        await displayQueue.displayLingeringChat();

        // Assert: chat hide skipped, lingering invoked, OBS readiness checked with no current display set
        expect(hideDisplaySpy).not.toHaveBeenCalledWith(chatItem);
        expect(obsReadySpy).toHaveBeenCalled();
        expect(displayQueue.currentDisplay).toBeNull();

        // Cleanup
        hideDisplaySpy.mockRestore();
        lingeringChatSpy.mockRestore();
        obsReadySpy.mockRestore();
    });

    test('should demonstrate difference in clearing behavior between notifications and chat', async () => {
        // Arrange: Notification and chat items with same duration
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

        // Spy on hideCurrentDisplay
        const hideDisplaySpy = spyOn(displayQueue, 'hideCurrentDisplay');
        hideDisplaySpy.mockResolvedValue();

        // Act: Process notification first
        displayQueue.addItem(notificationItem);
        await displayQueue.processQueue();

        // Assert: Notification should be hidden
        expect(hideDisplaySpy).toHaveBeenCalledWith(notificationItem);

        hideDisplaySpy.mockClear();

        // Act: Process chat message  
        displayQueue.addItem(chatItem);
        await displayQueue.processQueue();

        // Assert: Chat should NOT be hidden (lingering behavior)
        expect(hideDisplaySpy).not.toHaveBeenCalledWith(chatItem);

        // Cleanup
        hideDisplaySpy.mockRestore();
    });

    // Manual cleanup removed - handled by setupAutomatedCleanup()
});
