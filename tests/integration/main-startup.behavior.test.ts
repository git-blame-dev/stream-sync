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
    const obsManager = { isConnected: () => false, isReady: () => false };
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
            createSceneManagementService: () => ({}),
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
});
