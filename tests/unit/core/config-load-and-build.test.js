const { describe, it, beforeEach, afterEach, expect } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ini = require('ini');
const { getRawTestConfig } = require('../../helpers/config-fixture');

describe('config load and build behavior', () => {
    let tempDir;
    let tempConfigPath;
    let tempEnvPath;
    let originalConfigPath;
    let originalTwitchClientId;
    let configModule;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-config-'));
        tempConfigPath = path.join(tempDir, 'config.ini');
        tempEnvPath = path.join(tempDir, '.env');
        originalConfigPath = process.env.CHAT_BOT_CONFIG_PATH;
        originalTwitchClientId = process.env.TWITCH_CLIENT_ID;
    });

    afterEach(() => {
        process.env.CHAT_BOT_CONFIG_PATH = originalConfigPath;
        if (originalTwitchClientId === undefined) {
            delete process.env.TWITCH_CLIENT_ID;
        } else {
            process.env.TWITCH_CLIENT_ID = originalTwitchClientId;
        }
        if (configModule) {
            configModule._resetConfigForTesting();
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
        configModule = null;
    });

    it('loads and builds configuration from ini file with debug enabled', () => {
        configModule = require('../../../src/core/config');
        const rawConfig = getRawTestConfig();
        rawConfig.general.debugEnabled = 'true';
        rawConfig.tiktok.enabled = 'true';
        rawConfig.tiktok.username = 'test-tiktok-user';
        rawConfig.displayQueue = { autoProcess: 'true', maxQueueSize: '100' };
        rawConfig.gifts = { giftVideoSource: 'test-gift-video', giftAudioSource: 'test-gift-audio' };
        rawConfig.envelopes = { command: '!testenvelope' };
        rawConfig.vfx = { filePath: '/test/vfx/path' };
        rawConfig.follows = { command: '!testfollow' };
        rawConfig.raids = { command: '!testraid' };
        rawConfig.shares = { command: '!testshare' };
        rawConfig.paypiggies = { command: '!testpay' };
        rawConfig.greetings = { command: '!testgreet' };
        rawConfig.farewell = { command: '!testfarewell' };
        rawConfig.gui = {
            ...rawConfig.gui,
            enableDock: 'true',
            messageCharacterLimit: '120',
            overlayMaxMessages: '4'
        };
        rawConfig.streamelements = {
            enabled: 'false',
            youtubeChannelId: 'test-yt-channel',
            twitchChannelId: 'test-twitch-channel',
            jwtToken: 'test-jwt'
        };
        rawConfig.logging = {
            consoleLevel: 'debug',
            fileLevel: 'info',
            fileLoggingEnabled: 'false'
        };
        rawConfig.http = {
            userAgents: 'test-agent',
            defaultTimeoutMs: '10000',
            reachabilityTimeoutMs: '5000',
            enhancedTimeoutMs: '3000',
            enhancedReachabilityTimeoutMs: '3000'
        };

        fs.writeFileSync(tempConfigPath, ini.stringify(rawConfig), 'utf8');
        process.env.CHAT_BOT_CONFIG_PATH = tempConfigPath;
        configModule._resetConfigForTesting();

        const normalized = configModule.loadConfig();
        const built = configModule.config;

        expect(normalized.general.debugEnabled).toBe(true);
        expect(built.general.viewerCountPollingIntervalMs).toBe(60000);
        expect(built.obs.chatPlatformLogos.twitch).toBe('test-twitch-img');
        expect(built.gifts.giftVideoSource).toBe('test-gift-video');
        expect(built.envelopes.command).toBe('!testenvelope');
        expect(built.gui.enableDock).toBe(true);
        expect(built.gui.overlayMaxMessages).toBe(4);
        expect(built.logging).toBeDefined();
    });

    it('normalizes out-of-range values to defaults and exposes config path', () => {
        configModule = require('../../../src/core/config');
        const { ConfigValidator } = require('../../../src/utils/config-validator');
        const rawConfig = getRawTestConfig();
        rawConfig.cooldowns.defaultCooldown = '5';
        rawConfig.cooldowns.heavyCommandCooldown = '30';
        rawConfig.cooldowns.heavyCommandThreshold = '1';
        rawConfig.handcam.maxSize = '200';
        rawConfig.handcam.rampUpDuration = '0.01';
        rawConfig.handcam.holdDuration = '-1';
        rawConfig.handcam.rampDownDuration = '20';

        const normalized = ConfigValidator.normalize(rawConfig);
        expect(normalized.cooldowns.defaultCooldown).toBe(60);
        expect(normalized.cooldowns.heavyCommandCooldown).toBe(60);
        expect(normalized.cooldowns.heavyCommandThreshold).toBe(3);
        expect(normalized.handcam.maxSize).toBe(50);
        expect(normalized.handcam.rampUpDuration).toBe(0.5);
        expect(normalized.handcam.holdDuration).toBe(8.0);
        expect(normalized.handcam.rampDownDuration).toBe(0.5);

        fs.writeFileSync(tempConfigPath, ini.stringify(rawConfig), 'utf8');
        process.env.CHAT_BOT_CONFIG_PATH = tempConfigPath;
        configModule._resetConfigForTesting();

        const loaded = configModule.loadConfig();
        expect(loaded).toBeDefined();
        expect(configModule._getConfigPath()).toBe(tempConfigPath);
    });

    it('throws when configuration file is missing', () => {
        configModule = require('../../../src/core/config');
        const originalExistsSync = fs.existsSync;
        process.env.CHAT_BOT_CONFIG_PATH = tempConfigPath;
        configModule._resetConfigForTesting();

        try {
            fs.existsSync = () => false;
            expect(() => configModule.loadConfig()).toThrow(/Configuration file not found/);
        } finally {
            fs.existsSync = originalExistsSync;
        }
    });

    it('throws with validation errors when required fields are missing', () => {
        configModule = require('../../../src/core/config');
        const rawConfig = getRawTestConfig();
        rawConfig.tiktok.enabled = 'true';
        rawConfig.tiktok.username = '';

        fs.writeFileSync(tempConfigPath, ini.stringify(rawConfig), 'utf8');
        process.env.CHAT_BOT_CONFIG_PATH = tempConfigPath;
        configModule._resetConfigForTesting();

        expect(() => configModule.loadConfig()).toThrow(/Configuration validation failed/);
    });

    it('uses TWITCH_CLIENT_ID from environment when config twitch clientId is empty', () => {
        configModule = require('../../../src/core/config');
        const rawConfig = getRawTestConfig();
        rawConfig.twitch = {
            ...rawConfig.twitch,
            enabled: 'true',
            username: 'test-user',
            channel: 'test-channel',
            clientId: ''
        };
        rawConfig.general = {
            ...rawConfig.general,
            envFileReadEnabled: 'false'
        };

        fs.writeFileSync(tempConfigPath, ini.stringify(rawConfig), 'utf8');
        process.env.CHAT_BOT_CONFIG_PATH = tempConfigPath;
        process.env.TWITCH_CLIENT_ID = 'test-env-client-id';
        configModule._resetConfigForTesting();

        const normalized = configModule.loadConfig();
        expect(normalized.twitch.clientId).toBe('test-env-client-id');
    });

    it('fails when TWITCH_CLIENT_ID is missing even if config twitch clientId is populated', () => {
        configModule = require('../../../src/core/config');
        const rawConfig = getRawTestConfig();
        rawConfig.twitch = {
            ...rawConfig.twitch,
            enabled: 'true',
            username: 'test-user',
            channel: 'test-channel',
            clientId: 'legacy-config-client-id'
        };
        rawConfig.general = {
            ...rawConfig.general,
            envFileReadEnabled: 'false'
        };

        fs.writeFileSync(tempConfigPath, ini.stringify(rawConfig), 'utf8');
        process.env.CHAT_BOT_CONFIG_PATH = tempConfigPath;
        delete process.env.TWITCH_CLIENT_ID;
        configModule._resetConfigForTesting();

        expect(() => configModule.loadConfig()).toThrow(/TWITCH_CLIENT_ID/);
    });

    it('loads TWITCH_CLIENT_ID from env file when env file read is enabled', () => {
        configModule = require('../../../src/core/config');
        const rawConfig = getRawTestConfig();
        rawConfig.twitch = {
            ...rawConfig.twitch,
            enabled: 'true',
            username: 'test-user',
            channel: 'test-channel',
            clientId: 'legacy-config-client-id'
        };
        rawConfig.general = {
            ...rawConfig.general,
            envFileReadEnabled: 'true',
            envFilePath: tempEnvPath
        };

        fs.writeFileSync(tempEnvPath, 'TWITCH_CLIENT_ID=test-env-file-client-id\n', 'utf8');
        fs.writeFileSync(tempConfigPath, ini.stringify(rawConfig), 'utf8');
        process.env.CHAT_BOT_CONFIG_PATH = tempConfigPath;
        delete process.env.TWITCH_CLIENT_ID;
        configModule._resetConfigForTesting();

        const normalized = configModule.loadConfig();
        expect(normalized.twitch.clientId).toBe('test-env-file-client-id');
    });

    it('keeps existing TWITCH_CLIENT_ID when env file also defines it', () => {
        configModule = require('../../../src/core/config');
        const rawConfig = getRawTestConfig();
        rawConfig.twitch = {
            ...rawConfig.twitch,
            enabled: 'true',
            username: 'test-user',
            channel: 'test-channel',
            clientId: 'legacy-config-client-id'
        };
        rawConfig.general = {
            ...rawConfig.general,
            envFileReadEnabled: 'true',
            envFilePath: tempEnvPath
        };

        fs.writeFileSync(tempEnvPath, 'TWITCH_CLIENT_ID=test-env-file-client-id\n', 'utf8');
        fs.writeFileSync(tempConfigPath, ini.stringify(rawConfig), 'utf8');
        process.env.CHAT_BOT_CONFIG_PATH = tempConfigPath;
        process.env.TWITCH_CLIENT_ID = 'test-shell-client-id';
        configModule._resetConfigForTesting();

        const normalized = configModule.loadConfig();
        expect(normalized.twitch.clientId).toBe('test-shell-client-id');
    });

    it('handles read errors with ENOENT code', () => {
        configModule = require('../../../src/core/config');
        const originalExistsSync = fs.existsSync;
        const originalReadFileSync = fs.readFileSync;

        process.env.CHAT_BOT_CONFIG_PATH = tempConfigPath;
        configModule._resetConfigForTesting();

        try {
            fs.existsSync = () => true;
            fs.readFileSync = () => {
                const error = new Error('missing');
                error.code = 'ENOENT';
                throw error;
            };
            expect(() => configModule.loadConfig()).toThrow(/missing/);
        } finally {
            fs.existsSync = originalExistsSync;
            fs.readFileSync = originalReadFileSync;
        }
    });

    it('normalizes logging config levels and respects debug overrides', () => {
        const { buildLoggingConfig } = require('../../../src/core/config-builders');

        const config = buildLoggingConfig({
            logging: {
                consoleLevel: 'invalid',
                fileLevel: 'invalid',
                fileLoggingEnabled: false
            },
            general: { debugEnabled: true }
        });

        expect(config.console.level).toBe('debug');
        expect(config.file.level).toBe('debug');
        expect(config.file.enabled).toBe(false);
        expect(config.chat.enabled).toBe(false);

        const debugConfig = buildLoggingConfig(
            { general: { debugEnabled: false }, logging: {} },
            { debugMode: true }
        );
        expect(debugConfig.console.level).toBe('debug');
    });
});
