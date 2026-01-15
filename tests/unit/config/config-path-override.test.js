const { describe, test, expect, it, afterEach } = require('bun:test');
const { resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

const fs = require('fs');
const os = require('os');
const path = require('path');

function writeTempConfig(content) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-bot-config-'));
    const configPath = path.join(dir, 'config.ini');
    fs.writeFileSync(configPath, content, 'utf8');
    return { dir, configPath };
}

function loadConfigWithPath(configPath) {
    const previousPath = process.env.CHAT_BOT_CONFIG_PATH;
    process.env.CHAT_BOT_CONFIG_PATH = configPath;
const { configManager, config } = require('../../../src/core/config');
    configManager.load();

    return {
        configManager,
        config,
        restoreEnv: () => {
            if (previousPath === undefined) {
                delete process.env.CHAT_BOT_CONFIG_PATH;
            } else {
                process.env.CHAT_BOT_CONFIG_PATH = previousPath;
            }
        }
    };
}

function buildMinimalConfig(overrides = {}) {
    const base = {
        general: {
            debugEnabled: 'false',
            chatMsgScene: '__smoke_scene__',
            chatMsgTxt: 'smoke chat txt',
            ttsEnabled: 'false',
            streamDetectionEnabled: 'false',
            streamRetryInterval: '15',
            streamMaxRetries: '1',
            continuousMonitoringInterval: '60',
            viewerCountPollingInterval: '60',
            chatMsgGroup: '',
            maxMessageLength: '500'
        },
        obs: {
            enabled: 'false',
            notificationTxt: 'smoke notification txt',
            notificationScene: 'smoke notification scene',
            notificationMsgGroup: 'smoke notification group',
            chatPlatformLogoTwitch: 'smoke chat twitch',
            chatPlatformLogoYouTube: 'smoke chat youtube',
            chatPlatformLogoTikTok: 'smoke chat tiktok',
            notificationPlatformLogoTwitch: 'smoke notification twitch',
            notificationPlatformLogoYouTube: 'smoke notification youtube',
            notificationPlatformLogoTikTok: 'smoke notification tiktok',
            connectionTimeoutMs: '1000'
        },
        timing: {
            fadeDuration: '250',
            notificationClearDelay: '1000',
            transitionDelay: '250',
            chatMessageDuration: '3000'
        },
        youtube: {
            enabled: 'false',
            innertubeInstanceTtlMs: '60000',
            innertubeMinTtlMs: '30000',
            userAgents: 'smoke-agent',
            streamDetectionMethod: 'api'
        },
        handcam: {
            glowEnabled: 'false',
            sourceName: 'smoke handcam',
            sceneName: 'smoke scene',
            glowFilterName: 'smoke glow',
            maxSize: '50',
            rampUpDuration: '0.5',
            holdDuration: '1',
            rampDownDuration: '0.5',
            totalSteps: '10',
            incrementPercent: '5',
            easingEnabled: 'true',
            animationInterval: '16'
        },
        cooldowns: {
            defaultCooldown: '10',
            heavyCommandCooldown: '60',
            heavyCommandThreshold: '3',
            heavyCommandWindow: '60',
            maxEntries: '100'
        },
        twitch: {
            enabled: 'false',
            cheermoteDefaultGiftCount: '1',
            cheermoteGenericCheerName: 'cheer',
            cheermoteGenericBitsName: 'bits',
            cheermoteUnknownUserIdPrefix: 'unknown',
            cheermoteDefaultType: 'bits'
        },
        commands: {
            enabled: 'false'
        }
    };

    const merged = {
        general: { ...base.general, ...(overrides.general || {}) },
        obs: { ...base.obs, ...(overrides.obs || {}) },
        timing: { ...base.timing, ...(overrides.timing || {}) },
        youtube: { ...base.youtube, ...(overrides.youtube || {}) },
        handcam: { ...base.handcam, ...(overrides.handcam || {}) },
        cooldowns: { ...base.cooldowns, ...(overrides.cooldowns || {}) },
        twitch: { ...base.twitch, ...(overrides.twitch || {}) },
        commands: { ...base.commands, ...(overrides.commands || {}) }
    };

    const lines = [];
    Object.entries(merged).forEach(([section, values]) => {
        lines.push(`[${section}]`);
        Object.entries(values).forEach(([key, value]) => {
            lines.push(`${key}=${value}`);
        });
        lines.push('');
    });

    return lines.join('\n');
}

describe('Config path override', () => {
    afterEach(() => {
        restoreAllModuleMocks();
    });

    it('loads config from CHAT_BOT_CONFIG_PATH when set', () => {
        const uniqueScene = '__smoke_scene_override__';
        const configContent = buildMinimalConfig({
            general: { chatMsgScene: uniqueScene }
        });
        const { dir, configPath } = writeTempConfig(configContent);

        let restoreEnv = null;
        try {
            const { configManager, restoreEnv: restoreEnvFn } = loadConfigWithPath(configPath);
            restoreEnv = restoreEnvFn;

            const raw = configManager.getRaw();
            expect(raw.general.chatMsgScene).toBe(uniqueScene);
        } finally {
            if (restoreEnv) {
                restoreEnv();
            }
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('provides startup-critical general defaults when values are missing', () => {
        const configContent = buildMinimalConfig({
            general: {
                chatMsgScene: '__smoke_scene_defaults__'
            }
        });
        const { dir, configPath } = writeTempConfig(configContent);

        let restoreEnv = null;
        try {
            const { config, restoreEnv: restoreEnvFn } = loadConfigWithPath(configPath);
            restoreEnv = restoreEnvFn;

            const general = config.general;
            const requiredBooleans = [
                'ttsEnabled',
                'streamDetectionEnabled',
                'userSuppressionEnabled'
            ];
            const requiredNumbers = [
                'streamRetryInterval',
                'streamMaxRetries',
                'continuousMonitoringInterval',
                'maxNotificationsPerUser',
                'suppressionWindowMs',
                'suppressionDurationMs',
                'suppressionCleanupIntervalMs'
            ];

            requiredBooleans.forEach((key) => {
                expect(typeof general[key]).toBe('boolean');
            });

            requiredNumbers.forEach((key) => {
                expect(Number.isFinite(general[key])).toBe(true);
            });

            expect(typeof general.chatMsgTxt).toBe('string');
            expect(general.chatMsgTxt.length).toBeGreaterThan(0);
            expect(typeof general.chatMsgScene).toBe('string');
            expect(general.chatMsgScene.length).toBeGreaterThan(0);
        } finally {
            if (restoreEnv) {
                restoreEnv();
            }
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
