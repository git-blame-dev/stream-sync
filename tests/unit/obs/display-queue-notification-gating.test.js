
jest.mock('../../../src/core/logging', () => ({
    logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }
}));

const sources = require('../../../src/obs/sources');
jest.mock('../../../src/obs/sources', () => {
    const instance = {
        updateChatMsgText: jest.fn().mockResolvedValue(),
        updateTextSource: jest.fn().mockResolvedValue(),
        setNotificationPlatformLogoVisibility: jest.fn().mockResolvedValue(),
        setGroupSourceVisibility: jest.fn().mockResolvedValue(),
        setChatDisplayVisibility: jest.fn().mockResolvedValue(),
        setNotificationDisplayVisibility: jest.fn().mockResolvedValue()
    };
    return {
        OBSSourcesManager: class {},
        createOBSSourcesManager: () => instance,
        getDefaultSourcesManager: () => instance
    };
});

const { DisplayQueue } = require('../../../src/obs/display-queue');
const { createMockOBSManager } = require('../../helpers/mock-factories');

describe('DisplayQueue platform notification gating', () => {
    const constants = {
        PRIORITY_LEVELS: { CHAT: 1, FOLLOW: 2 },
        CHAT_MESSAGE_DURATION: 4500,
        CHAT_TRANSITION_DELAY: 200,
        NOTIFICATION_CLEAR_DELAY: 200
    };

    const config = {
        autoProcess: false,
        chat: { sourceName: 'chat', sceneName: 'scene', groupName: 'group', platformLogos: {} },
        notification: { sourceName: 'notification', sceneName: 'scene', groupName: 'group', platformLogos: {} },
        twitch: { notificationsEnabled: false }
    };

    it('skips notification display when platform notifications are disabled', async () => {
        const queue = new DisplayQueue(createMockOBSManager('connected'), config, constants);
        queue.displayNotificationItem = jest.requireActual('../../../src/obs/display-queue').DisplayQueue.prototype.displayNotificationItem;

        const notificationItem = {
            type: 'platform:follow',
            platform: 'twitch',
            data: {
                username: 'Follower',
                displayMessage: 'Follower just followed!'
            },
            priority: 2,
            duration: 5000
        };

        await queue.displayNotificationItem(notificationItem);

        const obsSources = sources.getDefaultSourcesManager();
        expect(obsSources.updateTextSource).not.toHaveBeenCalled();
        expect(obsSources.setGroupSourceVisibility).not.toHaveBeenCalled();
        expect(obsSources.setNotificationDisplayVisibility).not.toHaveBeenCalled();
    });
});
