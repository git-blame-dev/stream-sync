const { describe, test, expect } = require('bun:test');
const {
    normalizeTwitchPlatformConfig,
    validateTwitchPlatformConfig
} = require('../../../../src/platforms/twitch/config/twitch-config');

describe('Twitch config', () => {
    test('normalizes boolean config values and applies defaults', () => {
        const rawConfig = {
            enabled: true,
            username: 'streamer',
            channel: 'streamer',
            eventsub_enabled: 'false',
            dataLoggingEnabled: 'true'
        };

        const normalized = normalizeTwitchPlatformConfig(rawConfig);

        expect(normalized.eventsub_enabled).toBe(false);
        expect(normalized.dataLoggingEnabled).toBe(true);
        expect(normalized.dataLoggingPath).toBe('./logs');
    });

    test('validates required fields and emits auth readiness warnings', () => {
        const authManager = { getState: () => 'PENDING' };
        const validConfig = {
            enabled: true,
            username: 'streamer',
            channel: 'streamer'
        };

        const validResult = validateTwitchPlatformConfig({
            config: validConfig,
            authManager
        });

        expect(validResult.isValid).toBe(true);
        expect(validResult.errors).toEqual([]);
        expect(validResult.warnings.some(msg => msg.toLowerCase().includes('authmanager'))).toBe(true);

        const invalidResult = validateTwitchPlatformConfig({
            config: { enabled: true, channel: 'streamer' },
            authManager: { getState: () => 'READY' }
        });

        expect(invalidResult.isValid).toBe(false);
        expect(invalidResult.errors).toContain('username: Username is required for Twitch authentication');
    });
});

