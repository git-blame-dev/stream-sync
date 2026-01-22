const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { expectNoTechnicalArtifacts } = require('../helpers/assertion-helpers');

const fs = require('fs');
const { config, configManager } = require('../../src/core/config');

let originalReadFileSync;
let originalExistsSync;
let originalWriteFileSync;

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
password = testpass
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

describe('Configuration System Behavior Tests', () => {
    let configContent;
    let originalDefaultConfigPath;
    const testConfigPath = '/test/config.ini';

    const setupConfigMocks = (content) => {
        configContent = content;
        fs.existsSync = createMockFn((filePath) => filePath === testConfigPath);
        fs.readFileSync = createMockFn((filePath) => {
            if (filePath === testConfigPath) return configContent;
            throw new Error(`ENOENT: no such file: ${filePath}`);
        });
    };

    const reloadConfig = () => {
        configManager.configPath = testConfigPath;
        configManager.isLoaded = false;
        configManager.config = null;
        configManager.load();
    };

    beforeEach(() => {
        originalReadFileSync = fs.readFileSync;
        originalExistsSync = fs.existsSync;
        originalWriteFileSync = fs.writeFileSync;
        originalDefaultConfigPath = configManager.defaultConfigPath;
        setupConfigMocks(testConfigContent);
        reloadConfig();
    });

    afterEach(() => {
        fs.readFileSync = originalReadFileSync;
        fs.existsSync = originalExistsSync;
        fs.writeFileSync = originalWriteFileSync;
        restoreAllMocks();
        configManager.isLoaded = false;
        configManager.config = null;
        configManager.defaultConfigPath = originalDefaultConfigPath;
        configManager.configPath = originalDefaultConfigPath;
    });

    describe('System Startup Behavior', () => {
        it('should enable platform connections when configuration enables them', () => {
            const youtubeEnabled = config.youtube.enabled;
            const youtubeUsername = config.youtube.username;
            const youtubeApiKey = config.youtube.apiKey;

            expect(youtubeEnabled).toBe(true);
            expect(youtubeUsername).toBe('TestChannel');
            expect(youtubeApiKey).toBe(process.env.YOUTUBE_API_KEY);

            expectNoTechnicalArtifacts(youtubeUsername);
        });

        it('should prevent system startup when required sections are missing', () => {
            const originalStderrWrite = process.stderr.write;
            process.stderr.write = () => {};
            try {
                const incompleteConfig = `
[general]
debugEnabled = true

[obs]
enabled = true
`;
                setupConfigMocks(incompleteConfig);

                expect(() => {
                    reloadConfig();
                }).toThrow(/Missing required configuration sections/);
            } finally {
                process.stderr.write = originalStderrWrite;
            }
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
cheermoteDefaultGiftCount = 1
cheermoteGenericCheerName = Cheer
cheermoteGenericBitsName = Bits
cheermoteUnknownUserIdPrefix = cheer_
cheermoteDefaultType = cheer

[youtube]
enabled = false
username = TestChannel
apiKey = test-api-key
innertubeInstanceTtlMs = 300000
innertubeMinTtlMs = 60000
userAgents = test-agent-1|test-agent-2
`;
                setupConfigMocks(missingUsernameConfig);

                expect(() => {
                    reloadConfig();
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

                expect(() => {
                    reloadConfig();
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

                configManager.configPath = '/nonexistent/config.ini';
                configManager.defaultConfigPath = '/default/config.ini';
                configManager.isLoaded = false;
                configManager.config = null;

                expect(() => configManager.load()).toThrow(/Configuration file not found/);
            } finally {
                process.env.NODE_ENV = originalNodeEnv;
                process.stderr.write = originalStderrWrite;
            }
        });
    });

    describe('Platform Integration Behavior', () => {
        it('should deliver correct configuration to platform factories', () => {
            const youtubeConfig = config.youtube;
            const twitchConfig = config.twitch;
            const tiktokConfig = config.tiktok;

            expect(youtubeConfig.enabled).toBe(true);
            expect(youtubeConfig.username).toBe('TestChannel');
            expect(youtubeConfig.apiKey).toBe(process.env.YOUTUBE_API_KEY);

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
apiKey = test-api-key
innertubeInstanceTtlMs = 300000
innertubeMinTtlMs = 60000
userAgents = test-agent-1|test-agent-2
messagesEnabled = false
followsEnabled = false
giftsEnabled = true
`;
            setupConfigMocks(configWithOverrides);
            reloadConfig();

            const youtubeConfig = config.youtube;

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
password = testpass
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
            setupConfigMocks(booleanConfig);
            reloadConfig();

            expect(config.general.debugEnabled).toBe(true);
            expect(config.general.messagesEnabled).toBe(false);
            expect(config.general.ttsEnabled).toBe(true);
            expect(config.general.greetingsEnabled).toBe(false);
            expect(config.obs.enabled).toBe(false);
            expect(config.commands.enabled).toBe(false);
        });
    });

    describe('Runtime Configuration Behavior', () => {
        it('should apply dynamic config path changes correctly', () => {
            const initialEnabled = config.youtube.enabled;
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
apiKey = different-key
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
            setupConfigMocks(newConfigContent);
            reloadConfig();

            expect(config.youtube.enabled).toBe(false);
            expect(config.youtube.username).toBe('DifferentChannel');
            expect(config.general.debugEnabled).toBe(false);
        });

        it('should handle configuration reloading without system restart', () => {
            const initialUsername = config.youtube.username;
            expect(initialUsername).toBe('TestChannel');

            const updatedConfig = testConfigContent.replace('TestChannel', 'UpdatedChannel');
            setupConfigMocks(updatedConfig);
            configManager.reload();

            expect(config.youtube.username).toBe('UpdatedChannel');
            expect(config.youtube.enabled).toBe(true);
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
password = clipass
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
apiKey = cli-key
innertubeInstanceTtlMs = 300000
innertubeMinTtlMs = 60000
userAgents = test-agent-1|test-agent-2
`;
            setupConfigMocks(overrideConfig);
            reloadConfig();

            expect(config.general.debugEnabled).toBe(false);
            expect(config.youtube.username).toBe('CLIChannel');
            expect(config.obs.password).toBe(process.env.OBS_PASSWORD);
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

                configManager.configPath = '/nonexistent/missing.ini';
                configManager.defaultConfigPath = fallbackPath;
                configManager.isLoaded = false;
                configManager.config = null;

                expect(() => configManager.load()).toThrow(/Configuration file not found/);
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
                setupConfigMocks(corruptedConfig);

                expect(() => {
                    reloadConfig();
                }).toThrow();
            } finally {
                process.stderr.write = originalStderrWrite;
            }
        });

        it('should maintain system stability during config errors', () => {
            reloadConfig();

            const initialYoutubeEnabled = config.youtube.enabled;
            expect(initialYoutubeEnabled).toBe(true);

            expect(config.youtube.enabled).toBe(true);
            expect(config.youtube.username).toBe('TestChannel');

            expect(config.general.debugEnabled).toBe(true);
            expect(config.obs.enabled).toBe(true);
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
            setupConfigMocks(invalidBooleanConfig);
            reloadConfig();

            expect(config.general.debugEnabled).toBe(false);
            expect(config.general.messagesEnabled).toBe(false);
            expect(config.general.ttsEnabled).toBe(false);
            expect(config.obs.enabled).toBe(false);
            expect(config.commands.enabled).toBe(false);
        });
    });

    describe('User Experience Configuration Behavior', () => {
        it('should deliver notification settings that affect user-visible behavior', () => {
            const notificationConfig = `
${testConfigContent}

[youtube]
enabled = true
username = TestChannel
apiKey = test-key
innertubeInstanceTtlMs = 300000
innertubeMinTtlMs = 60000
userAgents = test-agent-1|test-agent-2
messagesEnabled = true
giftsEnabled = false
followsEnabled = true
`;
            setupConfigMocks(notificationConfig);
            reloadConfig();

            const youtubeConfig = config.youtube;

            expect(youtubeConfig.messagesEnabled).toBe(true);
            expect(youtubeConfig.giftsEnabled).toBe(false);
            expect(youtubeConfig.followsEnabled).toBe(true);
            expect(youtubeConfig.apiKey).toBe(process.env.YOUTUBE_API_KEY);

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
            setupConfigMocks(ttsConfig);
            reloadConfig();

            const generalConfig = config.general;

            expect(generalConfig.ttsEnabled).toBe(true);
            expect(generalConfig.messagesEnabled).toBe(true);
        });

        it('should provide OBS integration settings that affect visual output', () => {
            const obsConfig = `
${testConfigContent}

[obs]
enabled = true
address = ws://localhost:4455
password = secure123
notificationTxt = Live Notifications
chatMsgTxt = Live Chat Display
connectionTimeoutMs = 10000
notificationMsgGroup = statusbar notification grp
chatPlatformLogoTwitch = twitch-img
chatPlatformLogoYouTube = youtube-img
chatPlatformLogoTikTok = tiktok-img
notificationPlatformLogoTwitch = twitch-img
notificationPlatformLogoYouTube = youtube-img
notificationPlatformLogoTikTok = tiktok-img
`;
            setupConfigMocks(obsConfig);
            reloadConfig();

            const obsSettings = config.obs;

            expect(obsSettings.enabled).toBe(true);
            expect(obsSettings.address).toBe('ws://localhost:4455');
            expect(obsSettings.notificationTxt).toBe('Live Notifications');
            expect(obsSettings.chatMsgTxt).toBe('Live Chat Display');

            expectNoTechnicalArtifacts(obsSettings.notificationTxt);
            expectNoTechnicalArtifacts(obsSettings.chatMsgTxt);
        });

        it('should handle platform username configuration for user identification', () => {
            const internationalConfig = `
${testConfigContent}

[youtube]
enabled = true
username = 김철수_Gaming
apiKey = test-key
innertubeInstanceTtlMs = 300000
innertubeMinTtlMs = 60000
userAgents = test-agent-1|test-agent-2

[twitch]
enabled = true
username = José_Streamer
cheermoteDefaultGiftCount = 1
cheermoteGenericCheerName = Cheer
cheermoteGenericBitsName = Bits
cheermoteUnknownUserIdPrefix = cheer_
cheermoteDefaultType = cheer

[tiktok]
enabled = true
username = 李小明直播
apiKey = tiktok-key
`;
            setupConfigMocks(internationalConfig);
            reloadConfig();

            const youtubeUsername = config.youtube.username;
            const twitchUsername = config.twitch.username;
            const tiktokUsername = config.tiktok.username;

            expect(youtubeUsername).toBe('김철수_Gaming');
            expect(twitchUsername).toBe('José_Streamer');
            expect(tiktokUsername).toBe('李小明直播');

            expectNoTechnicalArtifacts(youtubeUsername);
            expectNoTechnicalArtifacts(twitchUsername);
            expectNoTechnicalArtifacts(tiktokUsername);
        });

        it('should expose stream detection settings with defaults when not configured', () => {
            const general = config.general;

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
            setupConfigMocks(detectionConfig);
            reloadConfig();

            const general = config.general;

            expect(general.streamDetectionEnabled).toBe(false);
            expect(general.streamRetryInterval).toBe(45);
            expect(general.streamMaxRetries).toBe(7);
            expect(general.continuousMonitoringInterval).toBe(120);
        });
    });

    describe('Configuration Schema Validation Behavior', () => {
        it('should validate required sections exist for system operation', () => {
            const originalStderrWrite = process.stderr.write;
            process.stderr.write = () => {};
            try {
                const minimalConfig = `
[general]
debugEnabled = true
`;
                setupConfigMocks(minimalConfig);

                expect(() => {
                    reloadConfig();
                }).toThrow(/Missing required configuration sections.*obs.*commands/);
            } finally {
                process.stderr.write = originalStderrWrite;
            }
        });

        it('should provide guidance for incomplete platform configuration', () => {
            const originalStderrWrite = process.stderr.write;
            process.stderr.write = () => {};
            try {
                const incompleteConfig = `
${testConfigContent}

[youtube]
enabled = true
apiKey = test-key
username =
innertubeInstanceTtlMs = 300000
innertubeMinTtlMs = 60000
userAgents = test-agent-1|test-agent-2
`;
                setupConfigMocks(incompleteConfig);

                expect(() => {
                    reloadConfig();
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
defaultNotificationDuration = 3500
fadeDuration = 750
transitionDelay = 200
notificationClearDelay = 500
`;
            setupConfigMocks(timingConfig);
            reloadConfig();

            const cmdCooldown = config.general.cmdCooldownMs;
            const pollingInterval = config.general.viewerCountPollingIntervalMs;

            expect(cmdCooldown).toBe(30000);
            expect(pollingInterval).toBe(45000);

            expect(cmdCooldown).toBeGreaterThan(1000);
            expect(cmdCooldown).toBeLessThan(300000);
            expect(pollingInterval).toBeGreaterThan(5000);
            expect(pollingInterval).toBeLessThan(600000);
        });
    });
});
