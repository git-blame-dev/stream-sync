const { describe, it, beforeEach, expect } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createRuntimeConstantsFixture } = require('../../helpers/runtime-constants-fixture');
const ChatNotificationRouter = require('../../../src/services/ChatNotificationRouter');

describe('ChatNotificationRouter lingering/priority/TTS', () => {
    let mockLogger;
    let runtimeConstants;

    beforeEach(() => {
        mockLogger = noOpLogger;
        runtimeConstants = createRuntimeConstantsFixture();
    });

    const baseMessage = {
        message: 'Test message',
        displayName: 'testViewer',
        username: 'testviewer',
        userId: 'test-user-1',
        timestamp: new Date().toISOString()
    };

    const createRouter = (overrides = {}) => {
        const baseRuntime = {
            config: {
                general: { greetingsEnabled: true, messagesEnabled: true },
                tts: { deduplicationEnabled: false },
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

        const runtime = { ...baseRuntime, ...overrides.runtime };

        const router = new ChatNotificationRouter({
            runtime,
            logger: mockLogger,
            runtimeConstants: overrides.runtimeConstants || runtimeConstants
        });

        return { router, runtime };
    };

    it('queues chat with lower priority than greeting when first message', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                isFirstMessage: createMockFn().mockReturnValue(true)
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage, message: 'test first message' });

        const calls = runtime.displayQueue.addItem.mock.calls.map((c) => c[0]);
        const chatItem = calls.find(c => c.type === 'chat');
        const greetingItem = calls.find(c => c.type === 'greeting');

        expect(chatItem).toBeDefined();
        expect(greetingItem).toBeDefined();
        expect(chatItem.priority || 0).toBeLessThanOrEqual(greetingItem.priority || Infinity);
    });

    it('does not enqueue greeting when platform greeting disabled', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: { greetingsEnabled: true, messagesEnabled: true },
                    tts: { deduplicationEnabled: false },
                    twitch: { greetingsEnabled: false }
                },
                isFirstMessage: createMockFn().mockReturnValue(true)
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage, message: 'test first' });

        const types = runtime.displayQueue.addItem.mock.calls.map((c) => c[0].type);
        expect(types).toContain('chat');
        expect(types).not.toContain('greeting');
    });

    it('always enqueues chat for valid messages', async () => {
        const { router, runtime } = createRouter();

        await router.handleChatMessage('twitch', { ...baseMessage, message: 'test hello' });

        const queuedChat = runtime.displayQueue.addItem.mock.calls.map((c) => c[0]).find((i) => i.type === 'chat');
        expect(queuedChat).toBeDefined();
    });
});
