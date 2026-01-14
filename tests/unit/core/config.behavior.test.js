const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

mockModule('../../../src/utils/user-friendly-errors', () => ({
    handleUserFacingError: createMockFn()
}));

const fs = require('fs');
const os = require('os');
const path = require('path');

const { handleUserFacingError } = require('../../../src/utils/user-friendly-errors');
const { config, configManager } = require('../../../src/core/config');

describe('ConfigManager behavior', () => {
    const originalState = {
        configPath: configManager.configPath,
        defaultConfigPath: configManager.defaultConfigPath,
        config: configManager.config,
        isLoaded: configManager.isLoaded
    };

    const writeTempConfig = (content) => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-behavior-'));
        const filePath = path.join(tempDir, 'config.ini');
        fs.writeFileSync(filePath, content);
        return filePath;
    };

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

    const resetConfigManagerState = () => {
        configManager.configPath = originalState.configPath;
        configManager.defaultConfigPath = originalState.defaultConfigPath;
        configManager.config = originalState.config;
        configManager.isLoaded = originalState.isLoaded;
    };

    beforeEach(() => {
        resetConfigManagerState();
        clearAllMocks();
    });

    afterEach(() => {
        resetConfigManagerState();
    });

    it('surfaces user-friendly error when config file is missing', () => {
        configManager.config = null;
        configManager.isLoaded = false;
        configManager.configPath = '/tmp/non-existent-config.ini';

        expect(() => configManager.load()).toThrow(/Configuration file not found/);
        expect(handleUserFacingError).toHaveBeenCalledWith(
            expect.any(Error),
            expect.objectContaining({ category: 'configuration', operation: 'loading' }),
            expect.objectContaining({ showInConsole: true, includeActions: true })
        );
    });

    it('fails validation when required sections are missing and reports via user-facing error', () => {
        const filePath = writeTempConfig('[general]\ndebugEnabled = true\n');
        configManager.config = null;
        configManager.isLoaded = false;
        configManager.configPath = filePath;

        expect(() => configManager.load()).toThrow(/Missing required configuration sections/);
        expect(handleUserFacingError).toHaveBeenCalledWith(
            expect.any(Error),
            expect.objectContaining({ category: 'configuration', operation: 'loading' }),
            expect.objectContaining({ showInConsole: true })
        );
    });

    it('fails validation when runtime config keys are missing', () => {
        const filePath = writeTempConfig(`
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
`);
        configManager.config = null;
        configManager.isLoaded = false;
        configManager.configPath = filePath;

        expect(() => configManager.load()).toThrow(/obs.connectionTimeoutMs/);
        expect(handleUserFacingError).toHaveBeenCalledWith(
            expect.any(Error),
            expect.objectContaining({ category: 'configuration', operation: 'loading' }),
            expect.objectContaining({ showInConsole: true })
        );
    });

    it('parses booleans/numbers with safe defaults when keys are missing or invalid', () => {
        const filePath = writeTempConfig(`
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
`);
        configManager.config = null;
        configManager.isLoaded = false;
        configManager.configPath = filePath;
        configManager.load();

        // Invalid boolean resolves to false because only explicit "true" passes
        expect(configManager.getBoolean('general', 'debugEnabled', false)).toBe(false);
        // Invalid number falls back to default provided
        expect(configManager.getNumber('general', 'streamRetryInterval', 15)).toBe(15);
        // Missing section keys return defaults without throwing
        expect(configManager.get('missing', 'key', 'default')).toBe('default');
    });

    it('exposes cooldown configuration on the config facade', () => {
        const filePath = writeTempConfig(`
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
`);
        configManager.config = null;
        configManager.isLoaded = false;
        configManager.configPath = filePath;

        configManager.load();

        expect(config.cooldowns).toBeDefined();
        expect(config.cooldowns.defaultCooldown).toBe('60');
        expect(config.cooldowns.heavyCommandCooldown).toBe('300');
        expect(config.cooldowns.maxEntries).toBe('1000');
    });

    it('fails validation when StreamElements enabled without channel IDs', () => {
        const filePath = writeTempConfig(buildConfig({
            streamelementsSection: `enabled = true
jwtToken = se-jwt-token`
        }));
        configManager.config = null;
        configManager.isLoaded = false;
        configManager.configPath = filePath;

        expect(() => configManager.load()).toThrow(/StreamElements channel ID/);
    });

    it('fails validation when YouTube API usage is enabled without apiKey', () => {
        const filePath = writeTempConfig(buildConfig({
            youtubeSection: `enabled = true
 username = TestChannel
 enableAPI = true
 streamDetectionMethod = youtubei
 viewerCountMethod = youtubei`
        }));
        configManager.config = null;
        configManager.isLoaded = false;
        configManager.configPath = filePath;

        expect(() => configManager.load()).toThrow(/YouTube API key/);
    });

    afterAll(() => {
        restoreAllModuleMocks();
    });

});
