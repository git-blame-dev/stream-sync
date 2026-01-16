const { describe, it, beforeEach, expect } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createRuntimeConstantsFixture } = require('../../helpers/runtime-constants-fixture');
const ChatNotificationRouter = require('../../../src/services/ChatNotificationRouter');
const testClock = require('../../helpers/test-clock');

describe('ChatNotificationRouter platform chat behavior', () => {
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
        timestamp: new Date(testClock.now()).toISOString()
    };

    const createRouter = (overrides = {}) => {
        const baseRuntime = {
            config: {
                general: { greetingsEnabled: true, messagesEnabled: true },
                tiktok: { messagesEnabled: true },
                twitch: { messagesEnabled: true },
                youtube: { messagesEnabled: true },
                tts: { deduplicationEnabled: false }
            },
            platformLifecycleService: {
                getPlatformConnectionTime: createMockFn().mockReturnValue(null)
            },
            displayQueue: {
                addItem: createMockFn()
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

    it('queues chat on TikTok when enabled', async () => {
        const { router, runtime } = createRouter();
        await router.handleChatMessage('tiktok', { ...baseMessage, message: 'test ni hao' });

        const queued = runtime.displayQueue.addItem.mock.calls.map((c) => c[0]).find((i) => i.type === 'chat');
        expect(queued).toBeDefined();
        expect(queued.platform).toBe('tiktok');
    });

    it('skips chat on Twitch when messages disabled for platform', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: { messagesEnabled: true },
                    tts: { deduplicationEnabled: false },
                    twitch: { messagesEnabled: false }
                }
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage, message: 'test hi' });

        expect(runtime.displayQueue.addItem).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'chat' }));
    });

    it('sanitizes Twitch chat payload with HTML and enqueues', async () => {
        const { router, runtime } = createRouter();
        await router.handleChatMessage('twitch', { ...baseMessage, message: '<b>Test Hi</b>' });

        const queued = runtime.displayQueue.addItem.mock.calls.map((c) => c[0]).find((i) => i.type === 'chat');
        expect(queued.data.message).toBe('Test Hi');
    });

    it('queues chat on YouTube when enabled', async () => {
        const { router, runtime } = createRouter();

        await router.handleChatMessage('youtube', { ...baseMessage, username: 'testytuser', message: 'test hello youtube' });

        expect(runtime.displayQueue.addItem).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'chat',
                platform: 'youtube',
                data: expect.objectContaining({ message: 'test hello youtube' })
            })
        );
    });

    it('skips chat on YouTube when messages disabled for platform', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: { messagesEnabled: true },
                    tts: { deduplicationEnabled: false },
                    youtube: { messagesEnabled: false }
                }
            }
        });

        await router.handleChatMessage('youtube', { ...baseMessage, message: 'test hello youtube' });

        expect(runtime.displayQueue.addItem).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'chat' }));
    });

    it('skips all platform chat when global messagesEnabled is false', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: { messagesEnabled: false },
                    tts: { deduplicationEnabled: false },
                    tiktok: {},
                    twitch: {},
                    youtube: {}
                }
            }
        });

        await router.handleChatMessage('tiktok', { ...baseMessage, message: 'test blocked globally' });

        expect(runtime.displayQueue.addItem).not.toHaveBeenCalled();
    });

    it('skips chat messages that are only whitespace', async () => {
        const { router, runtime } = createRouter();

        await router.handleChatMessage('tiktok', { ...baseMessage, message: '   ' });

        expect(runtime.displayQueue.addItem).not.toHaveBeenCalled();
    });

    it('skips chat sent before platform connection time', async () => {
        const connectionTime = testClock.now();
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: { messagesEnabled: true, filterOldMessages: true },
                    tts: { deduplicationEnabled: false },
                    tiktok: { messagesEnabled: true }
                },
                platformLifecycleService: {
                    getPlatformConnectionTime: createMockFn().mockReturnValue(connectionTime)
                }
            }
        });

        const oldTimestamp = new Date(connectionTime - 1000).toISOString();
        await router.handleChatMessage('tiktok', { ...baseMessage, message: 'test late arrival', timestamp: oldTimestamp });

        expect(runtime.displayQueue.addItem).not.toHaveBeenCalled();
    });
});
