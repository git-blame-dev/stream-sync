
const { config, configManager } = require('../../src/core/config');
const { expectNoTechnicalArtifacts, expectValidNotification } = require('../helpers/assertion-helpers');
const OptimizedTestFactory = require('../helpers/optimized-test-factory');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('Configuration System Behavior Tests', () => {
    let originalConfigPath;
    let tempConfigPath;
    let tempDir;
    let testConfigContent;
    const setConfigPath = (filePath) => {
        configManager.configPath = filePath;
        configManager.isLoaded = false;
    };

    beforeEach(() => {
        // Store original config path
        originalConfigPath = configManager.configPath;
        
        // Create temporary config path for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-bot-tests-'));
        tempConfigPath = path.join(tempDir, 'test-config.ini');
        
        // Create basic test config content
        testConfigContent = `
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
        
        // Reset config manager state
        configManager.isLoaded = false;
        configManager.config = null;
    });

    afterEach(() => {
        // Restore original config path
        configManager.configPath = originalConfigPath;
        configManager.isLoaded = false;
        configManager.config = null;
        
        // Clean up temp files/directories
        if (tempDir && fs.existsSync(tempDir)) {
            fs.readdirSync(tempDir).forEach((file) => {
                const filePath = path.join(tempDir, file);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            });
            fs.rmdirSync(tempDir);
        }
    });

    describe('System Startup Behavior', () => {
        it('should enable platform connections when configuration enables them', () => {
            // Given: Configuration enables YouTube platform
            fs.writeFileSync(tempConfigPath, testConfigContent);
            setConfigPath(tempConfigPath);
            
            // When: System reads configuration
            const youtubeEnabled = config.youtube.enabled;
            const youtubeUsername = config.youtube.username;
            const youtubeApiKey = config.youtube.apiKey;
            
            // Then: Platform integration receives correct configuration
            expect(youtubeEnabled).toBe(true);
            expect(youtubeUsername).toBe('TestChannel');
            expect(youtubeApiKey).toBe('test-api-key');
            
            // And: Configuration values are user-facing quality
            expectNoTechnicalArtifacts(youtubeUsername);
            expectNoTechnicalArtifacts(youtubeApiKey);
        });

        it('should prevent system startup when required sections are missing', () => {
            // Given: Configuration missing required section
            const incompleteConfig = `
[general]
debugEnabled = true

[obs]
enabled = true
`;
            fs.writeFileSync(tempConfigPath, incompleteConfig);
            setConfigPath(tempConfigPath);
            
            // When: System attempts to load configuration
            // Then: System provides helpful error message to user
            expect(() => {
                configManager.load();
            }).toThrow(/Missing required configuration sections/);
        });

        it('should prevent startup when an enabled platform is missing a username', () => {
            const missingUsernameConfig = `
${testConfigContent}

[twitch]
enabled = true
username =
apiKey = test-key
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
            fs.writeFileSync(tempConfigPath, missingUsernameConfig);
            setConfigPath(tempConfigPath);

            expect(() => {
                configManager.load();
            }).toThrow(/Twitch.*username/i);
        });

        it('should provide helpful error messages for missing config files', () => {
            // Given: Configuration file does not exist
            setConfigPath('/nonexistent/config.ini');
            
            // When: System attempts to load configuration
            // Then: System provides user-friendly error message
            expect(() => {
                configManager.load();
            }).toThrow(/Configuration file not found/);
        });

        it('should not fall back when the configured path is missing', () => {
            // Given: Custom config path doesn't exist but default does
            fs.writeFileSync(tempConfigPath, testConfigContent);
            setConfigPath('/nonexistent/config.ini');
            configManager.defaultConfigPath = tempConfigPath;
            
            // When: System loads with missing config
            // Then: System surfaces missing config error (no fallback)
            expect(() => configManager.load()).toThrow(/Configuration file not found/);
        });
    });

    describe('Platform Integration Behavior', () => {
        beforeEach(() => {
            fs.writeFileSync(tempConfigPath, testConfigContent);
            setConfigPath(tempConfigPath);
        });

        it('should deliver correct configuration to platform factories', () => {
            // Given: Configuration specifies platform settings
            // When: Platform factory requests configuration
            const youtubeConfig = config.youtube;
            const twitchConfig = config.twitch;
            const tiktokConfig = config.tiktok;
            
            // Then: Platform receives accurate configuration
            expect(youtubeConfig.enabled).toBe(true);
            expect(youtubeConfig.username).toBe('TestChannel');
            expect(youtubeConfig.apiKey).toBe('test-api-key');
            
            expect(twitchConfig.enabled).toBe(false);
            expect(tiktokConfig.enabled).toBe(false);
            
            // And: Configuration affects platform behavior correctly
            expect(youtubeConfig.messagesEnabled).toBe(true);
            expect(youtubeConfig.followsEnabled).toBe(true);
            expect(youtubeConfig.giftsEnabled).toBe(true);
        });

        it('should apply platform-specific overrides correctly', () => {
            // Given: Configuration with platform-specific overrides
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
            fs.writeFileSync(tempConfigPath, configWithOverrides);
            configManager.reload();
            
            // When: Platform requests configuration
            const youtubeConfig = config.youtube;
            
            // Then: Platform-specific settings override global settings
            expect(youtubeConfig.messagesEnabled).toBe(false);  // Overridden
            expect(youtubeConfig.followsEnabled).toBe(false);   // Overridden
            expect(youtubeConfig.giftsEnabled).toBe(true);      // Overridden
            expect(youtubeConfig.enabled).toBe(true);           // Platform still enabled
        });

        it('should handle boolean configuration values correctly for user experience', () => {
            // Given: Configuration with various boolean formats
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
            fs.writeFileSync(tempConfigPath, booleanConfig);
            configManager.reload();
            
            // When: System interprets boolean values
            // Then: User experiences consistent boolean behavior
            expect(config.general.debugEnabled).toBe(true);
            expect(config.general.messagesEnabled).toBe(false);
            expect(config.general.ttsEnabled).toBe(true);
            expect(config.general.greetingsEnabled).toBe(false);
            expect(config.obs.enabled).toBe(false);  // "yes" should be false (only "true" is true)
            expect(config.commands.enabled).toBe(false);  // "1" should be false (only "true" is true)
        });
    });

    describe('Runtime Configuration Behavior', () => {
        beforeEach(() => {
            fs.writeFileSync(tempConfigPath, testConfigContent);
            setConfigPath(tempConfigPath);
        });

        it('should apply dynamic config path changes correctly', () => {
            // Given: System loaded with initial config
            const initialEnabled = config.youtube.enabled;
            expect(initialEnabled).toBe(true);
            
            // When: Config path changes to different configuration
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
            const newTempPath = path.join(tempDir, 'new-test-config.ini');
            fs.writeFileSync(newTempPath, newConfigContent);
            setConfigPath(newTempPath);
            
            // Then: System behavior reflects new configuration
            expect(config.youtube.enabled).toBe(false);
            expect(config.youtube.username).toBe('DifferentChannel');
            expect(config.general.debugEnabled).toBe(false);
            
            // Clean up
            fs.unlinkSync(newTempPath);
        });

        it('should handle configuration reloading without system restart', () => {
            // Given: System running with initial configuration
            const initialUsername = config.youtube.username;
            expect(initialUsername).toBe('TestChannel');
            
            // When: Configuration file is updated and reloaded
            const updatedConfig = testConfigContent.replace('TestChannel', 'UpdatedChannel');
            fs.writeFileSync(tempConfigPath, updatedConfig);
            configManager.reload();
            
            // Then: System behavior reflects updated configuration without restart
            expect(config.youtube.username).toBe('UpdatedChannel');
            expect(config.youtube.enabled).toBe(true);  // Other settings preserved
        });

        it('should support explicit config path overrides', () => {
            // Given: Default configuration loaded
            const originalDebug = config.general.debugEnabled;
            
            // When: Alternate config path is applied
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
            const overrideTempPath = path.join(tempDir, 'override-config.ini');
            fs.writeFileSync(overrideTempPath, overrideConfig);
            setConfigPath(overrideTempPath);
            
            // Then: Config path overrides take effect
            expect(config.general.debugEnabled).toBe(false);
            expect(config.youtube.username).toBe('CLIChannel');
            expect(config.obs.password).toBe('clipass');
            
            // Clean up
            fs.unlinkSync(overrideTempPath);
        });
    });

    describe('Error Recovery Behavior', () => {
        it('should surface missing config errors without fallback', () => {
            // Given: Main config file missing even when default exists
            const fallbackPath = path.join(tempDir, 'fallback-config.ini');
            fs.writeFileSync(fallbackPath, testConfigContent);
            
            setConfigPath('/nonexistent/missing.ini');
            configManager.defaultConfigPath = fallbackPath;
            
            // When: System attempts to load configuration
            // Then: System surfaces missing config error (no fallback)
            expect(() => configManager.load()).toThrow(/Configuration file not found/);
            
            // Clean up
            fs.unlinkSync(fallbackPath);
        });

        it('should provide helpful errors for corrupted config files', () => {
            // Given: Corrupted configuration file
            const corruptedConfig = `
[general
debugEnabled = true
broken syntax here
[obs]
enabled = 
`;
            fs.writeFileSync(tempConfigPath, corruptedConfig);
            setConfigPath(tempConfigPath);
            
            // When: System attempts to load corrupted config
            // Then: System provides user-friendly error message
            expect(() => {
                configManager.load();
            }).toThrow(); // Should fail gracefully with helpful message
        });

        it('should maintain system stability during config errors', () => {
            // Given: System running with valid configuration
            fs.writeFileSync(tempConfigPath, testConfigContent);
            setConfigPath(tempConfigPath);
            configManager.load();
            
            const initialYoutubeEnabled = config.youtube.enabled;
            expect(initialYoutubeEnabled).toBe(true);
            
            // When: Configuration error occurs (file becomes inaccessible)
            fs.unlinkSync(tempConfigPath);
            
            // Then: System maintains stable state with previous configuration
            expect(config.youtube.enabled).toBe(true);  // Previous config preserved
            expect(config.youtube.username).toBe('TestChannel');  // Previous values maintained
            
            // And: System continues to provide consistent behavior
            expect(config.general.debugEnabled).toBe(true);
            expect(config.obs.enabled).toBe(true);
        });

        it('should handle invalid boolean values gracefully', () => {
            // Given: Configuration with invalid boolean values
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
            fs.writeFileSync(tempConfigPath, invalidBooleanConfig);
            setConfigPath(tempConfigPath);
            
            // When: System processes invalid boolean values
            configManager.load();
            
            // Then: System uses safe default values for user experience
            expect(config.general.debugEnabled).toBe(false);  // Invalid -> false default
            expect(config.general.messagesEnabled).toBe(false);  // Invalid -> false default
            expect(config.general.ttsEnabled).toBe(false);  // Invalid -> false default
            expect(config.obs.enabled).toBe(false);  // Invalid -> false default
            expect(config.commands.enabled).toBe(false);  // Invalid -> false default
        });
    });

    describe('User Experience Configuration Behavior', () => {
        beforeEach(() => {
            fs.writeFileSync(tempConfigPath, testConfigContent);
            setConfigPath(tempConfigPath);
        });

        it('should deliver notification settings that affect user-visible behavior', () => {
            // Given: Configuration with notification settings
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
            fs.writeFileSync(tempConfigPath, notificationConfig);
            configManager.reload();
            
            // When: System checks notification behavior
            const youtubeConfig = config.youtube;
            
            // Then: User-visible notification behavior is configured correctly
            expect(youtubeConfig.messagesEnabled).toBe(true);   // User will see chat messages
            expect(youtubeConfig.giftsEnabled).toBe(false);     // User will NOT see gift notifications
            expect(youtubeConfig.followsEnabled).toBe(true);    // User will see follow notifications
            
            // And: Configuration values are clean for user experience
            expectNoTechnicalArtifacts(youtubeConfig.username);
            expectNoTechnicalArtifacts(youtubeConfig.apiKey);
        });

        it('should handle TTS configuration that affects speech behavior', () => {
            // Given: Configuration with TTS settings
            const ttsConfig = `
${testConfigContent}

[general]
ttsEnabled = true
messagesEnabled = true
chatMsgGroup = statusbar chat grp
viewerCountPollingInterval = 60
maxMessageLength = 500
`;
            fs.writeFileSync(tempConfigPath, ttsConfig);
            configManager.reload();
            
            // When: System checks TTS behavior
            const generalConfig = config.general;
            
            // Then: Speech functionality is configured correctly for user experience
            expect(generalConfig.ttsEnabled).toBe(true);        // User will hear speech
            expect(generalConfig.messagesEnabled).toBe(true);   // Messages will be spoken
        });

        it('should provide OBS integration settings that affect visual output', () => {
            // Given: Configuration with OBS settings
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
            fs.writeFileSync(tempConfigPath, obsConfig);
            configManager.reload();
            
            // When: System accesses OBS configuration
            const obsSettings = config.obs;
            
            // Then: Visual output behavior is configured correctly
            expect(obsSettings.enabled).toBe(true);
            expect(obsSettings.address).toBe('ws://localhost:4455');
            expect(obsSettings.notificationTxt).toBe('Live Notifications');
            expect(obsSettings.chatMsgTxt).toBe('Live Chat Display');
            
            // And: OBS text source names are user-friendly
            expectNoTechnicalArtifacts(obsSettings.notificationTxt);
            expectNoTechnicalArtifacts(obsSettings.chatMsgTxt);
        });

        it('should handle platform username configuration for user identification', () => {
            // Given: Configuration with international usernames
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
apiKey = twitch-key
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
            fs.writeFileSync(tempConfigPath, internationalConfig);
            configManager.reload();
            
            // When: System processes international usernames
            const youtubeUsername = config.youtube.username;
            const twitchUsername = config.twitch.username;
            const tiktokUsername = config.tiktok.username;
            
            // Then: International characters are preserved for user identification
            expect(youtubeUsername).toBe('김철수_Gaming');
            expect(twitchUsername).toBe('José_Streamer');
            expect(tiktokUsername).toBe('李小明直播');
            
            // And: Usernames maintain character integrity
            expectNoTechnicalArtifacts(youtubeUsername);
            expectNoTechnicalArtifacts(twitchUsername);
            expectNoTechnicalArtifacts(tiktokUsername);
        });

        it('should expose stream detection settings with defaults when not configured', () => {
            // Given: Base configuration without stream detection overrides
            fs.writeFileSync(tempConfigPath, testConfigContent);
            setConfigPath(tempConfigPath);

            // When: System reads general stream detection settings
            const general = config.general;

            // Then: Defaults are applied for resilient startup
            expect(general.streamDetectionEnabled).toBe(true);
            expect(general.streamRetryInterval).toBe(15);
            expect(general.streamMaxRetries).toBe(-1);
            expect(general.continuousMonitoringInterval).toBe(60);
        });

        it('should honor stream detection overrides from configuration file', () => {
            // Given: Configuration with explicit stream detection overrides
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
            fs.writeFileSync(tempConfigPath, detectionConfig);
            setConfigPath(tempConfigPath);

            // When: System reads general stream detection settings
            const general = config.general;

            // Then: Config values flow through for user-facing behavior
            expect(general.streamDetectionEnabled).toBe(false);
            expect(general.streamRetryInterval).toBe(45);
            expect(general.streamMaxRetries).toBe(7);
            expect(general.continuousMonitoringInterval).toBe(120);
        });
    });

    describe('Configuration Schema Validation Behavior', () => {
        it('should validate required sections exist for system operation', () => {
            // Given: Configuration missing critical sections
            const minimalConfig = `
[general]
debugEnabled = true
`;
            fs.writeFileSync(tempConfigPath, minimalConfig);
            setConfigPath(tempConfigPath);
            
            // When: System validates configuration schema
            // Then: System identifies missing required sections
            expect(() => {
                configManager.load();
            }).toThrow(/Missing required configuration sections.*obs.*commands/);
        });

        it('should provide guidance for incomplete platform configuration', () => {
            // Given: Platform enabled but missing username
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
            fs.writeFileSync(tempConfigPath, incompleteConfig);
            setConfigPath(tempConfigPath);
            
            // When/Then: System surfaces a user-facing error for missing username
            expect(() => {
                configManager.load();
            }).toThrow(/YouTube.*username/i);
        });

        it('should handle numeric configuration values for timing behavior', () => {
            // Given: Configuration with timing values
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
            fs.writeFileSync(tempConfigPath, timingConfig);
            setConfigPath(tempConfigPath);
            configManager.reload();
            
            // When: System processes numeric configuration
            const cmdCooldown = config.general.cmdCooldownMs;
            const pollingInterval = config.general.viewerCountPollingIntervalMs;
            
            // Then: Timing behavior reflects configuration (values converted to milliseconds)
            expect(cmdCooldown).toBe(30000);    // 30 seconds -> 30000ms
            expect(pollingInterval).toBe(45000); // 45 seconds -> 45000ms
            
            // And: Timing values are within reasonable ranges for user experience
            expect(cmdCooldown).toBeGreaterThan(1000);     // At least 1 second
            expect(cmdCooldown).toBeLessThan(300000);      // Less than 5 minutes
            expect(pollingInterval).toBeGreaterThan(5000); // At least 5 seconds
            expect(pollingInterval).toBeLessThan(600000);  // Less than 10 minutes
        });
    });
});
