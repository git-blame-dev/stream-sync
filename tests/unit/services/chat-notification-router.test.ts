const { describe, it, beforeEach, expect } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createConfigFixture } = require('../../helpers/config-fixture');
const { ChatNotificationRouter } = require('../../../src/services/ChatNotificationRouter.ts');
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
        username: 'test-user-gamma',
        userId: 'test-user-1',
        timestamp: new Date(testClock.now()).toISOString()
    };

    const createRouter = ({ runtime: runtimeOverrides, config = testConfig } = {}) => {
        const baseRuntime = {
            config: {
                general: {
                    messagesEnabled: true,
                    greetingsEnabled: true
                },
                cooldowns: {
                    cmdCooldownMs: 60000,
                    heavyCommandCooldownMs: 300000,
                    globalCmdCooldownMs: 45000
                },
                farewell: {
                    timeout: 300
                },
                twitch: { greetingsEnabled: true, messagesEnabled: true, farewellsEnabled: true },
                tiktok: { greetingsEnabled: true, messagesEnabled: true, farewellsEnabled: true }
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
            vfxCommandService: {
                selectVFXCommand: createMockFn().mockResolvedValue(null),
                matchFarewell: createMockFn().mockReturnValue(null),
                getVFXConfig: createMockFn().mockResolvedValue(null)
            },
            handleFarewellNotification: async (platform, username, options) => {
                runtime.displayQueue.addItem({
                    type: 'farewell',
                    platform,
                    data: {
                        username,
                        command: options.command,
                        displayMessage: `Goodbye, ${username}!`
                    }
                });
                return { success: true };
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

        expect(runtime.displayQueue.addItem).toHaveBeenCalledTimes(1);
        const [queuedItem] = runtime.displayQueue.addItem.mock.calls[0];
        expect(queuedItem?.type).toBe('chat');
        expect(queuedItem?.platform).toBe('twitch');
    });

    it('preserves canonical avatarUrl on queued chat rows', async () => {
        const { router, runtime } = createRouter();

        await router.handleChatMessage('twitch', {
            ...baseMessage,
            avatarUrl: 'https://example.invalid/chat-avatar.png'
        });

        const queuedItems = runtime.displayQueue.addItem.mock.calls.map((call) => call[0]);
        const chatItem = queuedItems.find((item) => item.type === 'chat');

        expect(chatItem).toBeDefined();
        expect(chatItem?.data?.avatarUrl).toBe('https://example.invalid/chat-avatar.png');
    });

    it('preserves isPaypiggy on queued chat rows', async () => {
        const { router, runtime } = createRouter();

        await router.handleChatMessage('twitch', {
            ...baseMessage,
            isPaypiggy: true
        });

        const queuedItems = runtime.displayQueue.addItem.mock.calls.map((call) => call[0]);
        const chatItem = queuedItems.find((item) => item.type === 'chat');

        expect(chatItem).toBeDefined();
        expect(chatItem?.data?.isPaypiggy).toBe(true);
    });

    it('queues greeting before command for first-time command messages', async () => {
        const commandConfig = { command: '!testboom' };
        const { router, runtime } = createRouter({
            runtime: {
                isFirstMessage: createMockFn().mockReturnValue(true),
                vfxCommandService: {
                    selectVFXCommand: createMockFn().mockResolvedValue(commandConfig),
                    matchFarewell: createMockFn().mockReturnValue(null),
                    getVFXConfig: createMockFn().mockResolvedValue(null)
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

    it('queues greeting when messages are disabled but greetings are enabled', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: { greetingsEnabled: true, messagesEnabled: false },
                    cooldowns: {
                        cmdCooldownMs: 60000,
                        heavyCommandCooldownMs: 300000,
                        globalCmdCooldownMs: 45000
                    },
                    twitch: { greetingsEnabled: true, messagesEnabled: false, farewellsEnabled: true }
                },
                isFirstMessage: createMockFn().mockReturnValue(true)
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage, message: 'hello everyone' });

        const queuedTypes = runtime.displayQueue.addItem.mock.calls.map((call) => call[0].type);
        expect(queuedTypes).toContain('greeting');
        expect(queuedTypes).not.toContain('chat');
    });

    it('queues command when cooldowns pass', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                vfxCommandService: {
                    selectVFXCommand: createMockFn().mockResolvedValue({ command: '!testboom' }),
                    matchFarewell: createMockFn().mockReturnValue(null),
                    getVFXConfig: createMockFn().mockResolvedValue(null)
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

    it('includes secondary VFX config in greeting for mapped greeting profile', async () => {
        const greetingVfx = {
            command: '!hello',
            commandKey: 'greetings',
            filename: 'hello.mp4',
            mediaSource: 'vfx top',
            vfxFilePath: '/vfx',
            duration: 5000
        };
        const secondaryVfx = {
            command: '!bye',
            commandKey: 'bye',
            filename: 'bye.mp4',
            mediaSource: 'vfx bottom green',
            vfxFilePath: '/vfx',
            duration: 5000
        };

        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    ...testConfig,
                    general: {
                        ...testConfig.general,
                        logChatMessages: false
                    },
                    twitch: { greetingsEnabled: true, messagesEnabled: true, farewellsEnabled: true },
                    greetings: {
                        command: '!hello',
                        customVfxProfiles: {
                            'twitch:test-user-gamma': {
                                profileId: 'profileMain',
                                command: '!bye'
                            }
                        }
                    }
                },
                isFirstMessage: createMockFn().mockReturnValue(true),
                vfxCommandService: {
                    getVFXConfig: createMockFn().mockResolvedValue(greetingVfx),
                    selectVFXCommand: createMockFn().mockResolvedValue(secondaryVfx),
                    matchFarewell: createMockFn().mockReturnValue(null)
                }
            }
        });

        await router.handleChatMessage('twitch', {
            ...baseMessage,
            username: 'test-user-gamma'
        });

        const queuedItems = runtime.displayQueue.addItem.mock.calls.map(c => c[0]);
        const greetingItem = queuedItems.find(item => item.type === 'greeting');
        expect(greetingItem).toBeDefined();
        expect(greetingItem.secondaryVfxConfig).toEqual(expect.objectContaining({
            command: '!bye',
            commandKey: 'bye'
        }));
    });

    it('matches youtube greeting profile keys with mixed-case and leading-@ identity input', async () => {
        const greetingVfx = {
            command: '!hello',
            commandKey: 'greetings',
            filename: 'hello.mp4',
            mediaSource: 'vfx top',
            vfxFilePath: '/vfx',
            duration: 5000
        };
        const secondaryVfx = {
            command: '!bye',
            commandKey: 'bye',
            filename: 'bye.mp4',
            mediaSource: 'vfx bottom green',
            vfxFilePath: '/vfx',
            duration: 5000
        };

        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    ...testConfig,
                    general: {
                        ...testConfig.general,
                        logChatMessages: false
                    },
                    youtube: { greetingsEnabled: true, messagesEnabled: true, farewellsEnabled: true },
                    greetings: {
                        command: '!hello',
                        customVfxProfiles: {
                            'youtube:test-user-yt-gamma': {
                                profileId: 'profileMain',
                                command: '!bye'
                            }
                        }
                    }
                },
                isFirstMessage: createMockFn().mockReturnValue(true),
                vfxCommandService: {
                    getVFXConfig: createMockFn().mockResolvedValue(greetingVfx),
                    selectVFXCommand: createMockFn().mockResolvedValue(secondaryVfx),
                    matchFarewell: createMockFn().mockReturnValue(null)
                }
            }
        });

        await router.handleChatMessage('youtube', {
            ...baseMessage,
            username: '@TeSt-UsEr-Yt-GaMmA'
        });

        const queuedItems = runtime.displayQueue.addItem.mock.calls.map((call) => call[0]);
        const greetingItem = queuedItems.find((item) => item.type === 'greeting');
        expect(greetingItem).toBeDefined();
        expect(greetingItem.secondaryVfxConfig).toEqual(expect.objectContaining({
            command: '!bye',
            commandKey: 'bye'
        }));
    });

    it('matches tiktok greeting profiles by userId identity value rather than nickname', async () => {
        const greetingVfx = {
            command: '!hello',
            commandKey: 'greetings',
            filename: 'hello.mp4',
            mediaSource: 'vfx top',
            vfxFilePath: '/vfx',
            duration: 5000
        };
        const secondaryVfx = {
            command: '!bye',
            commandKey: 'bye',
            filename: 'bye.mp4',
            mediaSource: 'vfx bottom green',
            vfxFilePath: '/vfx',
            duration: 5000
        };

        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    ...testConfig,
                    general: {
                        ...testConfig.general,
                        logChatMessages: false
                    },
                    tiktok: { greetingsEnabled: true, messagesEnabled: true, farewellsEnabled: true },
                    greetings: {
                        command: '!hello',
                        customVfxProfiles: {
                            'tiktok:test-unique-id-alpha': {
                                profileId: 'profileMain',
                                command: '!bye'
                            }
                        }
                    }
                },
                isFirstMessage: createMockFn().mockReturnValue(true),
                vfxCommandService: {
                    getVFXConfig: createMockFn().mockResolvedValue(greetingVfx),
                    selectVFXCommand: createMockFn().mockResolvedValue(secondaryVfx),
                    matchFarewell: createMockFn().mockReturnValue(null)
                }
            }
        });

        await router.handleChatMessage('tiktok', {
            ...baseMessage,
            userId: 'TeSt-Unique-Id-Alpha',
            username: 'DifferentNicknameShouldNotKeyMatch'
        });

        const queuedItems = runtime.displayQueue.addItem.mock.calls.map((call) => call[0]);
        const greetingItem = queuedItems.find((item) => item.type === 'greeting');
        expect(greetingItem).toBeDefined();
        expect(greetingItem.secondaryVfxConfig).toEqual(expect.objectContaining({
            command: '!bye',
            commandKey: 'bye'
        }));
    });

    it('greets mapped profile only once across platforms', async () => {
        const trackedFirstMessageKeys = new Set();
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    ...testConfig,
                    general: {
                        ...testConfig.general,
                        logChatMessages: false
                    },
                    twitch: { greetingsEnabled: true, messagesEnabled: true, farewellsEnabled: true },
                    tiktok: { greetingsEnabled: true, messagesEnabled: true, farewellsEnabled: true },
                    greetings: {
                        command: '!hello',
                        customVfxProfiles: {
                            'twitch:test-user-alpha': { profileId: 'profileMain', command: '!bye' },
                            'tiktok:test-user-beta': { profileId: 'profileMain', command: '!bye' }
                        }
                    }
                },
                isFirstMessage: createMockFn().mockImplementation((trackingKey) => {
                    if (trackedFirstMessageKeys.has(trackingKey)) {
                        return false;
                    }
                    trackedFirstMessageKeys.add(trackingKey);
                    return true;
                })
            }
        });

        await router.handleChatMessage('twitch', {
            ...baseMessage,
            username: 'test-user-alpha',
            userId: 'tw-user-1'
        });
        await router.handleChatMessage('tiktok', {
            ...baseMessage,
            username: 'test-user-beta',
            userId: 'test-user-beta'
        });

        const greetingRows = runtime.displayQueue.addItem.mock.calls
            .map((call) => call[0])
            .filter((item) => item.type === 'greeting');

        expect(greetingRows.length).toBe(1);
    });

    it('queues greeting before command for mapped first-time command message', async () => {
        const greetingVfx = {
            command: '!hello',
            commandKey: 'greetings',
            filename: 'hello.mp4',
            mediaSource: 'vfx top',
            vfxFilePath: '/vfx',
            duration: 5000
        };
        const secondaryVfx = {
            command: '!bye',
            commandKey: 'bye',
            filename: 'bye.mp4',
            mediaSource: 'vfx bottom green',
            vfxFilePath: '/vfx',
            duration: 5000
        };
        const commandVfx = { command: '!testboom' };
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    ...testConfig,
                    general: {
                        ...testConfig.general,
                        logChatMessages: false
                    },
                    twitch: { greetingsEnabled: true, messagesEnabled: true, farewellsEnabled: true },
                    greetings: {
                        command: '!hello',
                        customVfxProfiles: {
                            'twitch:test-user-gamma': {
                                profileId: 'profileMain',
                                command: '!bye'
                            }
                        }
                    }
                },
                isFirstMessage: createMockFn().mockReturnValue(true),
                vfxCommandService: {
                    getVFXConfig: createMockFn().mockResolvedValue(greetingVfx),
                    selectVFXCommand: createMockFn((trigger) => {
                        if (trigger === '!bye') {
                            return Promise.resolve(secondaryVfx);
                        }
                        return Promise.resolve(commandVfx);
                    }),
                    matchFarewell: createMockFn().mockReturnValue(null)
                }
            }
        });

        await router.handleChatMessage('twitch', {
            ...baseMessage,
            message: '!testboom hello',
            username: 'test-user-gamma'
        });

        const queuedItems = runtime.displayQueue.addItem.mock.calls.map(c => c[0]);
        const queuedTypes = queuedItems.map((item) => item.type);
        expect(queuedTypes[0]).toBe('chat');
        expect(queuedTypes[1]).toBe('greeting');
        expect(queuedTypes[2]).toBe('command');
        expect(queuedItems[1].secondaryVfxConfig).toEqual(expect.objectContaining({ command: '!bye' }));
    });

    it('routes farewell messages into a user-visible farewell row', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                vfxCommandService: {
                    selectVFXCommand: createMockFn().mockResolvedValue(null),
                    matchFarewell: createMockFn().mockReturnValue('!bye')
                }
            }
        });

        await router.handleChatMessage('twitch', {
            ...baseMessage,
            message: '!bye everyone'
        });

        const queuedTypes = runtime.displayQueue.addItem.mock.calls.map((call) => call[0].type);
        expect(queuedTypes).toContain('chat');
        expect(queuedTypes).toContain('farewell');
    });

    it('does not route commands when only runtime command parser is available', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                vfxCommandService: null,
                commandParser: {
                    getVFXConfig: createMockFn().mockReturnValue({ command: '!testboom' }),
                    getMatchingFarewell: createMockFn().mockReturnValue(null)
                }
            }
        });

        await router.handleChatMessage('twitch', {
            ...baseMessage,
            message: '!testboom now'
        });

        const queuedTypes = runtime.displayQueue.addItem.mock.calls.map((call) => call[0].type);
        expect(queuedTypes).toContain('chat');
        expect(queuedTypes).not.toContain('command');
    });

    it('does not emit farewell rows when farewells are disabled for platform', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: { greetingsEnabled: true, messagesEnabled: true },
                    cooldowns: {
                        cmdCooldownMs: 60000,
                        heavyCommandCooldownMs: 300000,
                        globalCmdCooldownMs: 45000
                    },
                    twitch: { greetingsEnabled: true, messagesEnabled: true, farewellsEnabled: false }
                },
                vfxCommandService: {
                    selectVFXCommand: createMockFn().mockResolvedValue(null),
                    matchFarewell: createMockFn().mockReturnValue('!bye')
                }
            }
        });

        await router.handleChatMessage('twitch', {
            ...baseMessage,
            message: '!bye everyone'
        });

        const queuedTypes = runtime.displayQueue.addItem.mock.calls.map((call) => call[0].type);
        expect(queuedTypes).toContain('chat');
        expect(queuedTypes).not.toContain('farewell');
    });

    it('continues command routing when farewell is matched but disabled', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: { greetingsEnabled: true, messagesEnabled: true },
                    cooldowns: {
                        cmdCooldownMs: 60000,
                        heavyCommandCooldownMs: 300000,
                        globalCmdCooldownMs: 45000
                    },
                    twitch: { greetingsEnabled: true, messagesEnabled: true, farewellsEnabled: false }
                },
                vfxCommandService: {
                    selectVFXCommand: createMockFn().mockResolvedValue({ command: '!testboom' }),
                    matchFarewell: createMockFn().mockReturnValue('!bye')
                }
            }
        });

        await router.handleChatMessage('twitch', {
            ...baseMessage,
            message: '!bye everyone'
        });

        const queuedTypes = runtime.displayQueue.addItem.mock.calls.map((call) => call[0].type);
        expect(queuedTypes).toContain('chat');
        expect(queuedTypes).not.toContain('farewell');
        expect(queuedTypes).toContain('command');
    });

    it('emits a single farewell row when farewell and command logic overlap', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                isFirstMessage: createMockFn().mockReturnValue(true),
                vfxCommandService: {
                    selectVFXCommand: createMockFn().mockResolvedValue({ command: '!testboom' }),
                    matchFarewell: createMockFn().mockReturnValue('!bye')
                }
            }
        });

        await router.handleChatMessage('twitch', {
            ...baseMessage,
            message: '!bye and !testboom'
        });

        const queuedTypes = runtime.displayQueue.addItem.mock.calls.map((call) => call[0].type);
        const farewellCount = queuedTypes.filter((type) => type === 'farewell').length;
        expect(farewellCount).toBe(1);
        expect(queuedTypes).not.toContain('command');
        expect(queuedTypes).not.toContain('greeting');
    });

    it('continues command routing when farewell notification reports failure', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                handleFarewellNotification: createMockFn().mockResolvedValue({ success: false, error: 'Notifications disabled' }),
                vfxCommandService: {
                    selectVFXCommand: createMockFn().mockResolvedValue({ command: '!testboom' }),
                    matchFarewell: createMockFn().mockReturnValue('!bye')
                }
            }
        });

        await router.handleChatMessage('twitch', {
            ...baseMessage,
            message: '!bye everyone'
        });

        const queuedTypes = runtime.displayQueue.addItem.mock.calls.map((call) => call[0].type);
        expect(queuedTypes).toContain('chat');
        expect(queuedTypes).toContain('command');
        expect(queuedTypes).not.toContain('farewell');
    });

    it('detects farewell triggers after sanitizing zero-width characters', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                vfxCommandService: {
                    selectVFXCommand: createMockFn().mockResolvedValue(null),
                    matchFarewell: createMockFn().mockReturnValue('!bye')
                }
            }
        });

        await router.handleChatMessage('twitch', {
            ...baseMessage,
            message: '!bye\u200B everyone'
        });

        const queuedTypes = runtime.displayQueue.addItem.mock.calls.map((call) => call[0].type);
        expect(queuedTypes).toContain('farewell');
    });

    it('detects farewell triggers with trailing punctuation', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                vfxCommandService: {
                    selectVFXCommand: createMockFn().mockResolvedValue(null),
                    matchFarewell: createMockFn().mockReturnValue('!bye')
                }
            }
        });

        await router.handleChatMessage('twitch', {
            ...baseMessage,
            message: '!bye!!! everyone'
        });

        const queuedTypes = runtime.displayQueue.addItem.mock.calls.map((call) => call[0].type);
        expect(queuedTypes).toContain('farewell');
    });

    it('suppresses repeated farewell triggers on the same platform within timeout', async () => {
        const activeCooldowns = new Set();
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: { greetingsEnabled: true, messagesEnabled: true },
                    cooldowns: {
                        cmdCooldownMs: 60000,
                        heavyCommandCooldownMs: 300000,
                        globalCmdCooldownMs: 45000
                    },
                    farewell: {
                        timeout: 300
                    },
                    twitch: { greetingsEnabled: true, messagesEnabled: true, farewellsEnabled: true }
                },
                commandCooldownService: {
                    checkUserCooldown: createMockFn().mockReturnValue(true),
                    checkGlobalCooldown: createMockFn().mockImplementation((key) => !activeCooldowns.has(key)),
                    updateUserCooldown: createMockFn(),
                    updateGlobalCooldown: createMockFn().mockImplementation((key) => {
                        activeCooldowns.add(key);
                    })
                },
                vfxCommandService: {
                    selectVFXCommand: createMockFn().mockResolvedValue({ command: '!testboom' }),
                    matchFarewell: createMockFn().mockReturnValue('!bye')
                }
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage, message: '!bye now' });
        await router.handleChatMessage('twitch', { ...baseMessage, message: '!bye again' });

        const queuedTypes = runtime.displayQueue.addItem.mock.calls.map((call) => call[0].type);
        const farewellCount = queuedTypes.filter((type) => type === 'farewell').length;
        expect(farewellCount).toBe(1);
    });

    it('allows farewell triggers independently per platform within timeout window', async () => {
        const activeCooldowns = new Set();
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: { greetingsEnabled: true, messagesEnabled: true },
                    cooldowns: {
                        cmdCooldownMs: 60000,
                        heavyCommandCooldownMs: 300000,
                        globalCmdCooldownMs: 45000
                    },
                    farewell: {
                        timeout: 300
                    },
                    twitch: { greetingsEnabled: true, messagesEnabled: true, farewellsEnabled: true },
                    tiktok: { greetingsEnabled: true, messagesEnabled: true, farewellsEnabled: true }
                },
                commandCooldownService: {
                    checkUserCooldown: createMockFn().mockReturnValue(true),
                    checkGlobalCooldown: createMockFn().mockImplementation((key) => !activeCooldowns.has(key)),
                    updateUserCooldown: createMockFn(),
                    updateGlobalCooldown: createMockFn().mockImplementation((key) => {
                        activeCooldowns.add(key);
                    })
                },
                vfxCommandService: {
                    selectVFXCommand: createMockFn().mockResolvedValue({ command: '!testboom' }),
                    matchFarewell: createMockFn().mockReturnValue('!bye')
                }
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage, message: '!bye twitch' });
        await router.handleChatMessage('tiktok', { ...baseMessage, message: '!bye tiktok' });

        const queuedItems = runtime.displayQueue.addItem.mock.calls.map((call) => call[0]);
        const farewellPlatforms = queuedItems
            .filter((item) => item.type === 'farewell')
            .map((item) => item.platform);
        expect(farewellPlatforms).toContain('twitch');
        expect(farewellPlatforms).toContain('tiktok');
    });

    it('treats cooldown-suppressed farewell as handled and does not fall through to commands', async () => {
        const activeCooldowns = new Set(['farewell:twitch']);
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: { greetingsEnabled: true, messagesEnabled: true },
                    cooldowns: {
                        cmdCooldownMs: 60000,
                        heavyCommandCooldownMs: 300000,
                        globalCmdCooldownMs: 45000
                    },
                    farewell: {
                        timeout: 300
                    },
                    twitch: { greetingsEnabled: true, messagesEnabled: true, farewellsEnabled: true }
                },
                commandCooldownService: {
                    checkUserCooldown: createMockFn().mockReturnValue(true),
                    checkGlobalCooldown: createMockFn().mockImplementation((key) => !activeCooldowns.has(key)),
                    updateUserCooldown: createMockFn(),
                    updateGlobalCooldown: createMockFn().mockImplementation((key) => {
                        activeCooldowns.add(key);
                    })
                },
                vfxCommandService: {
                    selectVFXCommand: createMockFn().mockResolvedValue({ command: '!testboom' }),
                    matchFarewell: createMockFn().mockReturnValue('!bye')
                }
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage, message: '!bye now' });

        const queuedTypes = runtime.displayQueue.addItem.mock.calls.map((call) => call[0].type);
        expect(queuedTypes).not.toContain('farewell');
        expect(queuedTypes).not.toContain('command');
    });

    it('uses isolated farewell cooldown keys that do not block regular command cooldown keys', async () => {
        const activeCooldowns = new Set(['farewell:twitch']);
        const checkGlobalCooldown = createMockFn().mockImplementation((key) => !activeCooldowns.has(key));
        const updateGlobalCooldown = createMockFn().mockImplementation((key) => {
            activeCooldowns.add(key);
        });
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: { greetingsEnabled: true, messagesEnabled: true },
                    cooldowns: {
                        cmdCooldownMs: 60000,
                        heavyCommandCooldownMs: 300000,
                        globalCmdCooldownMs: 45000
                    },
                    farewell: {
                        timeout: 300
                    },
                    twitch: { greetingsEnabled: true, messagesEnabled: true, farewellsEnabled: true }
                },
                commandCooldownService: {
                    checkUserCooldown: createMockFn().mockReturnValue(true),
                    checkGlobalCooldown,
                    updateUserCooldown: createMockFn(),
                    updateGlobalCooldown
                },
                vfxCommandService: {
                    selectVFXCommand: createMockFn().mockImplementation((trigger) => {
                        if (trigger === '!testboom') {
                            return { command: '!testboom' };
                        }
                        return null;
                    }),
                    matchFarewell: createMockFn().mockImplementation((message, trigger) => {
                        if (trigger === '!bye') {
                            return '!bye';
                        }
                        return null;
                    })
                }
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage, message: '!bye now' });
        await router.handleChatMessage('twitch', { ...baseMessage, message: '!testboom now' });

        const queuedTypes = runtime.displayQueue.addItem.mock.calls.map((call) => call[0].type);
        expect(queuedTypes).not.toContain('farewell');
        expect(queuedTypes).toContain('command');
    });

    it('detects command triggers after sanitizing zero-width characters', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                vfxCommandService: {
                    selectVFXCommand: createMockFn().mockImplementation((trigger) => {
                        if (trigger === '!testboom') {
                            return { command: '!testboom' };
                        }
                        return null;
                    }),
                    matchFarewell: createMockFn().mockReturnValue(null)
                }
            }
        });

        await router.handleChatMessage('twitch', {
            ...baseMessage,
            message: '!testboom\u200B now'
        });

        const queuedTypes = runtime.displayQueue.addItem.mock.calls.map((call) => call[0].type);
        expect(queuedTypes).toContain('command');
    });

    it('queues emote-only TikTok chat rows when canonical message parts are present', async () => {
        const { router, runtime } = createRouter();

        await router.handleChatMessage('tiktok', {
            ...baseMessage,
            message: {
                text: '   ',
                parts: [
                    {
                        type: 'emote',
                        platform: 'tiktok',
                        emoteId: '1234512345',
                        imageUrl: 'https://example.invalid/tiktok-emote.webp'
                    }
                ]
            }
        });

        expect(runtime.displayQueue.addItem).toHaveBeenCalled();
        const queuedItems = runtime.displayQueue.addItem.mock.calls.map((call) => call[0]);
        const chatItem = queuedItems.find((item) => item.type === 'chat');
        expect(chatItem).toBeDefined();
        expect(chatItem?.data?.message).toEqual({
            text: '',
            parts: [
                {
                    type: 'emote',
                    platform: 'tiktok',
                    emoteId: '1234512345',
                    imageUrl: 'https://example.invalid/tiktok-emote.webp'
                }
            ]
        });
    });

    it('queues emote-only non-TikTok chat rows when canonical message parts are present', async () => {
        const { router, runtime } = createRouter();

        await router.handleChatMessage('twitch', {
            ...baseMessage,
            message: {
                text: '   ',
                parts: [
                    {
                        type: 'emote',
                        platform: 'twitch',
                        emoteId: '1234512345',
                        imageUrl: 'https://example.invalid/twitch-emote.webp'
                    }
                ]
            }
        });

        expect(runtime.displayQueue.addItem).toHaveBeenCalled();
        const queuedItems = runtime.displayQueue.addItem.mock.calls.map((call) => call[0]);
        const chatItem = queuedItems.find((item) => item.type === 'chat');
        expect(chatItem).toBeDefined();
        expect(chatItem?.data?.message).toEqual({
            text: '',
            parts: [
                {
                    type: 'emote',
                    platform: 'twitch',
                    emoteId: '1234512345',
                    imageUrl: 'https://example.invalid/twitch-emote.webp'
                }
            ]
        });
    });
});
