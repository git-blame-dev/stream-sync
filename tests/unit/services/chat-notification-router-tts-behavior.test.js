const { describe, it, beforeEach, expect } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { createMockLogger } = require('../../helpers/mock-factories');
const { createRuntimeConstantsFixture } = require('../../helpers/runtime-constants-fixture');
const ChatNotificationRouter = require('../../../src/services/ChatNotificationRouter');

describe('ChatNotificationRouter TTS behavior', () => {
    let mockLogger;
    let runtimeConstants;

    beforeEach(() => {
        mockLogger = createMockLogger();
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

    it('enqueues chat message with expected data structure', async () => {
        const { router, runtime } = createRouter();

        await router.handleChatMessage('tiktok', { ...baseMessage, message: 'test great stream' });

        const queuedChat = runtime.displayQueue.addItem.mock.calls.map(c => c[0]).find(i => i.type === 'chat');
        expect(queuedChat).toBeDefined();
        expect(queuedChat.data.message).toBe('test great stream');
    });

    it('queues chat regardless of TTS deduplication config', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: { greetingsEnabled: true, messagesEnabled: true },
                    tts: { deduplicationEnabled: true },
                    twitch: {}
                }
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage, message: 'test hello there' });

        const queuedChat = runtime.displayQueue.addItem.mock.calls.map(c => c[0]).find(i => i.type === 'chat');
        expect(queuedChat).toBeDefined();
    });

    it('queues chat when TTS deduplication is disabled', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: { greetingsEnabled: true, messagesEnabled: true },
                    tts: { deduplicationEnabled: false },
                    twitch: {}
                }
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage, message: 'test bits 100' });

        const queuedChat = runtime.displayQueue.addItem.mock.calls.map(c => c[0]).find(i => i.type === 'chat');
        expect(queuedChat).toBeDefined();
    });

    it('always enqueues valid chat messages', async () => {
        const { router, runtime } = createRouter();

        await router.handleChatMessage('tiktok', { ...baseMessage, message: 'test cheer100' });

        const queuedChat = runtime.displayQueue.addItem.mock.calls.map(c => c[0]).find(i => i.type === 'chat');
        expect(queuedChat).toBeDefined();
    });
});
