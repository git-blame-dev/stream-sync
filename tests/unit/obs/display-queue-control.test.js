const { describe, expect, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { initializeTestLogging } = require('../../helpers/test-setup');

initializeTestLogging();

const { DisplayQueue } = require('../../../src/obs/display-queue');
const { createMockOBSManager } = require('../../helpers/mock-factories');

describe('DisplayQueue control', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const constants = {
        PRIORITY_LEVELS: { CHAT: 1, GIFT: 4, RAID: 6 },
        CHAT_MESSAGE_DURATION: 4500,
        CHAT_TRANSITION_DELAY: 200,
        NOTIFICATION_CLEAR_DELAY: 100
    };

    const createConfig = (overrides = {}) => ({
        autoProcess: false,
        maxQueueSize: 3,
        chat: { sourceName: 'chat', sceneName: 'scene', groupName: 'group', platformLogos: {} },
        notification: { sourceName: 'notification', sceneName: 'scene', groupName: 'group', platformLogos: {} },
        ...overrides
    });

    const createQueue = (configOverrides = {}) => {
        const config = createConfig(configOverrides);
        const queue = new DisplayQueue(createMockOBSManager('connected'), config, constants, null, constants);
        queue.getDuration = createMockFn().mockReturnValue(0);
        return queue;
    };

    describe('platform validation', () => {
        it('rejects items without platform', () => {
            const queue = createQueue();

            expect(() => {
                queue.addItem({ type: 'platform:gift', data: { username: 'testUser' } });
            }).toThrow('platform');
        });
    });

    describe('maxQueueSize enforcement', () => {
        it('rejects items when queue is at maxQueueSize capacity', () => {
            const queue = createQueue({ maxQueueSize: 2 });

            queue.addItem({ type: 'platform:gift', platform: 'twitch', data: { username: 'testUser1', giftType: 'Rose', giftCount: 1, amount: 10, currency: 'coins' } });
            queue.addItem({ type: 'platform:gift', platform: 'twitch', data: { username: 'testUser2', giftType: 'Rose', giftCount: 1, amount: 10, currency: 'coins' } });

            expect(queue.queue.length).toBe(2);

            expect(() => {
                queue.addItem({ type: 'platform:gift', platform: 'twitch', data: { username: 'testUser3', giftType: 'Rose', giftCount: 1, amount: 10, currency: 'coins' } });
            }).toThrow();
        });
    });

    describe('processChatMessage autoProcess respect', () => {
        it('does not auto-process when autoProcess is false', async () => {
            const queue = createQueue({ autoProcess: false });
            let processed = false;
            queue.displayItem = createMockFn(async () => { processed = true; });

            await queue.processChatMessage({
                type: 'chat',
                platform: 'twitch',
                data: { username: 'testUser', message: 'hello' }
            });

            expect(queue.queue.length).toBe(1);
            expect(processed).toBe(false);
        });
    });

    describe('stop() behavior', () => {
        it('clears all state when stopping', async () => {
            const queue = createQueue();
            queue.currentDisplay = { type: 'platform:gift', data: { username: 'testUser' } };
            queue.isProcessing = true;
            queue.queue.push({ type: 'chat', data: { username: 'testUser', message: 'test' } });

            await queue.stop();

            expect(queue.currentDisplay).toBe(null);
            expect(queue.isProcessing).toBe(false);
            expect(queue.queue.length).toBe(0);
        });

        it('aborts active processing loop when stop is called', async () => {
            const queue = createQueue();
            const processed = [];
            let itemCount = 0;

            queue.displayItem = createMockFn(async (item) => {
                processed.push(item.data.username);
                itemCount++;
                if (itemCount === 1) {
                    queue.stop();
                }
            });

            queue.addItem({ type: 'platform:gift', platform: 'twitch', data: { username: 'testUser1', giftType: 'Rose', giftCount: 1, amount: 10, currency: 'coins' } });
            queue.addItem({ type: 'platform:gift', platform: 'twitch', data: { username: 'testUser2', giftType: 'Rose', giftCount: 1, amount: 10, currency: 'coins' } });
            queue.addItem({ type: 'platform:gift', platform: 'twitch', data: { username: 'testUser3', giftType: 'Rose', giftCount: 1, amount: 10, currency: 'coins' } });

            await queue.processQueue();

            expect(processed.length).toBe(1);
        });
    });
});
