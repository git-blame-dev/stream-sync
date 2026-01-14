const { describe, it, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, clearAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

mockModule('../../../src/utils/chat-logger', () => ({
    logChatMessageWithConfig: createMockFn(),
    logChatMessageSkipped: createMockFn()
}));

mockModule('../../../src/utils/monetization-detector', () => ({
    detectMonetization: createMockFn().mockReturnValue({ detected: false, timingMs: 1 })
}));

mockModule('../../../src/utils/message-normalization', () => ({
    validateNormalizedMessage: createMockFn().mockReturnValue({ isValid: true })
}));

mockModule('../../../src/utils/notification-builder', () => ({
    build: createMockFn((data) => data)
}));

const ChatNotificationRouter = require('../../../src/services/ChatNotificationRouter');
const NotificationBuilder = require('../../../src/utils/notification-builder');
const { createRuntimeConstantsFixture } = require('../../helpers/runtime-constants-fixture');
const testClock = require('../../helpers/test-clock');

describe('ChatNotificationRouter', () => {
    const baseMessage = {
        message: 'Hello world',
        displayName: 'Viewer',
        username: 'viewer',
        userId: 'user-1',
        timestamp: new Date(testClock.now()).toISOString()
    };

    beforeEach(() => {
        clearAllMocks();
        NotificationBuilder.build.mockImplementation((data) => data);
    });

    afterEach(() => {
        restoreAllModuleMocks();
    });

    const createRouter = (overrides = {}) => {
        const runtimeConstants = overrides.runtimeConstants || createRuntimeConstantsFixture();
        const baseAppRuntime = {
            config: {
                general: {
                    greetingsEnabled: true,
                    cmdCoolDownMs: 60000,
                    heavyCommandCooldownMs: 300000,
                    globalCmdCooldownMs: 45000
                },
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
            gracefulExitService: null,
            commandParser: {
                getVFXConfig: createMockFn().mockReturnValue(null)
            },
            vfxService: null,
            isFirstMessage: createMockFn().mockReturnValue(false)
        };
        const runtime = Object.assign({}, baseAppRuntime, overrides.runtime || {});
        const logger = overrides.logger || {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };
        const router = new ChatNotificationRouter({
            runtime,
            logger,
            runtimeConstants
        });

        return { router, runtime, logger, runtimeConstants };
    };

    it('queues chat messages before any other notifications', async () => {
        const { router, runtime, logger } = createRouter();

        await router.handleChatMessage('twitch', { ...baseMessage });
        expect(logger.error).not.toHaveBeenCalled();
        expect(runtime.displayQueue.addItem).toHaveBeenCalled();
        expect(runtime.displayQueue.addItem).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'chat',
                platform: 'twitch'
            })
        );
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('queues greeting before command for first-time command messages', async () => {
        const commandConfig = { command: '!boom' };
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
        expect(calls.slice(0, 3)).toEqual(['chat', 'greeting', 'command']);
    });

    it('includes userId on queued greeting items for first-time messages', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                isFirstMessage: createMockFn().mockReturnValue(true)
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage });

        const queuedItems = runtime.displayQueue.addItem.mock.calls.map(c => c[0]);
        const chatItem = queuedItems.find((item) => item.type === 'chat');
        const greetingItem = queuedItems.find((item) => item.type === 'greeting');

        expect(queuedItems.map((item) => item.type)).toContain('greeting');
        expect(chatItem && chatItem.data ? chatItem.data.userId : undefined).toBe(baseMessage.userId);
        expect(greetingItem).toBeDefined();
        expect(greetingItem && greetingItem.data ? greetingItem.data.userId : undefined).toBe(baseMessage.userId);
    });

    it('checks both user and global cooldowns when running commands', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                commandParser: {
                    getVFXConfig: createMockFn().mockReturnValue({ command: '!boom' })
                }
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage });

        expect(runtime.commandCooldownService.checkUserCooldown).toHaveBeenCalled();
        expect(runtime.commandCooldownService.checkGlobalCooldown).toHaveBeenCalledWith('!boom', expect.any(Number));
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
            timestamp: 'not-a-date'
        });

        expect(runtime.displayQueue.addItem).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat' }));
    });

    it('resolves greeting VFX via vfxCommandService helper', async () => {
        const greetingConfig = {
            commandKey: 'greetings',
            command: '!hello',
            filename: 'hello.mp4',
            mediaSource: 'greeting-source',
            vfxFilePath: '/tmp/path',
            duration: 5000
        };
        const getVFXConfig = createMockFn().mockResolvedValue(greetingConfig);
        const { router } = createRouter({
            runtime: {
                vfxCommandService: {
                    getVFXConfig
                }
            }
        });

        const resolved = await router.resolveGreetingVFX();

        expect(getVFXConfig).toHaveBeenCalledWith('greetings', null);
        expect(resolved).toEqual(expect.objectContaining({
            commandKey: 'greetings',
            command: '!hello',
            filename: 'hello.mp4',
            mediaSource: 'greeting-source',
            vfxFilePath: '/tmp/path',
            triggerWord: '!hello',
            duration: 5000
        }));
    });

    it('queues command VFX with the original trigger to keep playback working', async () => {
        const commandConfig = {
            command: '!wtf',
            commandKey: 'what-the-hell-is-even-that',
            filename: 'what-the-hell-is-even-that',
            mediaSource: 'vfx bottom green',
            vfxFilePath: '/tmp/path',
            duration: 5000
        };

        const { router, runtime } = createRouter({
            runtime: {
                commandParser: {
                    getVFXConfig: createMockFn().mockReturnValue(commandConfig)
                }
            }
        });

        await router.handleChatMessage('tiktok', { ...baseMessage, message: 'all shinys wtf' });

        const queuedCommand = runtime.displayQueue.addItem.mock.calls
            .map(call => call[0])
            .find(item => item.type === 'command');

        expect(queuedCommand).toBeDefined();
        expect(queuedCommand.vfxConfig).toEqual(expect.objectContaining({
            triggerWord: '!wtf',
            command: '!wtf',
            commandKey: 'what-the-hell-is-even-that',
            filename: 'what-the-hell-is-even-that',
            mediaSource: 'vfx bottom green',
            vfxFilePath: '/tmp/path'
        }));
    });

    it('skips chat messages with empty/whitespace-only content', async () => {
        const { router, runtime } = createRouter();

        await router.handleChatMessage('twitch', { ...baseMessage, message: '   ' });

        expect(runtime.displayQueue.addItem).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'chat' }));
    });

    it('skips non-string messages and logs skip reason', async () => {
        const { router, runtime } = createRouter();
        const { logChatMessageSkipped } = require('../../../src/utils/chat-logger');

        await router.handleChatMessage('twitch', { ...baseMessage, message: 12345 });

        expect(runtime.displayQueue.addItem).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'chat' }));
        expect(logChatMessageSkipped).toHaveBeenCalledWith('twitch', expect.anything(), 'empty message');
    });

    it('requests log truncation when messages exceed configured length', async () => {
        const longMessage = 'a'.repeat(500);
        const { router } = createRouter();
        const { logChatMessageWithConfig } = require('../../../src/utils/chat-logger');

        await router.handleChatMessage('twitch', { ...baseMessage, message: longMessage });

        const logOptions = logChatMessageWithConfig.mock.calls[0][3];
        expect(logOptions).toEqual(expect.objectContaining({ truncateMessage: true, maxMessageLength: 200 }));
    });

    it('marks chat as skipChatTTS when monetization detected', async () => {
        const { router, runtime } = createRouter();
        const MonetizationDetector = require('../../../src/utils/monetization-detector');
        MonetizationDetector.detectMonetization.mockReturnValue({ detected: true, timingMs: 1 });

        await router.handleChatMessage('tiktok', { ...baseMessage, message: 'cheer100 great stream' });

        const built = require('../../../src/utils/notification-builder').build;
        expect(built).toHaveBeenCalledWith(expect.objectContaining({ skipChatTTS: true }));
        const queuedChat = runtime.displayQueue.addItem.mock.calls.map(c => c[0]).find(i => i.type === 'chat');
        expect(queuedChat).toBeDefined();
    });

    it('sanitizes chat message content before queuing and TTS', async () => {
        const { router, runtime } = createRouter();
        const dirtyMessage = ' <b>Hello</b>\u200b<script>alert(1)</script> ';

        await router.handleChatMessage('tiktok', { ...baseMessage, message: dirtyMessage });

        const queueCalls = runtime.displayQueue.addItem.mock.calls.map(c => c[0]);
        expect(queueCalls.length).toBeGreaterThan(0);
        const queuedChat = queueCalls.find(i => i.type === 'chat');
        expect(queuedChat).toBeDefined();
        expect(queuedChat.data.message).toBe('Hello alert(1)');
    });

    it('skips chat queuing when sanitization removes all visible content', async () => {
        const { router, runtime } = createRouter();
        const { logChatMessageSkipped } = require('../../../src/utils/chat-logger');

        await router.handleChatMessage('twitch', { ...baseMessage, message: '\u200b<script></script>' });

        expect(runtime.displayQueue.addItem).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'chat' }));
        expect(logChatMessageSkipped).toHaveBeenCalledWith(
            'twitch',
            expect.anything(),
            'empty after sanitization'
        );
    });

    it('respects global messagesEnabled config toggle', async () => {
        const displayQueue = { addItem: createMockFn() };
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: { messagesEnabled: false }
                },
                displayQueue
            }
        });
        const { logChatMessageSkipped } = require('../../../src/utils/chat-logger');

        await router.handleChatMessage('tiktok', { ...baseMessage });

        expect(runtime.displayQueue.addItem).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'chat' }));
        expect(logChatMessageSkipped).toHaveBeenCalledWith('tiktok', expect.anything(), 'messages disabled');
    });

    it('respects per-platform messagesEnabled toggle overriding global', async () => {
        const displayQueue = { addItem: createMockFn() };
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: { messagesEnabled: true },
                    twitch: { messagesEnabled: false }
                },
                displayQueue
            }
        });
        const { logChatMessageSkipped } = require('../../../src/utils/chat-logger');

        await router.handleChatMessage('twitch', { ...baseMessage });

        expect(runtime.displayQueue.addItem).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'chat' }));
        expect(logChatMessageSkipped).toHaveBeenCalledWith('twitch', expect.anything(), 'messages disabled');
    });

    it('does not perform deduplication when tts.deduplicationEnabled is false', async () => {
        const displayQueue = { addItem: createMockFn() };
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: { greetingsEnabled: true, messagesEnabled: true },
                    tts: { deduplicationEnabled: false }
                },
                displayQueue
            }
        });
        const MonetizationDetector = require('../../../src/utils/monetization-detector');
        MonetizationDetector.detectMonetization.mockReturnValue({ detected: true, timingMs: 1 });

        await router.handleChatMessage('twitch', { ...baseMessage, message: 'bits100 nice' });

        expect(MonetizationDetector.detectMonetization).not.toHaveBeenCalled();
        const built = require('../../../src/utils/notification-builder').build;
        expect(built).toHaveBeenCalledWith(expect.not.objectContaining({ skipChatTTS: true }));
    });

    it('triggers graceful exit and skips further processing when threshold hit', async () => {
        const displayQueue = { addItem: createMockFn() };
        const triggerExit = createMockFn();
        const { router } = createRouter({
            runtime: {
                displayQueue,
                gracefulExitService: {
                    isEnabled: () => true,
                    incrementMessageCount: () => true,
                    triggerExit
                },
                commandParser: { getVFXConfig: createMockFn().mockReturnValue(null) }
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage });

        expect(triggerExit).toHaveBeenCalled();
        expect(displayQueue.addItem).not.toHaveBeenCalled();
    });

    it('continues processing when graceful exit threshold not reached', async () => {
        const displayQueue = { addItem: createMockFn() };
        const triggerExit = createMockFn();
        const { router } = createRouter({
            runtime: {
                displayQueue,
                gracefulExitService: {
                    isEnabled: () => true,
                    incrementMessageCount: () => false,
                    triggerExit
                },
                commandParser: { getVFXConfig: createMockFn().mockReturnValue(null) }
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage });

        expect(triggerExit).not.toHaveBeenCalled();
        expect(displayQueue.addItem).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat' }));
    });

    it('logs validation issues but continues processing chat', async () => {
        const validator = require('../../../src/utils/message-normalization');
        validator.validateNormalizedMessage.mockReturnValueOnce({ isValid: false, issues: ['bad'] });
        const { router, runtime, logger } = createRouter();

        await router.handleChatMessage('twitch', { ...baseMessage });

        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid normalized message from twitch'), 'chat-router', expect.any(Object));
        expect(runtime.displayQueue.addItem).toHaveBeenCalled();
    });

    it('includes validation issues in skip log when message invalid and empty after sanitize', async () => {
        const validator = require('../../../src/utils/message-normalization');
        validator.validateNormalizedMessage.mockReturnValueOnce({ isValid: false, issues: ['missing text'] });
        const { router } = createRouter();
        const { logChatMessageSkipped } = require('../../../src/utils/chat-logger');

        await router.handleChatMessage('twitch', { ...baseMessage, message: '   ' });

        expect(logChatMessageSkipped).toHaveBeenCalledWith(
            'twitch',
            expect.objectContaining({ platform: 'twitch' }),
            'empty message'
        );
    });

    it('warns and skips command processing when CommandCooldownService is missing', async () => {
        const logger = {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };
        const { router, runtime } = createRouter({
            runtime: {
                commandCooldownService: null,
                vfxCommandService: {
                    selectVFXCommand: createMockFn().mockResolvedValue({ command: '!cmd' })
                }
            },
            logger
        });

        await router.handleChatMessage('twitch', { ...baseMessage, message: '!cmd' });

        expect(logger.warn).toHaveBeenCalledWith('CommandCooldownService not available; cannot process command', 'chat-router');
        expect(runtime.displayQueue.addItem).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat' }));
    });

    it('uses platform greetings override to skip greeting when disabled', async () => {
        const displayQueue = { addItem: createMockFn() };
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: { greetingsEnabled: true, messagesEnabled: true },
                    twitch: { greetingsEnabled: false }
                },
                displayQueue,
                isFirstMessage: createMockFn().mockReturnValue(true)
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage });

        const types = runtime.displayQueue.addItem.mock.calls.map(c => c[0].type);
        expect(types).toEqual(['chat']);
    });

    it('uses platform greetings override to allow greeting when global disabled', async () => {
        const displayQueue = { addItem: createMockFn() };
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: { greetingsEnabled: false, messagesEnabled: true },
                    twitch: { greetingsEnabled: true }
                },
                displayQueue,
                isFirstMessage: createMockFn().mockReturnValue(true)
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage });

        const types = runtime.displayQueue.addItem.mock.calls.map(c => c[0].type);
        expect(types).toEqual(['chat', 'greeting']);
    });

    it('does not enqueue greeting when messages are disabled even if greetings enabled', async () => {
        const displayQueue = { addItem: createMockFn() };
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: { messagesEnabled: false, greetingsEnabled: true }
                },
                displayQueue,
                isFirstMessage: createMockFn().mockReturnValue(true)
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage });

        expect(runtime.displayQueue.addItem).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'greeting' }));
    });

    it('keeps chat TTS skipped when monetization detected even if greetings enqueue', async () => {
        const MonetizationDetector = require('../../../src/utils/monetization-detector');
        MonetizationDetector.detectMonetization.mockReturnValue({ detected: true, timingMs: 1 });
        const displayQueue = { addItem: createMockFn() };
        const { router, runtime } = createRouter({
            runtime: {
                displayQueue,
                isFirstMessage: createMockFn().mockReturnValue(true)
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage, message: 'cheer100 hi' });

        const queued = runtime.displayQueue.addItem.mock.calls.map(c => c[0]);
        const chatItem = queued.find((item) => item.type === 'chat');
        const greetingItem = queued.find((item) => item.type === 'greeting');

        expect(chatItem).toBeDefined();
        expect(chatItem.data.skipChatTTS).toBe(true);
        expect(greetingItem).toBeDefined();
    });

    it('does not skip old messages when filterOldMessages is disabled', async () => {
        const displayQueue = { addItem: createMockFn() };
        const connectionTime = testClock.now();
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: { messagesEnabled: true, filterOldMessages: false }
                },
                displayQueue,
                platformLifecycleService: {
                    getPlatformConnectionTime: createMockFn().mockReturnValue(connectionTime)
                }
            }
        });

        await router.handleChatMessage('twitch', {
            ...baseMessage,
            timestamp: new Date(connectionTime - 1000).toISOString()
        });

        expect(runtime.displayQueue.addItem).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat' }));
    });

    it('processes old messages when platformLifecycleService is missing', async () => {
        const displayQueue = { addItem: createMockFn() };
        const { router, runtime } = createRouter({
            runtime: {
                config: { general: { messagesEnabled: true } },
                displayQueue,
                platformLifecycleService: null
            }
        });

        await router.handleChatMessage('twitch', {
            ...baseMessage,
            timestamp: new Date(testClock.now() - 100000).toISOString()
        });

        expect(runtime.displayQueue.addItem).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat' }));
    });

    it('skips command processing when per-user cooldown blocks', async () => {
        const displayQueue = { addItem: createMockFn() };
        const { router, runtime, logger } = createRouter({
            runtime: {
                displayQueue,
                commandParser: { getVFXConfig: createMockFn().mockReturnValue({ command: '!boom' }) },
                commandCooldownService: {
                    checkUserCooldown: createMockFn().mockReturnValue(false),
                    checkGlobalCooldown: createMockFn(),
                    updateUserCooldown: createMockFn(),
                    updateGlobalCooldown: createMockFn()
                }
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage, message: '!boom' });

        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('viewer tried to use !boom but is on per-user cooldown'),
            'twitch'
        );
        const types = displayQueue.addItem.mock.calls.map(c => c[0].type);
        expect(types).toEqual(['chat']);
        expect(runtime.commandCooldownService.checkGlobalCooldown).not.toHaveBeenCalled();
    });

    it('skips command processing when global cooldown blocks', async () => {
        const displayQueue = { addItem: createMockFn() };
        const { router, runtime, logger } = createRouter({
            runtime: {
                displayQueue,
                commandParser: { getVFXConfig: createMockFn().mockReturnValue({ command: '!boom' }) },
                commandCooldownService: {
                    checkUserCooldown: createMockFn().mockReturnValue(true),
                    checkGlobalCooldown: createMockFn().mockReturnValue(false),
                    updateUserCooldown: createMockFn(),
                    updateGlobalCooldown: createMockFn()
                }
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage, message: '!boom' });

        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('viewer tried to use !boom but is on global cooldown'),
            'twitch'
        );
        const types = displayQueue.addItem.mock.calls.map(c => c[0].type);
        expect(types).toEqual(['chat']);
        expect(runtime.commandCooldownService.updateUserCooldown).not.toHaveBeenCalled();
    });

    it('uses commandParser for commands when vfxCommandService is unavailable', async () => {
        const displayQueue = { addItem: createMockFn() };
        const commandConfig = { command: '!hey' };
        const { router, runtime } = createRouter({
            runtime: {
                displayQueue,
                vfxCommandService: null,
                commandParser: {
                    getVFXConfig: createMockFn().mockReturnValue(commandConfig)
                }
            }
        });

        await router.handleChatMessage('tiktok', { ...baseMessage, message: '!hey' });

        const types = displayQueue.addItem.mock.calls.map(c => c[0].type);
        expect(types).toContain('command');
        expect(runtime.commandParser.getVFXConfig).toHaveBeenCalledWith('!hey', '!hey');
    });

    it('does not enqueue command when no parser or vfxCommandService is available', async () => {
        const displayQueue = { addItem: createMockFn() };
        const { router, runtime } = createRouter({
            runtime: {
                displayQueue,
                vfxCommandService: null,
                commandParser: null
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage, message: '!missing' });

        const types = displayQueue.addItem.mock.calls.map(c => c[0].type);
        expect(types).toEqual(['chat']);
    });

    it('queues chat without command when parser returns null and vfxCommandService is unavailable', async () => {
        const displayQueue = { addItem: createMockFn() };
        const { router, runtime } = createRouter({
            runtime: {
                displayQueue,
                vfxCommandService: null,
                commandParser: {
                    getVFXConfig: createMockFn().mockReturnValue(null)
                }
            }
        });

        await router.handleChatMessage('tiktok', { ...baseMessage, message: '!unknown' });

        const types = displayQueue.addItem.mock.calls.map(c => c[0].type);
        expect(types).toEqual(['chat']);
        expect(runtime.commandParser.getVFXConfig).toHaveBeenCalledWith('!unknown', '!unknown');
    });

    it('updates user and global cooldowns when command is processed', async () => {
        const displayQueue = { addItem: createMockFn() };
        const { router, runtime } = createRouter({
            runtime: {
                displayQueue,
                commandParser: {
                    getVFXConfig: createMockFn().mockReturnValue({ command: '!run' })
                },
                commandCooldownService: {
                    checkUserCooldown: createMockFn().mockReturnValue(true),
                    checkGlobalCooldown: createMockFn().mockReturnValue(true),
                    updateUserCooldown: createMockFn(),
                    updateGlobalCooldown: createMockFn()
                }
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage, message: '!run' });

        expect(runtime.commandCooldownService.updateUserCooldown).toHaveBeenCalledWith('user-1');
        expect(runtime.commandCooldownService.updateGlobalCooldown).toHaveBeenCalledWith('!run');
        const types = displayQueue.addItem.mock.calls.map(c => c[0].type);
        expect(types).toContain('command');
    });

    it('queues chat even when username/displayName are missing', async () => {
        const displayQueue = { addItem: createMockFn() };
        const { router } = createRouter({
            runtime: {
                displayQueue
            }
        });

        await router.handleChatMessage('tiktok', { message: 'hi', userId: 'id-1' });

        const queued = displayQueue.addItem.mock.calls.map(c => c[0]).find((i) => i.type === 'chat');
        expect(queued.data.username).toBeUndefined();
    });

    it('processes commands via vfxCommandService when usernames are missing', async () => {
        const displayQueue = { addItem: createMockFn() };
        const logger = { debug: createMockFn(), info: createMockFn(), warn: createMockFn(), error: createMockFn() };
        const selectVFXCommand = createMockFn((command, contextMessage) => {
            if (typeof contextMessage !== 'string') {
                throw new Error('context required');
            }
            if (command !== '!hi') {
                return null;
            }
            return { command: '!hi' };
        });
        const { router } = createRouter({
            runtime: {
                displayQueue,
                vfxCommandService: {
                    selectVFXCommand
                }
            },
            logger
        });

        await router.handleChatMessage('tiktok', { message: '!hi now', userId: 'id-1' });

        const types = displayQueue.addItem.mock.calls.map(c => c[0].type);
        expect(types).toContain('command');
        expect(logger.error).not.toHaveBeenCalled();
    });
    it('continues processing when displayQueue is missing', async () => {
        const { router } = createRouter({
            runtime: {
                displayQueue: null,
                commandParser: { getVFXConfig: createMockFn().mockReturnValue(null) }
            }
        });
        const { logChatMessageWithConfig } = require('../../../src/utils/chat-logger');

        await expect(router.handleChatMessage('twitch', { ...baseMessage })).resolves.toBeUndefined();
        expect(logChatMessageWithConfig).toHaveBeenCalled();
    });

    it('handles missing config safely and still processes chat', async () => {
        const displayQueue = { addItem: createMockFn() };
        const { router, runtime } = createRouter({
            runtime: {
                config: null,
                displayQueue
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage });

        expect(displayQueue.addItem).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat' }));
    });

    it('warns when displayQueue addItem throws', async () => {
        const addItem = createMockFn(() => { throw new Error('queue failed'); });
        const logger = { debug: createMockFn(), info: createMockFn(), warn: createMockFn(), error: createMockFn() };
        const { router } = createRouter({
            runtime: {
                displayQueue: { addItem },
                commandParser: { getVFXConfig: createMockFn().mockReturnValue(null) }
            },
            logger
        });

        await expect(router.handleChatMessage('twitch', { ...baseMessage })).resolves.toBeUndefined();
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('queue failed'), 'chat-router', expect.any(Object));
    });

    it('logs monetization detection warnings when detection throws', async () => {
        const MonetizationDetector = require('../../../src/utils/monetization-detector');
        MonetizationDetector.detectMonetization.mockImplementation(() => {
            throw new Error('detect fail');
        });
        const logger = { debug: createMockFn(), info: createMockFn(), warn: createMockFn(), error: createMockFn() };
        const { router, runtime } = createRouter({
            runtime: {
                commandParser: { getVFXConfig: createMockFn().mockReturnValue(null) }
            },
            logger
        });

        await router.handleChatMessage('twitch', { ...baseMessage, message: 'cheer100 hi' });

        expect(logger.error).toHaveBeenCalledWith(
            'Monetization detection error - continuing without deduplication',
            'chat-router',
            expect.objectContaining({ eventType: 'monetization' })
        );
        const queued = runtime.displayQueue.addItem.mock.calls.map(c => c[0]).find((i) => i.type === 'chat');
        expect(queued).toBeDefined();
    });

    it('continues when vfxCommandService selectVFXCommand rejects', async () => {
        const displayQueue = { addItem: createMockFn() };
        const logger = { debug: createMockFn(), info: createMockFn(), warn: createMockFn(), error: createMockFn() };
        const { router, runtime } = createRouter({
            runtime: {
                displayQueue,
                vfxCommandService: {
                    selectVFXCommand: createMockFn().mockRejectedValue(new Error('select failed'))
                }
            },
            logger
        });

        await router.handleChatMessage('twitch', { ...baseMessage, message: '!cmd' });

        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining('select failed'),
            'chat-router',
            expect.objectContaining({ eventType: 'chat-routing' })
        );
        expect(displayQueue.addItem).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat' }));
        const types = displayQueue.addItem.mock.calls.map(c => c[0].type);
        expect(types).not.toContain('command');
    });

    it('continues when commandParser getVFXConfig throws', async () => {
        const displayQueue = { addItem: createMockFn() };
        const logger = { debug: createMockFn(), info: createMockFn(), warn: createMockFn(), error: createMockFn() };
        const { router, runtime } = createRouter({
            runtime: {
                displayQueue,
                vfxCommandService: null,
                commandParser: {
                    getVFXConfig: createMockFn(() => { throw new Error('parser failed'); })
                }
            },
            logger
        });

        await router.handleChatMessage('twitch', { ...baseMessage, message: '!cmd' });

        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining('parser failed'),
            'chat-router',
            expect.objectContaining({ eventType: 'chat-routing' })
        );
        expect(displayQueue.addItem).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat' }));
        const types = displayQueue.addItem.mock.calls.map(c => c[0].type);
        expect(types).not.toContain('command');
    });
});
