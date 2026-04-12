const { describe, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { createMockOBSManager } = require('../../helpers/mock-factories');
const { initializeTestLogging } = require('../../helpers/test-setup');
const { DisplayQueue, initializeDisplayQueue, resetDisplayQueue } = require('../../../src/obs/display-queue.ts');
const { PRIORITY_LEVELS } = require('../../../src/core/constants');

initializeTestLogging();

describe('DisplayQueue DI requirements', () => {
    afterEach(() => {
        restoreAllMocks();
        resetDisplayQueue();
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

    it('passes initializeDisplayQueue dependencies through to DisplayQueue construction', () => {
        const mockObsManager = createMockOBSManager('connected');
        const injectedSourcesManager = {
            updateTextSource: createMockFn().mockResolvedValue(),
            clearTextSource: createMockFn().mockResolvedValue(),
            setSourceVisibility: createMockFn().mockResolvedValue(),
            setChatDisplayVisibility: createMockFn().mockResolvedValue(),
            setNotificationDisplayVisibility: createMockFn().mockResolvedValue(),
            setPlatformLogoVisibility: createMockFn().mockResolvedValue(),
            setNotificationPlatformLogoVisibility: createMockFn().mockResolvedValue()
        };
        const injectedGoalsManager = {
            initializeGoalDisplay: createMockFn().mockResolvedValue(),
            updateAllGoalDisplays: createMockFn().mockResolvedValue(),
            updateGoalDisplay: createMockFn().mockResolvedValue(),
            processDonationGoal: createMockFn().mockResolvedValue({ success: true }),
            processPaypiggyGoal: createMockFn().mockResolvedValue({ success: true }),
            getCurrentGoalStatus: createMockFn().mockReturnValue(null),
            getAllCurrentGoalStatuses: createMockFn().mockReturnValue({})
        };

        const queue = initializeDisplayQueue(
            mockObsManager,
            {
                autoProcess: false,
                chat: { sourceName: 'chat', sceneName: 'scene', groupName: 'group', platformLogos: {} },
                notification: { sourceName: 'notification', sceneName: 'scene', groupName: 'group', platformLogos: {} }
            },
            { PRIORITY_LEVELS, CHAT_MESSAGE_DURATION: 4500 },
            null,
            {
                sourcesManager: injectedSourcesManager,
                goalsManager: injectedGoalsManager
            }
        );

        expect(queue.sourcesManager).toBe(injectedSourcesManager);
        expect(queue.goalsManager).toBe(injectedGoalsManager);
    });

    it('rebinds obs manager on repeated initializeDisplayQueue calls', () => {
        const firstManager = createMockOBSManager('connected');
        const secondManager = createMockOBSManager('connected');

        const queue = initializeDisplayQueue(
            firstManager,
            {
                autoProcess: false,
                chat: { sourceName: 'chat', sceneName: 'scene', groupName: 'group', platformLogos: {} },
                notification: { sourceName: 'notification', sceneName: 'scene', groupName: 'group', platformLogos: {} }
            },
            { PRIORITY_LEVELS, CHAT_MESSAGE_DURATION: 4500 },
            null,
            {}
        );

        initializeDisplayQueue(
            secondManager,
            {
                autoProcess: false,
                chat: { sourceName: 'chat', sceneName: 'scene', groupName: 'group', platformLogos: {} },
                notification: { sourceName: 'notification', sceneName: 'scene', groupName: 'group', platformLogos: {} }
            },
            { PRIORITY_LEVELS, CHAT_MESSAGE_DURATION: 4500 },
            null,
            {}
        );

        expect(queue.obsManager).toBe(secondManager);
    });

    it('supports resetting display queue singleton between initializations', () => {
        const manager = createMockOBSManager('connected');
        const first = initializeDisplayQueue(
            manager,
            {
                autoProcess: false,
                chat: { sourceName: 'chat', sceneName: 'scene', groupName: 'group', platformLogos: {} },
                notification: { sourceName: 'notification', sceneName: 'scene', groupName: 'group', platformLogos: {} }
            },
            { PRIORITY_LEVELS, CHAT_MESSAGE_DURATION: 4500 },
            null,
            {}
        );

        resetDisplayQueue();

        const second = initializeDisplayQueue(
            manager,
            {
                autoProcess: false,
                chat: { sourceName: 'chat', sceneName: 'scene', groupName: 'group', platformLogos: {} },
                notification: { sourceName: 'notification', sceneName: 'scene', groupName: 'group', platformLogos: {} }
            },
            { PRIORITY_LEVELS, CHAT_MESSAGE_DURATION: 4500 },
            null,
            {}
        );

        expect(second).not.toBe(first);
    });
});
