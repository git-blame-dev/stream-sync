const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const fs = require('fs');
const { ensureSecrets } = require('../../../src/utils/secret-manager');

let originalReadFileSync;
let originalWriteFileSync;
let originalExistsSync;
let originalChmodSync;
let originalStatSync;

const createCapturingLogger = () => {
    const entries = [];
    const push = (level) => (message) => entries.push({ level, message });
    return {
        entries,
        debug: push('debug'),
        info: push('info'),
        warn: push('warn'),
        error: push('error')
    };
};

describe('secret-manager', () => {
    let testConfig;
    let logger;
    const originalEnv = {};
    const envFilePath = '/test/.env';

    let fileStore;
    let filePermissions;

    const setupFsMocks = () => {
        fileStore = {};
        filePermissions = {};

        fs.existsSync = createMockFn((path) => path in fileStore);
        fs.readFileSync = createMockFn((path) => {
            if (path in fileStore) return fileStore[path];
            throw new Error(`ENOENT: no such file: ${path}`);
        });
        fs.writeFileSync = createMockFn((path, content, options) => {
            fileStore[path] = content;
            if (options && options.mode) {
                filePermissions[path] = options.mode;
            }
        });
        fs.chmodSync = createMockFn((path, mode) => {
            filePermissions[path] = mode;
        });
        fs.statSync = createMockFn((path) => {
            if (!(path in fileStore)) {
                throw new Error(`ENOENT: no such file: ${path}`);
            }
            return {
                mode: (filePermissions[path] || 0o644) | 0o100000
            };
        });
    };

    beforeEach(() => {
        originalReadFileSync = fs.readFileSync;
        originalWriteFileSync = fs.writeFileSync;
        originalExistsSync = fs.existsSync;
        originalChmodSync = fs.chmodSync;
        originalStatSync = fs.statSync;

        setupFsMocks();

        testConfig = {
            tiktok: { enabled: true, username: 'test-tiktok-user' },
            twitch: { enabled: true, username: 'test-twitch-user', channel: 'test-twitch-channel', clientId: 'test-client-id' },
            obs: { enabled: true },
            streamelements: { enabled: true, youtubeChannelId: 'test-yt-channel', twitchChannelId: 'test-twitch-channel' },
            youtube: { enabled: false }
        };
        logger = createCapturingLogger();

        ['TIKTOK_API_KEY', 'TWITCH_CLIENT_SECRET', 'OBS_PASSWORD', 'STREAMELEMENTS_JWT_TOKEN', 'YOUTUBE_API_KEY'].forEach((key) => {
            originalEnv[key] = process.env[key];
            delete process.env[key];
        });
    });

    afterEach(() => {
        Object.entries(originalEnv).forEach(([key, value]) => {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        });

        fs.readFileSync = originalReadFileSync;
        fs.writeFileSync = originalWriteFileSync;
        fs.existsSync = originalExistsSync;
        fs.chmodSync = originalChmodSync;
        fs.statSync = originalStatSync;
        restoreAllMocks();
    });

    it('applies environment secrets without prompting and leaves existing env file untouched', async () => {
        process.env.TIKTOK_API_KEY = 'env_tiktok_key';
        process.env.TWITCH_CLIENT_SECRET = 'env_client_secret';
        process.env.OBS_PASSWORD = 'env_obs_password';
        process.env.STREAMELEMENTS_JWT_TOKEN = 'env_jwt_token';

        const result = await ensureSecrets({
            config: {
                tiktok: testConfig.tiktok,
                twitch: testConfig.twitch,
                obs: testConfig.obs,
                streamelements: testConfig.streamelements
            },
            logger,
            interactive: false,
            envFilePath,
            envFileReadEnabled: false,
            envFileWriteEnabled: false
        });

        expect(result.missingRequired).toEqual([]);
        expect(process.env.TIKTOK_API_KEY).toBe('env_tiktok_key');
        expect(process.env.OBS_PASSWORD).toBe('env_obs_password');
        expect(envFilePath in fileStore).toBe(false);
        expect(logger.entries.some((entry) => entry.message.includes('env_tiktok_key'))).toBe(false);
    });

    it('prompts in interactive mode, persists secrets to .env, and preserves existing entries', async () => {
        const { ensureSecrets } = require('../../../src/utils/secret-manager');

        const promptValues = {
            TIKTOK_API_KEY: 'prompt_tiktok',
            TWITCH_CLIENT_SECRET: 'prompt_client_secret',
            OBS_PASSWORD: 'prompt_obs_password',
            STREAMELEMENTS_JWT_TOKEN: 'prompt_jwt'
        };

        const promptFor = async (secretId) => promptValues[secretId] || '';
        fileStore[envFilePath] = 'EXISTING=keep\n';

        const result = await ensureSecrets({
            config: {
                tiktok: testConfig.tiktok,
                twitch: testConfig.twitch,
                obs: testConfig.obs,
                streamelements: testConfig.streamelements
            },
            logger,
            interactive: true,
            envFilePath,
            envFileReadEnabled: true,
            envFileWriteEnabled: true,
            promptFor
        });

        const envContent = fileStore[envFilePath];
        expect(envContent).toContain('EXISTING=keep');
        expect(envContent).toContain('TIKTOK_API_KEY=prompt_tiktok');
        expect(envContent).toContain('OBS_PASSWORD=prompt_obs_password');
        expect(process.env.TWITCH_CLIENT_SECRET).toBe('prompt_client_secret');
        expect(result.persisted.sort()).toEqual(
            expect.arrayContaining(['TIKTOK_API_KEY', 'TWITCH_CLIENT_SECRET', 'OBS_PASSWORD', 'STREAMELEMENTS_JWT_TOKEN'])
        );
        expect(logger.entries.some((entry) => entry.message.includes('prompt_client_secret'))).toBe(false);
    });

    it('writes the env file with restricted permissions', async () => {
        const { ensureSecrets } = require('../../../src/utils/secret-manager');

        const promptValues = {
            TIKTOK_API_KEY: 'prompt_tiktok',
            TWITCH_CLIENT_SECRET: 'prompt_client_secret',
            OBS_PASSWORD: 'prompt_obs_password',
            STREAMELEMENTS_JWT_TOKEN: 'prompt_jwt'
        };

        const promptFor = async (secretId) => promptValues[secretId] || '';

        await ensureSecrets({
            config: {
                tiktok: testConfig.tiktok,
                twitch: testConfig.twitch,
                obs: testConfig.obs,
                streamelements: testConfig.streamelements
            },
            logger,
            interactive: true,
            envFilePath,
            envFileReadEnabled: false,
            envFileWriteEnabled: true,
            promptFor
        });

        expect(envFilePath in fileStore).toBe(true);

        if (process.platform !== 'win32') {
            const mode = filePermissions[envFilePath] & 0o077;
            expect(mode).toBe(0);
        }
    });

    it('requires a YouTube API key when API methods are selected', async () => {
        process.env.TIKTOK_API_KEY = 'env_tiktok_key';
        process.env.TWITCH_CLIENT_SECRET = 'env_client_secret';
        process.env.OBS_PASSWORD = 'env_obs_password';
        process.env.STREAMELEMENTS_JWT_TOKEN = 'env_jwt_token';

        const youtubeSection = {
            ...testConfig.youtube,
            enabled: true,
            enableAPI: false,
            streamDetectionMethod: 'api',
            viewerCountMethod: 'youtubei'
        };

        await expect(ensureSecrets({
            config: {
                tiktok: testConfig.tiktok,
                twitch: testConfig.twitch,
                obs: testConfig.obs,
                streamelements: testConfig.streamelements,
                youtube: youtubeSection
            },
            logger,
            interactive: false,
            envFilePath,
            envFileReadEnabled: false,
            envFileWriteEnabled: false
        })).rejects.toThrow(/missing required secrets/i);
    });

    it('shows colon-terminated prompts for interactive clarity', async () => {
        const { ensureSecrets } = require('../../../src/utils/secret-manager');

        const promptValues = {
            TIKTOK_API_KEY: 'prompt_tiktok',
            TWITCH_CLIENT_SECRET: 'prompt_client_secret',
            OBS_PASSWORD: 'prompt_obs_password',
            STREAMELEMENTS_JWT_TOKEN: 'prompt_jwt'
        };

        const promptsSeen = [];
        const promptFor = async (secretId, promptText) => {
            promptsSeen.push({ secretId, promptText });
            return promptValues[secretId] || '';
        };

        await ensureSecrets({
            config: {
                tiktok: testConfig.tiktok,
                twitch: testConfig.twitch,
                obs: testConfig.obs,
                streamelements: testConfig.streamelements
            },
            logger,
            interactive: true,
            envFilePath,
            envFileReadEnabled: false,
            envFileWriteEnabled: false,
            promptFor
        });

        expect(promptsSeen).not.toHaveLength(0);
        promptsSeen.forEach(({ promptText }) => {
            expect(promptText).toMatch(/: $/);
        });
    });

    it('fails fast in non-interactive mode when required secrets are missing', async () => {
        process.env.TIKTOK_API_KEY = 'env_tiktok_key';
        process.env.OBS_PASSWORD = 'env_obs_password';
        process.env.STREAMELEMENTS_JWT_TOKEN = 'env_jwt_token';

        await expect(ensureSecrets({
            config: {
                tiktok: testConfig.tiktok,
                twitch: testConfig.twitch,
                obs: testConfig.obs,
                streamelements: testConfig.streamelements
            },
            logger,
            interactive: false,
            envFilePath,
            envFileReadEnabled: false,
            envFileWriteEnabled: false
        })).rejects.toThrow(/missing required secrets/i);
    });
});
