const { describe, expect, it } = require('bun:test');
const { ConfigValidator } = require('../../../src/utils/config-validator');
const { CONFIG_SCHEMA } = require('../../../src/core/config-schema');

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
        'handcam', 'goals', 'gifts', 'envelopes', 'timing', 'cooldowns',
        'spam', 'displayQueue', 'logging', 'gui', 'farewell', 'commands', 'vfx', 'streamelements',
        'follows', 'raids', 'paypiggies', 'greetings', 'shares'
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
        expect(normalized.cooldowns.cmdCooldown).toBe(60);
        expect(normalized.cooldowns.globalCmdCooldown).toBe(60);
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
        const raw = { maxMessageLength: '1000' };
        const result = ConfigValidator._normalizeGeneralSection(raw);

        expect(result.maxMessageLength).toBe(1000);
    });

    it('applies defaults for missing fields', () => {
        const result = ConfigValidator._normalizeGeneralSection({});

        expect(result.debugEnabled).toBe(false);
        expect(result.fallbackUsername).toBe('Unknown User');
    });

    it('preserves string values', () => {
        const raw = { fallbackUsername: 'TestUser', anonymousUsername: 'TestAnon' };
        const result = ConfigValidator._normalizeGeneralSection(raw);

        expect(result.fallbackUsername).toBe('TestUser');
        expect(result.anonymousUsername).toBe('TestAnon');
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

        expect(result.messagesEnabled).toBeNull();
        expect(result.greetingsEnabled).toBeNull();
    });
});

describe('ConfigValidator._normalizeTwitchSection()', () => {
    it('applies Twitch defaults', () => {
        const result = ConfigValidator._normalizeTwitchSection({});

        expect(result.enabled).toBe(false);
        expect(result.tokenStorePath).toBe('./data/twitch-tokens.json');
    });

    it('normalizes channel and username', () => {
        const raw = { username: 'test-streamer', channel: 'test-channel' };
        const result = ConfigValidator._normalizeTwitchSection(raw);

        expect(result.username).toBe('test-streamer');
        expect(result.channel).toBe('test-channel');
    });

    it('uses TWITCH_CLIENT_ID from environment only', () => {
        const originalTwitchClientId = process.env.TWITCH_CLIENT_ID;
        try {
            process.env.TWITCH_CLIENT_ID = 'test-env-client-id';
            const raw = { clientId: 'legacy-config-client-id' };
            const result = ConfigValidator._normalizeTwitchSection(raw);

            expect(result.clientId).toBe('test-env-client-id');
        } finally {
            if (originalTwitchClientId === undefined) {
                delete process.env.TWITCH_CLIENT_ID;
            } else {
                process.env.TWITCH_CLIENT_ID = originalTwitchClientId;
            }
        }
    });
});

describe('ConfigValidator._normalizeYoutubeSection()', () => {
    it('applies YouTube defaults', () => {
        const result = ConfigValidator._normalizeYoutubeSection({});

        expect(result.enabled).toBe(false);
        expect(result.streamDetectionMethod).toBe('youtubei');
        expect(result.chatMode).toBe('live');
        expect(result.maxStreams).toBe(2);
    });

    it('validates stream detection method', () => {
        const rawValid = { streamDetectionMethod: 'api' };
        const rawInvalid = { streamDetectionMethod: 'invalid' };

        expect(ConfigValidator._normalizeYoutubeSection(rawValid).streamDetectionMethod).toBe('api');
        expect(ConfigValidator._normalizeYoutubeSection(rawInvalid).streamDetectionMethod).toBe('youtubei');
    });

    it('validates chat mode and falls back to live', () => {
        const rawTop = { chatMode: 'top' };
        const rawInvalid = { chatMode: 'random' };

        expect(ConfigValidator._normalizeYoutubeSection(rawTop).chatMode).toBe('top');
        expect(ConfigValidator._normalizeYoutubeSection(rawInvalid).chatMode).toBe('live');
    });
});

describe('ConfigValidator._normalizeHandcamSection()', () => {
    it('applies handcam defaults', () => {
        const result = ConfigValidator._normalizeHandcamSection({});

        expect(result.enabled).toBe(false);
        expect(result.maxSize).toBe(50);
        expect(result.rampUpDuration).toBe(0.5);
    });

    it('converts animation timing values', () => {
        const raw = { holdDuration: '10.0', totalSteps: '60' };
        const result = ConfigValidator._normalizeHandcamSection(raw);

        expect(result.holdDuration).toBe(10.0);
        expect(result.totalSteps).toBe(60);
    });

    it('rejects out-of-range handcam values with defaults', () => {
        const tooLow = ConfigValidator._normalizeHandcamSection({
            maxSize: '0',
            rampUpDuration: '0.05',
            holdDuration: '-1',
            rampDownDuration: '0.05'
        });

        expect(tooLow.maxSize).toBe(50);
        expect(tooLow.rampUpDuration).toBe(0.5);
        expect(tooLow.holdDuration).toBe(8.0);
        expect(tooLow.rampDownDuration).toBe(0.5);

        const tooHigh = ConfigValidator._normalizeHandcamSection({
            maxSize: '200',
            rampUpDuration: '15',
            rampDownDuration: '15'
        });

        expect(tooHigh.maxSize).toBe(50);
        expect(tooHigh.rampUpDuration).toBe(0.5);
        expect(tooHigh.rampDownDuration).toBe(0.5);
    });

    it('accepts holdDuration of 0', () => {
        const result = ConfigValidator._normalizeHandcamSection({
            holdDuration: '0'
        });

        expect(result.holdDuration).toBe(0);
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

        expect(result.command).toBe('');
        expect(result.giftVideoSource).toBe('gift-video');
        expect(result.giftAudioSource).toBe('gift-audio');
    });

    it('preserves command value from raw config', () => {
        const result = ConfigValidator._normalizeGiftsSection({ command: '!gift|!donate' });

        expect(result.command).toBe('!gift|!donate');
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

        expect(result.defaultCooldown).toBe(60);
        expect(result.heavyCommandCooldown).toBe(60);
        expect(result.cmdCooldown).toBe(60);
        expect(result.globalCmdCooldown).toBe(60);
    });

    it('parses string values for cmdCooldown and globalCmdCooldown', () => {
        const result = ConfigValidator._normalizeCooldownsSection({
            cmdCooldown: '45',
            globalCmdCooldown: '90'
        });

        expect(result.cmdCooldown).toBe(45);
        expect(result.globalCmdCooldown).toBe(90);
    });

    it('rejects out-of-range cooldown values with defaults', () => {
        const tooLow = ConfigValidator._normalizeCooldownsSection({
            defaultCooldown: '5',
            heavyCommandCooldown: '30',
            heavyCommandThreshold: '1'
        });

        expect(tooLow.defaultCooldown).toBe(60);
        expect(tooLow.heavyCommandCooldown).toBe(60);
        expect(tooLow.heavyCommandThreshold).toBe(3);

        const tooHigh = ConfigValidator._normalizeCooldownsSection({
            defaultCooldown: '5000',
            heavyCommandCooldown: '5000',
            heavyCommandThreshold: '50'
        });

        expect(tooHigh.defaultCooldown).toBe(60);
        expect(tooHigh.heavyCommandCooldown).toBe(60);
        expect(tooHigh.heavyCommandThreshold).toBe(3);
    });

    it('rejects out-of-range cmdCooldown and globalCmdCooldown with defaults', () => {
        const tooLow = ConfigValidator._normalizeCooldownsSection({
            cmdCooldown: '5',
            globalCmdCooldown: '5'
        });

        expect(tooLow.cmdCooldown).toBe(60);
        expect(tooLow.globalCmdCooldown).toBe(60);

        const tooHigh = ConfigValidator._normalizeCooldownsSection({
            cmdCooldown: '5000',
            globalCmdCooldown: '5000'
        });

        expect(tooHigh.cmdCooldown).toBe(60);
        expect(tooHigh.globalCmdCooldown).toBe(60);
    });
});

describe('ConfigValidator._normalizeLoggingSection()', () => {
    it('normalizes logging settings with null defaults when not specified', () => {
        const result = ConfigValidator._normalizeLoggingSection({});

        expect(result.consoleLevel).toBe(null);
        expect(result.fileLevel).toBe(null);
        expect(result.fileLoggingEnabled).toBe(null);
    });

    it('parses user-provided logging settings', () => {
        const result = ConfigValidator._normalizeLoggingSection({
            consoleLevel: 'info',
            fileLevel: 'debug',
            fileLoggingEnabled: 'true'
        });

        expect(result.consoleLevel).toBe('info');
        expect(result.fileLevel).toBe('debug');
        expect(result.fileLoggingEnabled).toBe(true);
    });
});

describe('ConfigValidator._normalizeGuiSection()', () => {
    it('applies gui defaults when section is empty', () => {
        const result = ConfigValidator._normalizeGuiSection({});

        expect(result.enableDock).toBe(false);
        expect(result.enableOverlay).toBe(false);
        expect(result.host).toBe('127.0.0.1');
        expect(result.port).toBe(3399);
        expect(result.messageCharacterLimit).toBe(0);
        expect(result.overlayMaxMessages).toBe(3);
        expect(result.overlayMaxLinesPerMessage).toBe(3);
        expect(result.showMessages).toBe(true);
        expect(result.showCommands).toBe(true);
        expect(result.showGreetings).toBe(true);
        expect(result.showFarewells).toBe(true);
        expect(result.showFollows).toBe(true);
        expect(result.showShares).toBe(true);
        expect(result.showRaids).toBe(true);
        expect(result.showGifts).toBe(true);
        expect(result.showPaypiggies).toBe(true);
        expect(result.showGiftPaypiggies).toBe(true);
        expect(result.showEnvelopes).toBe(true);
    });

    it('parses gui section values from raw strings', () => {
        const result = ConfigValidator._normalizeGuiSection({
            enableDock: 'true',
            enableOverlay: 'true',
            host: '0.0.0.0',
            port: '3400',
            messageCharacterLimit: '120',
            overlayMaxMessages: '5',
            overlayMaxLinesPerMessage: '4',
            showMessages: 'false',
            showCommands: 'false',
            showGreetings: 'false',
            showFarewells: 'false',
            showFollows: 'false',
            showShares: 'false',
            showRaids: 'false',
            showGifts: 'false',
            showPaypiggies: 'false',
            showGiftPaypiggies: 'false',
            showEnvelopes: 'false'
        });

        expect(result.enableDock).toBe(true);
        expect(result.enableOverlay).toBe(true);
        expect(result.host).toBe('0.0.0.0');
        expect(result.port).toBe(3400);
        expect(result.messageCharacterLimit).toBe(120);
        expect(result.overlayMaxMessages).toBe(5);
        expect(result.overlayMaxLinesPerMessage).toBe(4);
        expect(result.showMessages).toBe(false);
        expect(result.showCommands).toBe(false);
        expect(result.showGreetings).toBe(false);
        expect(result.showFarewells).toBe(false);
        expect(result.showFollows).toBe(false);
        expect(result.showShares).toBe(false);
        expect(result.showRaids).toBe(false);
        expect(result.showGifts).toBe(false);
        expect(result.showPaypiggies).toBe(false);
        expect(result.showGiftPaypiggies).toBe(false);
        expect(result.showEnvelopes).toBe(false);
    });

    it('falls back to defaults for invalid gui values', () => {
        const result = ConfigValidator._normalizeGuiSection({
            host: '   ',
            port: '0',
            messageCharacterLimit: '-1',
            overlayMaxMessages: '0',
            overlayMaxLinesPerMessage: '-4'
        });

        expect(result.host).toBe('127.0.0.1');
        expect(result.port).toBe(3399);
        expect(result.messageCharacterLimit).toBe(0);
        expect(result.overlayMaxMessages).toBe(3);
        expect(result.overlayMaxLinesPerMessage).toBe(3);
    });

    it('falls back to defaults for non-integer gui numeric values', () => {
        const result = ConfigValidator._normalizeGuiSection({
            port: '3399.25',
            messageCharacterLimit: '1.2',
            overlayMaxMessages: '3.5',
            overlayMaxLinesPerMessage: '2.1'
        });

        expect(result.port).toBe(3399);
        expect(result.messageCharacterLimit).toBe(0);
        expect(result.overlayMaxMessages).toBe(3);
        expect(result.overlayMaxLinesPerMessage).toBe(3);
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

    it('normalizes envelopes section', () => {
        const result = ConfigValidator._normalizeEnvelopesSection({ command: 'envelope-cmd' });
        expect(result.command).toBe('envelope-cmd');
    });

    it('normalizes greetings section', () => {
        const result = ConfigValidator._normalizeGreetingsSection({});
        expect(result.command).toBe('');
        expect(result.customVfxProfiles).toEqual({});
    });

    it('normalizes greetings custom VFX profile entries', () => {
        const result = ConfigValidator._normalizeGreetingsSection({
            command: '!hello',
            seasonMain: 'tiktok:theonlyseasonn|youtube:@seasonYT, !water'
        });

        expect(result.command).toBe('!hello');
        expect(result.customVfxProfiles).toEqual({
            'tiktok:theonlyseasonn': {
                profileId: 'seasonMain',
                command: '!water'
            },
            'youtube:seasonyt': {
                profileId: 'seasonMain',
                command: '!water'
            }
        });
    });

    it('throws when greetings custom profile row is malformed', () => {
        expect(() => ConfigValidator._normalizeGreetingsSection({
            seasonMain: 'tiktok:theonlyseasonn|youtube:seasonYT'
        })).toThrow('greetings.seasonMain must include a comma separator');
    });

    it('throws when greetings custom profile uses unsupported platform', () => {
        expect(() => ConfigValidator._normalizeGreetingsSection({
            seasonMain: 'kick:season, !water'
        })).toThrow('greetings.seasonMain has unsupported platform: kick');
    });

    it('throws when greetings custom profile maps same identity twice', () => {
        expect(() => ConfigValidator._normalizeGreetingsSection({
            seasonMain: 'tiktok:season, !water',
            seasonAlt: 'tiktok:season, !run'
        })).toThrow('greetings custom VFX identity mapped more than once: tiktok:season');
    });

    it('normalizes shares section', () => {
        const result = ConfigValidator._normalizeSharesSection({ command: 'share-cmd' });
        expect(result.command).toBe('share-cmd');
    });

    it('normalizes shares section with default', () => {
        const result = ConfigValidator._normalizeSharesSection({});
        expect(result.command).toBe('');
    });

    it('normalizes vfx section', () => {
        const result = ConfigValidator._normalizeVfxSection({ filePath: '/path/to/vfx.json' });
        expect(result.filePath).toBe('/path/to/vfx.json');
    });

    it('normalizes farewell section', () => {
        const result = ConfigValidator._normalizeFarewellSection({ command: 'bye-cmd' });
        expect(result.command).toBe('bye-cmd');
        expect(result.timeout).toBe(300);
    });

    it('normalizes farewell timeout to numeric seconds', () => {
        const result = ConfigValidator._normalizeFarewellSection({
            command: 'bye-cmd',
            timeout: '120'
        });

        expect(result.command).toBe('bye-cmd');
        expect(result.timeout).toBe(120);
    });

    it('normalizes commands section preserves command definitions', () => {
        const raw = {
            'test-single': '!testsingle, vfx bottom green',
            'test-multi': '!testalpha|!testbravo, vfx center green, alpha|bravo'
        };
        const result = ConfigValidator._normalizeCommandsSection(raw);

        expect(result['test-single']).toBe('!testsingle, vfx bottom green');
        expect(result['test-multi']).toBe('!testalpha|!testbravo, vfx center green, alpha|bravo');
    });

    it('normalizes commands section ignores non-string values', () => {
        const raw = {
            'valid-command': '!cmd, vfx top',
            'invalid-number': 123,
            'invalid-object': { foo: 'bar' },
            'invalid-null': null
        };
        const result = ConfigValidator._normalizeCommandsSection(raw);

        expect(result['valid-command']).toBe('!cmd, vfx top');
        expect(result['invalid-number']).toBeUndefined();
        expect(result['invalid-object']).toBeUndefined();
        expect(result['invalid-null']).toBeUndefined();
    });

    it('normalizes commands section with empty input returns empty object', () => {
        const result = ConfigValidator._normalizeCommandsSection({});

        expect(Object.keys(result)).toEqual([]);
    });
});

describe('ConfigValidator.validate()', () => {
    const createMinimalValidConfig = () => ({
        general: { debugEnabled: false },
        obs: { enabled: false },
        commands: {},
        tiktok: { enabled: false },
        twitch: { enabled: false },
        youtube: { enabled: false },
        streamelements: { enabled: false },
        cooldowns: { defaultCooldown: 60, heavyCommandCooldown: 120, heavyCommandThreshold: 5 },
        handcam: { maxSize: 50, rampUpDuration: 0.5, holdDuration: 6.0, rampDownDuration: 0.5 }
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
        expect(result.errors).toContain('Missing required configuration: tiktok.username (required when tiktok is enabled)');
    });

    it('returns error when Twitch enabled without username', () => {
        const config = createMinimalValidConfig();
        config.twitch = { enabled: true, username: '' };

        const result = ConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Missing required configuration: twitch.username (required when twitch is enabled)');
    });

    it('returns error when Twitch enabled without TWITCH_CLIENT_ID env var', () => {
        const originalTwitchClientId = process.env.TWITCH_CLIENT_ID;
        try {
            delete process.env.TWITCH_CLIENT_ID;
            const config = createMinimalValidConfig();
            config.twitch = { enabled: true, username: 'test-user', clientId: 'legacy-config-client-id', channel: 'test-channel' };

            const result = ConfigValidator.validate(config);

            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('Missing required environment variable: TWITCH_CLIENT_ID (required when twitch is enabled)');
        } finally {
            if (originalTwitchClientId === undefined) {
                delete process.env.TWITCH_CLIENT_ID;
            } else {
                process.env.TWITCH_CLIENT_ID = originalTwitchClientId;
            }
        }
    });

    it('returns error when YouTube enabled without username', () => {
        const config = createMinimalValidConfig();
        config.youtube = { enabled: true, username: '' };

        const result = ConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Missing required configuration: youtube.username (required when youtube is enabled)');
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

describe('getFieldsRequiredWhenEnabled()', () => {
    const { getFieldsRequiredWhenEnabled } = require('../../../src/core/config-schema');

    it('returns username for youtube section', () => {
        const fields = getFieldsRequiredWhenEnabled('youtube');
        expect(fields).toContain('username');
    });

    it('returns username and channel for twitch section', () => {
        const fields = getFieldsRequiredWhenEnabled('twitch');
        expect(fields).toContain('username');
        expect(fields).toContain('channel');
        expect(fields).not.toContain('clientId');
    });

    it('returns username for tiktok section', () => {
        const fields = getFieldsRequiredWhenEnabled('tiktok');
        expect(fields).toContain('username');
    });

    it('returns empty array for sections without requiredWhenEnabled fields', () => {
        const fields = getFieldsRequiredWhenEnabled('general');
        expect(fields).toEqual([]);
    });

    it('returns empty array for unknown sections', () => {
        const fields = getFieldsRequiredWhenEnabled('nonexistent');
        expect(fields).toEqual([]);
    });
});

describe('ConfigValidator.validateRequiredFields()', () => {
    const {
        createTikTokConfigFixture,
        createTwitchConfigFixture,
        createYouTubeConfigFixture
    } = require('../../../tests/helpers/config-fixture');

    const createValidationTestConfig = (overrides = {}) => ({
        general: { debugEnabled: false },
        tiktok: createTikTokConfigFixture({ enabled: false, ...overrides.tiktok }),
        twitch: createTwitchConfigFixture({ enabled: false, ...overrides.twitch }),
        youtube: createYouTubeConfigFixture({ enabled: false, ...overrides.youtube })
    });

    it('adds error when enabled TikTok missing username', () => {
        const config = createValidationTestConfig({
            tiktok: { enabled: true, username: '' }
        });

        const errors = [];
        ConfigValidator.validateRequiredFields(config, errors);

        expect(errors).toContain('Missing required configuration: tiktok.username (required when tiktok is enabled)');
    });

    it('adds error when enabled YouTube missing username', () => {
        const config = createValidationTestConfig({
            youtube: { enabled: true, username: '' }
        });

        const errors = [];
        ConfigValidator.validateRequiredFields(config, errors);

        expect(errors).toContain('Missing required configuration: youtube.username (required when youtube is enabled)');
    });

    it('adds errors when enabled Twitch missing channel and TWITCH_CLIENT_ID', () => {
        const originalTwitchClientId = process.env.TWITCH_CLIENT_ID;
        try {
            delete process.env.TWITCH_CLIENT_ID;
            const config = createValidationTestConfig({
                twitch: { enabled: true, username: 'test-user', clientId: 'legacy-config-client-id', channel: '' }
            });

            const errors = [];
            ConfigValidator.validateRequiredFields(config, errors);

            expect(errors).toContain('Missing required environment variable: TWITCH_CLIENT_ID (required when twitch is enabled)');
            expect(errors).toContain('Missing required configuration: twitch.channel (required when twitch is enabled)');
        } finally {
            if (originalTwitchClientId === undefined) {
                delete process.env.TWITCH_CLIENT_ID;
            } else {
                process.env.TWITCH_CLIENT_ID = originalTwitchClientId;
            }
        }
    });

    it('adds no errors when all required fields present', () => {
        const originalTwitchClientId = process.env.TWITCH_CLIENT_ID;
        try {
            process.env.TWITCH_CLIENT_ID = 'test-env-client-id';
            const config = createValidationTestConfig({
                tiktok: { enabled: true },
                twitch: { enabled: true },
                youtube: { enabled: true }
            });

            const errors = [];
            ConfigValidator.validateRequiredFields(config, errors);

            expect(errors).toEqual([]);
        } finally {
            if (originalTwitchClientId === undefined) {
                delete process.env.TWITCH_CLIENT_ID;
            } else {
                process.env.TWITCH_CLIENT_ID = originalTwitchClientId;
            }
        }
    });

    it('ignores disabled platforms', () => {
        const config = createValidationTestConfig({
            tiktok: { enabled: false, username: '' },
            twitch: { enabled: false, username: '' },
            youtube: { enabled: false, username: '' }
        });

        const errors = [];
        ConfigValidator.validateRequiredFields(config, errors);

        expect(errors).toEqual([]);
    });

    it('validates multiple platforms independently', () => {
        const originalTwitchClientId = process.env.TWITCH_CLIENT_ID;
        try {
            delete process.env.TWITCH_CLIENT_ID;
            const config = createValidationTestConfig({
                tiktok: { enabled: true, username: '' },
                twitch: { enabled: true, username: '', clientId: 'legacy-config-client-id', channel: '' },
                youtube: { enabled: true, username: '' }
            });

            const errors = [];
            ConfigValidator.validateRequiredFields(config, errors);

            expect(errors.length).toBe(5);
            expect(errors).toContain('Missing required configuration: tiktok.username (required when tiktok is enabled)');
            expect(errors).toContain('Missing required configuration: twitch.username (required when twitch is enabled)');
            expect(errors).toContain('Missing required environment variable: TWITCH_CLIENT_ID (required when twitch is enabled)');
            expect(errors).toContain('Missing required configuration: twitch.channel (required when twitch is enabled)');
            expect(errors).toContain('Missing required configuration: youtube.username (required when youtube is enabled)');
        } finally {
            if (originalTwitchClientId === undefined) {
                delete process.env.TWITCH_CLIENT_ID;
            } else {
                process.env.TWITCH_CLIENT_ID = originalTwitchClientId;
            }
        }
    });

    it('rejects whitespace-only values as empty', () => {
        const config = createValidationTestConfig({
            tiktok: { enabled: true, username: '   ' }
        });

        const errors = [];
        ConfigValidator.validateRequiredFields(config, errors);

        expect(errors).toContain('Missing required configuration: tiktok.username (required when tiktok is enabled)');
    });
});

describe('ConfigValidator.normalizeFromSchema()', () => {
    it('parses boolean type from schema', () => {
        const result = ConfigValidator.normalizeFromSchema('general', { debugEnabled: 'true' });
        expect(result.debugEnabled).toBe(true);
    });

    it('applies default from schema when value missing', () => {
        const result = ConfigValidator.normalizeFromSchema('general', {});
        expect(result.debugEnabled).toBe(false);
        expect(result.viewerCountPollingInterval).toBe(60);
    });

    it('returns null for userDefined fields when not provided', () => {
        const result = ConfigValidator.normalizeFromSchema('vfx', {});
        expect(result.filePath).toBeNull();
    });

    it('preserves userDefined field value when provided', () => {
        const result = ConfigValidator.normalizeFromSchema('vfx', { filePath: '/path/to/vfx' });
        expect(result.filePath).toBe('/path/to/vfx');
    });

    it('validates enum values and falls back to default', () => {
        const validResult = ConfigValidator.normalizeFromSchema('youtube', { streamDetectionMethod: 'api' });
        expect(validResult.streamDetectionMethod).toBe('api');

        const invalidResult = ConfigValidator.normalizeFromSchema('youtube', { streamDetectionMethod: 'invalid' });
        expect(invalidResult.streamDetectionMethod).toBe('youtubei');
    });

    it('returns null for inheritFrom fields', () => {
        const result = ConfigValidator.normalizeFromSchema('youtube', {});
        expect(result.messagesEnabled).toBeNull();
        expect(result.greetingsEnabled).toBeNull();
    });

    it('uses CONFIG_SCHEMA for section definitions', () => {
        expect(CONFIG_SCHEMA.general).toBeDefined();
        expect(CONFIG_SCHEMA.general.debugEnabled.type).toBe('boolean');
    });

    it('returns empty object for dynamic sections', () => {
        const result = ConfigValidator.normalizeFromSchema('commands', { someCommand: '!test' });
        expect(result).toEqual({});
    });

    it('returns empty object for unknown sections', () => {
        const result = ConfigValidator.normalizeFromSchema('nonexistent', { foo: 'bar' });
        expect(result).toEqual({});
    });

    it('enforces integer schema constraints for gui numeric fields', () => {
        const result = ConfigValidator.normalizeFromSchema('gui', {
            port: '3399.5',
            messageCharacterLimit: '2.5',
            overlayMaxMessages: '3.1',
            overlayMaxLinesPerMessage: '4.9'
        });

        expect(result.port).toBe(3399);
        expect(result.messageCharacterLimit).toBe(0);
        expect(result.overlayMaxMessages).toBe(3);
        expect(result.overlayMaxLinesPerMessage).toBe(3);
    });
});
