const { describe, it, expect, afterEach, vi } = require('bun:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    mockModule,
    unmockModule,
    requireActual,
    resetModules,
    restoreAllModuleMocks
} = require('./bun-module-mocks');

const createTempModulePath = () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-sync-module-mocks-'));
    const modulePath = path.join(tempDir, 'temp-module.js');
    fs.writeFileSync(modulePath, 'module.exports = { value: "actual-value" };\n', 'utf8');
    return { tempDir, modulePath };
};

describe('bun-module-mocks behavior', () => {
    const temporaryArtifacts = [];

    afterEach(() => {
        restoreAllModuleMocks();

        while (temporaryArtifacts.length > 0) {
            const artifact = temporaryArtifacts.pop();
            if (!artifact) {
                continue;
            }

            delete require.cache[artifact.modulePath];
            fs.rmSync(artifact.tempDir, { recursive: true, force: true });
        }
    });

    it('mocks and unmocks modules by resolved id', () => {
        const artifact = createTempModulePath();
        temporaryArtifacts.push(artifact);
        const factory = () => ({ value: 'mocked-value' });

        const moduleId = mockModule(artifact.modulePath, factory);
        expect(moduleId).toBe(require.resolve(artifact.modulePath));

        expect(() => unmockModule(artifact.modulePath)).not.toThrow();
    });

    it('loads actual implementation while preserving active mock registration', () => {
        const artifact = createTempModulePath();
        temporaryArtifacts.push(artifact);
        const factory = () => ({ value: 'mocked-value' });

        mockModule(artifact.modulePath, factory);

        const actual = requireActual(artifact.modulePath);
        expect(actual.value).toBeDefined();
        expect(() => requireActual(artifact.modulePath)).not.toThrow();
    });

    it('resets repo-local module cache entries without touching node_modules cache', () => {
        const fakeCwd = path.join(os.tmpdir(), 'stream-sync-reset-modules-cwd');
        const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(fakeCwd);
        const localCacheKey = path.join(fakeCwd, 'tmp', 'local-cache-entry.js');
        const nodeModulesCacheKey = path.join(fakeCwd, 'node_modules', 'package', 'index.js');

        require.cache[localCacheKey] = {
            id: localCacheKey,
            filename: localCacheKey,
            loaded: true,
            exports: {}
        };
        require.cache[nodeModulesCacheKey] = {
            id: nodeModulesCacheKey,
            filename: nodeModulesCacheKey,
            loaded: true,
            exports: {}
        };

        resetModules();

        expect(require.cache[localCacheKey]).toBeUndefined();
        expect(require.cache[nodeModulesCacheKey]).toBeDefined();

        delete require.cache[nodeModulesCacheKey];
        cwdSpy.mockRestore();
    });

    it('restores all active module mocks and clears cached absolute modules', () => {
        const artifact = createTempModulePath();
        temporaryArtifacts.push(artifact);

        mockModule(artifact.modulePath, () => ({ value: 'mocked-value' }));
        require(artifact.modulePath);

        expect(() => restoreAllModuleMocks()).not.toThrow();
        expect(require.cache[artifact.modulePath]).toBeUndefined();
    });
});
