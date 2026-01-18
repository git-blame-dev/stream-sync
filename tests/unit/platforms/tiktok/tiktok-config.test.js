const { describe, test, expect } = require('bun:test');
const { noOpLogger } = require('../../../helpers/mock-factories');
const { ConfigValidator } = require('../../../../src/utils/config-validator');

const {
    normalizeTikTokPlatformConfig,
    validateTikTokPlatformConfig
} = require('../../../../src/platforms/tiktok/config/tiktok-config');

describe('TikTok config helpers', () => {
    const logger = noOpLogger;

    test('normalizes TikTok config values while dropping unsupported keys', () => {
        const configValidator = new ConfigValidator(logger);
        const rawConfig = {
            enabled: 'true',
            username: 123,
            viewerCountEnabled: 'false',
            greetingsEnabled: 'false',
            giftAggregationEnabled: 'true',
            dataLoggingEnabled: 'true',
            dataLoggingPath: null,
            someUnknownKey: 'drop-me',
            maxRetries: 9,
            baseDelay: 9000
        };

        const normalized = normalizeTikTokPlatformConfig(rawConfig, configValidator);

        expect(normalized.enabled).toBe(true);
        expect(normalized.username).toBe('123');
        expect(normalized.viewerCountEnabled).toBe(false);
        expect(normalized.viewerCountSource).toBe('websocket');
        expect(normalized.greetingsEnabled).toBe(false);
        expect(normalized.giftAggregationEnabled).toBe(true);
        expect(normalized.dataLoggingEnabled).toBe(true);
        expect(normalized.dataLoggingPath).toBe('./logs');
        expect(normalized.someUnknownKey).toBeUndefined();
        expect(normalized.maxRetries).toBeUndefined();
        expect(normalized.baseDelay).toBeUndefined();
    });

    test('drops blank apiKey values and trims non-empty keys', () => {
        const configValidator = new ConfigValidator(logger);

        const blankConfig = normalizeTikTokPlatformConfig(
            { enabled: true, username: 'tester', apiKey: '   ' },
            configValidator
        );
        expect(blankConfig.apiKey).toBeUndefined();

        const keyedConfig = normalizeTikTokPlatformConfig(
            { enabled: true, username: 'tester', apiKey: '  test-key  ' },
            configValidator
        );
        expect(keyedConfig.apiKey).toBe('test-key');
    });

    test('validates required TikTok config fields', () => {
        expect(validateTikTokPlatformConfig({ username: 'tester' }).valid).toBe(true);

        const invalid = validateTikTokPlatformConfig({ username: '' });
        expect(invalid.isValid).toBe(false);
        expect(invalid.errors).toContain('Username is required');
    });
});
