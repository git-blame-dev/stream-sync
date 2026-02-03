const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { expectNoTechnicalArtifacts } = require('../helpers/assertion-helpers');

const fs = require('fs');
const CONFIG_MODULE_PATH = require.resolve('../../src/core/config');

function resetConfigModule() {
    delete require.cache[CONFIG_MODULE_PATH];
}

function loadFreshConfig() {
    resetConfigModule();
    const { config } = require('../../src/core/config');
    return { config };
}

let originalReadFileSync;
let originalExistsSync;
let originalWriteFileSync;
let originalConfigPath;

const testConfigContent = `
[general]
debugEnabled = true
messagesEnabled = true
ttsEnabled = false
chatMsgGroup = statusbar chat grp
viewerCountPollingInterval = 60
maxMessageLength = 500

[obs]
enabled = true
address = ws://localhost:4455
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

describe('Configuration System Behavior Tests', () => {
    let currentConfig;
    const testConfigPath = '/test/config.ini';

    const setupConfigMocks = (content, configPath = testConfigPath) => {
        fs.existsSync = createMockFn((filePath) => filePath === configPath);
        fs.readFileSync = createMockFn((filePath) => {
            if (filePath === configPath) return content;
            throw new Error(`ENOENT: no such file: ${filePath}`);
        });
    };

    const reloadConfig = (content = testConfigContent, configPath = testConfigPath) => {
        setupConfigMocks(content, configPath);
        process.env.CHAT_BOT_CONFIG_PATH = configPath;
        const { config } = loadFreshConfig();
        currentConfig = config;
        return { config };
    };

    beforeEach(() => {
        originalReadFileSync = fs.readFileSync;
        originalExistsSync = fs.existsSync;
        originalWriteFileSync = fs.writeFileSync;
        originalConfigPath = process.env.CHAT_BOT_CONFIG_PATH;
        reloadConfig();
    });

    afterEach(() => {
        fs.readFileSync = originalReadFileSync;
        fs.existsSync = originalExistsSync;
        fs.writeFileSync = originalWriteFileSync;
        restoreAllMocks();
        resetConfigModule();
        process.env.CHAT_BOT_CONFIG_PATH = originalConfigPath;
    });

    describe('System Startup Behavior', () => {
        it('should enable platform connections when configuration enables them', () => {
            const youtubeEnabled = currentConfig.youtube.enabled;
            const youtubeUsername = currentConfig.youtube.username;
            const youtubeApiKey = currentConfig.youtube.apiKey;

            expect(youtubeEnabled).toBe(true);
            expect(youtubeUsername).toBe('TestChannel');
            expect(youtubeApiKey).toBeUndefined();

            expectNoTechnicalArtifacts(youtubeUsername);
        });

        it('should prevent startup when an enabled platform is missing a username', () => {
            const originalStderrWrite = process.stderr.write;
            process.stderr.write = () => {};
            try {
                const missingUsernameConfig = `
${testConfigContent}

[twitch]
enabled = true
username =
clientId = test-client-id
cheermoteDefaultGiftCount = 1
cheermoteGenericCheerName = Cheer
cheermoteGenericBitsName = Bits
cheermoteUnknownUserIdPrefix = cheer_
cheermoteDefaultType = cheer

[youtube]
enabled = false
username = TestChannel
innertubeInstanceTtlMs = 300000
innertubeMinTtlMs = 60000
userAgents = test-agent-1|test-agent-2
`;
                expect(() => {
                    reloadConfig(missingUsernameConfig);
                }).toThrow(/Twitch.*username/i);
            } finally {
                process.stderr.write = originalStderrWrite;
            }
        });

        it('should provide helpful error messages for missing config files', () => {
            const originalNodeEnv = process.env.NODE_ENV;
            const originalStderrWrite = process.stderr.write;
            const stderrOutput = [];
            process.stderr.write = (msg) => stderrOutput.push(msg);
            process.env.NODE_ENV = 'production';
            try {
                fs.existsSync = createMockFn(() => false);
                process.env.CHAT_BOT_CONFIG_PATH = '/nonexistent/config.ini';

                expect(() => {
                    loadFreshConfig();
                }).toThrow(/Configuration file not found/);
                expect(stderrOutput.join('')).toContain('SETTINGS FILE MISSING');
            } finally {
                process.env.NODE_ENV = originalNodeEnv;
                process.stderr.write = originalStderrWrite;
            }
        });

        it('should not fall back when the configured path is missing', () => {
            const originalNodeEnv = process.env.NODE_ENV;
            const originalStderrWrite = process.stderr.write;
            process.stderr.write = () => {};
            process.env.NODE_ENV = 'production';
            try {
                fs.existsSync = createMockFn((path) => path === '/default/config.ini');
                process.env.CHAT_BOT_CONFIG_PATH = '/nonexistent/config.ini';

                expect(() => loadFreshConfig()).toThrow(/Configuration file not found/);
            } finally {
                process.env.NODE_ENV = originalNodeEnv;
                process.stderr.write = originalStderrWrite;
            }
        });
    });

    describe('Platform Integration Behavior', () => {
        it('should deliver correct configuration to platform factories', () => {
            const youtubeConfig = currentConfig.youtube;
            const twitchConfig = currentConfig.twitch;
            const tiktokConfig = currentConfig.tiktok;

            expect(youtubeConfig.enabled).toBe(true);
            expect(youtubeConfig.username).toBe('TestChannel');
            expect(youtubeConfig.apiKey).toBeUndefined();

            expect(twitchConfig.enabled).toBe(false);
            expect(tiktokConfig.enabled).toBe(false);

            expect(youtubeConfig.messagesEnabled).toBe(true);
            expect(youtubeConfig.followsEnabled).toBe(true);
            expect(youtubeConfig.giftsEnabled).toBe(true);
        });

        it('should apply platform-specific overrides correctly', () => {
            const configWithOverrides = `
${testConfigContent}

[youtube]
enabled = true
username = TestChannel
innertubeInstanceTtlMs = 300000
innertubeMinTtlMs = 60000
userAgents = test-agent-1|test-agent-2
messagesEnabled = false
followsEnabled = false
giftsEnabled = true
`;
            reloadConfig(configWithOverrides);

            const youtubeConfig = currentConfig.youtube;

            expect(youtubeConfig.messagesEnabled).toBe(false);
            expect(youtubeConfig.followsEnabled).toBe(false);
            expect(youtubeConfig.giftsEnabled).toBe(true);
            expect(youtubeConfig.enabled).toBe(true);
        });

        it('should handle boolean configuration values correctly for user experience', () => {
            const booleanConfig = `
${testConfigContent}

[general]
debugEnabled = true
messagesEnabled = false
ttsEnabled = TRUE
greetingsEnabled = False
chatMsgGroup = statusbar chat grp
viewerCountPollingInterval = 60
maxMessageLength = 500

[obs]
enabled = yes
address = ws://localhost:4455
connectionTimeoutMs = 10000
notificationMsgGroup = statusbar notification grp
chatPlatformLogoTwitch = twitch-img
chatPlatformLogoYouTube = youtube-img
chatPlatformLogoTikTok = tiktok-img
notificationPlatformLogoTwitch = twitch-img
notificationPlatformLogoYouTube = youtube-img
notificationPlatformLogoTikTok = tiktok-img

[commands]
enabled = 1
`;
            reloadConfig(booleanConfig);

            expect(currentConfig.general.debugEnabled).toBe(true);
            expect(currentConfig.general.messagesEnabled).toBe(false);
            expect(currentConfig.general.ttsEnabled).toBe(true);
            expect(currentConfig.general.greetingsEnabled).toBe(false);
            expect(currentConfig.obs.enabled).toBe(false);
        });
    });

    describe('Runtime Configuration Behavior', () => {
        it('should apply dynamic config path changes correctly', () => {
            const initialEnabled = currentConfig.youtube.enabled;
            expect(initialEnabled).toBe(true);

            const newConfigContent = `
[general]
debugEnabled = false
messagesEnabled = false
chatMsgGroup = statusbar chat grp
viewerCountPollingInterval = 60
maxMessageLength = 500

[obs]
enabled = false
address = ws://localhost:4455
connectionTimeoutMs = 10000
notificationMsgGroup = statusbar notification grp
chatPlatformLogoTwitch = twitch-img
chatPlatformLogoYouTube = youtube-img
chatPlatformLogoTikTok = tiktok-img
notificationPlatformLogoTwitch = twitch-img
notificationPlatformLogoYouTube = youtube-img
notificationPlatformLogoTikTok = tiktok-img

[commands]
enabled = false

[timing]
fadeDuration = 750
transitionDelay = 200
chatMessageDuration = 4500
notificationClearDelay = 500

[youtube]
enabled = false
username = DifferentChannel
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
            reloadConfig(newConfigContent);

            expect(currentConfig.youtube.enabled).toBe(false);
            expect(currentConfig.youtube.username).toBe('DifferentChannel');
            expect(currentConfig.general.debugEnabled).toBe(false);
        });

        it('should handle configuration reloading without system restart', () => {
            const initialUsername = currentConfig.youtube.username;
            expect(initialUsername).toBe('TestChannel');

            const updatedConfig = testConfigContent.replace('TestChannel', 'UpdatedChannel');
            reloadConfig(updatedConfig);

            expect(currentConfig.youtube.username).toBe('UpdatedChannel');
            expect(currentConfig.youtube.enabled).toBe(true);
        });

        it('should support explicit config path overrides', () => {
            const overrideConfig = `
${testConfigContent}

[general]
debugEnabled = false
messagesEnabled = true
chatMsgGroup = statusbar chat grp
viewerCountPollingInterval = 60
maxMessageLength = 500

[obs]
enabled = true
address = ws://localhost:4455
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

[youtube]
enabled = true
username = CLIChannel
innertubeInstanceTtlMs = 300000
innertubeMinTtlMs = 60000
userAgents = test-agent-1|test-agent-2
`;
            reloadConfig(overrideConfig);

            expect(currentConfig.general.debugEnabled).toBe(false);
            expect(currentConfig.youtube.username).toBe('CLIChannel');
            expect(currentConfig.obs.password).toBeUndefined();
        });
    });

    describe('Error Recovery Behavior', () => {
        it('should surface missing config errors without fallback', () => {
            const originalNodeEnv = process.env.NODE_ENV;
            const originalStderrWrite = process.stderr.write;
            process.stderr.write = () => {};
            process.env.NODE_ENV = 'production';
            try {
                const fallbackPath = '/fallback/config.ini';

                fs.existsSync = createMockFn((path) => path === fallbackPath);
                fs.readFileSync = createMockFn((path) => {
                    if (path === fallbackPath) return testConfigContent;
                    throw new Error(`ENOENT: no such file: ${path}`);
                });

                process.env.CHAT_BOT_CONFIG_PATH = '/nonexistent/missing.ini';

                expect(() => loadFreshConfig()).toThrow(/Configuration file not found/);
            } finally {
                process.env.NODE_ENV = originalNodeEnv;
                process.stderr.write = originalStderrWrite;
            }
        });

        it('should provide helpful errors for corrupted config files', () => {
            const originalStderrWrite = process.stderr.write;
            process.stderr.write = () => {};
            try {
                const corruptedConfig = `
[general
debugEnabled = true
broken syntax here
[obs]
enabled =
`;
                expect(() => {
                    reloadConfig(corruptedConfig);
                }).toThrow();
            } finally {
                process.stderr.write = originalStderrWrite;
            }
        });

        it('should maintain system stability during config errors', () => {
            reloadConfig();

            const initialYoutubeEnabled = currentConfig.youtube.enabled;
            expect(initialYoutubeEnabled).toBe(true);

            expect(currentConfig.youtube.enabled).toBe(true);
            expect(currentConfig.youtube.username).toBe('TestChannel');

            expect(currentConfig.general.debugEnabled).toBe(true);
            expect(currentConfig.obs.enabled).toBe(true);
        });

        it('should handle invalid boolean values gracefully', () => {
            const invalidBooleanConfig = `
${testConfigContent}

[general]
debugEnabled = maybe
messagesEnabled = sometimes
ttsEnabled = invalid
chatMsgGroup = statusbar chat grp
viewerCountPollingInterval = 60
maxMessageLength = 500

[obs]
enabled = broken
address = ws://localhost:4455
connectionTimeoutMs = 10000
notificationMsgGroup = statusbar notification grp
chatPlatformLogoTwitch = twitch-img
chatPlatformLogoYouTube = youtube-img
chatPlatformLogoTikTok = tiktok-img
notificationPlatformLogoTwitch = twitch-img
notificationPlatformLogoYouTube = youtube-img
notificationPlatformLogoTikTok = tiktok-img

[commands]
enabled = notabool
`;
            reloadConfig(invalidBooleanConfig);

            expect(currentConfig.general.debugEnabled).toBe(false);
            expect(currentConfig.general.messagesEnabled).toBe(true);
            expect(currentConfig.general.ttsEnabled).toBe(false);
            expect(currentConfig.obs.enabled).toBe(false);
        });
    });

    describe('User Experience Configuration Behavior', () => {
        it('should deliver notification settings that affect user-visible behavior', () => {
            const notificationConfig = `
${testConfigContent}

[youtube]
enabled = true
username = TestChannel
innertubeInstanceTtlMs = 300000
innertubeMinTtlMs = 60000
userAgents = test-agent-1|test-agent-2
messagesEnabled = true
giftsEnabled = false
followsEnabled = true
`;
            reloadConfig(notificationConfig);

            const youtubeConfig = currentConfig.youtube;

            expect(youtubeConfig.messagesEnabled).toBe(true);
            expect(youtubeConfig.giftsEnabled).toBe(false);
            expect(youtubeConfig.followsEnabled).toBe(true);
            expect(youtubeConfig.apiKey).toBeUndefined();

            expectNoTechnicalArtifacts(youtubeConfig.username);
        });

        it('should handle TTS configuration that affects speech behavior', () => {
            const ttsConfig = `
${testConfigContent}

[general]
ttsEnabled = true
messagesEnabled = true
chatMsgGroup = statusbar chat grp
viewerCountPollingInterval = 60
maxMessageLength = 500
`;
            reloadConfig(ttsConfig);

            const generalConfig = currentConfig.general;

            expect(generalConfig.ttsEnabled).toBe(true);
            expect(generalConfig.messagesEnabled).toBe(true);
        });

        it('should provide OBS integration settings that affect visual output', () => {
            const obsConfig = `
${testConfigContent}

[obs]
enabled = true
address = ws://localhost:4455
notificationTxt = Live Notifications
connectionTimeoutMs = 10000
notificationMsgGroup = statusbar notification grp
chatPlatformLogoTwitch = twitch-img
chatPlatformLogoYouTube = youtube-img
chatPlatformLogoTikTok = tiktok-img
notificationPlatformLogoTwitch = twitch-img
notificationPlatformLogoYouTube = youtube-img
notificationPlatformLogoTikTok = tiktok-img
`;
            reloadConfig(obsConfig);

            const obsSettings = currentConfig.obs;

            expect(obsSettings.enabled).toBe(true);
            expect(obsSettings.address).toBe('ws://localhost:4455');
            expect(obsSettings.notificationTxt).toBe('Live Notifications');

            expectNoTechnicalArtifacts(obsSettings.notificationTxt);
        });

        it('should handle platform username configuration for user identification', () => {
            const internationalConfig = `
${testConfigContent}

[youtube]
enabled = true
username = 김철수_Gaming
innertubeInstanceTtlMs = 300000
innertubeMinTtlMs = 60000
userAgents = test-agent-1|test-agent-2

[twitch]
enabled = true
username = José_Streamer
clientId = test-client-id
channel = test-channel
cheermoteDefaultGiftCount = 1
cheermoteGenericCheerName = Cheer
cheermoteGenericBitsName = Bits
cheermoteUnknownUserIdPrefix = cheer_
cheermoteDefaultType = cheer

[tiktok]
enabled = true
username = 李小明直播
`;
            reloadConfig(internationalConfig);

            const youtubeUsername = currentConfig.youtube.username;
            const twitchUsername = currentConfig.twitch.username;
            const tiktokUsername = currentConfig.tiktok.username;

            expect(youtubeUsername).toBe('김철수_Gaming');
            expect(twitchUsername).toBe('José_Streamer');
            expect(tiktokUsername).toBe('李小明直播');

            expectNoTechnicalArtifacts(youtubeUsername);
            expectNoTechnicalArtifacts(twitchUsername);
            expectNoTechnicalArtifacts(tiktokUsername);
        });

        it('should expose stream detection settings with defaults when not configured', () => {
            const general = currentConfig.general;

            expect(general.streamDetectionEnabled).toBe(true);
            expect(general.streamRetryInterval).toBe(15);
            expect(general.streamMaxRetries).toBe(-1);
            expect(general.continuousMonitoringInterval).toBe(60);
        });

        it('should honor stream detection overrides from configuration file', () => {
            const detectionConfig = `
${testConfigContent}

[general]
debugEnabled = true
messagesEnabled = true
ttsEnabled = false
streamDetectionEnabled = false
streamRetryInterval = 45
streamMaxRetries = 7
continuousMonitoringInterval = 120
chatMsgGroup = statusbar chat grp
viewerCountPollingInterval = 60
maxMessageLength = 500
`;
            reloadConfig(detectionConfig);

            const general = currentConfig.general;

            expect(general.streamDetectionEnabled).toBe(false);
            expect(general.streamRetryInterval).toBe(45);
            expect(general.streamMaxRetries).toBe(7);
            expect(general.continuousMonitoringInterval).toBe(120);
        });
    });

    describe('Configuration Schema Validation Behavior', () => {
        it('should provide guidance for incomplete platform configuration', () => {
            const originalStderrWrite = process.stderr.write;
            process.stderr.write = () => {};
            try {
                const incompleteConfig = `
${testConfigContent}

[youtube]
enabled = true
username =
innertubeInstanceTtlMs = 300000
innertubeMinTtlMs = 60000
userAgents = test-agent-1|test-agent-2
`;
                expect(() => {
                    reloadConfig(incompleteConfig);
                }).toThrow(/YouTube.*username/i);
            } finally {
                process.stderr.write = originalStderrWrite;
            }
        });

        it('should handle numeric configuration values for timing behavior', () => {
            const timingConfig = `
${testConfigContent}

[general]
cmdCoolDown = 30
viewerCountPollingInterval = 45
chatMsgGroup = statusbar chat grp
maxMessageLength = 500

[timing]
chatMessageDuration = 5000
fadeDuration = 750
transitionDelay = 200
notificationClearDelay = 500
`;
            reloadConfig(timingConfig);

            const cmdCooldown = currentConfig.general.cmdCooldownMs;
            const pollingInterval = currentConfig.general.viewerCountPollingIntervalMs;

            expect(cmdCooldown).toBe(30000);
            expect(pollingInterval).toBe(45000);

            expect(cmdCooldown).toBeGreaterThan(1000);
            expect(cmdCooldown).toBeLessThan(300000);
            expect(pollingInterval).toBeGreaterThan(5000);
            expect(pollingInterval).toBeLessThan(600000);
        });
    });
});
