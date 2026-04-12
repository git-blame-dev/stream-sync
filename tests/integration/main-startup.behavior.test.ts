const { describe, it, beforeEach, afterEach, expect } = require('bun:test');

const { main } = require('../../src/main.ts');
const { createDonationSpamDetection } = require('../../src/utils/spam-detection');
const { createConfigFixture } = require('../helpers/config-fixture');
const { useFakeTimers, useRealTimers, clearAllTimers } = require('../helpers/bun-timers');
const { createMockDisplayQueue } = require('../helpers/mock-factories');
const { captureStdout, captureStderr } = require('../helpers/output-capture');

const buildMainConfig = (overrides = {}) => createConfigFixture({
    general: {
        debugEnabled: false,
        envFilePath: '/tmp/test-env',
        envFileReadEnabled: false,
        envFileWriteEnabled: false,
        viewerCountPollingIntervalMs: 0,
        ...overrides.general
    },
    obs: {
        chatMsgTxt: 'test-chat-text',
        chatMsgScene: 'test-chat-scene',
        chatMsgGroup: 'test-chat-group',
        ttsEnabled: false,
        notificationTxt: 'test-notification-text',
        notificationScene: 'test-notification-scene',
        notificationMsgGroup: 'test-notification-group',
        chatPlatformLogos: {},
        notificationPlatformLogos: {},
        ...overrides.obs
    },
    displayQueue: {
        autoProcess: false,
        maxQueueSize: 5,
        ...overrides.displayQueue
    },
    timing: {
        transitionDelay: 1000,
        notificationClearDelay: 500,
        chatMessageDuration: 1000,
        ...overrides.timing
    },
    http: {
        userAgents: ['test-agent'],
        ...overrides.http
    },
    twitch: {
        enabled: false,
        ...overrides.twitch
    },
    youtube: {
        enabled: false,
        ...overrides.youtube
    },
    tiktok: {
        enabled: false,
        ...overrides.tiktok
    },
    ...overrides
});

const buildOverrides = (options = {}) => {
    const displayQueue = createMockDisplayQueue();
    const obsManager = {
        isConnected: () => false,
        isReady: () => false,
        ensureConnected: async () => undefined,
        call: async () => ({}),
        connect: async () => true,
        disconnect: async () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined
    };
    let capturedDisplayQueueConfig = null;

    const ensureSecrets = async () => {
        if (options.ensureSecretsError) {
            throw options.ensureSecretsError;
        }
    };

    class TwitchAuthStub {
        async initialize() {
            if (options.twitchAuthInitError) {
                throw options.twitchAuthInitError;
            }
        }

        isReady() {
            return options.twitchAuthReady !== false;
        }
    }

    const createDonationSpamDetectionNoCleanup = (spamConfig, deps) => (
        createDonationSpamDetection(spamConfig, { ...deps, autoCleanup: false })
    );

    return {
        overrides: {
            cliArgs: options.cliArgs || {},
            ensureSecrets,
            TwitchAuth: TwitchAuthStub,
            initializeDisplayQueue: (_obsManager, displayQueueConfig) => {
                capturedDisplayQueueConfig = displayQueueConfig;
                return displayQueue;
            },
            getOBSConnectionManager: () => obsManager,
            createOBSEventService: () => ({ disconnect: async () => {} }),
            createDonationSpamDetection: createDonationSpamDetectionNoCleanup
        },
        getCapturedDisplayQueueConfig: () => capturedDisplayQueueConfig
    };
};

describe('main startup behavior', () => {
    let stdoutCapture;
    let stderrCapture;
    let originalStartupOnly;

    beforeEach(() => {
        stdoutCapture = captureStdout();
        stderrCapture = captureStderr();
        useFakeTimers();
        originalStartupOnly = process.env.CHAT_BOT_STARTUP_ONLY;
        delete process.env.CHAT_BOT_STARTUP_ONLY;
    });

    afterEach(() => {
        if (originalStartupOnly === undefined) {
            delete process.env.CHAT_BOT_STARTUP_ONLY;
        } else {
            process.env.CHAT_BOT_STARTUP_ONLY = originalStartupOnly;
        }
        clearAllTimers();
        useRealTimers();
        stdoutCapture.restore();
        stderrCapture.restore();
    });

    it('starts runtime and returns startup status', async () => {
        const { overrides } = buildOverrides({ cliArgs: { chat: 1 } });

        const result = await main({
            ...overrides,
            config: buildMainConfig()
        });

        expect(result).toEqual({
            success: true,
            appStarted: true,
            viewerCountActive: false,
            authValid: true
        });
    });

    it('shuts down in startup-only mode', async () => {
        process.env.CHAT_BOT_STARTUP_ONLY = 'true';
        const { overrides } = buildOverrides({ cliArgs: { chat: 1 } });

        const result = await main({
            ...overrides,
            config: buildMainConfig()
        });

        expect(result.success).toBe(true);
    });

    it('stores keep-alive interval when chat limit is not set', async () => {
        const { overrides } = buildOverrides({
            cliArgs: { chat: null }
        });

        const result = await main({
            ...overrides,
            config: buildMainConfig()
        });

        expect(result.success).toBe(true);
    });

    it('surfaces secret setup failures', async () => {
        const error = new Error('test-secret-failure');
        const { overrides } = buildOverrides({ ensureSecretsError: error, cliArgs: { chat: 1 } });

        await expect(main({
            ...overrides,
            config: buildMainConfig()
        })).rejects.toThrow('test-secret-failure');
    });

    it('continues when Twitch auth initialization fails', async () => {
        const error = new Error('test-auth-failure');
        const { overrides } = buildOverrides({ twitchAuthInitError: error, cliArgs: { chat: 1 } });

        const result = await main({
            ...overrides,
            config: buildMainConfig({ twitch: { enabled: true } })
        });

        expect(result.authValid).toBe(false);
        expect(result.success).toBe(true);
    });

    it('passes gui settings to display queue configuration', async () => {
        process.env.CHAT_BOT_STARTUP_ONLY = 'true';
        const { overrides, getCapturedDisplayQueueConfig } = buildOverrides({ cliArgs: { chat: 1 } });
        const config = buildMainConfig({
            gui: {
                enableDock: false,
                enableOverlay: false,
                showGifts: true
            }
        });

        const result = await main({
            ...overrides,
            config
        });

        expect(result.success).toBe(true);
        expect(getCapturedDisplayQueueConfig()).toBeDefined();
        expect(getCapturedDisplayQueueConfig().gui).toEqual(config.gui);
    });

    it('rejects non-function startup override dependencies', async () => {
        const { overrides } = buildOverrides({ cliArgs: { chat: 1 } });

        await expect(main({
            ...overrides,
            createEventBus: 'not-a-function',
            config: buildMainConfig()
        })).rejects.toThrow('main override createEventBus must be a function when provided');
    });

    it('rejects invalid cliArgs chat override values', async () => {
        const { overrides } = buildOverrides({});

        await expect(main({
            ...overrides,
            cliArgs: { chat: 'invalid-chat-count' },
            config: buildMainConfig()
        })).rejects.toThrow('main override cliArgs.chat must be null or a positive integer');
    });

    it('uses one OBS subsystem instance for display queue, event services, and VFX wiring', async () => {
        process.env.CHAT_BOT_STARTUP_ONLY = 'true';
        const { overrides } = buildOverrides({ cliArgs: { chat: 1 } });
        const displayQueueManagers = [];
        const eventServiceManagers = [];
        const createVfxCallArgs = [];
        const createProductionDependenciesArgs = [];
        let managerSeq = 0;

        const makeObsManager = () => {
            managerSeq += 1;
            return {
                id: `obs-manager-${managerSeq}`,
                isConnected: () => false,
                isReady: () => false,
                connect: async () => true,
                disconnect: async () => undefined,
                ensureConnected: async () => undefined,
                call: async () => ({}),
                addEventListener: () => undefined,
                removeEventListener: () => undefined
            };
        };

        const result = await main({
            ...overrides,
            getOBSConnectionManager: () => makeObsManager(),
            initializeDisplayQueue: (obsManager) => {
                displayQueueManagers.push(obsManager);
                return createMockDisplayQueue();
            },
            createOBSEventService: ({ obsConnection }) => {
                eventServiceManagers.push(obsConnection);
                return {
                    connect: async () => true,
                    disconnect: async () => undefined,
                    destroy: () => undefined
                };
            },
            createVFXCommandService: (...args) => {
                createVfxCallArgs.push(args);
                return {
                    executeCommand: async () => ({ success: true }),
                    executeCommandForKey: async () => ({ success: true }),
                    getVFXConfig: async () => null
                };
            },
            createProductionDependencies: (...args) => {
                createProductionDependenciesArgs.push(args);
                const loggerDouble = {
                    debug: () => undefined,
                    info: () => undefined,
                    warn: () => undefined,
                    error: () => undefined,
                    console: () => undefined
                };
                return {
                    obs: {},
                    logger: loggerDouble,
                    logging: loggerDouble,
                    platforms: {},
                    displayQueue: null,
                    notificationManager: null,
                    dependencyFactory: {},
                    lazyInnertube: {},
                    eventBus: null,
                    vfxCommandService: null,
                    userTrackingService: null
                };
            },
            config: buildMainConfig()
        });

        expect(result.success).toBe(true);
        expect(displayQueueManagers.length).toBe(1);
        expect(eventServiceManagers.length).toBe(1);
        expect(displayQueueManagers[0]).toBe(eventServiceManagers[0]);
        expect(createVfxCallArgs[0][2]?.effectsManager).toBeDefined();
        expect(createProductionDependenciesArgs[0][1]?.effectsManager).toBe(createVfxCallArgs[0][2]?.effectsManager);
    });

    it('uses non-singleton createDisplayQueue runtime path when provided', async () => {
        process.env.CHAT_BOT_STARTUP_ONLY = 'true';
        const { overrides } = buildOverrides({ cliArgs: { chat: 1 } });
        const createdQueues = [];

        const result = await main({
            ...overrides,
            initializeDisplayQueue: undefined,
            createDisplayQueue: (obsManager, displayQueueConfig, displayQueueConstants, eventBus, dependencies) => {
                createdQueues.push({ obsManager, displayQueueConfig, displayQueueConstants, eventBus, dependencies });
                return createMockDisplayQueue();
            },
            config: buildMainConfig()
        });

        expect(result.success).toBe(true);
        expect(createdQueues.length).toBe(1);
    });
});
