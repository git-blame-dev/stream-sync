const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createConfigFixture } = require('../../helpers/config-fixture');

const NotificationManager = require('../../../src/notifications/NotificationManager');
const constants = require('../../../src/core/constants');

describe('NotificationManager error handling', () => {
    let manager;
    let mockDisplayQueue;
    let mockEventBus;

    beforeEach(() => {
        mockDisplayQueue = {
            addItem: createMockFn(),
            addToQueue: createMockFn(),
            processQueue: createMockFn(),
            isQueueEmpty: createMockFn().mockReturnValue(true),
            clearQueue: createMockFn()
        };

        mockEventBus = {
            emit: createMockFn(),
            on: createMockFn(),
            off: createMockFn()
        };

        manager = new NotificationManager({
            logger: noOpLogger,
            displayQueue: mockDisplayQueue,
            eventBus: mockEventBus,
            constants,
            textProcessing: { formatChatMessage: createMockFn() },
            obsGoals: { processDonationGoal: createMockFn() },
            config: createConfigFixture(),
            vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) }
        });
    });

    afterEach(() => {
        restoreAllMocks();
    });

    test('returns failure result when display queue throws error', async () => {
        mockDisplayQueue.addItem.mockImplementation(() => {
            throw new Error('queue fail');
        });

        const result = await manager.handleNotification('platform:follow', 'tiktok', {
            username: 'testUser',
            userId: 'test-user-id-001'
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Display queue error');
        expect(result.details).toBe('queue fail');
    });

    test('does not emit notification:processed event on display queue failure', async () => {
        mockDisplayQueue.addItem.mockImplementation(() => {
            throw new Error('queue fail');
        });

        await manager.handleNotification('platform:follow', 'tiktok', {
            username: 'testUser',
            userId: 'test-user-id-002'
        });

        const processedEvents = mockEventBus.emit.mock.calls.filter(
            ([event]) => event === 'notification:processed'
        );
        expect(processedEvents).toHaveLength(0);
    });

    test('handles notification successfully when display queue works', async () => {
        mockDisplayQueue.addItem.mockReturnValue(undefined);

        const result = await manager.handleNotification('platform:follow', 'tiktok', {
            username: 'testUser',
            userId: 'test-user-id-003'
        });

        expect(result.success).toBe(true);
        expect(mockDisplayQueue.addItem).toHaveBeenCalled();
    });
});
