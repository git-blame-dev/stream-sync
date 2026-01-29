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

    test('drops token fields from normalized config', () => {
        const rawConfig = {
            enabled: true,
            username: 'streamer',
            channel: 'streamer',
            clientId: 'test-client-id',
            accessToken: 'test-access-token',
            refreshToken: 'test-refresh-token'
        };

        const normalized = normalizeTwitchPlatformConfig(rawConfig);

        expect(normalized.clientId).toBe('test-client-id');
        expect(normalized.accessToken).toBeUndefined();
        expect(normalized.refreshToken).toBeUndefined();
    });

    test('validates required fields and emits auth readiness warnings', () => {
        const authManager = { getState: () => 'PENDING' };
        const validConfig = {
            enabled: true,
            username: 'streamer',
            channel: 'streamer',
            clientId: 'test-client-id'
        };

        const validResult = validateTwitchPlatformConfig({
            config: validConfig,
            authManager
        });

        expect(validResult.isValid).toBe(true);
        expect(validResult.errors).toEqual([]);
        expect(validResult.warnings.some(msg => msg.toLowerCase().includes('authmanager'))).toBe(true);

        const missingUsernameResult = validateTwitchPlatformConfig({
            config: { enabled: true, channel: 'streamer', clientId: 'test-client-id' },
            authManager: { getState: () => 'READY' }
        });

        expect(missingUsernameResult.isValid).toBe(false);
        expect(missingUsernameResult.errors).toContain('username: Username is required for Twitch authentication');

        const missingClientIdResult = validateTwitchPlatformConfig({
            config: { enabled: true, channel: 'streamer', username: 'streamer' },
            authManager: { getState: () => 'READY' }
        });

        expect(missingClientIdResult.isValid).toBe(false);
        expect(missingClientIdResult.errors).toContain('clientId: Client ID is required for Twitch authentication');
    });
});
