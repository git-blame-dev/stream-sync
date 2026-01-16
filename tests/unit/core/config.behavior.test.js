const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

const fs = require('fs');

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

describe('ConfigManager behavior', () => {
    let configManager;
    let config;
    let configContent;

    const setupConfigMocks = (content) => {
        configContent = content;
        fs.existsSync = createMockFn((filePath) => filePath === testConfigPath);
        fs.readFileSync = createMockFn((filePath) => {
            if (filePath === testConfigPath) return configContent;
            throw new Error(`ENOENT: no such file: ${filePath}`);
        });
    };

    beforeEach(() => {
        originalReadFileSync = fs.readFileSync;
        originalExistsSync = fs.existsSync;
        resetModules();
        const configModule = require('../../../src/core/config');
        configManager = configModule.configManager;
        config = configModule.config;
    });

    afterEach(() => {
        fs.readFileSync = originalReadFileSync;
        fs.existsSync = originalExistsSync;
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    it('throws user-friendly error when config file is missing', () => {
        fs.existsSync = createMockFn(() => false);
        configManager.config = null;
        configManager.isLoaded = false;
        configManager.configPath = '/tmp/non-existent-config.ini';

        expect(() => configManager.load()).toThrow(/Configuration file not found/);
    });

    it('throws error when required sections are missing', () => {
        setupConfigMocks('[general]\ndebugEnabled = true\n');
        configManager.config = null;
        configManager.isLoaded = false;
        configManager.configPath = testConfigPath;

        expect(() => configManager.load()).toThrow(/Missing required configuration sections/);
    });

    it('throws error when runtime config keys are missing', () => {
        const incompleteConfig = `
[general]
chatMsgGroup = statusbar chat grp
viewerCountPollingInterval = 60
maxMessageLength = 500

[obs]
enabled = true
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
        setupConfigMocks(incompleteConfig);
        configManager.config = null;
        configManager.isLoaded = false;
        configManager.configPath = testConfigPath;

        expect(() => configManager.load()).toThrow(/obs.connectionTimeoutMs/);
    });

    it('parses booleans/numbers with safe defaults when keys are missing or invalid', () => {
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
apiKey = test-api-key
innertubeInstanceTtlMs = 300000
innertubeMinTtlMs = 60000
userAgents = test-agent-1|test-agent-2

[twitch]
enabled = false
username =
apiKey =
cheermoteDefaultGiftCount = 1
cheermoteGenericCheerName = Cheer
cheermoteGenericBitsName = Bits
cheermoteUnknownUserIdPrefix = cheer_
cheermoteDefaultType = cheer

[tiktok]
enabled = false
username =
apiKey =

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
        setupConfigMocks(configWithInvalid);
        configManager.config = null;
        configManager.isLoaded = false;
        configManager.configPath = testConfigPath;
        configManager.load();

        expect(configManager.getBoolean('general', 'debugEnabled', false)).toBe(false);
        expect(configManager.getNumber('general', 'streamRetryInterval', 15)).toBe(15);
        expect(configManager.get('missing', 'key', 'default')).toBe('default');
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
        setupConfigMocks(cooldownConfig);
        configManager.config = null;
        configManager.isLoaded = false;
        configManager.configPath = testConfigPath;

        configManager.load();

        expect(config.cooldowns).toBeDefined();
        expect(config.cooldowns.defaultCooldown).toBe('60');
        expect(config.cooldowns.heavyCommandCooldown).toBe('300');
        expect(config.cooldowns.maxEntries).toBe('1000');
    });

    it('throws error when StreamElements enabled without channel IDs', () => {
        setupConfigMocks(buildConfig({
            streamelementsSection: `enabled = true
jwtToken = se-jwt-token`
        }));
        configManager.config = null;
        configManager.isLoaded = false;
        configManager.configPath = testConfigPath;

        expect(() => configManager.load()).toThrow(/StreamElements channel ID/);
    });

    it('throws error when YouTube API usage is enabled without apiKey', () => {
        setupConfigMocks(buildConfig({
            youtubeSection: `enabled = true
 username = TestChannel
 enableAPI = true
 streamDetectionMethod = youtubei
 viewerCountMethod = youtubei`
        }));
        configManager.config = null;
        configManager.isLoaded = false;
        configManager.configPath = testConfigPath;

        expect(() => configManager.load()).toThrow(/YouTube API key/);
    });
});
