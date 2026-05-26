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

const restoreRegisteredModuleMocks = (actualEntries: ModuleMockEntry[] = []) => {
  mock.restore();
  actualEntries.forEach((entry) => {
    if (entry.hasActualModule) {
      mock.module(entry.moduleName, () => entry.actualModule);
    }
  });
  activeMocks.forEach((entry) => {
    mock.module(entry.moduleName, entry.factory);
  });
};

const restoreActualModules = () => {
  mock.restore();
  activeMocks.forEach((entry) => {
    if (entry.hasActualModule) {
      mock.module(entry.moduleName, () => entry.actualModule);
    }
  });
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

  activeMocks.delete(entry.moduleId);
  restoreRegisteredModuleMocks([entry]);
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

  restoreActualModules();
  const actualModule = nodeRequire(moduleName);
  restoreRegisteredModuleMocks();
  return actualModule;
};

const restoreAllModuleMocks = () => {
  restoreActualModules();
  activeMocks.clear();
};

const resetModules = () => {
  restoreAllModuleMocks();
};

export { mockModule, unmockModule, requireActual, resetModules, restoreAllModuleMocks };
