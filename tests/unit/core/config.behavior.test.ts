import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createMockFn, restoreAllMocks } from '../../helpers/bun-mock-utils';
import { captureStderr, captureStdout } from '../../helpers/output-capture';
import fs from 'fs';
import * as configModule from '../../../src/core/config.ts';

function loadFreshConfig() {
    configModule._resetConfigForTesting();
    const loadedConfig = configModule.config;
    void loadedConfig.general;
    return { config: loadedConfig, configModule };
}

function loadFreshConfigModule() {
    configModule._resetConfigForTesting();
    return configModule;
}

let originalReadFileSync;
let originalExistsSync;
let originalConfigPath;
let originalTwitchClientId;

const testConfigPath = '/test/config.ini';

const buildConfig = ({ youtubeSection = 'enabled = false', streamelementsSection = 'enabled = false' } = {}) => `
[general]
viewerCountPollingInterval = 60
maxMessageLength = 500

[obs]
enabled = true
connectionTimeoutMs = 10000
chatMsgGroup = statusbar chat grp
notificationMsgGroup = statusbar notification grp
chatPlatformLogoTwitch = twitch-img
chatPlatformLogoYouTube = youtube-img
chatPlatformLogoTikTok = tiktok-img
notificationPlatformLogoTwitch = twitch-img
notificationPlatformLogoYouTube = youtube-img
notificationPlatformLogoTikTok = tiktok-img

[timing]
fadeDuration = 750
transitionDelay = 250
chatMessageDuration = 4000
notificationClearDelay = 500

[youtube]
${youtubeSection}

[handcam]
enabled = true
sourceName = handcam
glowFilterName = Glow
maxSize = 50
rampUpDuration = 0.5
holdDuration = 8.0
rampDownDuration = 0.5
totalSteps = 30
easingEnabled = true

[cooldowns]
defaultCooldown = 60
heavyCommandCooldown = 300
heavyCommandThreshold = 4
heavyCommandWindow = 360
maxEntries = 1000

[twitch]
enabled = false

[commands]
enabled = true

[streamelements]
${streamelementsSection}
`;

describe('Config loading behavior', () => {
    let currentConfig;

    const setupConfigMocks = (content, configPath = testConfigPath) => {
        fs.existsSync = createMockFn((filePath) => filePath === configPath);
        fs.readFileSync = createMockFn((filePath) => {
            if (filePath === configPath) return content;
            throw new Error(`ENOENT: no such file: ${filePath}`);
        });
    };

    const reloadConfig = (content, configPath = testConfigPath) => {
        setupConfigMocks(content, configPath);
        process.env.CHAT_BOT_CONFIG_PATH = configPath;
        const fresh = loadFreshConfig();
        currentConfig = fresh.config;
        return { config: currentConfig };
    };

    beforeEach(() => {
        originalReadFileSync = fs.readFileSync;
        originalExistsSync = fs.existsSync;
        originalConfigPath = process.env.CHAT_BOT_CONFIG_PATH;
        originalTwitchClientId = process.env.TWITCH_CLIENT_ID;
    });

    afterEach(() => {
        fs.readFileSync = originalReadFileSync;
        fs.existsSync = originalExistsSync;
        restoreAllMocks();
        configModule._resetConfigForTesting();
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
    });

    it('throws user-friendly error when config file is missing in non-test environment', () => {
        const originalNodeEnv = process.env.NODE_ENV;
        const stderrCapture = captureStderr();
        process.env.NODE_ENV = 'production';
        try {
            fs.existsSync = createMockFn(() => false);
            process.env.CHAT_BOT_CONFIG_PATH = '/tmp/non-existent-config.ini';

            expect(() => loadFreshConfig()).toThrow(/Configuration file not found/);
            expect(stderrCapture.output.join('')).toContain('SETTINGS FILE MISSING');
        } finally {
            process.env.NODE_ENV = originalNodeEnv;
            stderrCapture.restore();
        }
    });

    it('throws error when general section is missing', () => {
        setupConfigMocks('[obs]\nenabled = false\n');
        process.env.CHAT_BOT_CONFIG_PATH = testConfigPath;

        expect(() => loadFreshConfig()).toThrow('Missing required configuration section: general');
    });

    it('uses safe defaults when values are invalid', () => {
        const configWithInvalid = `
[general]
debugEnabled = yes
viewerCountPollingInterval = not-a-number
maxMessageLength = 500

[obs]
enabled = true
connectionTimeoutMs = 10000
chatMsgGroup = statusbar chat grp
notificationMsgGroup = statusbar notification grp
chatPlatformLogoTwitch = twitch-img
chatPlatformLogoYouTube = youtube-img
chatPlatformLogoTikTok = tiktok-img
notificationPlatformLogoTwitch = twitch-img
notificationPlatformLogoYouTube = youtube-img
notificationPlatformLogoTikTok = tiktok-img

[commands]
enabled = true

[timing]
fadeDuration = 750
transitionDelay = 200
chatMessageDuration = 4500
notificationClearDelay = 500

[youtube]
enabled = true
username = TestChannel
innertubeInstanceTtlMs = 300000
innertubeMinTtlMs = 60000
userAgents = test-agent-1|test-agent-2

[twitch]
enabled = false
username =
cheermoteDefaultGiftCount = 1
cheermoteGenericCheerName = Cheer
cheermoteGenericBitsName = Bits
cheermoteUnknownUserIdPrefix = cheer_
cheermoteDefaultType = cheer

[tiktok]
enabled = false
username =

[handcam]
enabled = true
sourceName = handcam
glowFilterName = Glow
maxSize = 50
rampUpDuration = 0.5
holdDuration = 8.0
rampDownDuration = 0.5
totalSteps = 30
easingEnabled = true

[cooldowns]
defaultCooldown = 60
heavyCommandCooldown = 300
heavyCommandThreshold = 4
heavyCommandWindow = 360
maxEntries = 1000
`;
        reloadConfig(configWithInvalid);

        expect(currentConfig.general.debugEnabled).toBe(false);
        expect(currentConfig.general.viewerCountPollingInterval).toBe(60);
    });

    it('exposes cooldown configuration on the config facade', () => {
        const cooldownConfig = `
[general]
viewerCountPollingInterval = 60
maxMessageLength = 500

[obs]
enabled = true
connectionTimeoutMs = 10000
chatMsgGroup = statusbar chat grp
chatPlatformLogoTwitch = twitch-img
chatPlatformLogoYouTube = youtube-img
chatPlatformLogoTikTok = tiktok-img
notificationPlatformLogoTwitch = twitch-img
notificationPlatformLogoYouTube = youtube-img
notificationPlatformLogoTikTok = tiktok-img
notificationMsgGroup = statusbar notification grp

[timing]
fadeDuration = 750
transitionDelay = 250
chatMessageDuration = 4000
notificationClearDelay = 500

[youtube]
innertubeInstanceTtlMs = 300000
innertubeMinTtlMs = 60000
userAgents = agent-one|agent-two

[handcam]
enabled = true
sourceName = handcam
glowFilterName = Glow
maxSize = 50
rampUpDuration = 0.5
holdDuration = 8.0
rampDownDuration = 0.5
totalSteps = 30
easingEnabled = true

[cooldowns]
defaultCooldown = 60
heavyCommandCooldown = 300
heavyCommandThreshold = 4
heavyCommandWindow = 360
maxEntries = 1000

[twitch]
cheermoteDefaultGiftCount = 1
cheermoteGenericCheerName = Cheer
cheermoteGenericBitsName = Bits
cheermoteUnknownUserIdPrefix = cheer_
cheermoteDefaultType = cheer

[commands]
enabled = true
`;
        reloadConfig(cooldownConfig);

        expect(currentConfig.cooldowns).toBeDefined();
        expect(currentConfig.cooldowns.defaultCooldown).toBe(60);
        expect(currentConfig.cooldowns.heavyCommandCooldown).toBe(300);
        expect(currentConfig.cooldowns.maxEntries).toBe(1000);
    });

    it('throws error when StreamElements enabled without channel IDs', () => {
        const content = buildConfig({
            streamelementsSection: `enabled = true`
        });
        setupConfigMocks(content);
        process.env.CHAT_BOT_CONFIG_PATH = testConfigPath;

        expect(() => loadFreshConfig()).toThrow(/StreamElements channel ID/);
    });

    it('does not throw when YouTube API usage is enabled without apiKey', () => {
        const content = buildConfig({
            youtubeSection: `enabled = true
 username = TestChannel
 enableAPI = true
 streamDetectionMethod = youtubei
 viewerCountMethod = youtubei`
        });
        setupConfigMocks(content);
        process.env.CHAT_BOT_CONFIG_PATH = testConfigPath;

        expect(() => loadFreshConfig()).not.toThrow();
    });

    it('resolves anonymousUsername defaults and overrides', () => {
        reloadConfig(buildConfig());

        expect(currentConfig.general.anonymousUsername).toBe('Anonymous User');

        const overriddenConfig = buildConfig().replace('[general]\n', '[general]\nanonymousUsername = Test Anonymous\n');
        reloadConfig(overriddenConfig);

        expect(currentConfig.general.anonymousUsername).toBe('Test Anonymous');
    });

    it('loads TWITCH_CLIENT_ID from env file when missing in process env', () => {
        const envPath = '/test/.env';
        const configWithEnv = buildConfig().replace(
            '[general]\n',
            `[general]\nenvFileReadEnabled = true\nenvFilePath = ${envPath}\n`
        );

        fs.existsSync = createMockFn((filePath) => filePath === testConfigPath || filePath === envPath);
        fs.readFileSync = createMockFn((filePath) => {
            if (filePath === testConfigPath) return configWithEnv;
            if (filePath === envPath) return 'TWITCH_CLIENT_ID=test-env-client-id\n';
            throw new Error(`ENOENT: no such file: ${filePath}`);
        });

        delete process.env.TWITCH_CLIENT_ID;
        process.env.CHAT_BOT_CONFIG_PATH = testConfigPath;

        loadFreshConfig();

        expect(String(process.env.TWITCH_CLIENT_ID)).toBe('test-env-client-id');
    });

    it('keeps existing TWITCH_CLIENT_ID when env file defines another value', () => {
        const envPath = '/test/.env';
        const configWithEnv = buildConfig().replace(
            '[general]\n',
            `[general]\nenvFileReadEnabled = true\nenvFilePath = ${envPath}\n`
        );

        fs.existsSync = createMockFn((filePath) => filePath === testConfigPath || filePath === envPath);
        fs.readFileSync = createMockFn((filePath) => {
            if (filePath === testConfigPath) return configWithEnv;
            if (filePath === envPath) return 'TWITCH_CLIENT_ID=test-env-file-client-id\n';
            throw new Error(`ENOENT: no such file: ${filePath}`);
        });

        process.env.TWITCH_CLIENT_ID = 'test-shell-client-id';
        process.env.CHAT_BOT_CONFIG_PATH = testConfigPath;

        loadFreshConfig();

        expect(String(process.env.TWITCH_CLIENT_ID)).toBe('test-shell-client-id');
    });

    it('does not set TWITCH_CLIENT_ID when env file exists without that key', () => {
        const envPath = '/test/.env';
        const configWithEnv = buildConfig().replace(
            '[general]\n',
            `[general]\nenvFileReadEnabled = true\nenvFilePath = ${envPath}\n`
        );

        fs.existsSync = createMockFn((filePath) => filePath === testConfigPath || filePath === envPath);
        fs.readFileSync = createMockFn((filePath) => {
            if (filePath === testConfigPath) return configWithEnv;
            if (filePath === envPath) return 'OTHER_KEY=value\n';
            throw new Error(`ENOENT: no such file: ${filePath}`);
        });

        delete process.env.TWITCH_CLIENT_ID;
        process.env.CHAT_BOT_CONFIG_PATH = testConfigPath;

        loadFreshConfig();

        expect(process.env.TWITCH_CLIENT_ID).toBeUndefined();
    });

    it('writes debug load message when debug mode is enabled', () => {
        const stdoutCapture = captureStdout();
        try {
            const debugConfig = buildConfig().replace('[general]\n', '[general]\ndebugEnabled = true\n');
            reloadConfig(debugConfig);

            expect(stdoutCapture.output.join('')).toContain('Successfully loaded configuration');
        } finally {
            stdoutCapture.restore();
        }
    });

    it('caches normalized config and does not reread the file on repeated load', () => {
        let reads = 0;
        setupConfigMocks(buildConfig());
        process.env.CHAT_BOT_CONFIG_PATH = testConfigPath;

        fs.readFileSync = createMockFn((filePath) => {
            if (filePath === testConfigPath) {
                reads += 1;
                return buildConfig();
            }
            throw new Error(`ENOENT: no such file: ${filePath}`);
        });

        configModule._resetConfigForTesting();
        const first = configModule.loadConfig();
        const second = configModule.loadConfig();

        expect(first).toBe(second);
        expect(reads).toBe(1);
    });

    it('rethrows non-validation loading errors', () => {
        const stderrCapture = captureStderr();
        try {
            fs.existsSync = createMockFn(() => true);
            fs.readFileSync = createMockFn(() => {
                throw new Error('failed to read config');
            });
            process.env.CHAT_BOT_CONFIG_PATH = testConfigPath;

            expect(() => loadFreshConfig()).toThrow('failed to read config');
        } finally {
            stderrCapture.restore();
        }
    });

    it('preloads TWITCH_CLIENT_ID only when env file reading is enabled', () => {
        const envPath = '/test/.env';
        const configWithEnvEnabled = buildConfig().replace(
            '[general]\n',
            `[general]\nenvFileReadEnabled = true\nenvFilePath = ${envPath}\n`
        );

        fs.existsSync = createMockFn((filePath) => filePath === testConfigPath || filePath === envPath);
        fs.readFileSync = createMockFn((filePath) => {
            if (filePath === testConfigPath) return configWithEnvEnabled;
            if (filePath === envPath) return 'TWITCH_CLIENT_ID=test-loaded-from-env\n';
            throw new Error(`ENOENT: no such file: ${filePath}`);
        });

        delete process.env.TWITCH_CLIENT_ID;
        process.env.CHAT_BOT_CONFIG_PATH = testConfigPath;

        const enabledModule = loadFreshConfigModule();
        enabledModule.loadConfig();
        expect(String(process.env.TWITCH_CLIENT_ID)).toBe('test-loaded-from-env');

        const configWithEnvDisabled = buildConfig().replace(
            '[general]\n',
            `[general]\nenvFileReadEnabled = false\nenvFilePath = ${envPath}\n`
        );
        fs.readFileSync = createMockFn((filePath) => {
            if (filePath === testConfigPath) return configWithEnvDisabled;
            if (filePath === envPath) {
                throw new Error('env file should not be read when disabled');
            }
            throw new Error(`ENOENT: no such file: ${filePath}`);
        });
        delete process.env.TWITCH_CLIENT_ID;

        const disabledModule = loadFreshConfigModule();
        disabledModule.loadConfig();
        expect(process.env.TWITCH_CLIENT_ID).toBeUndefined();
    });

    it('resets config path and cache using testing helpers', () => {
        setupConfigMocks(buildConfig());
        process.env.CHAT_BOT_CONFIG_PATH = testConfigPath;

        const configModule = loadFreshConfigModule();
        configModule.loadConfig();
        expect(configModule._getConfigPath()).toBe(testConfigPath);

        configModule._resetConfigForTesting();
        expect(configModule._getConfigPath()).toBe('./config.ini');
    });

    it('returns cached built config from the config getter', () => {
        setupConfigMocks(buildConfig());
        process.env.CHAT_BOT_CONFIG_PATH = testConfigPath;

        const { configModule } = loadFreshConfig();
        const first = configModule.config;
        const second = configModule.config;

        expect(first).toBe(second);
    });

    it('surfaces configuration validation errors through loadConfig', () => {
        const invalidConfig = buildConfig({ streamelementsSection: 'enabled = true' });
        setupConfigMocks(invalidConfig);
        process.env.CHAT_BOT_CONFIG_PATH = testConfigPath;

        const configModule = loadFreshConfigModule();

        expect(() => configModule.loadConfig()).toThrow(/Configuration validation failed/);
    });

    it('handles ENOENT and generic read failures in loadConfig catch branches', () => {
        fs.existsSync = createMockFn(() => true);
        fs.readFileSync = createMockFn(() => {
            const error = new Error('missing config file');
            (error as Error & { code?: string }).code = 'ENOENT';
            throw error;
        });
        process.env.CHAT_BOT_CONFIG_PATH = testConfigPath;

        const enoentModule = loadFreshConfigModule();
        expect(() => enoentModule.loadConfig()).toThrow('missing config file');

        fs.readFileSync = createMockFn(() => {
            throw new Error('unexpected read failure');
        });

        const genericFailureModule = loadFreshConfigModule();
        expect(() => genericFailureModule.loadConfig()).toThrow('unexpected read failure');
    });
});
