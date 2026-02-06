const { describe, it, beforeEach, afterEach, expect } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ini = require('ini');
const { getRawTestConfig } = require('../../helpers/config-fixture');

describe('config load and build behavior', () => {
    let tempDir;
    let tempConfigPath;
    let originalConfigPath;
    let configModule;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-config-'));
        tempConfigPath = path.join(tempDir, 'config.ini');
        originalConfigPath = process.env.CHAT_BOT_CONFIG_PATH;
    });

    afterEach(() => {
        process.env.CHAT_BOT_CONFIG_PATH = originalConfigPath;
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
        rawConfig.displayQueue = { autoProcess: 'true', maxQueueSize: '100', chatOptimization: 'true' };
        rawConfig.gifts = { giftVideoSource: 'test-gift-video', giftAudioSource: 'test-gift-audio' };
        rawConfig.envelopes = { command: '!testenvelope' };
        rawConfig.vfx = { filePath: '/test/vfx/path' };
        rawConfig.follows = { command: '!testfollow' };
        rawConfig.raids = { command: '!testraid' };
        rawConfig.shares = { command: '!testshare' };
        rawConfig.paypiggies = { command: '!testpay' };
        rawConfig.greetings = { command: '!testgreet' };
        rawConfig.farewell = { command: '!testfarewell' };
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
        expect(built.logging).toBeDefined();
    });

    it('loads config with warnings and exposes config path', () => {
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
        const validation = ConfigValidator.validate(normalized);
        expect(validation.warnings.length).toBeGreaterThan(0);

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
        configModule = require('../../../src/core/config');
        const loggingModule = require('../../../src/core/logging');

        loggingModule.setDebugMode(false);
        const config = configModule.validateLoggingConfig({
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

        loggingModule.setDebugMode(true);
        const debugConfig = configModule.validateLoggingConfig({
            general: { debugEnabled: false }
        });
        expect(debugConfig.console.level).toBe('debug');
        loggingModule.setDebugMode(false);
    });
});
