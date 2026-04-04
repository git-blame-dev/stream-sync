
const { describe, expect, it, afterEach } = require('bun:test');
const { restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { DisplayQueue } = require('../../../src/obs/display-queue.ts');
const { createMockOBSManager } = require('../../helpers/mock-factories');
const { PRIORITY_LEVELS } = require('../../../src/core/constants');

describe('DisplayQueue lingering chat visibility', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const constants = {
        PRIORITY_LEVELS,
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
            username: 'test-viewer',
            message: 'Hello there'
        }
    });

    it('treats lingering chat as displayed when queue is empty and no active display', () => {
        const displayQueue = new DisplayQueue(createMockOBSManager('connected'), config, constants, null, constants);
        displayQueue.currentDisplay = null;
        displayQueue.queue = [];
        displayQueue.lastChatItem = buildChatItem();

        expect(displayQueue.isItemDisplayedToUser('chat')).toBe(true);

        const content = displayQueue.getCurrentDisplayContent();
        expect(content).toEqual(
            expect.objectContaining({
                type: 'chat',
                username: 'test-viewer',
                content: 'test-viewer: Hello there',
                isLingering: true
            })
        );
    });

    it('does not report lingering chat as displayed when a notification is active', () => {
        const displayQueue = new DisplayQueue(createMockOBSManager('connected'), config, constants, null, constants);
        displayQueue.queue = [];
        displayQueue.lastChatItem = buildChatItem();
        displayQueue.currentDisplay = {
            type: 'platform:follow',
            platform: 'twitch',
            data: {
                username: 'test-follower',
                displayMessage: 'test-follower just followed!'
            }
        };

        expect(displayQueue.isItemDisplayedToUser('chat')).toBe(false);

        const content = displayQueue.getCurrentDisplayContent();
        expect(content.type).toBe('platform:follow');
        expect(content.content).toContain('test-follower just followed!');
        expect(content.isLingering).toBeUndefined();
    });

    it('does not surface lingering chat while queued items remain', () => {
        const displayQueue = new DisplayQueue(createMockOBSManager('connected'), config, constants, null, constants);
        displayQueue.lastChatItem = buildChatItem();
        displayQueue.queue = [
            {
                type: 'platform:follow',
                platform: 'twitch',
                data: {
                    username: 'test-queued-follower',
                    displayMessage: 'test-queued-follower just followed!'
                },
                priority: constants.PRIORITY_LEVELS.FOLLOW
            }
        ];

        expect(displayQueue.isItemDisplayedToUser('chat')).toBe(false);
        expect(displayQueue.getCurrentDisplayContent()).toBeNull();
    });

    it('reports notification visibility and formats notification details', () => {
        const displayQueue = new DisplayQueue(createMockOBSManager('connected'), config, constants, null, constants);
        displayQueue.currentDisplay = {
            type: 'platform:gift',
            platform: 'twitch',
            data: {
                username: 'test-user',
                displayMessage: 'test-user sent a gift',
                amount: 100,
                currency: 'bits',
                giftType: 'bits',
                giftCount: 1,
                repeatCount: 2,
                tier: 'Tier 1',
                months: 3
            }
        };

        expect(displayQueue.isItemDisplayedToUser('platform:gift')).toBe(true);
        const content = displayQueue.getCurrentDisplayContent();
        expect(content).toEqual(expect.objectContaining({
            type: 'platform:gift',
            username: 'test-user'
        }));
        expect(content.notificationDetails).toEqual(expect.objectContaining({
            amount: 100,
            currency: 'bits',
            giftType: 'bits',
            giftCount: 1,
            repeatCount: 2,
            tier: 'Tier 1',
            months: 3
        }));
        expect(content.isTechnicalArtifactFree).toBe(true);
    });

    it('formats generic content and matches exact type visibility', () => {
        const displayQueue = new DisplayQueue(createMockOBSManager('connected'), config, constants, null, constants);
        displayQueue.currentDisplay = {
            type: 'custom',
            platform: 'twitch',
            data: { username: 'test-user', message: 'custom message' }
        };

        expect(displayQueue.isItemDisplayedToUser('custom')).toBe(true);
        const content = displayQueue.getCurrentDisplayContent();
        expect(content).toEqual(expect.objectContaining({
            type: 'custom',
            content: 'custom message',
            username: 'test-user'
        }));
    });

    it('returns false for non-chat visibility when no display is active', () => {
        const displayQueue = new DisplayQueue(createMockOBSManager('connected'), config, constants, null, constants);
        displayQueue.currentDisplay = null;
        displayQueue.queue = [];
        displayQueue.lastChatItem = null;

        expect(displayQueue.isItemDisplayedToUser('platform:follow')).toBe(false);
        expect(displayQueue.getCurrentDisplayContent()).toBeNull();
    });

    it('marks technical artifact content as not clean', () => {
        const displayQueue = new DisplayQueue(createMockOBSManager('connected'), config, constants, null, constants);
        displayQueue.currentDisplay = {
            type: 'platform:follow',
            platform: 'twitch',
            data: { username: 'test-user', displayMessage: 'undefined in message' }
        };

        const content = displayQueue.getCurrentDisplayContent();
        expect(content.isTechnicalArtifactFree).toBe(false);
    });
});
