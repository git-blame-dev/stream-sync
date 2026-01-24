
const {
    normalizeYouTubeConfig,
    validateRequiredKeys
} = require('../../../src/utils/config-normalizer');

describe('Configuration Normalizer', () => {
    describe('normalizeYouTubeConfig', () => {
        test('should preserve existing apiKey', () => {
            const config = {
                enabled: true,
                username: 'testuser',
                apiKey: 'test-api-key'
            };
            
            const normalized = normalizeYouTubeConfig(config);
            
            expect(normalized.apiKey).toBe('test-api-key');
        });
        
        test('should reject deprecated channel_id key', () => {
            const config = {
                enabled: true,
                username: 'testuser',
                channel_id: 'test-channel'
            };
            
            expect(() => normalizeYouTubeConfig(config)).toThrow('channel_id');
        });
        
        test('should handle null/undefined config', () => {
            expect(normalizeYouTubeConfig(null)).toBeNull();
            expect(normalizeYouTubeConfig(undefined)).toBeUndefined();
        });

        test('should parse numeric string values for retryAttempts and streamPollingInterval', () => {
            const config = {
                enabled: true,
                username: 'testuser',
                retryAttempts: '7',
                streamPollingInterval: '30'
            };

            const normalized = normalizeYouTubeConfig(config);

            expect(normalized.retryAttempts).toBe(7);
            expect(normalized.streamPollingInterval).toBe(30);
        });

        test('should apply YouTube defaults when optional retry/interval values are missing', () => {
            const config = {
                enabled: true,
                username: 'testuser'
            };

            const normalized = normalizeYouTubeConfig(config);

            expect(normalized.retryAttempts).toBe(3);
            expect(normalized.maxStreams).toBe(2);
            expect(normalized.streamPollingInterval).toBe(60);
            expect(normalized.fullCheckInterval).toBe(300000);
            expect(normalized.dataLoggingEnabled).toBe(false);
            expect(normalized.dataLoggingPath).toBe('./logs');
        });

        test('should drop unsupported YouTube keys', () => {
            const config = {
                enabled: true,
                username: 'testuser',
                apiKey: 'test-api-key',
                retryAttempts: '4',
                someUnknownKey: 'nope'
            };

            const normalized = normalizeYouTubeConfig(config);

            expect(normalized.apiKey).toBe('test-api-key');
            expect(normalized.retryAttempts).toBe(4);
            expect(normalized.someUnknownKey).toBeUndefined();
        });
    });

    describe('validateRequiredKeys', () => {
        test('should pass when all required keys present', () => {
            const config = {
                apiKey: 'test-key',
                username: 'testuser'
            };
            
            expect(() => {
                validateRequiredKeys(config, ['apiKey', 'username'], 'YouTube');
            }).not.toThrow();
        });
        
        test('should throw when required keys missing', () => {
            const config = {
                username: 'testuser'
                // apiKey missing
            };
            
            expect(() => {
                validateRequiredKeys(config, ['apiKey', 'username'], 'YouTube');
            }).toThrow('YouTube configuration missing required keys: apiKey');
        });
        
        test('should list all missing keys', () => {
            const config = {
                // Both missing
            };
            
            expect(() => {
                validateRequiredKeys(config, ['apiKey', 'username'], 'YouTube');
            }).toThrow('YouTube configuration missing required keys: apiKey, username');
        });
    });
});
