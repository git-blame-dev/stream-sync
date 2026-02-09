const { describe, expect, it, afterEach } = require('bun:test');
const { restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { createMockOBSForTesting } = require('../../helpers/display-queue-test-factory');

describe('DisplayQueue getQueueLength', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    function createQueue() {
        const mockOBS = createMockOBSForTesting();
        const config = {
            maxQueueSize: 50,
            autoProcess: false,
            timing: { transitionDelay: 100 }
        };
        const { DisplayQueue } = require('../../../src/obs/display-queue');
        const { PRIORITY_LEVELS } = require('../../../src/core/constants');
        return new DisplayQueue(mockOBS, config, { PRIORITY_LEVELS });
    }

    it('returns 0 for an empty queue', () => {
        const queue = createQueue();
        expect(queue.getQueueLength()).toBe(0);
    });

    it('returns the correct count after adding items of different types', () => {
        const queue = createQueue();
        queue.addItem({ type: 'chat', priority: 1, platform: 'tiktok', data: { username: 'test-user', message: 'hello' } });
        queue.addItem({ type: 'platform:gift', priority: 3, platform: 'twitch', data: { username: 'test-user-2', message: 'gift' } });
        expect(queue.getQueueLength()).toBe(2);
    });

    it('returns 0 after clearing the queue', () => {
        const queue = createQueue();
        queue.addItem({ type: 'chat', priority: 1, platform: 'tiktok', data: { username: 'test-user', message: 'hello' } });
        queue.clearQueue();
        expect(queue.getQueueLength()).toBe(0);
    });
});
