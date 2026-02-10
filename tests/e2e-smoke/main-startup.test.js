const { describe, it, beforeEach, afterEach, expect } = require('bun:test');

const { main } = require('../../src/main');
const { createDonationSpamDetection } = require('../../src/utils/spam-detection');
const { createConfigFixture } = require('../helpers/config-fixture');
const { useFakeTimers, useRealTimers, clearAllTimers } = require('../helpers/bun-timers');
const { createMockDisplayQueue } = require('../helpers/mock-factories');
const { captureStdout, captureStderr } = require('../helpers/output-capture');

const buildSmokeConfig = () => createConfigFixture({
    general: {
        debugEnabled: false,
        envFilePath: '/tmp/test-smoke-env',
        envFileReadEnabled: false,
        envFileWriteEnabled: false,
        viewerCountPollingIntervalMs: 0
    },
    obs: {
        chatMsgTxt: 'test-smoke-chat-text',
        chatMsgScene: 'test-smoke-chat-scene',
        chatMsgGroup: 'test-smoke-chat-group',
        ttsEnabled: false,
        notificationTxt: 'test-smoke-notification-text',
        notificationScene: 'test-smoke-notification-scene',
        notificationMsgGroup: 'test-smoke-notification-group',
        chatPlatformLogos: {},
        notificationPlatformLogos: {}
    },
    displayQueue: {
        autoProcess: false,
        maxQueueSize: 5
    },
    timing: {
        transitionDelay: 1000,
        notificationClearDelay: 500,
        chatMessageDuration: 1000
    },
    http: { userAgents: ['test-smoke-agent'] },
    twitch: { enabled: false },
    youtube: { enabled: false },
    tiktok: { enabled: false }
});

describe('main startup smoke', () => {
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

    it('starts with fixture-only dependencies', async () => {
        const createDonationSpamDetectionNoCleanup = (spamConfig, deps) => (
            createDonationSpamDetection(spamConfig, { ...deps, autoCleanup: false })
        );

        const overrides = {
            cliArgs: { chat: 1 },
            ensureSecrets: async () => {},
            initializeDisplayQueue: () => createMockDisplayQueue(),
            getOBSConnectionManager: () => ({ isConnected: () => false, isReady: () => false }),
            createOBSEventService: () => ({ disconnect: async () => {} }),
            createSceneManagementService: () => ({}),
            createDonationSpamDetection: createDonationSpamDetectionNoCleanup
        };

        const result = await main({
            ...overrides,
            config: buildSmokeConfig()
        });

        expect(result.success).toBe(true);
        expect(result.appStarted).toBe(true);
    });
});
