const { describe, it, beforeEach, expect } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { createMockLogger } = require('../../helpers/mock-factories');
const { createRuntimeConstantsFixture } = require('../../helpers/runtime-constants-fixture');
const ChatNotificationRouter = require('../../../src/services/ChatNotificationRouter');

describe('ChatNotificationRouter error handling', () => {
    let mockLogger;
    let runtimeConstants;
    let baseMessage;

    beforeEach(() => {
        mockLogger = createMockLogger();
        runtimeConstants = createRuntimeConstantsFixture();

        baseMessage = {
            message: 'Test message',
            displayName: 'testViewer',
            username: 'testviewer',
            userId: 'test-user-1',
            timestamp: new Date().toISOString()
        };
    });

    const createRuntime = (displayQueueBehavior) => ({
        config: {
            general: { messagesEnabled: true, greetingsEnabled: true },
            tts: { deduplicationEnabled: false },
            twitch: {}
        },
        platformLifecycleService: {
            getPlatformConnectionTime: createMockFn().mockReturnValue(null)
        },
        displayQueue: {
            addItem: displayQueueBehavior
        },
        commandCooldownService: {
            checkUserCooldown: createMockFn().mockReturnValue(true),
            checkGlobalCooldown: createMockFn().mockReturnValue(true),
            updateUserCooldown: createMockFn(),
            updateGlobalCooldown: createMockFn()
        },
        userTrackingService: {
            isFirstMessage: createMockFn().mockReturnValue(false)
        },
        commandParser: {
            getVFXConfig: createMockFn().mockReturnValue(null)
        },
        isFirstMessage: createMockFn().mockReturnValue(false)
    });

    it('handles display queue failures gracefully without crashing', async () => {
        const runtime = createRuntime(createMockFn().mockImplementation(() => {
            throw new Error('queue failure');
        }));

        const router = new ChatNotificationRouter({
            runtime,
            logger: mockLogger,
            runtimeConstants
        });

        await expect(router.handleChatMessage('twitch', baseMessage)).resolves.toBeUndefined();
    });

    it('handles non-Error thrown values without crashing', async () => {
        const runtime = createRuntime(createMockFn().mockImplementation(() => {
            throw 'string failure';
        }));

        const router = new ChatNotificationRouter({
            runtime,
            logger: mockLogger,
            runtimeConstants
        });

        await expect(router.handleChatMessage('twitch', baseMessage)).resolves.toBeUndefined();
    });
});
