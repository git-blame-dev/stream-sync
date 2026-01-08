const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadTokens, saveTokens, clearTokens } = require('../../../src/utils/token-store');

const createLogger = () => {
    const entries = [];
    const push = (level) => (message) => entries.push({ level, message });
    return {
        entries,
        info: push('info'),
        warn: push('warn'),
        error: push('error')
    };
};

describe('token-store', () => {
    let tempDir;
    let storePath;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-store-'));
        storePath = path.join(tempDir, 'tokens.json');
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('throws when tokenStorePath is missing', async () => {
        await expect(loadTokens({})).rejects.toThrow(/tokenStorePath/i);
    });

    it('returns null when token store file does not exist', async () => {
        const logger = createLogger();

        const result = await loadTokens({ tokenStorePath: storePath, logger });

        expect(result).toBeNull();
        expect(logger.entries.some((entry) => entry.message.includes('Token store file not found'))).toBe(true);
    });

    it('saves and loads tokens from the store', async () => {
        const logger = createLogger();

        await saveTokens(
            { tokenStorePath: storePath, logger },
            { accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: 123456 }
        );

        const result = await loadTokens({ tokenStorePath: storePath, logger });

        expect(result).toEqual({
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
            expiresAt: 123456
        });
    });

    it('creates missing token store directories and persists tokens securely', async () => {
        const logger = createLogger();
        const nestedStorePath = path.join(tempDir, 'nested', 'tokens.json');

        await saveTokens(
            { tokenStorePath: nestedStorePath, logger },
            { accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: 123456 }
        );

        expect(fs.existsSync(path.dirname(nestedStorePath))).toBe(true);

        const result = await loadTokens({ tokenStorePath: nestedStorePath, logger });

        expect(result).toEqual({
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
            expiresAt: 123456
        });

        if (process.platform !== 'win32') {
            const mode = fs.statSync(nestedStorePath).mode & 0o077;
            expect(mode).toBe(0);
        }
    });

    it('preserves other stored data when saving tokens', async () => {
        const logger = createLogger();
        const existing = {
            otherService: { value: 'keep' },
            twitch: { accessToken: 'old', refreshToken: 'old-refresh' }
        };
        fs.writeFileSync(storePath, JSON.stringify(existing, null, 2), 'utf8');

        await saveTokens(
            { tokenStorePath: storePath, logger },
            { accessToken: 'updated-access', refreshToken: 'updated-refresh' }
        );

        const updated = JSON.parse(fs.readFileSync(storePath, 'utf8'));
        expect(updated.otherService).toEqual({ value: 'keep' });
        expect(updated.twitch.accessToken).toBe('updated-access');
        expect(updated.twitch.refreshToken).toBe('updated-refresh');
    });

    it('throws when token store contains invalid JSON', async () => {
        const logger = createLogger();
        fs.writeFileSync(storePath, '{invalid-json', 'utf8');

        await expect(loadTokens({ tokenStorePath: storePath, logger })).rejects.toThrow(/invalid token store/i);
    });

    it('clears twitch tokens while preserving other data', async () => {
        const logger = createLogger();
        const existing = {
            otherService: { value: 'keep' },
            twitch: { accessToken: 'old', refreshToken: 'old-refresh' }
        };
        fs.writeFileSync(storePath, JSON.stringify(existing, null, 2), 'utf8');

        await clearTokens({ tokenStorePath: storePath, logger });

        const updated = JSON.parse(fs.readFileSync(storePath, 'utf8'));
        expect(updated.otherService).toEqual({ value: 'keep' });
        expect(updated.twitch).toBeUndefined();
    });
});
