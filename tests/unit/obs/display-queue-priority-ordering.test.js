
const { describe, test, expect, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { initializeTestLogging } = require('../../helpers/test-setup');

initializeTestLogging();

const { DisplayQueue } = require('../../../src/obs/display-queue');
const { createMockOBSManager } = require('../../helpers/mock-factories');

describe('DisplayQueue priority ordering', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const constants = {
        PRIORITY_LEVELS: {
            CHAT: 1,
            FOLLOW: 2,
            GIFT: 4,
            RAID: 6
        },
        CHAT_MESSAGE_DURATION: 4500,
        CHAT_TRANSITION_DELAY: 200
    };

    const config = {
        autoProcess: false,
        chat: { sourceName: 'chat', sceneName: 'scene', groupName: 'group', platformLogos: {} },
        notification: { sourceName: 'notification', sceneName: 'scene', groupName: 'group', platformLogos: {} }
    };

    const createQueue = () => {
        const queue = new DisplayQueue(createMockOBSManager('connected'), config, constants, null, constants);
        queue.getDuration = createMockFn().mockReturnValue(0);
        return queue;
    };

    it('front-loads higher priority items even when added later', () => {
        const queue = createQueue();
        const processed = [];
        queue.displayItem = createMockFn(async (item) => {
            processed.push(item.type);
        });

        queue.addItem({
            type: 'chat',
            platform: 'twitch',
            data: { username: 'Viewer', message: 'first chat' }
        });

        queue.addItem({
            type: 'platform:raid',
            platform: 'twitch',
            data: { username: 'Raider', viewerCount: 5 }
        });

        return queue.processQueue().then(() => {
            expect(processed).toEqual(['platform:raid', 'chat']);
        });
    });

    it('preserves FIFO ordering for same-priority items', () => {
        const queue = createQueue();
        const processedUsers = [];
        queue.displayItem = createMockFn(async (item) => {
            processedUsers.push(item.data.username);
        });

        queue.addItem({
            type: 'platform:gift',
            platform: 'twitch',
            data: { username: 'Gifter1', giftType: 'bits', giftCount: 1, amount: 100, currency: 'bits' }
        });

        queue.addItem({
            type: 'platform:gift',
            platform: 'twitch',
            data: { username: 'Gifter2', giftType: 'bits', giftCount: 1, amount: 250, currency: 'bits' }
        });

        return queue.processQueue().then(() => {
            expect(processedUsers).toEqual(['Gifter1', 'Gifter2']);
        });
    });
});
