const { describe, it, expect, beforeEach, afterEach } = require('bun:test');

const envKeys = [
    'TWITCH_CLIENT_SECRET',
    'TIKTOK_API_KEY',
    'YOUTUBE_API_KEY',
    'OBS_PASSWORD',
    'STREAMELEMENTS_JWT_TOKEN'
];

const { secrets, initializeStaticSecrets, _resetForTesting } = require('../../../src/core/secrets');

describe('secrets', () => {
    const originalEnv = {};

    beforeEach(() => {
        envKeys.forEach((key) => {
            originalEnv[key] = process.env[key];
            delete process.env[key];
        });
    });

    afterEach(() => {
        envKeys.forEach((key) => {
            if (originalEnv[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = originalEnv[key];
            }
        });

        _resetForTesting();
    });

    it('initializes static secrets from env', () => {
        process.env.TWITCH_CLIENT_SECRET = 'test_twitch_secret';
        process.env.TIKTOK_API_KEY = 'test_tiktok_key';
        process.env.YOUTUBE_API_KEY = 'test_youtube_key';
        process.env.OBS_PASSWORD = 'test_obs_password';
        process.env.STREAMELEMENTS_JWT_TOKEN = 'test_se_jwt';

        _resetForTesting();
        initializeStaticSecrets();

        expect(secrets.twitch.clientSecret).toBe('test_twitch_secret');
        expect(secrets.tiktok.apiKey).toBe('test_tiktok_key');
        expect(secrets.youtube.apiKey).toBe('test_youtube_key');
        expect(secrets.obs.password).toBe('test_obs_password');
        expect(secrets.streamelements.jwtToken).toBe('test_se_jwt');
    });

    it('uses null when env values are missing', () => {
        _resetForTesting();
        initializeStaticSecrets();

        expect(secrets.twitch.clientSecret).toBeNull();
        expect(secrets.tiktok.apiKey).toBeNull();
        expect(secrets.youtube.apiKey).toBeNull();
        expect(secrets.obs.password).toBeNull();
        expect(secrets.streamelements.jwtToken).toBeNull();
    });

    it('resets secrets to null', () => {
        process.env.TWITCH_CLIENT_SECRET = 'test_twitch_secret';

        initializeStaticSecrets();

        _resetForTesting();

        expect(secrets.twitch.clientSecret).toBeNull();
    });
});
