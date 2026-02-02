const { describe, expect, it } = require('bun:test');
const { ConfigValidator } = require('../../../src/utils/config-validator');

describe('config-validator (utility) behavior', () => {
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

    it('normalizes sharesEnabled flag', () => {
        const rawEnabled = { sharesEnabled: 'true' };
        const rawDisabled = { sharesEnabled: 'false' };
        const rawDefault = {};

        expect(ConfigValidator._normalizeGeneralSection(rawEnabled).sharesEnabled).toBe(true);
        expect(ConfigValidator._normalizeGeneralSection(rawDisabled).sharesEnabled).toBe(false);
        expect(ConfigValidator._normalizeGeneralSection(rawDefault).sharesEnabled).toBe(true);
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

        expect(result.giftVideoSource).toBe('gift-video');
        expect(result.giftAudioSource).toBe('gift-audio');
    });
});

describe('ConfigValidator._normalizeSpamSection()', () => {
    it('applies spam defaults', () => {
        const result = ConfigValidator._normalizeSpamSection({});

        expect(result.enabled).toBe(true);
        expect(result.lowValueThreshold).toBe(10);
        expect(result.detectionWindow).toBe(5);
        expect(result.maxIndividualNotifications).toBe(2);
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
    it('returns empty object (logging handled separately in config.js)', () => {
        const result = ConfigValidator._normalizeLoggingSection({});

        expect(result).toEqual({});
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

    it('normalizes commands section enabled flag', () => {
        const result = ConfigValidator._normalizeCommandsSection({ enabled: 'true' });
        expect(result.enabled).toBe(true);
    });

    it('normalizes commands section preserves command definitions', () => {
        const raw = {
            enabled: 'true',
            'test-single': '!testsingle, vfx bottom green',
            'test-multi': '!testalpha|!testbravo, vfx center green, alpha|bravo'
        };
        const result = ConfigValidator._normalizeCommandsSection(raw);

        expect(result.enabled).toBe(true);
        expect(result['test-single']).toBe('!testsingle, vfx bottom green');
        expect(result['test-multi']).toBe('!testalpha|!testbravo, vfx center green, alpha|bravo');
    });

    it('normalizes commands section ignores non-string values except enabled', () => {
        const raw = {
            enabled: 'false',
            'valid-command': '!cmd, vfx top',
            'invalid-number': 123,
            'invalid-object': { foo: 'bar' },
            'invalid-null': null
        };
        const result = ConfigValidator._normalizeCommandsSection(raw);

        expect(result.enabled).toBe(false);
        expect(result['valid-command']).toBe('!cmd, vfx top');
        expect(result['invalid-number']).toBeUndefined();
        expect(result['invalid-object']).toBeUndefined();
        expect(result['invalid-null']).toBeUndefined();
    });

    it('normalizes commands section with empty input returns only enabled', () => {
        const result = ConfigValidator._normalizeCommandsSection({});

        expect(result.enabled).toBe(false);
        expect(Object.keys(result)).toEqual(['enabled']);
    });
});

describe('ConfigValidator.validate()', () => {
    const createMinimalValidConfig = () => ({
        general: { debugEnabled: false },
        obs: { enabled: false },
        commands: { enabled: false },
        tiktok: { enabled: false },
        twitch: { enabled: false },
        youtube: { enabled: false },
        streamelements: { enabled: false },
        cooldowns: { defaultCooldown: 60, heavyCommandCooldown: 120, heavyCommandThreshold: 5 },
        handcam: { maxSize: 50, rampUpDuration: 0.5, holdDuration: 6.0, rampDownDuration: 0.5 },
        retry: { baseDelay: 1000, maxDelay: 30000, maxRetries: 3 }
    });

    it('returns valid for minimal config with all required sections', () => {
        const config = createMinimalValidConfig();
        const result = ConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it('returns error for missing general section', () => {
        const config = createMinimalValidConfig();
        delete config.general;

        const result = ConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Missing required configuration section: general');
    });

    it('accepts config without obs section (uses defaults)', () => {
        const config = createMinimalValidConfig();
        delete config.obs;

        const result = ConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
    });

    it('accepts config without commands section (uses defaults)', () => {
        const config = createMinimalValidConfig();
        delete config.commands;

        const result = ConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
    });

    it('returns error when enabled platform has no username', () => {
        const config = createMinimalValidConfig();
        config.tiktok = { enabled: true, username: '' };

        const result = ConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Missing required configuration: TikTok username');
    });

    it('returns error when Twitch enabled without username', () => {
        const config = createMinimalValidConfig();
        config.twitch = { enabled: true, username: '' };

        const result = ConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Missing required configuration: Twitch username');
    });

    it('returns error when Twitch enabled without clientId', () => {
        const config = createMinimalValidConfig();
        config.twitch = { enabled: true, username: 'test-user', clientId: '' };

        const result = ConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Missing required configuration: Twitch clientId');
    });

    it('returns error when YouTube enabled without username', () => {
        const config = createMinimalValidConfig();
        config.youtube = { enabled: true, username: '' };

        const result = ConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Missing required configuration: YouTube username');
    });

    it('passes when enabled platform has username', () => {
        const config = createMinimalValidConfig();
        config.tiktok = { enabled: true, username: 'test-user' };

        const result = ConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it('returns error when StreamElements enabled without channel ID', () => {
        const config = createMinimalValidConfig();
        config.streamelements = { enabled: true, youtubeChannelId: '', twitchChannelId: '' };

        const result = ConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Missing required configuration: StreamElements channel ID (YouTube or Twitch)');
    });

    it('passes when StreamElements has YouTube channel ID', () => {
        const config = createMinimalValidConfig();
        config.streamelements = { enabled: true, youtubeChannelId: 'test-channel', twitchChannelId: '' };

        const result = ConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
    });

    it('passes when StreamElements has Twitch channel ID', () => {
        const config = createMinimalValidConfig();
        config.streamelements = { enabled: true, youtubeChannelId: '', twitchChannelId: 'test-channel' };

        const result = ConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
    });
});

describe('ConfigValidator.validate() warnings', () => {
    const createMinimalValidConfig = () => ({
        general: { debugEnabled: false },
        obs: { enabled: false },
        commands: { enabled: false },
        cooldowns: { defaultCooldown: 60, heavyCommandCooldown: 120, heavyCommandThreshold: 5 },
        handcam: { maxSize: 50, rampUpDuration: 0.5, holdDuration: 6.0, rampDownDuration: 0.5 },
        retry: { baseDelay: 1000, maxDelay: 30000, maxRetries: 3 }
    });

    it('warns when cooldown.defaultCooldown is too low', () => {
        const config = createMinimalValidConfig();
        config.cooldowns.defaultCooldown = 5;

        const result = ConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
        expect(result.warnings).toContain('cooldowns.defaultCooldown should be between 10 and 3600 seconds');
    });

    it('warns when cooldown.defaultCooldown is too high', () => {
        const config = createMinimalValidConfig();
        config.cooldowns.defaultCooldown = 5000;

        const result = ConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
        expect(result.warnings).toContain('cooldowns.defaultCooldown should be between 10 and 3600 seconds');
    });

    it('warns when handcam.maxSize is out of range', () => {
        const config = createMinimalValidConfig();
        config.handcam.maxSize = 200;

        const result = ConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
        expect(result.warnings).toContain('handcam.maxSize should be between 1 and 100');
    });

    it('warns when handcam.holdDuration is negative', () => {
        const config = createMinimalValidConfig();
        config.handcam.holdDuration = -1;

        const result = ConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
        expect(result.warnings).toContain('handcam.holdDuration must be 0 or greater');
    });

    it('allows handcam.holdDuration of 0 and large values without warning', () => {
        const configZero = createMinimalValidConfig();
        configZero.handcam.holdDuration = 0;

        const resultZero = ConfigValidator.validate(configZero);

        expect(resultZero.isValid).toBe(true);
        expect(resultZero.warnings.some(w => w.includes('holdDuration'))).toBe(false);

        const configLarge = createMinimalValidConfig();
        configLarge.handcam.holdDuration = 300;

        const resultLarge = ConfigValidator.validate(configLarge);

        expect(resultLarge.isValid).toBe(true);
        expect(resultLarge.warnings.some(w => w.includes('holdDuration'))).toBe(false);
    });

    it('warns when retry.baseDelay is too low', () => {
        const config = createMinimalValidConfig();
        config.retry.baseDelay = 50;

        const result = ConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
        expect(result.warnings).toContain('retry.baseDelay should be between 100 and 30000 milliseconds');
    });

    it('warns when retry.maxRetries is too high', () => {
        const config = createMinimalValidConfig();
        config.retry.maxRetries = 50;

        const result = ConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
        expect(result.warnings).toContain('retry.maxRetries should be between 0 and 20');
    });

    it('returns multiple warnings for multiple issues', () => {
        const config = createMinimalValidConfig();
        config.cooldowns.defaultCooldown = 5;
        config.handcam.maxSize = 200;
        config.retry.baseDelay = 50;

        const result = ConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
        expect(result.warnings.length).toBe(3);
    });

    it('returns no warnings for valid ranges', () => {
        const config = createMinimalValidConfig();

        const result = ConfigValidator.validate(config);

        expect(result.warnings).toEqual([]);
    });
});
