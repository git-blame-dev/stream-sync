const { describe, expect, beforeEach, it } = require('bun:test');
const { noOpLogger } = require('../../helpers/mock-factories');
const { ConfigValidator } = require('../../../src/utils/config-validator');

describe('config-validator (utility) behavior', () => {
    let validator;

    beforeEach(() => {
        validator = new ConfigValidator(noOpLogger);
    });

    it('parses booleans, strings, and numbers with defaults and bounds', () => {
        expect(ConfigValidator.parseBoolean('true', false)).toBe(true);
        expect(ConfigValidator.parseBoolean('invalid', true)).toBe(true);
        expect(ConfigValidator.parseString(null, 'default')).toBe('default');
        expect(ConfigValidator.parseNumber('5', { defaultValue: 0, min: 1, max: 10 })).toBe(5);
        expect(ConfigValidator.parseNumber('bad', { defaultValue: 3 })).toBe(3);
    });

    it('rejects non-finite numeric values', () => {
        expect(ConfigValidator.parseNumber(Infinity, { defaultValue: 7 })).toBe(7);
        expect(ConfigValidator.parseNumber(-Infinity, { defaultValue: 7 })).toBe(7);
        expect(ConfigValidator.parseNumber('Infinity', { defaultValue: 7 })).toBe(7);
    });

    it('validates retry config with bounds', () => {
        const retry = validator.validateRetryConfig({ maxRetries: 50, baseDelay: 50, maxDelay: 999999, enableRetry: 'false' });

        expect(retry.maxRetries).toBe(3);
        expect(retry.baseDelay).toBe(1000);
        expect(retry.maxDelay).toBe(30000);
        expect(retry.enableRetry).toBe(false);
    });

    it('returns config with undefined apiKey when API enabled without key', () => {
        const apiConfig = validator.validateApiConfig({ enabled: true, useAPI: true }, 'youtube');

        expect(apiConfig.enabled).toBe(true);
        expect(apiConfig.apiKey).toBeUndefined();
    });
});

describe('ConfigValidator.normalize()', () => {
    const ALL_SECTIONS = [
        'general', 'http', 'obs', 'tiktok', 'twitch', 'youtube',
        'handcam', 'goals', 'gifts', 'timing', 'cooldowns', 'tts',
        'spam', 'displayQueue', 'retry', 'intervals', 'connectionLimits',
        'api', 'logging', 'farewell', 'commands', 'vfx', 'streamelements',
        'follows', 'raids', 'paypiggies', 'greetings'
    ];

    it('returns object with all config sections', () => {
        const rawConfig = {};
        const normalized = ConfigValidator.normalize(rawConfig);

        ALL_SECTIONS.forEach(section => {
            expect(normalized).toHaveProperty(section);
            expect(typeof normalized[section]).toBe('object');
        });
    });

    it('handles empty raw config with defaults', () => {
        const normalized = ConfigValidator.normalize({});

        expect(Object.keys(normalized).length).toBe(ALL_SECTIONS.length);
        expect(normalized.general.debugEnabled).toBe(false);
        expect(normalized.general.cmdCoolDown).toBe(60);
    });

    it('handles missing sections gracefully', () => {
        const rawConfig = { general: { debugEnabled: 'true' } };
        const normalized = ConfigValidator.normalize(rawConfig);

        expect(normalized.twitch.enabled).toBe(false);
        expect(normalized.youtube.enabled).toBe(false);
        expect(normalized.tiktok.enabled).toBe(false);
    });
});

describe('ConfigValidator._normalizeGeneralSection()', () => {
    it('converts string booleans to actual booleans', () => {
        const raw = { debugEnabled: 'true', messagesEnabled: 'false' };
        const result = ConfigValidator._normalizeGeneralSection(raw);

        expect(result.debugEnabled).toBe(true);
        expect(result.messagesEnabled).toBe(false);
    });

    it('converts string numbers to actual numbers', () => {
        const raw = { cmdCoolDown: '120', maxMessageLength: '1000' };
        const result = ConfigValidator._normalizeGeneralSection(raw);

        expect(result.cmdCoolDown).toBe(120);
        expect(result.maxMessageLength).toBe(1000);
    });

    it('applies defaults for missing fields', () => {
        const result = ConfigValidator._normalizeGeneralSection({});

        expect(result.debugEnabled).toBe(false);
        expect(result.cmdCoolDown).toBe(60);
        expect(result.fallbackUsername).toBe('Unknown User');
    });

    it('preserves string values', () => {
        const raw = { chatMsgTxt: 'test-source', fallbackUsername: 'TestUser' };
        const result = ConfigValidator._normalizeGeneralSection(raw);

        expect(result.chatMsgTxt).toBe('test-source');
        expect(result.fallbackUsername).toBe('TestUser');
    });
});

describe('ConfigValidator._normalizeHttpSection()', () => {
    it('applies default timeouts', () => {
        const result = ConfigValidator._normalizeHttpSection({});

        expect(result.defaultTimeoutMs).toBe(10000);
        expect(result.reachabilityTimeoutMs).toBe(5000);
    });

    it('converts string timeouts to numbers', () => {
        const raw = { defaultTimeoutMs: '15000' };
        const result = ConfigValidator._normalizeHttpSection(raw);

        expect(result.defaultTimeoutMs).toBe(15000);
    });

    it('uses default user agents when none provided', () => {
        const result = ConfigValidator._normalizeHttpSection({});

        expect(Array.isArray(result.userAgents)).toBe(true);
        expect(result.userAgents.length).toBeGreaterThan(0);
    });
});

describe('ConfigValidator._normalizeObsSection()', () => {
    it('applies OBS defaults', () => {
        const result = ConfigValidator._normalizeObsSection({});

        expect(result.enabled).toBe(false);
        expect(result.address).toBe('ws://localhost:4455');
        expect(result.connectionTimeoutMs).toBe(10000);
    });

    it('converts string values correctly', () => {
        const raw = { enabled: 'true', address: 'ws://custom:4455' };
        const result = ConfigValidator._normalizeObsSection(raw);

        expect(result.enabled).toBe(true);
        expect(result.address).toBe('ws://custom:4455');
    });
});

describe('ConfigValidator._normalizeTiktokSection()', () => {
    it('applies TikTok defaults', () => {
        const result = ConfigValidator._normalizeTiktokSection({});

        expect(result.enabled).toBe(false);
        expect(result.username).toBe('');
        expect(result.viewerCountEnabled).toBe(true);
    });

    it('normalizes platform-specific fields', () => {
        const raw = { enabled: 'true', username: 'test-user', giftAggregationEnabled: 'false' };
        const result = ConfigValidator._normalizeTiktokSection(raw);

        expect(result.enabled).toBe(true);
        expect(result.username).toBe('test-user');
        expect(result.giftAggregationEnabled).toBe(false);
    });

    it('allows null for platform-overrideable flags', () => {
        const result = ConfigValidator._normalizeTiktokSection({});

        expect(result.greetNewCommentors).toBeNull();
        expect(result.messagesEnabled).toBeNull();
    });
});

describe('ConfigValidator._normalizeTwitchSection()', () => {
    it('applies Twitch defaults', () => {
        const result = ConfigValidator._normalizeTwitchSection({});

        expect(result.enabled).toBe(false);
        expect(result.eventsubEnabled).toBe(true);
        expect(result.tokenStorePath).toBe('./data/twitch-tokens.json');
    });

    it('normalizes channel and username', () => {
        const raw = { username: 'test-streamer', channel: 'test-channel' };
        const result = ConfigValidator._normalizeTwitchSection(raw);

        expect(result.username).toBe('test-streamer');
        expect(result.channel).toBe('test-channel');
    });
});

describe('ConfigValidator._normalizeYoutubeSection()', () => {
    it('applies YouTube defaults', () => {
        const result = ConfigValidator._normalizeYoutubeSection({});

        expect(result.enabled).toBe(false);
        expect(result.streamDetectionMethod).toBe('youtubei');
        expect(result.maxStreams).toBe(2);
    });

    it('validates stream detection method', () => {
        const rawValid = { streamDetectionMethod: 'api' };
        const rawInvalid = { streamDetectionMethod: 'invalid' };

        expect(ConfigValidator._normalizeYoutubeSection(rawValid).streamDetectionMethod).toBe('api');
        expect(ConfigValidator._normalizeYoutubeSection(rawInvalid).streamDetectionMethod).toBe('youtubei');
    });
});

describe('ConfigValidator._normalizeHandcamSection()', () => {
    it('applies handcam defaults', () => {
        const result = ConfigValidator._normalizeHandcamSection({});

        expect(result.glowEnabled).toBe(false);
        expect(result.maxSize).toBe(50);
        expect(result.rampUpDuration).toBe(0.5);
    });

    it('converts animation timing values', () => {
        const raw = { holdDuration: '10.0', totalSteps: '60' };
        const result = ConfigValidator._normalizeHandcamSection(raw);

        expect(result.holdDuration).toBe(10.0);
        expect(result.totalSteps).toBe(60);
    });
});

describe('ConfigValidator._normalizeGoalsSection()', () => {
    it('applies goals defaults', () => {
        const result = ConfigValidator._normalizeGoalsSection({});

        expect(result.enabled).toBe(false);
        expect(result.tiktokGoalTarget).toBe(1000);
        expect(result.youtubeGoalTarget).toBe(1.0);
    });
});

describe('ConfigValidator._normalizeGiftsSection()', () => {
    it('applies gifts defaults', () => {
        const result = ConfigValidator._normalizeGiftsSection({});

        expect(result.lowValueThreshold).toBe(10);
        expect(result.spamDetectionEnabled).toBe(true);
    });
});

describe('ConfigValidator._normalizeTimingSection()', () => {
    it('applies timing defaults', () => {
        const result = ConfigValidator._normalizeTimingSection({});

        expect(result.fadeDuration).toBe(750);
        expect(result.chatMessageDuration).toBe(4500);
    });
});

describe('ConfigValidator._normalizeCooldownsSection()', () => {
    it('applies cooldown defaults', () => {
        const result = ConfigValidator._normalizeCooldownsSection({});

        expect(result.defaultCooldown).toBe(5);
        expect(result.heavyCommandCooldown).toBe(30);
    });
});

describe('ConfigValidator._normalizeTtsSection()', () => {
    it('applies TTS defaults', () => {
        const result = ConfigValidator._normalizeTtsSection({});

        expect(result.deduplicationEnabled).toBe(true);
        expect(result.voice).toBe('default');
        expect(result.rate).toBe(1.0);
    });
});

describe('ConfigValidator._normalizeRetrySection()', () => {
    it('applies retry defaults', () => {
        const result = ConfigValidator._normalizeRetrySection({});

        expect(result.maxRetries).toBe(3);
        expect(result.baseDelay).toBe(1000);
        expect(result.enableRetry).toBe(true);
    });
});

describe('ConfigValidator._normalizeIntervalsSection()', () => {
    it('applies interval defaults', () => {
        const result = ConfigValidator._normalizeIntervalsSection({});

        expect(result.pollInterval).toBe(5000);
        expect(result.connectionTimeout).toBe(30000);
    });
});

describe('ConfigValidator._normalizeLoggingSection()', () => {
    it('applies logging defaults', () => {
        const result = ConfigValidator._normalizeLoggingSection({});

        expect(result.level).toBe('info');
        expect(result.enableConsole).toBe(true);
        expect(result.enableFile).toBe(false);
    });
});

describe('ConfigValidator._normalizeStreamElementsSection()', () => {
    it('applies streamelements defaults', () => {
        const result = ConfigValidator._normalizeStreamElementsSection({});

        expect(result.enabled).toBe(false);
        expect(result.youtubeChannelId).toBe('');
        expect(result.twitchChannelId).toBe('');
    });
});

describe('ConfigValidator simple command sections', () => {
    it('normalizes follows section', () => {
        const result = ConfigValidator._normalizeFollowsSection({ command: 'test-cmd' });
        expect(result.command).toBe('test-cmd');
    });

    it('normalizes raids section', () => {
        const result = ConfigValidator._normalizeRaidsSection({});
        expect(result.command).toBe('');
    });

    it('normalizes paypiggies section', () => {
        const result = ConfigValidator._normalizePaypiggiesSection({ command: 'paypig-cmd' });
        expect(result.command).toBe('paypig-cmd');
    });

    it('normalizes greetings section', () => {
        const result = ConfigValidator._normalizeGreetingsSection({});
        expect(result.command).toBe('');
    });

    it('normalizes vfx section', () => {
        const result = ConfigValidator._normalizeVfxSection({ vfxFilePath: '/path/to/vfx.json' });
        expect(result.vfxFilePath).toBe('/path/to/vfx.json');
    });

    it('normalizes farewell section', () => {
        const result = ConfigValidator._normalizeFarewellSection({ enabled: 'true', command: 'bye-cmd' });
        expect(result.enabled).toBe(true);
        expect(result.command).toBe('bye-cmd');
    });

    it('normalizes commands section', () => {
        const result = ConfigValidator._normalizeCommandsSection({ enabled: 'true' });
        expect(result.enabled).toBe(true);
    });
});
