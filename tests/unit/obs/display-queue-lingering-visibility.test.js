
jest.mock('../../../src/core/logging', () => ({
    logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }
}));

const { DisplayQueue } = require('../../../src/obs/display-queue');
const { createMockOBSManager } = require('../../helpers/mock-factories');

describe('DisplayQueue lingering chat visibility', () => {
    const constants = {
        PRIORITY_LEVELS: {
            CHAT: 1,
            FOLLOW: 2,
            GIFT: 4
        },
        CHAT_MESSAGE_DURATION: 4500,
        CHAT_TRANSITION_DELAY: 200
    };

    const config = {
        autoProcess: false,
        chat: {
            sourceName: 'chat',
            sceneName: 'scene',
            groupName: 'group',
            platformLogos: {}
        },
        notification: {
            sourceName: 'notification',
            sceneName: 'scene',
            groupName: 'group',
            platformLogos: {}
        }
    };

    const buildChatItem = () => ({
        type: 'chat',
        platform: 'twitch',
        data: {
            username: 'Viewer',
            message: 'Hello there'
        }
    });

    it('treats lingering chat as displayed when queue is empty and no active display', () => {
        const displayQueue = new DisplayQueue(createMockOBSManager('connected'), config, constants);
        displayQueue.currentDisplay = null;
        displayQueue.queue = [];
        displayQueue.lastChatItem = buildChatItem();

        expect(displayQueue.isItemDisplayedToUser('chat')).toBe(true);

        const content = displayQueue.getCurrentDisplayContent();
        expect(content).toEqual(
            expect.objectContaining({
                type: 'chat',
                username: 'Viewer',
                content: 'Viewer: Hello there',
                isLingering: true
            })
        );
    });

    it('does not report lingering chat as displayed when a notification is active', () => {
        const displayQueue = new DisplayQueue(createMockOBSManager('connected'), config, constants);
        displayQueue.queue = [];
        displayQueue.lastChatItem = buildChatItem();
        displayQueue.currentDisplay = {
            type: 'follow',
            platform: 'twitch',
            data: {
                username: 'Follower',
                displayMessage: 'Follower just followed!'
            }
        };

        expect(displayQueue.isItemDisplayedToUser('chat')).toBe(false);

        const content = displayQueue.getCurrentDisplayContent();
        expect(content.type).toBe('follow');
        expect(content.content).toContain('Follower just followed!');
        expect(content.isLingering).toBeUndefined();
    });

    it('does not surface lingering chat while queued items remain', () => {
        const displayQueue = new DisplayQueue(createMockOBSManager('connected'), config, constants);
        displayQueue.lastChatItem = buildChatItem();
        displayQueue.queue = [
            {
                type: 'follow',
                platform: 'twitch',
                data: {
                    username: 'QueuedFollower',
                    displayMessage: 'QueuedFollower just followed!'
                },
                priority: constants.PRIORITY_LEVELS.FOLLOW
            }
        ];

        expect(displayQueue.isItemDisplayedToUser('chat')).toBe(false);
        expect(displayQueue.getCurrentDisplayContent()).toBeNull();
    });
});
