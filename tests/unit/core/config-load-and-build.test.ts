import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ini from 'ini';
import { getRawTestConfig } from '../../helpers/config-fixture';
import { captureStdout } from '../../helpers/output-capture';
import * as configModuleRef from '../../../src/core/config.ts';
import { buildLoggingConfig } from '../../../src/core/config-builders.ts';
import { ConfigValidator } from '../../../src/utils/config-validator';
import { createEnhancedHttpClient } from '../../../src/utils/enhanced-http-client';

type LoadedConfigModule = typeof configModuleRef;

type BuiltConfigShape = {
    general: { viewerCountPollingIntervalMs: number };
    obs: { enabled: boolean; address: string; ttsChatEnabled: boolean; ttsNotificationsEnabled: boolean };
    gifts: { giftVideoSource: string };
    envelopes: { command: string };
    gui: { enableDock: boolean; overlayMaxMessages: number };
    logging: unknown;
};

function getBuiltConfig(module: LoadedConfigModule): BuiltConfigShape {
    return module.config as unknown as BuiltConfigShape;
}

describe('config load and build behavior', () => {
    let tempDir: string;
    let tempConfigPath: string;
    let tempEnvPath: string;
    let originalConfigPath: string | undefined;
    let originalTwitchClientId: string | undefined;
    let configModule: LoadedConfigModule = configModuleRef;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-config-'));
        tempConfigPath = path.join(tempDir, 'config.ini');
        tempEnvPath = path.join(tempDir, '.env');
        originalConfigPath = process.env.CHAT_BOT_CONFIG_PATH;
        originalTwitchClientId = process.env.TWITCH_CLIENT_ID;
    });

    afterEach(() => {
        if (originalConfigPath === undefined) {
            delete process.env.CHAT_BOT_CONFIG_PATH;
        } else {
            process.env.CHAT_BOT_CONFIG_PATH = originalConfigPath;
        }
        if (originalTwitchClientId === undefined) {
            delete process.env.TWITCH_CLIENT_ID;
        } else {
            process.env.TWITCH_CLIENT_ID = originalTwitchClientId;
        }
        configModule._resetConfigForTesting();
        fs.rmSync(tempDir, { recursive: true, force: true });
        configModule = configModuleRef;
    });

    it('loads the checked-in example through the production parser and validator', () => {
        const raw = ini.parse(fs.readFileSync(path.resolve('config.example.ini'), 'utf8'));
        const normalized = ConfigValidator.normalize(raw);
        expect(ConfigValidator.validate(normalized)).toEqual({ isValid: true, errors: [] });
        expect(normalized.streamelements).toEqual({
            enabled: false,
            dataLoggingEnabled: false,
            dataLoggingPath: './logs'
        });
    });

    for (const scenario of [
        { name: 'nondefault limits', max: '1048576', queue: '131072', expectedMax: 1048576, expectedQueue: 131072 },
        { name: 'below-minimum limits', max: '65535', queue: '0', expectedMax: 20971520, expectedQueue: 2097152 },
        { name: 'fractional limits', max: '1048576.5', queue: '131072.5', expectedMax: 20971520, expectedQueue: 2097152 },
        { name: 'unsafe integer limits', max: '9007199254740992', queue: '9007199254740992', expectedMax: 20971520, expectedQueue: 2097152 },
        { name: 'maximum safe limits', max: String(Number.MAX_SAFE_INTEGER), queue: String(Number.MAX_SAFE_INTEGER), expectedMax: Number.MAX_SAFE_INTEGER, expectedQueue: Number.MAX_SAFE_INTEGER },
    ]) {
        it(`loads and builds logging byte limits: ${scenario.name}`, () => {
            const raw = getRawTestConfig();
            raw.logging = { ...raw.logging, fileMaxBytes: scenario.max, fileQueueMaxBytes: scenario.queue };
            fs.writeFileSync(tempConfigPath, ini.stringify(raw), 'utf8');
            process.env.CHAT_BOT_CONFIG_PATH = tempConfigPath;
            configModule._resetConfigForTesting();

            const normalized = configModule.loadConfig();
            const built = configModule.config.logging;
            expect(normalized.logging.fileMaxBytes).toBe(scenario.expectedMax);
            expect(normalized.logging.fileQueueMaxBytes).toBe(scenario.expectedQueue);
            expect(built.file.maxBytes).toBe(scenario.expectedMax);
            expect(built.file.maxQueueBytes).toBe(scenario.expectedQueue);
        });
    }

    it('loads and builds configuration from ini file with debug enabled', async () => {
        const stdoutCapture = captureStdout();
        try {
configModule = configModuleRef;
            const rawConfig = getRawTestConfig();
            rawConfig.general.debugEnabled = 'true';
            rawConfig.obs.enabled = 'true';
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
                dataLoggingEnabled: 'false'
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
                enhancedTimeoutMs: '6000',
                enhancedReachabilityTimeoutMs: '3000'
            };

            fs.writeFileSync(tempConfigPath, ini.stringify(rawConfig), 'utf8');
            process.env.CHAT_BOT_CONFIG_PATH = tempConfigPath;
            configModule._resetConfigForTesting();

            const normalized = configModule.loadConfig();
            const built = getBuiltConfig(configModule);

            expect(normalized.general.debugEnabled).toBe(true);
            expect(normalized.http.enhancedTimeoutMs).toBe(6000);
            let requestConfig: Record<string, unknown> | undefined;
            const enhancedHttpClient = createEnhancedHttpClient({
                axios: {
                    get: async (_url, config) => {
                        requestConfig = config;
                        return { data: {}, status: 200 };
                    },
                    post: async () => ({ data: {}, status: 200 }),
                    put: async () => ({ data: {}, status: 200 }),
                    delete: async () => ({ data: {}, status: 200 })
                }
            });
            await enhancedHttpClient.get('https://api.twitch.tv/helix/test');
            expect(requestConfig?.timeout).toBe(6000);
            expect(built.general.viewerCountPollingIntervalMs).toBe(60000);
            expect(built.obs.enabled).toBe(true);
            expect(built.obs.address).toBe('ws://localhost:4455');
            expect(built.obs.ttsChatEnabled).toBe(false);
            expect(built.obs.ttsNotificationsEnabled).toBe(true);
            expect(built.gifts.giftVideoSource).toBe('test-gift-video');
            expect(built.envelopes.command).toBe('!testenvelope');
            expect(built.gui.enableDock).toBe(true);
            expect(built.gui.overlayMaxMessages).toBe(4);
            expect(built.logging).toBeDefined();
        } finally {
            stdoutCapture.restore();
        }
    });

    it('normalizes out-of-range values to defaults and exposes config path', () => {
configModule = configModuleRef;
        const rawConfig = getRawTestConfig();
        if (!rawConfig.handcam) {
            throw new Error('Expected handcam fixture section');
        }
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
configModule = configModuleRef;
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
configModule = configModuleRef;
        const rawConfig = getRawTestConfig();
        rawConfig.tiktok.enabled = 'true';
        rawConfig.tiktok.username = '';

        fs.writeFileSync(tempConfigPath, ini.stringify(rawConfig), 'utf8');
        process.env.CHAT_BOT_CONFIG_PATH = tempConfigPath;
        configModule._resetConfigForTesting();

        expect(() => configModule.loadConfig()).toThrow(/Configuration validation failed/);
    });

    it('uses TWITCH_CLIENT_ID from environment when config twitch clientId is empty', () => {
configModule = configModuleRef;
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
configModule = configModuleRef;
        const rawConfig = getRawTestConfig();
        rawConfig.twitch = {
            ...rawConfig.twitch,
            enabled: 'true',
            username: 'test-user',
            channel: 'test-channel',
            clientId: 'config-file-client-id'
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
configModule = configModuleRef;
        const rawConfig = getRawTestConfig();
        rawConfig.twitch = {
            ...rawConfig.twitch,
            enabled: 'true',
            username: 'test-user',
            channel: 'test-channel',
            clientId: 'config-file-client-id'
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
configModule = configModuleRef;
        const rawConfig = getRawTestConfig();
        rawConfig.twitch = {
            ...rawConfig.twitch,
            enabled: 'true',
            username: 'test-user',
            channel: 'test-channel',
            clientId: 'config-file-client-id'
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
configModule = configModuleRef;
        const originalExistsSync = fs.existsSync;
        const originalReadFileSync = fs.readFileSync;

        process.env.CHAT_BOT_CONFIG_PATH = tempConfigPath;
        configModule._resetConfigForTesting();

        try {
            fs.existsSync = () => true;
            fs.readFileSync = () => {
                const error = new Error('missing') as Error & { code?: string };
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

        const debugConfig = buildLoggingConfig(
            { general: { debugEnabled: false }, logging: {} },
            { debugMode: true }
        );
        expect(debugConfig.console.level).toBe('debug');
    });
});
