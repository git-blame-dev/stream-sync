import { mock } from "bun:test";
import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);

type ModuleMockEntry = {
  moduleName: string;
  moduleId: string;
  factory: () => unknown;
  hasActualModule: boolean;
  actualModule: unknown;
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

const isPathSpecifier = (moduleName: string) => {
  return (
    moduleName.startsWith("./") ||
    moduleName.startsWith("../") ||
    moduleName.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(moduleName)
  );
};

const resolveActualModule = (moduleName: string) => {
  if (!isPathSpecifier(moduleName)) {
    return { hasActualModule: false, actualModule: undefined };
  }

  try {
    return { hasActualModule: true, actualModule: nodeRequire(moduleName) };
  } catch {
    return { hasActualModule: false, actualModule: undefined };
  }
};

const mockModule = (moduleName: string, factory: () => unknown) => {
  const moduleId = resolveModuleId(moduleName);
  const currentEntry = activeMocks.get(moduleId);
  const actualModuleResolution =
    currentEntry ??
    ({ moduleName, moduleId, factory, ...resolveActualModule(moduleName) } as ModuleMockEntry);

  activeMocks.set(moduleId, {
    moduleName,
    moduleId,
    factory,
    hasActualModule: actualModuleResolution.hasActualModule,
    actualModule: actualModuleResolution.actualModule,
  });
  mock.module(moduleName, factory);
  return moduleId;
};

const unmockModule = (moduleName: string) => {
  const moduleId = resolveModuleId(moduleName);
  const entry = activeMocks.get(moduleId);
  if (!entry) {
    return;
  }

  restoreMockModule(entry.moduleName);
  if (entry.hasActualModule) {
    mock.module(entry.moduleName, () => entry.actualModule);
  }
  activeMocks.delete(entry.moduleId);
};

const requireActual = (moduleName: string) => {
  const moduleId = resolveModuleId(moduleName);
  const entry = activeMocks.get(moduleId);
  if (!entry) {
    return nodeRequire(moduleName);
  }

  if (entry.hasActualModule) {
    return entry.actualModule;
  }

  restoreMockModule(entry.moduleName);
  const actualModule = nodeRequire(moduleName);
  mock.module(entry.moduleName, entry.factory);
  return actualModule;
};

const restoreAllModuleMocks = () => {
  activeMocks.forEach((entry) => {
    restoreMockModule(entry.moduleName);
    if (entry.hasActualModule) {
      mock.module(entry.moduleName, () => entry.actualModule);
    }
  });
  activeMocks.clear();
};

const resetModules = () => {
  restoreAllModuleMocks();
};

export { mockModule, unmockModule, requireActual, resetModules, restoreAllModuleMocks };
