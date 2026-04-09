(function initializeCoreIndexModule() {
type ConfigModule = {
    config: Record<string, unknown>;
    loadConfig: () => unknown;
    _resetConfigForTesting: () => void;
    _getConfigPath: () => string;
};

function nodeRequire<T>(moduleId: string): T {
    return require(moduleId) as T;
}

const config = nodeRequire<ConfigModule>('./config');

module['exports'] = {
    config
};
})();
