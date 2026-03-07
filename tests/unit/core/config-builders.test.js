const { describe, it, expect } = require('bun:test');
const {
    buildGeneralConfig,
    buildPlatformConfig,
    buildObsConfig,
    buildCooldownsConfig,
    buildStreamElementsConfig,
    buildSpamConfig,
    buildHandcamConfig,
    buildGiftConfig,
    buildEnvelopeConfig,
    buildVfxConfig,
    buildConfig,
    buildLoggingConfig,
    DEFAULT_LOGGING_CONFIG
} = require('../../../src/core/config-builders');
const { ConfigValidator } = require('../../../src/utils/config-validator');
const { getRawTestConfig } = require('../../helpers/config-fixture');

describe('config-builders', () => {
    describe('buildGeneralConfig', () => {
        it('converts viewerCountPollingInterval seconds to milliseconds', () => {
            const normalized = {
                general: {
                    viewerCountPollingInterval: 120,
                    debugEnabled: false
                }
            };
            const result = buildGeneralConfig(normalized);

            expect(result.viewerCountPollingIntervalMs).toBe(120000);
        });

        it('does not produce cooldown ms fields (cooldowns now owned by buildCooldownsConfig)', () => {
            const normalized = {
                general: {
                    viewerCountPollingInterval: 10,
                    debugEnabled: false
                }
            };
            const result = buildGeneralConfig(normalized);

            expect(result.cmdCooldownMs).toBeUndefined();
            expect(result.globalCmdCooldownMs).toBeUndefined();
        });

        it('spreads remaining general fields through', () => {
            const normalized = {
                general: {
                    viewerCountPollingInterval: 10,
                    ttsEnabled: true,
                    debugEnabled: false
                }
            };
            const result = buildGeneralConfig(normalized);

            expect(result.ttsEnabled).toBe(true);
            expect(result.debugEnabled).toBe(false);
        });
    });

    describe('buildPlatformConfig', () => {
        it('converts pollInterval seconds to milliseconds', () => {
            const normalized = { tiktok: { enabled: true, pollInterval: 30 } };
            const generalConfig = { viewerCountPollingIntervalMs: 60000 };
            const result = buildPlatformConfig('tiktok', normalized, generalConfig);

            expect(result.pollIntervalMs).toBe(30000);
        });

        it('falls back to general viewerCountPollingIntervalMs when pollInterval is missing', () => {
            const normalized = { tiktok: { enabled: true } };
            const generalConfig = { viewerCountPollingIntervalMs: 45000 };
            const result = buildPlatformConfig('tiktok', normalized, generalConfig);

            expect(result.pollIntervalMs).toBe(45000);
        });

        it('inherits null values from generalConfig', () => {
            const normalized = { twitch: { enabled: true, messagesEnabled: null } };
            const generalConfig = { messagesEnabled: true, viewerCountPollingIntervalMs: 60000 };
            const result = buildPlatformConfig('twitch', normalized, generalConfig);

            expect(result.messagesEnabled).toBe(true);
        });

        it('preserves non-null platform values over generalConfig', () => {
            const normalized = { twitch: { enabled: true, messagesEnabled: false } };
            const generalConfig = { messagesEnabled: true, viewerCountPollingIntervalMs: 60000 };
            const result = buildPlatformConfig('twitch', normalized, generalConfig);

            expect(result.messagesEnabled).toBe(false);
        });

        it('returns empty platform config with defaults when platform section missing', () => {
            const normalized = {};
            const generalConfig = { viewerCountPollingIntervalMs: 60000 };
            const result = buildPlatformConfig('tiktok', normalized, generalConfig);

            expect(result.pollIntervalMs).toBe(60000);
        });

        it('sets dataLoggingPath from DEFAULTS', () => {
            const normalized = { tiktok: { enabled: true } };
            const generalConfig = { viewerCountPollingIntervalMs: 60000 };
            const result = buildPlatformConfig('tiktok', normalized, generalConfig);

            expect(result.dataLoggingPath).toBe('./logs');
        });
    });

    describe('buildObsConfig', () => {
        it('maps individual logo fields into nested platform objects', () => {
            const normalized = {
                obs: {
                    enabled: true,
                    chatPlatformLogoTwitch: 'test-twitch-chat.png',
                    chatPlatformLogoYouTube: 'test-youtube-chat.png',
                    chatPlatformLogoTikTok: 'test-tiktok-chat.png',
                    notificationPlatformLogoTwitch: 'test-twitch-notif.png',
                    notificationPlatformLogoYouTube: 'test-youtube-notif.png',
                    notificationPlatformLogoTikTok: 'test-tiktok-notif.png'
                }
            };
            const result = buildObsConfig(normalized);

            expect(result.chatPlatformLogos).toEqual({
                twitch: 'test-twitch-chat.png',
                youtube: 'test-youtube-chat.png',
                tiktok: 'test-tiktok-chat.png'
            });
            expect(result.notificationPlatformLogos).toEqual({
                twitch: 'test-twitch-notif.png',
                youtube: 'test-youtube-notif.png',
                tiktok: 'test-tiktok-notif.png'
            });
        });

        it('spreads remaining obs fields through', () => {
            const normalized = {
                obs: {
                    enabled: false,
                    address: 'ws://test:4455',
                    chatPlatformLogoTwitch: '',
                    chatPlatformLogoYouTube: '',
                    chatPlatformLogoTikTok: '',
                    notificationPlatformLogoTwitch: '',
                    notificationPlatformLogoYouTube: '',
                    notificationPlatformLogoTikTok: ''
                }
            };
            const result = buildObsConfig(normalized);

            expect(result.enabled).toBe(false);
            expect(result.address).toBe('ws://test:4455');
        });
    });

    describe('buildCooldownsConfig', () => {
        it('converts seconds to milliseconds for cooldown fields', () => {
            const normalized = {
                cooldowns: {
                    defaultCooldown: 60,
                    heavyCommandCooldown: 300,
                    heavyCommandThreshold: 4,
                    heavyCommandWindow: 360,
                    maxEntries: 1000
                }
            };
            const result = buildCooldownsConfig(normalized);

            expect(result.defaultCooldownMs).toBe(60000);
            expect(result.heavyCommandCooldownMs).toBe(300000);
            expect(result.heavyCommandWindowMs).toBe(360000);
        });

        it('preserves original seconds values alongside ms values', () => {
            const normalized = {
                cooldowns: {
                    defaultCooldown: 60,
                    heavyCommandCooldown: 300,
                    heavyCommandThreshold: 4,
                    heavyCommandWindow: 360,
                    maxEntries: 1000,
                    cmdCooldown: 60,
                    globalCmdCooldown: 60
                }
            };
            const result = buildCooldownsConfig(normalized);

            expect(result.defaultCooldown).toBe(60);
            expect(result.heavyCommandCooldown).toBe(300);
            expect(result.heavyCommandWindow).toBe(360);
            expect(result.heavyCommandThreshold).toBe(4);
            expect(result.maxEntries).toBe(1000);
            expect(result.cmdCooldown).toBe(60);
            expect(result.globalCmdCooldown).toBe(60);
        });

        it('converts cmdCooldown and globalCmdCooldown seconds to milliseconds', () => {
            const normalized = {
                cooldowns: {
                    defaultCooldown: 60,
                    heavyCommandCooldown: 300,
                    heavyCommandThreshold: 4,
                    heavyCommandWindow: 360,
                    maxEntries: 1000,
                    cmdCooldown: 45,
                    globalCmdCooldown: 90
                }
            };
            const result = buildCooldownsConfig(normalized);

            expect(result.cmdCooldownMs).toBe(45000);
            expect(result.globalCmdCooldownMs).toBe(90000);
        });
    });

    describe('buildStreamElementsConfig', () => {
        it('passes through empty channel IDs from normalizer', () => {
            const normalized = {
                streamelements: {
                    enabled: true,
                    youtubeChannelId: '',
                    twitchChannelId: '',
                    dataLoggingEnabled: false
                }
            };
            const result = buildStreamElementsConfig(normalized);

            expect(result.youtubeChannelId).toBe('');
            expect(result.twitchChannelId).toBe('');
        });

        it('preserves truthy channel IDs', () => {
            const normalized = {
                streamelements: {
                    enabled: true,
                    youtubeChannelId: 'test-yt-channel',
                    twitchChannelId: 'test-tw-channel',
                    dataLoggingEnabled: true
                }
            };
            const result = buildStreamElementsConfig(normalized);

            expect(result.youtubeChannelId).toBe('test-yt-channel');
            expect(result.twitchChannelId).toBe('test-tw-channel');
        });

        it('sets dataLoggingPath from DEFAULTS', () => {
            const normalized = {
                streamelements: {
                    enabled: false,
                    youtubeChannelId: '',
                    twitchChannelId: '',
                    dataLoggingEnabled: false
                }
            };
            const result = buildStreamElementsConfig(normalized);

            expect(result.dataLoggingPath).toBe('./logs');
        });
    });

    describe('buildSpamConfig', () => {
        it('maps all spam fields', () => {
            const normalized = {
                spam: {
                    enabled: true,
                    lowValueThreshold: 10,
                    detectionWindow: 60,
                    maxIndividualNotifications: 5,
                    tiktokEnabled: true,
                    tiktokLowValueThreshold: 5,
                    twitchEnabled: false,
                    twitchLowValueThreshold: 20,
                    youtubeEnabled: true,
                    youtubeLowValueThreshold: 15
                }
            };
            const result = buildSpamConfig(normalized);

            expect(result.enabled).toBe(true);
            expect(result.lowValueThreshold).toBe(10);
            expect(result.detectionWindow).toBe(60);
            expect(result.maxIndividualNotifications).toBe(5);
            expect(result.tiktokEnabled).toBe(true);
            expect(result.tiktokLowValueThreshold).toBe(5);
            expect(result.twitchEnabled).toBe(false);
            expect(result.twitchLowValueThreshold).toBe(20);
            expect(result.youtubeEnabled).toBe(true);
            expect(result.youtubeLowValueThreshold).toBe(15);
        });
    });

    describe('buildHandcamConfig', () => {
        it('maps all handcam fields explicitly', () => {
            const normalized = {
                handcam: {
                    enabled: true,
                    sourceName: 'test-cam',
                    glowFilterName: 'test-glow',
                    maxSize: 50,
                    rampUpDuration: 0.5,
                    holdDuration: 8.0,
                    rampDownDuration: 0.5,
                    totalSteps: 30,
                    easingEnabled: true
                }
            };
            const result = buildHandcamConfig(normalized);

            expect(result.enabled).toBe(true);
            expect(result.sourceName).toBe('test-cam');
            expect(result.glowFilterName).toBe('test-glow');
            expect(result.maxSize).toBe(50);
            expect(result.rampUpDuration).toBe(0.5);
            expect(result.holdDuration).toBe(8.0);
            expect(result.rampDownDuration).toBe(0.5);
            expect(result.totalSteps).toBe(30);
            expect(result.easingEnabled).toBe(true);
        });
    });

    describe('buildGiftConfig', () => {
        it('extracts gift command and sources', () => {
            const normalized = {
                gifts: {
                    command: '!testgift',
                    giftVideoSource: 'test-video',
                    giftAudioSource: 'test-audio',
                    extraField: 'ignored'
                }
            };
            const result = buildGiftConfig(normalized);

            expect(result.command).toBe('!testgift');
            expect(result.giftVideoSource).toBe('test-video');
            expect(result.giftAudioSource).toBe('test-audio');
            expect(result.extraField).toBeUndefined();
        });
    });

    describe('buildEnvelopeConfig', () => {
        it('extracts envelope command only', () => {
            const normalized = {
                envelopes: {
                    command: '!testenvelope',
                    extraField: 'ignored'
                }
            };
            const result = buildEnvelopeConfig(normalized);

            expect(result.command).toBe('!testenvelope');
            expect(result.extraField).toBeUndefined();
        });
    });

    describe('buildVfxConfig', () => {
        it('extracts filePath only', () => {
            const normalized = {
                vfx: {
                    filePath: 'test/vfx.json',
                    extraField: 'ignored'
                }
            };
            const result = buildVfxConfig(normalized);

            expect(result.filePath).toBe('test/vfx.json');
            expect(result.extraField).toBeUndefined();
        });
    });

    describe('buildLoggingConfig', () => {
        const minNormalized = {
            general: { debugEnabled: false },
            logging: {}
        };

        it('returns default nested shape when no overrides', () => {
            const result = buildLoggingConfig(minNormalized);

            expect(result.console).toEqual({ enabled: true, level: 'console' });
            expect(result.file.enabled).toBe(true);
            expect(result.file.level).toBe('debug');
            expect(result.file.directory).toBe('./logs');
            expect(result.platforms.twitch.enabled).toBe(true);
            expect(result.chat.enabled).toBe(true);
        });

        it('sets console level to debug when debugEnabled is true', () => {
            const result = buildLoggingConfig({
                general: { debugEnabled: true },
                logging: {}
            });

            expect(result.console.level).toBe('debug');
        });

        it('keeps console level debug when debugMode option is true even if config debugEnabled is false', () => {
            const result = buildLoggingConfig(
                { general: { debugEnabled: false }, logging: {} },
                { debugMode: true }
            );

            expect(result.console.level).toBe('debug');
        });

        it('applies flat consoleLevel override from logging section', () => {
            const result = buildLoggingConfig({
                general: { debugEnabled: false },
                logging: { consoleLevel: 'info' }
            });

            expect(result.console.level).toBe('info');
        });

        it('applies flat fileLevel override from logging section', () => {
            const result = buildLoggingConfig({
                general: { debugEnabled: false },
                logging: { fileLevel: 'warn' }
            });

            expect(result.file.level).toBe('warn');
        });

        it('applies fileLoggingEnabled override from logging section', () => {
            const result = buildLoggingConfig({
                general: { debugEnabled: false },
                logging: { fileLoggingEnabled: false }
            });

            expect(result.file.enabled).toBe(false);
            expect(result.chat.enabled).toBe(false);
        });

        it('rejects invalid console level and falls back to console', () => {
            const result = buildLoggingConfig({
                general: { debugEnabled: false },
                logging: { consoleLevel: 'invalid-level' }
            });

            expect(result.console.level).toBe('console');
        });

        it('rejects invalid file level and falls back to debug', () => {
            const result = buildLoggingConfig({
                general: { debugEnabled: false },
                logging: { fileLevel: 'invalid-level' }
            });

            expect(result.file.level).toBe('debug');
        });

        it('exports DEFAULT_LOGGING_CONFIG for use by logging system', () => {
            expect(DEFAULT_LOGGING_CONFIG).toBeDefined();
            expect(DEFAULT_LOGGING_CONFIG.console.enabled).toBe(true);
            expect(DEFAULT_LOGGING_CONFIG.file.enabled).toBe(true);
        });
    });

    describe('buildConfig', () => {
        it('includes gui section from normalized config', () => {
            const normalized = ConfigValidator.normalize(getRawTestConfig());
            normalized.gui = {
                ...normalized.gui,
                enableDock: true,
                messageCharacterLimit: 120
            };

            const result = buildConfig(normalized);

            expect(result.gui).toEqual(normalized.gui);
        });
    });
});
