const { describe, expect, it, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { createRuntimeConstantsFixture } = require('../../helpers/runtime-constants-fixture');

const { DisplayQueue } = require('../../../src/obs/display-queue');
const { EventEmitter } = require('events');

describe('DisplayQueue platform notification gating', () => {
    let originalNodeEnv;

    beforeEach(() => {
        originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'test';
    });

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        restoreAllMocks();
    });

    function createQueue(platformConfig = {}) {
        const runtimeConstants = createRuntimeConstantsFixture({
            CHAT_MESSAGE_DURATION: 4500,
            CHAT_TRANSITION_DELAY: 200,
            NOTIFICATION_CLEAR_DELAY: 200
        });

        const mockSourcesManager = {
            updateTextSource: createMockFn().mockResolvedValue(),
            updateChatMsgText: createMockFn().mockResolvedValue(),
            setSourceVisibility: createMockFn().mockResolvedValue(),
            setNotificationDisplayVisibility: createMockFn().mockResolvedValue(),
            setChatDisplayVisibility: createMockFn().mockResolvedValue(),
            hideAllDisplays: createMockFn().mockResolvedValue(),
            setPlatformLogoVisibility: createMockFn().mockResolvedValue(),
            setNotificationPlatformLogoVisibility: createMockFn().mockResolvedValue(),
            setGroupSourceVisibility: createMockFn().mockResolvedValue(),
            setSourceFilterVisibility: createMockFn().mockResolvedValue()
        };

        const obsManager = {
            call: createMockFn().mockResolvedValue({}),
            isConnected: () => true,
            isReady: createMockFn().mockResolvedValue(true)
        };

        const config = {
            autoProcess: false,
            ttsEnabled: false,
            chat: { sourceName: 'chat', sceneName: 'scene', groupName: 'group', platformLogos: {} },
            notification: { sourceName: 'notification', sceneName: 'scene', groupName: 'group', platformLogos: {} },
            ...platformConfig
        };

        const queue = new DisplayQueue(
            obsManager,
            config,
            { PRIORITY_LEVELS: { CHAT: 1, FOLLOW: 2 } },
            new EventEmitter(),
            runtimeConstants
        );

        queue.sourcesManager = mockSourcesManager;
        return { queue, mockSourcesManager };
    }

    it('skips notification display when platform notifications are disabled', async () => {
        const { queue, mockSourcesManager } = createQueue({
            twitch: { notificationsEnabled: false }
        });

        const notificationItem = {
            type: 'platform:follow',
            platform: 'twitch',
            data: {
                username: 'testFollower',
                displayMessage: 'testFollower just followed!'
            },
            priority: 2,
            duration: 5000
        };

        await queue.displayNotificationItem(notificationItem);

        expect(mockSourcesManager.updateTextSource).not.toHaveBeenCalled();
        expect(mockSourcesManager.setNotificationDisplayVisibility).not.toHaveBeenCalled();
    });

    it('displays notification when platform notifications are enabled', async () => {
        const { queue, mockSourcesManager } = createQueue({
            twitch: { notificationsEnabled: true }
        });

        const notificationItem = {
            type: 'platform:follow',
            platform: 'twitch',
            data: {
                username: 'testFollower',
                displayMessage: 'testFollower just followed!'
            },
            priority: 2,
            duration: 5000
        };

        await queue.displayNotificationItem(notificationItem);

        expect(mockSourcesManager.setNotificationDisplayVisibility).toHaveBeenCalled();
    });

    it('displays notification for platforms without explicit config', async () => {
        const { queue, mockSourcesManager } = createQueue({});

        const notificationItem = {
            type: 'platform:follow',
            platform: 'youtube',
            data: {
                username: 'testFollower',
                displayMessage: 'testFollower just subscribed!'
            },
            priority: 2,
            duration: 5000
        };

        await queue.displayNotificationItem(notificationItem);

        expect(mockSourcesManager.setNotificationDisplayVisibility).toHaveBeenCalled();
    });
});
