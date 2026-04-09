import { mock } from 'bun:test';
import { createRequire } from 'node:module';
import path from 'node:path';

const nodeRequire = createRequire(import.meta.url);

type ModuleMockEntry = {
    moduleName: string;
    factory: () => unknown;
};

const restoreMockModule = (moduleName: string) => {
    (mock.restore as unknown as (targetModule: string) => void)(moduleName);
};

const activeMocks = new Map<string, ModuleMockEntry>();

const resolveModuleId = (moduleName: string) => {
    try {
        return nodeRequire.resolve(moduleName);
    } catch {
        return moduleName;
    }
};

const mockModule = (moduleName: string, factory: () => unknown) => {
    const moduleId = resolveModuleId(moduleName);
    activeMocks.set(moduleId, { moduleName, factory });
    mock.module(moduleName, factory);
    return moduleId;
};

const unmockModule = (moduleName: string) => {
    const moduleId = resolveModuleId(moduleName);
    activeMocks.delete(moduleId);
    restoreMockModule(moduleName);
};

const requireActual = (moduleName: string) => {
    const moduleId = resolveModuleId(moduleName);
    const entry = activeMocks.get(moduleId);
    if (entry) {
        restoreMockModule(entry.moduleName);
    }
    if (path.isAbsolute(moduleId)) {
        delete nodeRequire.cache[moduleId];
    }
    const actual = nodeRequire(moduleName);
    if (entry) {
        mock.module(entry.moduleName, entry.factory);
    }
    return actual;
};

const resetModules = () => {
    Object.keys(nodeRequire.cache).forEach((cacheKey) => {
        if (cacheKey.startsWith(process.cwd()) && !cacheKey.includes(`${path.sep}node_modules${path.sep}`)) {
            delete nodeRequire.cache[cacheKey];
        }
    });
};

const restoreAllModuleMocks = () => {
    activeMocks.forEach((entry, moduleId) => {
        restoreMockModule(entry.moduleName);
        // Also clear the require cache to ensure next require gets fresh module
        if (path.isAbsolute(moduleId)) {
            delete nodeRequire.cache[moduleId];
        }
    });
    activeMocks.clear();
};

export {
    mockModule,
    unmockModule,
    requireActual,
    resetModules,
    restoreAllModuleMocks
};
