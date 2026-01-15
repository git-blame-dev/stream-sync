const path = require('path');
const { mock } = require('bun:test');

const activeMocks = new Map();

const resolveModuleId = (moduleName) => {
    try {
        return require.resolve(moduleName);
    } catch (error) {
        return moduleName;
    }
};

const mockModule = (moduleName, factory) => {
    const moduleId = resolveModuleId(moduleName);
    activeMocks.set(moduleId, { moduleName, factory });
    mock.module(moduleName, factory);
    return moduleId;
};

const unmockModule = (moduleName) => {
    const moduleId = resolveModuleId(moduleName);
    activeMocks.delete(moduleId);
    mock.restore(moduleName);
};

const requireActual = (moduleName) => {
    const moduleId = resolveModuleId(moduleName);
    const entry = activeMocks.get(moduleId);
    if (entry) {
        mock.restore(entry.moduleName);
    }
    if (path.isAbsolute(moduleId)) {
        delete require.cache[moduleId];
    }
    const actual = require(moduleName);
    if (entry) {
        mock.module(entry.moduleName, entry.factory);
    }
    return actual;
};

const resetModules = () => {
    Object.keys(require.cache).forEach((cacheKey) => {
        if (cacheKey.startsWith(process.cwd()) && !cacheKey.includes(`${path.sep}node_modules${path.sep}`)) {
            delete require.cache[cacheKey];
        }
    });
};

const restoreAllModuleMocks = () => {
    for (const [moduleId, entry] of activeMocks.entries()) {
        mock.restore(entry.moduleName);
        // Also clear the require cache to ensure next require gets fresh module
        if (path.isAbsolute(moduleId)) {
            delete require.cache[moduleId];
        }
    }
    activeMocks.clear();
};

module.exports = {
    mockModule,
    unmockModule,
    requireActual,
    resetModules,
    restoreAllModuleMocks
};
