const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { validateLoggingConfig } = require('../../src/core/config');
const { setConfigValidator } = require('../../src/core/logging');

const buildSmokeConfigIni = () => `[general]
debugEnabled=true
chatMsgTxt=smoke chat txt
chatMsgScene=smoke chat scene
chatMsgGroup=
ttsEnabled=false
streamDetectionEnabled=false
streamRetryInterval=15
streamMaxRetries=1
continuousMonitoringInterval=60
userSuppressionEnabled=false
viewerCountPollingInterval=60
maxMessageLength=500

[obs]
enabled=false
notificationTxt=smoke notification txt
notificationScene=smoke notification scene
notificationMsgGroup=smoke notification group
chatPlatformLogoTwitch=smoke chat twitch
chatPlatformLogoYouTube=smoke chat youtube
chatPlatformLogoTikTok=smoke chat tiktok
notificationPlatformLogoTwitch=smoke notification twitch
notificationPlatformLogoYouTube=smoke notification youtube
notificationPlatformLogoTikTok=smoke notification tiktok
connectionTimeoutMs=1000
ttsTxt=smoke tts txt
ttsScene=smoke tts scene

[timing]
fadeDuration=250
notificationClearDelay=1000
transitionDelay=250
chatMessageDuration=3000

[youtube]
enabled=false
innertubeInstanceTtlMs=60000
innertubeMinTtlMs=30000
userAgents=smoke-agent
streamDetectionMethod=api

[handcam]
glowEnabled=false
sourceName=smoke handcam
sceneName=smoke scene
glowFilterName=smoke glow
maxSize=50
rampUpDuration=0.5
holdDuration=1
rampDownDuration=0.5
totalSteps=10
incrementPercent=5
easingEnabled=true
animationInterval=16

[cooldowns]
defaultCooldown=10
heavyCommandCooldown=60
heavyCommandThreshold=3
heavyCommandWindow=60
maxEntries=100

[twitch]
enabled=false
cheermoteDefaultGiftCount=1
cheermoteGenericCheerName=cheer
cheermoteGenericBitsName=bits
cheermoteUnknownUserIdPrefix=unknown
cheermoteDefaultType=bits

[commands]
enabled=false

[logging]
consoleLevel=debug

[tiktok]
enabled=false
`;

describe('Startup wiring smoke', () => {
    let tempDir;
    let tempConfigPath;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-smoke-'));
        tempConfigPath = path.join(tempDir, 'config.smoke.ini');
        fs.writeFileSync(tempConfigPath, buildSmokeConfigIni());
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('core startup modules can be required and initialized', () => {
        expect(typeof validateLoggingConfig).toBe('function');
        expect(typeof setConfigValidator).toBe('function');

        setConfigValidator(validateLoggingConfig);
    });

    test('smoke config file exists and is readable', () => {
        expect(fs.existsSync(tempConfigPath)).toBe(true);

        const content = fs.readFileSync(tempConfigPath, 'utf-8');
        expect(content).toContain('[general]');
        expect(content).toContain('[obs]');
        expect(content).toContain('[commands]');
    });

    test('bootstrap file exists', () => {
        const bootstrapPath = path.join(__dirname, '../../src/bootstrap.js');

        expect(fs.existsSync(bootstrapPath)).toBe(true);
    });
});
