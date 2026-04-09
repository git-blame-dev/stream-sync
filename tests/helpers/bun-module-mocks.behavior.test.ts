import { afterEach, describe, expect, it, vi } from 'bun:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import {
    mockModule,
    unmockModule,
    requireActual,
    resetModules,
    restoreAllModuleMocks
} from './bun-module-mocks';

const nodeRequire = createRequire(import.meta.url);

type TemporaryArtifact = {
    tempDir: string;
    modulePath: string;
};

const createTempModulePath = () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-sync-module-mocks-'));
    const modulePath = path.join(tempDir, 'temp-module.js');
    fs.writeFileSync(modulePath, 'module.exports = { value: "actual-value" };\n', 'utf8');
    return { tempDir, modulePath };
};

describe('bun-module-mocks behavior', () => {
    const temporaryArtifacts: TemporaryArtifact[] = [];

    afterEach(() => {
        restoreAllModuleMocks();

        while (temporaryArtifacts.length > 0) {
            const artifact = temporaryArtifacts.pop();
            if (!artifact) {
                continue;
            }

            delete nodeRequire.cache[artifact.modulePath];
            fs.rmSync(artifact.tempDir, { recursive: true, force: true });
        }
    });

    it('mocks and unmocks modules by resolved id', () => {
        const artifact = createTempModulePath();
        temporaryArtifacts.push(artifact);
        const factory = () => ({ value: 'mocked-value' });

        const moduleId = mockModule(artifact.modulePath, factory);
        expect(moduleId).toBe(nodeRequire.resolve(artifact.modulePath));

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

        nodeRequire.cache[localCacheKey] = {
            id: localCacheKey,
            filename: localCacheKey,
            loaded: true,
            exports: {}
        } as NodeJS.Module;
        nodeRequire.cache[nodeModulesCacheKey] = {
            id: nodeModulesCacheKey,
            filename: nodeModulesCacheKey,
            loaded: true,
            exports: {}
        } as NodeJS.Module;

        resetModules();

        expect(nodeRequire.cache[localCacheKey]).toBeUndefined();
        expect(nodeRequire.cache[nodeModulesCacheKey]).toBeDefined();

        delete nodeRequire.cache[nodeModulesCacheKey];
        cwdSpy.mockRestore();
    });

    it('restores all active module mocks and clears cached absolute modules', () => {
        const artifact = createTempModulePath();
        temporaryArtifacts.push(artifact);

        mockModule(artifact.modulePath, () => ({ value: 'mocked-value' }));
        nodeRequire(artifact.modulePath);

        expect(() => restoreAllModuleMocks()).not.toThrow();
        expect(nodeRequire.cache[artifact.modulePath]).toBeUndefined();
    });
});
