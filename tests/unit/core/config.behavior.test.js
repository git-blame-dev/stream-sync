const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const fs = require('fs');
const CONFIG_MODULE_PATH = require.resolve('../../../src/core/config');

function resetConfigModule() {
    delete require.cache[CONFIG_MODULE_PATH];
}

function loadFreshConfig() {
    resetConfigModule();
    return require('../../../src/core/config');
}

let originalReadFileSync;
let originalExistsSync;

const testConfigPath = '/test/config.ini';

const buildConfig = ({ youtubeSection = 'enabled = false', streamelementsSection = 'enabled = false' } = {}) => `
[general]
chatMsgGroup = statusbar chat grp
viewerCountPollingInterval = 60
maxMessageLength = 500

[obs]
enabled = true
connectionTimeoutMs = 10000
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
    });

    afterEach(() => {
        fs.readFileSync = originalReadFileSync;
        fs.existsSync = originalExistsSync;
        restoreAllMocks();
        resetConfigModule();
        delete process.env.CHAT_BOT_CONFIG_PATH;
    });

    it('throws user-friendly error when config file is missing in non-test environment', () => {
        const originalNodeEnv = process.env.NODE_ENV;
        const originalStderrWrite = process.stderr.write;
        const stderrOutput = [];
        process.stderr.write = (msg) => stderrOutput.push(msg);
        process.env.NODE_ENV = 'production';
        try {
            fs.existsSync = createMockFn(() => false);
            process.env.CHAT_BOT_CONFIG_PATH = '/tmp/non-existent-config.ini';

            expect(() => loadFreshConfig()).toThrow(/Configuration file not found/);
            expect(stderrOutput.join('')).toContain('SETTINGS FILE MISSING');
        } finally {
            process.env.NODE_ENV = originalNodeEnv;
            process.stderr.write = originalStderrWrite;
        }
    });

    it('throws error when general section is missing', () => {
        const originalStderrWrite = process.stderr.write;
        process.stderr.write = () => {};
        try {
            setupConfigMocks('[obs]\nenabled = false\n');
            process.env.CHAT_BOT_CONFIG_PATH = testConfigPath;

            expect(() => loadFreshConfig()).toThrow('Missing required configuration section: general');
        } finally {
            process.stderr.write = originalStderrWrite;
        }
    });

    it('uses safe defaults when values are invalid', () => {
        const configWithInvalid = `
[general]
debugEnabled = yes
viewerCountPollingInterval = 60
streamRetryInterval = not-a-number
chatMsgGroup = statusbar chat grp
maxMessageLength = 500

[obs]
enabled = true
connectionTimeoutMs = 10000
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
`;
        reloadConfig(configWithInvalid);

        expect(currentConfig.general.debugEnabled).toBe(false);
        expect(currentConfig.general.streamRetryInterval).toBe(15);
    });

    it('exposes cooldown configuration on the config facade', () => {
        const cooldownConfig = `
[general]
chatMsgGroup = statusbar chat grp
viewerCountPollingInterval = 60
maxMessageLength = 500

[obs]
enabled = true
connectionTimeoutMs = 10000
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
        const originalStderrWrite = process.stderr.write;
        process.stderr.write = () => {};
        try {
            const content = buildConfig({
                streamelementsSection: `enabled = true`
            });
            setupConfigMocks(content);
            process.env.CHAT_BOT_CONFIG_PATH = testConfigPath;

            expect(() => loadFreshConfig()).toThrow(/StreamElements channel ID/);
        } finally {
            process.stderr.write = originalStderrWrite;
        }
    });

    it('does not throw when YouTube API usage is enabled without apiKey', () => {
        const originalStderrWrite = process.stderr.write;
        process.stderr.write = () => {};
        try {
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
        } finally {
            process.stderr.write = originalStderrWrite;
        }
    });

    it('resolves anonymousUsername defaults and overrides', () => {
        reloadConfig(buildConfig());

        expect(currentConfig.general.anonymousUsername).toBe('Anonymous User');

        const overriddenConfig = buildConfig().replace('[general]\n', '[general]\nanonymousUsername = Test Anonymous\n');
        reloadConfig(overriddenConfig);

        expect(currentConfig.general.anonymousUsername).toBe('Test Anonymous');
    });
});
