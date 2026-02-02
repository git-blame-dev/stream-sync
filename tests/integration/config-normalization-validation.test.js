const { describe, expect, it } = require('bun:test');
const { ConfigValidator } = require('../../src/utils/config-validator');

describe('ConfigValidator normalize + validate integration', () => {
    it('full config normalization and validation flow', () => {
        const rawConfig = {
            general: { debugEnabled: 'true', cmdCoolDown: '60' },
            obs: { enabled: 'false', address: 'ws://localhost:4455' },
            commands: {},
            tiktok: { enabled: 'false' },
            twitch: { enabled: 'false' },
            youtube: { enabled: 'false' }
        };

        const normalized = ConfigValidator.normalize(rawConfig);

        expect(normalized.general.debugEnabled).toBe(true);
        expect(normalized.general.cmdCoolDown).toBe(60);
        expect(normalized.obs.enabled).toBe(false);

        const validation = ConfigValidator.validate(normalized);

        expect(validation.isValid).toBe(true);
        expect(validation.errors).toEqual([]);
    });

    it('missing general section fails validation', () => {
        const manualConfig = { obs: {}, commands: {} };
        const validation = ConfigValidator.validate(manualConfig);

        expect(validation.isValid).toBe(false);
        expect(validation.errors).toContain('Missing required configuration section: general');
    });

    it('enabled platform without username fails validation', () => {
        const rawConfig = {
            general: {},
            obs: {},
            commands: {},
            tiktok: { enabled: 'true', username: '' }
        };

        const normalized = ConfigValidator.normalize(rawConfig);
        const validation = ConfigValidator.validate(normalized);

        expect(validation.isValid).toBe(false);
        expect(validation.errors).toContain('Missing required configuration: TikTok username');
    });

    it('enabled platform with username passes validation', () => {
        const rawConfig = {
            general: {},
            obs: {},
            commands: {},
            tiktok: { enabled: 'true', username: 'test-streamer' }
        };

        const normalized = ConfigValidator.normalize(rawConfig);
        const validation = ConfigValidator.validate(normalized);

        expect(validation.isValid).toBe(true);
        expect(normalized.tiktok.enabled).toBe(true);
        expect(normalized.tiktok.username).toBe('test-streamer');
    });

    it('defaults applied for missing fields', () => {
        const rawConfig = { general: {}, obs: {}, commands: {} };
        const normalized = ConfigValidator.normalize(rawConfig);

        expect(normalized.general.debugEnabled).toBe(false);
        expect(normalized.general.cmdCoolDown).toBe(60);
        expect(normalized.general.messagesEnabled).toBe(true);
        expect(normalized.http.defaultTimeoutMs).toBe(10000);
        expect(normalized.cooldowns.defaultCooldown).toBe(5);
        expect(normalized.retry.maxRetries).toBe(3);
    });

    it('string to boolean conversion works correctly', () => {
        const rawConfig = {
            general: { 
                debugEnabled: 'true', 
                messagesEnabled: 'false',
                commandsEnabled: 'TRUE',
                greetingsEnabled: 'FALSE'
            },
            obs: {},
            commands: {}
        };

        const normalized = ConfigValidator.normalize(rawConfig);

        expect(normalized.general.debugEnabled).toBe(true);
        expect(normalized.general.messagesEnabled).toBe(false);
        expect(normalized.general.commandsEnabled).toBe(true);
        expect(normalized.general.greetingsEnabled).toBe(false);
    });

    it('string to number conversion works correctly', () => {
        const rawConfig = {
            general: { cmdCoolDown: '120', maxMessageLength: '1000' },
            obs: { connectionTimeoutMs: '5000' },
            commands: {},
            timing: { fadeDuration: '500', chatMessageDuration: '3000' }
        };

        const normalized = ConfigValidator.normalize(rawConfig);

        expect(normalized.general.cmdCoolDown).toBe(120);
        expect(normalized.general.maxMessageLength).toBe(1000);
        expect(normalized.obs.connectionTimeoutMs).toBe(5000);
        expect(normalized.timing.fadeDuration).toBe(500);
        expect(normalized.timing.chatMessageDuration).toBe(3000);
    });

    it('invalid string values fall back to defaults', () => {
        const rawConfig = {
            general: { 
                debugEnabled: 'invalid',
                cmdCoolDown: 'not-a-number'
            },
            obs: {},
            commands: {}
        };

        const normalized = ConfigValidator.normalize(rawConfig);

        expect(normalized.general.debugEnabled).toBe(false);
        expect(normalized.general.cmdCoolDown).toBe(60);
    });

    it('validates all three platforms correctly', () => {
        const rawConfig = {
            general: {},
            obs: {},
            commands: {},
            tiktok: { enabled: 'true', username: '' },
            twitch: { enabled: 'true', username: '' },
            youtube: { enabled: 'true', username: '' }
        };

        const normalized = ConfigValidator.normalize(rawConfig);
        const validation = ConfigValidator.validate(normalized);

        expect(validation.isValid).toBe(false);
        expect(validation.errors).toContain('Missing required configuration: TikTok username');
        expect(validation.errors).toContain('Missing required configuration: Twitch username');
        expect(validation.errors).toContain('Missing required configuration: YouTube username');
    });

    it('StreamElements validation requires channel ID when enabled', () => {
        const rawConfig = {
            general: {},
            obs: {},
            commands: {},
            streamelements: { enabled: 'true', youtubeChannelId: '', twitchChannelId: '' }
        };

        const normalized = ConfigValidator.normalize(rawConfig);
        const validation = ConfigValidator.validate(normalized);

        expect(validation.isValid).toBe(false);
        expect(validation.errors).toContain('Missing required configuration: StreamElements channel ID (YouTube or Twitch)');
    });

    it('StreamElements passes with YouTube channel ID', () => {
        const rawConfig = {
            general: {},
            obs: {},
            commands: {},
            streamelements: { enabled: 'true', youtubeChannelId: 'UC123456' }
        };

        const normalized = ConfigValidator.normalize(rawConfig);
        const validation = ConfigValidator.validate(normalized);

        expect(validation.isValid).toBe(true);
        expect(normalized.streamelements.enabled).toBe(true);
        expect(normalized.streamelements.youtubeChannelId).toBe('UC123456');
    });

    it('warnings generated for out-of-range values', () => {
        const rawConfig = {
            general: {},
            obs: {},
            commands: {},
            cooldowns: { defaultCooldown: '5', heavyCommandCooldown: '120' },
            handcam: { maxSize: '200' },
            retry: { baseDelay: '50' }
        };

        const normalized = ConfigValidator.normalize(rawConfig);
        const validation = ConfigValidator.validate(normalized);

        expect(validation.isValid).toBe(true);
        expect(validation.warnings).toContain('cooldowns.defaultCooldown should be between 10 and 3600 seconds');
        expect(validation.warnings).toContain('handcam.maxSize should be between 1 and 100');
        expect(validation.warnings).toContain('retry.baseDelay should be between 100 and 30000 milliseconds');
    });

    it('YouTube stream detection method validation', () => {
        const rawConfigValid = {
            general: {},
            obs: {},
            commands: {},
            youtube: { enabled: 'true', username: 'test-channel', streamDetectionMethod: 'api' }
        };

        const rawConfigInvalid = {
            general: {},
            obs: {},
            commands: {},
            youtube: { enabled: 'true', username: 'test-channel', streamDetectionMethod: 'invalid-method' }
        };

        const normalizedValid = ConfigValidator.normalize(rawConfigValid);
        const normalizedInvalid = ConfigValidator.normalize(rawConfigInvalid);

        expect(normalizedValid.youtube.streamDetectionMethod).toBe('api');
        expect(normalizedInvalid.youtube.streamDetectionMethod).toBe('youtubei');
    });

    it('platform-overrideable fields default to null for inheritance', () => {
        const rawConfig = {
            general: { messagesEnabled: 'true' },
            obs: {},
            commands: {},
            tiktok: { enabled: 'false' }
        };

        const normalized = ConfigValidator.normalize(rawConfig);

        expect(normalized.general.messagesEnabled).toBe(true);
        expect(normalized.tiktok.messagesEnabled).toBeNull();
    });

    it('complete config round-trip maintains type integrity', () => {
        const rawConfig = {
            general: {
                debugEnabled: 'false',
                cmdCoolDown: '30',
                messagesEnabled: 'true',
                fallbackUsername: 'TestBot'
            },
            http: {
                defaultTimeoutMs: '15000'
            },
            obs: {
                enabled: 'true',
                address: 'ws://192.168.1.100:4455',
                connectionTimeoutMs: '8000'
            },
            commands: {},
            tiktok: { enabled: 'true', username: 'test-tiktok' },
            twitch: { enabled: 'false' },
            youtube: { enabled: 'false' },
            timing: {
                fadeDuration: '500',
                chatMessageDuration: '5000'
            },
            cooldowns: {
                defaultCooldown: '60',
                heavyCommandCooldown: '180'
            }
        };

        const normalized = ConfigValidator.normalize(rawConfig);
        const validation = ConfigValidator.validate(normalized);

        expect(validation.isValid).toBe(true);
        expect(validation.errors).toEqual([]);
        expect(validation.warnings).toEqual([]);

        expect(typeof normalized.general.debugEnabled).toBe('boolean');
        expect(typeof normalized.general.cmdCoolDown).toBe('number');
        expect(typeof normalized.general.fallbackUsername).toBe('string');
        expect(typeof normalized.http.defaultTimeoutMs).toBe('number');
        expect(typeof normalized.obs.enabled).toBe('boolean');
        expect(typeof normalized.obs.connectionTimeoutMs).toBe('number');
        expect(typeof normalized.timing.fadeDuration).toBe('number');
        expect(typeof normalized.cooldowns.defaultCooldown).toBe('number');
    });

    it('commands section preserves user-defined command definitions through normalization', () => {
        const rawConfig = {
            general: {},
            obs: {},
            commands: {
                enabled: 'true',
                'test-single': '!testsingle, vfx bottom green',
                'test-multi': '!testalpha|!testbravo, vfx top, alpha|bravo',
                'test-keywords': '!testcmd|!testalt, vfx center green, keyword1|keyword2|keyword3'
            }
        };

        const normalized = ConfigValidator.normalize(rawConfig);

        expect(normalized.commands['test-single']).toBe('!testsingle, vfx bottom green');
        expect(normalized.commands['test-multi']).toBe('!testalpha|!testbravo, vfx top, alpha|bravo');
        expect(normalized.commands['test-keywords']).toBe('!testcmd|!testalt, vfx center green, keyword1|keyword2|keyword3');
        expect(Object.keys(normalized.commands).length).toBe(3);
    });

    it('sharesEnabled is preserved through normalization with correct default', () => {
        const rawConfigExplicit = {
            general: { sharesEnabled: 'true' },
            obs: {},
            commands: {}
        };
        const rawConfigDefault = {
            general: {},
            obs: {},
            commands: {}
        };

        const normalizedExplicit = ConfigValidator.normalize(rawConfigExplicit);
        const normalizedDefault = ConfigValidator.normalize(rawConfigDefault);

        expect(normalizedExplicit.general.sharesEnabled).toBe(true);
        expect(normalizedDefault.general.sharesEnabled).toBe(true);
    });

    it('shares section is normalized with command field', () => {
        const rawConfigWithCommand = {
            general: {},
            shares: { command: '!share' }
        };
        const rawConfigEmpty = {
            general: {}
        };

        const normalizedWithCommand = ConfigValidator.normalize(rawConfigWithCommand);
        const normalizedEmpty = ConfigValidator.normalize(rawConfigEmpty);

        expect(normalizedWithCommand.shares.command).toBe('!share');
        expect(normalizedEmpty.shares.command).toBe('');
    });
});
