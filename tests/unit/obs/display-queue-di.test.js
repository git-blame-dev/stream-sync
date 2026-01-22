const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { createRuntimeConstantsFixture } = require('../../helpers/runtime-constants-fixture');
const { createMockOBSManager } = require('../../helpers/mock-factories');
const { initializeTestLogging } = require('../../helpers/test-setup');
const { DisplayQueue, initializeDisplayQueue } = require('../../../src/obs/display-queue');

initializeTestLogging();

describe('DisplayQueue DI requirements', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    beforeEach(() => {
        initializeTestLogging();
    });

    it('requires an OBS manager in the constructor', () => {
        expect(() => new DisplayQueue(null, {}, {}, null, createRuntimeConstantsFixture())).toThrow(/OBSConnectionManager/);
    });

    it('accepts items when initialized with injected obsManager', () => {
        const mockObsManager = createMockOBSManager('connected');

        const queue = initializeDisplayQueue(mockObsManager, {
            autoProcess: false,
            chat: { sourceName: 'chat', sceneName: 'scene', groupName: 'group', platformLogos: {} },
            notification: { sourceName: 'notification', sceneName: 'scene', groupName: 'group', platformLogos: {} }
        }, {
            PRIORITY_LEVELS: { CHAT: 1 },
            CHAT_MESSAGE_DURATION: 4500
        }, null, createRuntimeConstantsFixture());

        expect(() => queue.addItem({
            type: 'chat',
            platform: 'twitch',
            data: { username: 'TestUser', message: 'Hello' }
        })).not.toThrow();

        expect(queue.queue.length).toBe(1);
    });
});
