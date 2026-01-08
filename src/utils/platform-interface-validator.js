const DEFAULT_REQUIRED_METHODS = ['initialize', 'on', 'cleanup'];
const DEFAULT_OPTIONAL_SHUTDOWN_METHODS = [];

function normalizePlatformName(platformName) {
    if (typeof platformName !== 'string') {
        return 'unknown';
    }

    const trimmed = platformName.trim();
    return trimmed ? trimmed : 'unknown';
}

function getMissingMethods(instance, requiredMethods, optionalShutdownMethods) {
    const expected = [...requiredMethods];

    if (!instance || typeof instance !== 'object') {
        expected.push(...optionalShutdownMethods);
        return expected.sort();
    }

    const missing = expected.filter((methodName) => typeof instance[methodName] !== 'function');
    const hasShutdownMethod = optionalShutdownMethods.some((methodName) => typeof instance[methodName] === 'function');
    if (!hasShutdownMethod) {
        missing.push(...optionalShutdownMethods);
    }

    return missing.sort();
}

function validatePlatformInterface(
    platformName,
    instance,
    requiredMethods = DEFAULT_REQUIRED_METHODS,
    optionalShutdownMethods = DEFAULT_OPTIONAL_SHUTDOWN_METHODS
) {
    const normalizedName = normalizePlatformName(platformName);
    const methods = Array.isArray(requiredMethods) && requiredMethods.length > 0
        ? requiredMethods
        : DEFAULT_REQUIRED_METHODS;
    const shutdownMethods = Array.isArray(optionalShutdownMethods) && optionalShutdownMethods.length > 0
        ? optionalShutdownMethods
        : DEFAULT_OPTIONAL_SHUTDOWN_METHODS;

    const issues = [];
    const isObject = !!instance && typeof instance === 'object';
    const missingMethods = getMissingMethods(instance, methods, shutdownMethods);

    if (!isObject) {
        issues.push(
            `Invalid platform "${normalizedName}": expected an object instance but received ${typeof instance}.`
        );
    }

    if (missingMethods.length > 0) {
        issues.push(
            `Platform "${normalizedName}" is missing required methods: ${missingMethods.join(', ')}.`
        );
        issues.push(
            `Ensure "${normalizedName}" implements initialize(handlers), on(event, handler), and cleanup().`
        );
    }

    return {
        valid: issues.length === 0,
        platformName: normalizedName,
        requiredMethods: [...methods].sort(),
        missingMethods,
        issues
    };
}

function assertPlatformInterface(platformName, instance, requiredMethods = DEFAULT_REQUIRED_METHODS) {
    const result = validatePlatformInterface(platformName, instance, requiredMethods);
    if (!result.valid) {
        throw new Error(result.issues.join(' '));
    }
    return instance;
}

module.exports = {
    assertPlatformInterface,
    validatePlatformInterface
};
