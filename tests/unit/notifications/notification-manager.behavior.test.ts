const { describe, expect, it, beforeEach, afterEach } = require('bun:test');
export {};
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createConfigFixture } = require('../../helpers/config-fixture');
const { PRIORITY_LEVELS } = require('../../../src/core/constants');

const NotificationManager = require('../../../src/notifications/NotificationManager');

describe('NotificationManager behavior', () => {
    let originalNodeEnv;

    beforeEach(() => {
        originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'test';
    });

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        restoreAllMocks();
    });

    const createDeps = (overrides = {}) => ({
        logger: noOpLogger,
        displayQueue: { enqueue: createMockFn(), addItem: createMockFn(), getQueueLength: createMockFn(() => 0) },
        eventBus: { on: createMockFn(), emit: createMockFn(), subscribe: createMockFn() },
        config: createConfigFixture(),
        constants: {
            PRIORITY_LEVELS,
            NOTIFICATION_CONFIGS: { follow: { settingKey: 'followsEnabled', commandKey: 'follows' } }
        },
        textProcessing: { formatChatMessage: createMockFn() },
        obsGoals: { processDonationGoal: createMockFn() },
        ...overrides
    });

    it('throws when logger dependency is missing', () => {
        expect(() => new NotificationManager({})).toThrow('logger dependency');
    });

    it('throws when constants dependency is missing', () => {
        const deps = createDeps({ constants: undefined });
        expect(() => new NotificationManager(deps)).toThrow('constants dependency');
    });

    it('throws when config dependency is missing', () => {
        const deps = createDeps({ config: null });
        expect(() => new NotificationManager(deps)).toThrow('config');
    });

    it('throws when displayQueue dependency is missing', () => {
        const deps = createDeps({ displayQueue: null });
        expect(() => new NotificationManager(deps)).toThrow('displayQueue dependency');
    });

    it('throws when eventBus dependency is missing', () => {
        const deps = createDeps({ eventBus: null });
        expect(() => new NotificationManager(deps)).toThrow('EventBus dependency');
    });

    it('initializes with valid dependencies', () => {
        const deps = createDeps();
        const manager = new NotificationManager(deps);
        expect(manager).toBeInstanceOf(NotificationManager);
        expect(manager.displayQueue).toBe(deps.displayQueue);
        expect(manager.config).toBe(deps.config);
    });
});
