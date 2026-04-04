const { describe, expect, beforeEach, it, afterEach } = require('bun:test');
const { restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { createMockOBSManager } = require('../../helpers/mock-factories');
const { initializeTestLogging } = require('../../helpers/test-setup');
const { DisplayQueue, initializeDisplayQueue } = require('../../../src/obs/display-queue.ts');
const { PRIORITY_LEVELS } = require('../../../src/core/constants');

initializeTestLogging();

describe('DisplayQueue DI requirements', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    beforeEach(() => {
        initializeTestLogging();
    });

    it('requires an OBS manager in the constructor', () => {
        expect(() => new DisplayQueue(null, {}, {}, null, {})).toThrow(/OBSConnectionManager/);
    });

    it('accepts items when initialized with injected obsManager', () => {
        const mockObsManager = createMockOBSManager('connected');

        const queue = initializeDisplayQueue(mockObsManager, {
            autoProcess: false,
            chat: { sourceName: 'chat', sceneName: 'scene', groupName: 'group', platformLogos: {} },
            notification: { sourceName: 'notification', sceneName: 'scene', groupName: 'group', platformLogos: {} }
        }, {
            PRIORITY_LEVELS,
            CHAT_MESSAGE_DURATION: 4500
        }, null, {});

        expect(() => queue.addItem({
            type: 'chat',
            platform: 'twitch',
            data: { username: 'test-user', message: 'Hello' }
        })).not.toThrow();

        expect(queue.queue.length).toBe(1);
    });

    it('throws when dependencies throw during construction', () => {
        const mockObsManager = createMockOBSManager('connected');
        const dependencies = {};
        Object.defineProperty(dependencies, 'sourcesManager', {
            get: () => {
                throw new Error('test-injected error');
            }
        });

        expect(() => {
            new DisplayQueue(mockObsManager, { autoProcess: true }, { PRIORITY_LEVELS }, null, dependencies);
        }).toThrow('test-injected error');
    });
});
