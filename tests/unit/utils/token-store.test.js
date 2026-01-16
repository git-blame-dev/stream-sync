const { describe, it, expect, beforeEach } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');

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

const createMockFs = (fileStore) => {
    const permissions = {};

    return {
        promises: {
            readFile: createMockFn(async (path) => {
                if (path in fileStore) return fileStore[path];
                const error = new Error(`ENOENT: no such file or directory, open '${path}'`);
                error.code = 'ENOENT';
                throw error;
            }),
            writeFile: createMockFn(async (path, content, options) => {
                fileStore[path] = content;
                if (options && options.mode) {
                    permissions[path] = options.mode;
                }
            }),
            mkdir: createMockFn(async (dirPath, options) => {
                if (options && options.mode) {
                    permissions[dirPath] = options.mode;
                }
            }),
            rename: createMockFn(async (oldPath, newPath) => {
                if (oldPath in fileStore) {
                    fileStore[newPath] = fileStore[oldPath];
                    delete fileStore[oldPath];
                    if (oldPath in permissions) {
                        permissions[newPath] = permissions[oldPath];
                        delete permissions[oldPath];
                    }
                }
            }),
            chmod: createMockFn(async (path, mode) => {
                permissions[path] = mode;
            }),
            stat: createMockFn(async (path) => {
                if (path in fileStore) {
                    return { mode: (permissions[path] || 0o644) | 0o100000 };
                }
                const error = new Error(`ENOENT: no such file or directory, stat '${path}'`);
                error.code = 'ENOENT';
                throw error;
            })
        },
        _fileStore: fileStore,
        _permissions: permissions
    };
};

describe('token-store', () => {
    const storePath = '/test/tokens.json';
    let fileStore;
    let mockFs;

    beforeEach(() => {
        fileStore = {};
        mockFs = createMockFs(fileStore);
    });

    it('throws when tokenStorePath is missing', async () => {
        await expect(loadTokens({})).rejects.toThrow(/tokenStorePath/i);
    });

    it('returns null when token store file does not exist', async () => {
        const logger = createLogger();

        const result = await loadTokens({ tokenStorePath: storePath, fs: mockFs, logger });

        expect(result).toBeNull();
        expect(logger.entries.some((entry) => entry.message.includes('Token store file not found'))).toBe(true);
    });

    it('saves and loads tokens from the store', async () => {
        const logger = createLogger();

        await saveTokens(
            { tokenStorePath: storePath, fs: mockFs, logger },
            { accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: 123456 }
        );

        const result = await loadTokens({ tokenStorePath: storePath, fs: mockFs, logger });

        expect(result).toEqual({
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
            expiresAt: 123456
        });
    });

    it('creates missing token store directories and persists tokens securely', async () => {
        const logger = createLogger();
        const nestedStorePath = '/test/nested/tokens.json';

        await saveTokens(
            { tokenStorePath: nestedStorePath, fs: mockFs, logger },
            { accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: 123456 }
        );

        expect(mockFs.promises.mkdir).toHaveBeenCalled();

        const result = await loadTokens({ tokenStorePath: nestedStorePath, fs: mockFs, logger });

        expect(result).toEqual({
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
            expiresAt: 123456
        });

        if (process.platform !== 'win32') {
            const mode = mockFs._permissions[nestedStorePath] & 0o077;
            expect(mode).toBe(0);
        }
    });

    it('preserves other stored data when saving tokens', async () => {
        const logger = createLogger();
        const existing = {
            otherService: { value: 'keep' },
            twitch: { accessToken: 'old', refreshToken: 'old-refresh' }
        };
        fileStore[storePath] = JSON.stringify(existing, null, 2);

        await saveTokens(
            { tokenStorePath: storePath, fs: mockFs, logger },
            { accessToken: 'updated-access', refreshToken: 'updated-refresh' }
        );

        const updated = JSON.parse(fileStore[storePath]);
        expect(updated.otherService).toEqual({ value: 'keep' });
        expect(updated.twitch.accessToken).toBe('updated-access');
        expect(updated.twitch.refreshToken).toBe('updated-refresh');
    });

    it('throws when token store contains invalid JSON', async () => {
        const logger = createLogger();
        fileStore[storePath] = '{invalid-json';

        await expect(loadTokens({ tokenStorePath: storePath, fs: mockFs, logger })).rejects.toThrow(/invalid token store/i);
    });

    it('clears twitch tokens while preserving other data', async () => {
        const logger = createLogger();
        const existing = {
            otherService: { value: 'keep' },
            twitch: { accessToken: 'old', refreshToken: 'old-refresh' }
        };
        fileStore[storePath] = JSON.stringify(existing, null, 2);

        await clearTokens({ tokenStorePath: storePath, fs: mockFs, logger });

        const updated = JSON.parse(fileStore[storePath]);
        expect(updated.otherService).toEqual({ value: 'keep' });
        expect(updated.twitch).toBeUndefined();
    });
});
