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

describe('ConfigValidator.normalize() skeleton', () => {
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

    it('handles empty raw config', () => {
        const normalized = ConfigValidator.normalize({});

        expect(Object.keys(normalized).length).toBe(ALL_SECTIONS.length);
    });

    it('passes raw section data to section normalizers', () => {
        const rawConfig = {
            general: { debugEnabled: 'true' },
            obs: { enabled: 'false' }
        };
        const normalized = ConfigValidator.normalize(rawConfig);

        expect(normalized.general).toEqual({});
        expect(normalized.obs).toEqual({});
    });

    it('handles missing sections gracefully', () => {
        const rawConfig = { general: { debugEnabled: 'true' } };
        const normalized = ConfigValidator.normalize(rawConfig);

        expect(normalized.twitch).toEqual({});
        expect(normalized.youtube).toEqual({});
        expect(normalized.tiktok).toEqual({});
    });
});
