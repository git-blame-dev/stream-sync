const { describe, it, beforeEach, expect } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createConfigFixture } = require('../../helpers/config-fixture');
const ChatNotificationRouter = require('../../../src/services/ChatNotificationRouter');

describe('ChatNotificationRouter TTS behavior', () => {
    let mockLogger;
    let testConfig;

    beforeEach(() => {
        mockLogger = noOpLogger;
        testConfig = createConfigFixture();
    });

    const baseMessage = {
        message: 'Test message',
        displayName: 'testViewer',
        username: 'testviewer',
        userId: 'test-user-1',
        timestamp: new Date().toISOString()
    };

    const createRouter = ({ runtime: runtimeOverrides, config = testConfig } = {}) => {
        const baseRuntime = {
            config: {
                general: { greetingsEnabled: true, messagesEnabled: true },
                twitch: {}
            },
            displayQueue: {
                addItem: createMockFn()
            },
            platformLifecycleService: {
                getPlatformConnectionTime: createMockFn().mockReturnValue(null)
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
        };

        const runtime = { ...baseRuntime, ...runtimeOverrides };

        const router = new ChatNotificationRouter({
            runtime,
            logger: mockLogger,
            config
        });

        return { router, runtime };
    };

    it('enqueues chat message with expected data structure', async () => {
        const { router, runtime } = createRouter();

        await router.handleChatMessage('tiktok', { ...baseMessage, message: 'test great stream' });

        const queuedChat = runtime.displayQueue.addItem.mock.calls.map(c => c[0]).find(i => i.type === 'chat');
        expect(queuedChat).toBeDefined();
        expect(queuedChat.data.message).toBe('test great stream');
    });

    it('enqueues valid chat messages', async () => {
        const { router, runtime } = createRouter();

        await router.handleChatMessage('tiktok', { ...baseMessage, message: 'test cheer100' });

        const queuedChat = runtime.displayQueue.addItem.mock.calls.map(c => c[0]).find(i => i.type === 'chat');
        expect(queuedChat).toBeDefined();
    });
});
