const { describe, it, beforeEach, expect } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { createMockLogger } = require('../../helpers/mock-factories');
const { createRuntimeConstantsFixture } = require('../../helpers/runtime-constants-fixture');
const ChatNotificationRouter = require('../../../src/services/ChatNotificationRouter');
const testClock = require('../../helpers/test-clock');

describe('ChatNotificationRouter', () => {
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
        timestamp: new Date(testClock.now()).toISOString()
    };

    const createRouter = (overrides = {}) => {
        const baseRuntime = {
            config: {
                general: {
                    messagesEnabled: true,
                    greetingsEnabled: true,
                    cmdCoolDownMs: 60000,
                    heavyCommandCooldownMs: 300000,
                    globalCmdCooldownMs: 45000
                },
                tts: { deduplicationEnabled: false },
                twitch: {}
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

    it('queues chat messages with correct type and platform', async () => {
        const { router, runtime } = createRouter();

        await router.handleChatMessage('twitch', { ...baseMessage });

        expect(runtime.displayQueue.addItem).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'chat',
                platform: 'twitch'
            })
        );
    });

    it('queues greeting before command for first-time command messages', async () => {
        const commandConfig = { command: '!testboom' };
        const { router, runtime } = createRouter({
            runtime: {
                isFirstMessage: createMockFn().mockReturnValue(true),
                commandParser: {
                    getVFXConfig: createMockFn().mockReturnValue(commandConfig)
                }
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage });

        const calls = runtime.displayQueue.addItem.mock.calls.map(c => c[0].type);
        expect(calls).toContain('greeting');
        expect(calls).toContain('command');
    });

    it('includes userId on queued greeting items for first-time messages', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                isFirstMessage: createMockFn().mockReturnValue(true)
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage });

        const queuedItems = runtime.displayQueue.addItem.mock.calls.map(c => c[0]);
        const greetingItem = queuedItems.find((item) => item.type === 'greeting');

        expect(greetingItem).toBeDefined();
        expect(greetingItem?.data?.userId).toBe(baseMessage.userId);
    });

    it('checks both user and global cooldowns when running commands', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                commandParser: {
                    getVFXConfig: createMockFn().mockReturnValue({ command: '!testboom' })
                }
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage });

        expect(runtime.commandCooldownService.checkUserCooldown).toHaveBeenCalled();
        expect(runtime.commandCooldownService.checkGlobalCooldown).toHaveBeenCalledWith('!testboom', expect.any(Number));
    });

    it('skips old messages prior to platform connection', async () => {
        const connectionTime = testClock.now();
        const { router, runtime } = createRouter({
            runtime: {
                platformLifecycleService: {
                    getPlatformConnectionTime: createMockFn().mockReturnValue(connectionTime)
                }
            }
        });

        await router.handleChatMessage('twitch', {
            ...baseMessage,
            timestamp: new Date(connectionTime - 1000).toISOString()
        });

        expect(runtime.displayQueue.addItem).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'chat' }));
    });

    it('does not skip chat when timestamp is invalid even if connection time exists', async () => {
        const connectionTime = testClock.now();
        const { router, runtime } = createRouter({
            runtime: {
                platformLifecycleService: {
                    getPlatformConnectionTime: createMockFn().mockReturnValue(connectionTime)
                }
            }
        });

        await router.handleChatMessage('twitch', {
            ...baseMessage,
            timestamp: 'invalid-timestamp'
        });

        expect(runtime.displayQueue.addItem).toHaveBeenCalled();
    });

    it('resolves greeting VFX via commandParser helper', async () => {
        const greetingVfx = { vfxCommand: '!testgreeting', media: 'greeting.mp4' };
        const { router, runtime } = createRouter({
            runtime: {
                isFirstMessage: createMockFn().mockReturnValue(true),
                commandParser: {
                    getVFXConfig: createMockFn().mockReturnValue(greetingVfx)
                }
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage });

        expect(runtime.commandParser.getVFXConfig).toHaveBeenCalled();
    });
});
