import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';

import { createMockFn, restoreAllMocks } from '../helpers/bun-mock-utils';

const nodeRequire = createRequire(import.meta.url);

type LoggerLike = {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
};

type FlexibleMock = ReturnType<typeof createMockFn> & {
    mockResolvedValue: (value: unknown) => FlexibleMock;
};

type QueueItem = {
    type: string;
    data: {
        platform: string;
        displayMessage: string;
        ttsMessage: string;
    };
};

type MockDisplayQueue = {
    addItem: FlexibleMock;
};

type CleanupOptions = {
    clearCallsBeforeEach?: boolean;
    validateAfterCleanup?: boolean;
    logPerformanceMetrics?: boolean;
};

const { noOpLogger, createMockDisplayQueue } = nodeRequire('../helpers/mock-factories') as {
    noOpLogger: LoggerLike;
    createMockDisplayQueue: (overrides?: Record<string, unknown>) => MockDisplayQueue;
};
const { setupAutomatedCleanup } = nodeRequire('../helpers/mock-lifecycle') as {
    setupAutomatedCleanup: (options?: CleanupOptions) => void;
};
const { expectNoTechnicalArtifacts } = nodeRequire('../helpers/assertion-helpers') as {
    expectNoTechnicalArtifacts: (value: string) => void;
};
const { createConfigFixture } = nodeRequire('../helpers/config-fixture') as {
    createConfigFixture: (overrides?: Record<string, unknown>) => Record<string, unknown>;
};
const NotificationManager = nodeRequire('../../src/notifications/NotificationManager') as new (deps: Record<string, unknown>) => NotificationManagerInstance;
const { createTextProcessingManager } = nodeRequire('../../src/utils/text-processing') as {
    createTextProcessingManager: (options: { logger: LoggerLike }) => unknown;
};

type NotificationManagerInstance = {
    handleNotification: (type: string, platform: string, data: Record<string, unknown>) => Promise<unknown>;
};

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

describe('Twitch gift subscriptions', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let mockLogger: LoggerLike;
    let mockDisplayQueue: ReturnType<typeof createMockDisplayQueue>;
    let notificationManager: NotificationManagerInstance;

    const createManager = () => {
        const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
        const config = createConfigFixture({
            general: {
                giftsEnabled: true,
                debugEnabled: true,
                
            }
        });
        const constants = nodeRequire('../../src/core/constants') as Record<string, unknown>;
        const textProcessing = createTextProcessingManager({ logger: mockLogger });
        const { getDefaultGoalsManager } = nodeRequire('../../src/obs/goals') as {
            getDefaultGoalsManager: () => unknown;
        };
        const obsGoals = getDefaultGoalsManager();
        const vfxCommandService = { getVFXConfig: (createMockFn() as FlexibleMock).mockResolvedValue(null) };
        return new NotificationManager({
            displayQueue: mockDisplayQueue,
            logger: mockLogger,
            eventBus: mockEventBus,
            config,
            constants,
            textProcessing,
            obsGoals,
            vfxCommandService
        });
    };

    beforeEach(() => {
        mockLogger = noOpLogger;
        mockDisplayQueue = createMockDisplayQueue({ length: 0 });
        notificationManager = createManager();
    });

    it('renders gifter and count in display and TTS output', async () => {
        const twitchGiftPaypiggyData = {
            userId: '123456789',
            username: 'GiftUser',
            displayName: 'GiftUser',
            tier: '1000',
            giftCount: 5,
            cumulativeTotal: 7,
            isAnonymous: false
        };

        const result = await notificationManager.handleNotification('platform:giftpaypiggy', 'twitch', twitchGiftPaypiggyData);

        expect(result).toEqual(expect.objectContaining({ success: true }));
        expect(mockDisplayQueue.addItem).toHaveBeenCalledTimes(1);

        const queueItem = mockDisplayQueue.addItem.mock.calls[0][0] as QueueItem;
        const notificationData = queueItem.data;

        expect(queueItem.type).toBe('platform:giftpaypiggy');
        expect(notificationData.platform).toBe('twitch');
        expect(notificationData.displayMessage).toContain('GiftUser');
        expect(notificationData.displayMessage).toMatch(/gift|sub/i);
        expect(notificationData.displayMessage).toMatch(/5|five/i);
        expect(notificationData.displayMessage).not.toContain('unknown');

        expect(notificationData.ttsMessage).toContain('GiftUser');
        expect(notificationData.ttsMessage).toMatch(/5|five/i);
        expect(notificationData.ttsMessage).toMatch(/gift|sub/i);
        expect(notificationData.ttsMessage).not.toContain('unknown');

        expectNoTechnicalArtifacts(notificationData.displayMessage);
        expectNoTechnicalArtifacts(notificationData.ttsMessage);
    });

    it('avoids placeholders when gift fields are incomplete', async () => {
        const minimalGiftPaypiggyData = {
            userId: '123456789',
            username: 'GiftUser',
            giftCount: 2
        };

        const result = await notificationManager.handleNotification('platform:giftpaypiggy', 'twitch', minimalGiftPaypiggyData);

        expect(result).toEqual(expect.objectContaining({ success: true }));
        expect(mockDisplayQueue.addItem).toHaveBeenCalledTimes(1);

        const queueItem = mockDisplayQueue.addItem.mock.calls[0][0] as QueueItem;
        const notificationData = queueItem.data;

        expect(notificationData.displayMessage).toContain('GiftUser');
        expect(notificationData.displayMessage).toMatch(/2|two/i);
        expect(notificationData.displayMessage).not.toMatch(/\{.*\}/);
        expect(notificationData.displayMessage).not.toContain('undefined');
        expect(notificationData.displayMessage).not.toContain('null');

        expectNoTechnicalArtifacts(notificationData.displayMessage);
    });
});
