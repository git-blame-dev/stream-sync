const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const fs = require('fs');
const { configManager: globalConfigManager } = require('../../../src/core/config');
const { ensureSecrets } = require('../../../src/utils/secret-manager');

let originalReadFileSync;
let originalWriteFileSync;
let originalExistsSync;
let originalChmodSync;
let originalStatSync;

const runtimeConfig = `
[general]
chatMsgGroup = statusbar chat grp
viewerCountPollingInterval = 30
maxMessageLength = 500

[obs]
chatPlatformLogoTwitch = twitch-img
chatPlatformLogoYouTube = youtube-img
chatPlatformLogoTikTok = tiktok-img
notificationPlatformLogoTwitch = twitch-img
notificationPlatformLogoYouTube = youtube-img
notificationPlatformLogoTikTok = tiktok-img
notificationMsgGroup = statusbar notification grp
connectionTimeoutMs = 5000

[timing]
fadeDuration = 750
transitionDelay = 200
chatMessageDuration = 4500
notificationClearDelay = 200

[youtube]
innertubeInstanceTtlMs = 300000
innertubeMinTtlMs = 60000
userAgents = agent-one

[handcam]
glowEnabled = true
sourceName = handcam
sceneName = handcam scene
glowFilterName = Glow
maxSize = 50
rampUpDuration = 0.5
holdDuration = 8.0
rampDownDuration = 0.5
totalSteps = 30
incrementPercent = 3.33
easingEnabled = true
animationInterval = 16

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
`.trim();

const baseConfig = `
[general]
messagesEnabled = true
greetingsEnabled = true
followsEnabled = true
giftsEnabled = true
raidsEnabled = true
paypiggiesEnabled = true
streamDetectionEnabled = false

[obs]
enabled = true
password =
notificationTxt = notification txt

[commands]
enabled = true

[tiktok]
enabled = true
username = hero_stream

[twitch]
enabled = true
username = hero_twitch
channel = hero_twitch

[streamelements]
enabled = true
youtubeChannelId = yt_channel
twitchChannelId = hero_twitch
jwtToken =
${runtimeConfig}
`.trim();

const createCapturingLogger = () => {
    const entries = [];
    const push = (level) => (message) => entries.push({ level, message });
    return {
        entries,
        debug: push('debug'),
        info: push('info'),
        warn: push('warn'),
        error: push('error')
    };
};

describe('secret-manager', () => {
    let configManager;
    let logger;
    let ConfigManager;
    const originalEnv = {};
    const configPath = '/test/config.ini';
    const envFilePath = '/test/.env';

    let fileStore;
    let filePermissions;

    const setupFsMocks = () => {
        fileStore = {
            [configPath]: baseConfig,
            './config.ini': baseConfig
        };
        filePermissions = {};

        fs.existsSync = createMockFn((path) => path in fileStore);
        fs.readFileSync = createMockFn((path) => {
            if (path in fileStore) return fileStore[path];
            throw new Error(`ENOENT: no such file: ${path}`);
        });
        fs.writeFileSync = createMockFn((path, content, options) => {
            fileStore[path] = content;
            if (options && options.mode) {
                filePermissions[path] = options.mode;
            }
        });
        fs.chmodSync = createMockFn((path, mode) => {
            filePermissions[path] = mode;
        });
        fs.statSync = createMockFn((path) => {
            if (!(path in fileStore)) {
                throw new Error(`ENOENT: no such file: ${path}`);
            }
            return {
                mode: (filePermissions[path] || 0o644) | 0o100000
            };
        });
    };

    beforeEach(() => {
        originalReadFileSync = fs.readFileSync;
        originalWriteFileSync = fs.writeFileSync;
        originalExistsSync = fs.existsSync;
        originalChmodSync = fs.chmodSync;
        originalStatSync = fs.statSync;

        setupFsMocks();

        globalConfigManager.isLoaded = false;
        globalConfigManager.config = null;

        ConfigManager = globalConfigManager.constructor;
        configManager = new ConfigManager(configPath);
        configManager.load();
        logger = createCapturingLogger();

        ['TIKTOK_API_KEY', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'OBS_PASSWORD', 'STREAMELEMENTS_JWT_TOKEN', 'YOUTUBE_API_KEY'].forEach((key) => {
            originalEnv[key] = process.env[key];
            delete process.env[key];
        });
    });

    afterEach(() => {
        Object.entries(originalEnv).forEach(([key, value]) => {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        });

        fs.readFileSync = originalReadFileSync;
        fs.writeFileSync = originalWriteFileSync;
        fs.existsSync = originalExistsSync;
        fs.chmodSync = originalChmodSync;
        fs.statSync = originalStatSync;
        restoreAllMocks();
        globalConfigManager.isLoaded = false;
        globalConfigManager.config = null;
    });

    it('applies environment secrets without prompting and leaves existing env file untouched', async () => {
        process.env.TIKTOK_API_KEY = 'env_tiktok_key';
        process.env.TWITCH_CLIENT_ID = 'env_client_id';
        process.env.TWITCH_CLIENT_SECRET = 'env_client_secret';
        process.env.OBS_PASSWORD = 'env_obs_password';
        process.env.STREAMELEMENTS_JWT_TOKEN = 'env_jwt_token';

        const result = await ensureSecrets({
            configManager,
            config: {
                tiktok: configManager.getSection('tiktok'),
                twitch: configManager.getSection('twitch'),
                obs: configManager.getSection('obs'),
                streamelements: configManager.getSection('streamelements')
            },
            logger,
            interactive: false,
            envFilePath,
            envFileReadEnabled: false,
            envFileWriteEnabled: false
        });

        expect(result.missingRequired).toEqual([]);
        const updatedTwitch = configManager.getSection('twitch');
        expect(updatedTwitch.clientId).toBe('env_client_id');
        expect(configManager.getSection('tiktok').apiKey).toBe('env_tiktok_key');
        expect(configManager.getSection('obs').password).toBe('env_obs_password');
        expect(envFilePath in fileStore).toBe(false);
        expect(logger.entries.some((entry) => entry.message.includes('env_tiktok_key'))).toBe(false);
    });

    it('prompts in interactive mode, persists secrets to .env, and preserves existing entries', async () => {
        const { ensureSecrets } = require('../../../src/utils/secret-manager');

        const promptValues = {
            TIKTOK_API_KEY: 'prompt_tiktok',
            TWITCH_CLIENT_ID: 'prompt_client_id',
            TWITCH_CLIENT_SECRET: 'prompt_client_secret',
            OBS_PASSWORD: 'prompt_obs_password',
            STREAMELEMENTS_JWT_TOKEN: 'prompt_jwt'
        };

        const promptFor = async (secretId) => promptValues[secretId] || '';
        fileStore[envFilePath] = 'EXISTING=keep\n';

        const result = await ensureSecrets({
            configManager,
            config: {
                tiktok: configManager.getSection('tiktok'),
                twitch: configManager.getSection('twitch'),
                obs: configManager.getSection('obs'),
                streamelements: configManager.getSection('streamelements')
            },
            logger,
            interactive: true,
            envFilePath,
            envFileReadEnabled: true,
            envFileWriteEnabled: true,
            promptFor
        });

        const envContent = fileStore[envFilePath];
        expect(envContent).toContain('EXISTING=keep');
        expect(envContent).toContain('TIKTOK_API_KEY=prompt_tiktok');
        expect(envContent).toContain('TWITCH_CLIENT_ID=prompt_client_id');
        expect(envContent).toContain('OBS_PASSWORD=prompt_obs_password');
        expect(configManager.getSection('twitch').clientSecret).toBe('prompt_client_secret');
        expect(result.persisted.sort()).toEqual(
            expect.arrayContaining(['TIKTOK_API_KEY', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'OBS_PASSWORD', 'STREAMELEMENTS_JWT_TOKEN'])
        );
        expect(logger.entries.some((entry) => entry.message.includes('prompt_client_secret'))).toBe(false);
    });

    it('writes the env file with restricted permissions', async () => {
        const { ensureSecrets } = require('../../../src/utils/secret-manager');

        const promptValues = {
            TIKTOK_API_KEY: 'prompt_tiktok',
            TWITCH_CLIENT_ID: 'prompt_client_id',
            TWITCH_CLIENT_SECRET: 'prompt_client_secret',
            OBS_PASSWORD: 'prompt_obs_password',
            STREAMELEMENTS_JWT_TOKEN: 'prompt_jwt'
        };

        const promptFor = async (secretId) => promptValues[secretId] || '';

        await ensureSecrets({
            configManager,
            config: {
                tiktok: configManager.getSection('tiktok'),
                twitch: configManager.getSection('twitch'),
                obs: configManager.getSection('obs'),
                streamelements: configManager.getSection('streamelements')
            },
            logger,
            interactive: true,
            envFilePath,
            envFileReadEnabled: false,
            envFileWriteEnabled: true,
            promptFor
        });

        expect(envFilePath in fileStore).toBe(true);

        if (process.platform !== 'win32') {
            const mode = filePermissions[envFilePath] & 0o077;
            expect(mode).toBe(0);
        }
    });

    it('requires a YouTube API key when API methods are selected', async () => {
        process.env.TIKTOK_API_KEY = 'env_tiktok_key';
        process.env.TWITCH_CLIENT_ID = 'env_client_id';
        process.env.TWITCH_CLIENT_SECRET = 'env_client_secret';
        process.env.OBS_PASSWORD = 'env_obs_password';
        process.env.STREAMELEMENTS_JWT_TOKEN = 'env_jwt_token';

        const youtubeSection = configManager.getSection('youtube');
        youtubeSection.enabled = true;
        youtubeSection.enableAPI = false;
        youtubeSection.streamDetectionMethod = 'api';
        youtubeSection.viewerCountMethod = 'youtubei';

        await expect(ensureSecrets({
            configManager,
            config: {
                tiktok: configManager.getSection('tiktok'),
                twitch: configManager.getSection('twitch'),
                obs: configManager.getSection('obs'),
                streamelements: configManager.getSection('streamelements'),
                youtube: youtubeSection
            },
            logger,
            interactive: false,
            envFilePath,
            envFileReadEnabled: false,
            envFileWriteEnabled: false
        })).rejects.toThrow(/missing required secrets/i);
    });

    it('shows colon-terminated prompts for interactive clarity', async () => {
        const { ensureSecrets } = require('../../../src/utils/secret-manager');

        const promptValues = {
            TIKTOK_API_KEY: 'prompt_tiktok',
            TWITCH_CLIENT_ID: 'prompt_client_id',
            TWITCH_CLIENT_SECRET: 'prompt_client_secret',
            OBS_PASSWORD: 'prompt_obs_password',
            STREAMELEMENTS_JWT_TOKEN: 'prompt_jwt'
        };

        const promptsSeen = [];
        const promptFor = async (secretId, promptText) => {
            promptsSeen.push({ secretId, promptText });
            return promptValues[secretId] || '';
        };

        await ensureSecrets({
            configManager,
            config: {
                tiktok: configManager.getSection('tiktok'),
                twitch: configManager.getSection('twitch'),
                obs: configManager.getSection('obs'),
                streamelements: configManager.getSection('streamelements')
            },
            logger,
            interactive: true,
            envFilePath,
            envFileReadEnabled: false,
            envFileWriteEnabled: false,
            promptFor
        });

        expect(promptsSeen).not.toHaveLength(0);
        promptsSeen.forEach(({ promptText }) => {
            expect(promptText).toMatch(/: $/);
        });
    });

    it('fails fast in non-interactive mode when required secrets are missing', async () => {
        process.env.TIKTOK_API_KEY = 'env_tiktok_key';
        process.env.OBS_PASSWORD = 'env_obs_password';
        process.env.STREAMELEMENTS_JWT_TOKEN = 'env_jwt_token';

        const twitchSection = configManager.getSection('twitch');
        twitchSection.clientId = 'config_client_id';
        twitchSection.clientSecret = 'config_client_secret';

        await expect(ensureSecrets({
            configManager,
            config: {
                tiktok: configManager.getSection('tiktok'),
                twitch: configManager.getSection('twitch'),
                obs: configManager.getSection('obs'),
                streamelements: configManager.getSection('streamelements')
            },
            logger,
            interactive: false,
            envFilePath,
            envFileReadEnabled: false,
            envFileWriteEnabled: false
        })).rejects.toThrow(/missing required secrets/i);
    });
});
