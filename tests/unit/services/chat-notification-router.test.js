const { describe, it, beforeEach, expect } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createConfigFixture } = require('../../helpers/config-fixture');
const ChatNotificationRouter = require('../../../src/services/ChatNotificationRouter');
const testClock = require('../../helpers/test-clock');

describe('ChatNotificationRouter', () => {
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
        timestamp: new Date(testClock.now()).toISOString()
    };

    const createRouter = ({ runtime: runtimeOverrides, config = testConfig } = {}) => {
        const baseRuntime = {
            config: {
                general: {
                    messagesEnabled: true,
                    greetingsEnabled: true,
                    cmdCoolDownMs: 60000,
                    heavyCommandCooldownMs: 300000,
                    globalCmdCooldownMs: 45000
                },
                twitch: { greetingsEnabled: true, messagesEnabled: true }
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

        const runtime = { ...baseRuntime, ...runtimeOverrides };

        const router = new ChatNotificationRouter({
            runtime,
            logger: mockLogger,
            config
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

    it('does not queue greeting when platform greetingsEnabled is false', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: { greetingsEnabled: true, messagesEnabled: true },
                    twitch: { greetingsEnabled: false, messagesEnabled: true }
                },
                isFirstMessage: createMockFn().mockReturnValue(true)
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage });

        const queuedItems = runtime.displayQueue.addItem.mock.calls.map(c => c[0]);
        const greetingItem = queuedItems.find((item) => item.type === 'greeting');
        const chatItem = queuedItems.find((item) => item.type === 'chat');

        expect(chatItem).toBeDefined();
        expect(greetingItem).toBeUndefined();
    });

    it('queues command when cooldowns pass', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                commandParser: {
                    getVFXConfig: createMockFn().mockReturnValue({ command: '!testboom' })
                }
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage });

        const queuedItems = runtime.displayQueue.addItem.mock.calls.map(c => c[0]);
        const commandItem = queuedItems.find(item => item.type === 'command');
        expect(commandItem).toBeDefined();
        expect(commandItem.vfxConfig.command).toBe('!testboom');
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

    it('includes VFX data in greeting when vfxCommandService returns VFX config', async () => {
        const greetingVfx = {
            command: '!testgreeting',
            commandKey: 'greetings',
            filename: 'greeting.mp4',
            mediaSource: 'local',
            vfxFilePath: '/vfx/greeting.mp4',
            duration: 5000
        };
        const { router, runtime } = createRouter({
            runtime: {
                isFirstMessage: createMockFn().mockReturnValue(true),
                vfxCommandService: {
                    getVFXConfig: createMockFn().mockResolvedValue(greetingVfx)
                }
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage });

        const queuedItems = runtime.displayQueue.addItem.mock.calls.map(c => c[0]);
        const greetingItem = queuedItems.find(item => item.type === 'greeting');
        expect(greetingItem).toBeDefined();
        expect(greetingItem.vfxConfig.command).toBe('!testgreeting');
    });
});
