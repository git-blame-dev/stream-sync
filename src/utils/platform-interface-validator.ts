const DEFAULT_REQUIRED_METHODS = ['initialize', 'on', 'cleanup'];
const DEFAULT_OPTIONAL_SHUTDOWN_METHODS: string[] = [];

function normalizePlatformName(platformName: unknown): string {
    if (typeof platformName !== 'string') {
        return 'unknown';
    }

    const trimmed = platformName.trim();
    return trimmed ? trimmed : 'unknown';
}

function getMissingMethods(
    instance: unknown,
    requiredMethods: string[],
    optionalShutdownMethods: string[]
): string[] {
    const expected = [...requiredMethods];

    if (!instance || typeof instance !== 'object') {
        expected.push(...optionalShutdownMethods);
        return expected.sort();
    }

    const record = instance as Record<string, unknown>;
    const missing = expected.filter((methodName) => typeof record[methodName] !== 'function');
    const hasShutdownMethod = optionalShutdownMethods.some((methodName) => typeof record[methodName] === 'function');
    if (!hasShutdownMethod) {
        missing.push(...optionalShutdownMethods);
    }

    return missing.sort();
}

type PlatformValidationResult = {
    valid: boolean;
    platformName: string;
    requiredMethods: string[];
    missingMethods: string[];
    issues: string[];
};

function validatePlatformInterface(
    platformName: unknown,
    instance: unknown,
    requiredMethods: string[] = DEFAULT_REQUIRED_METHODS,
    optionalShutdownMethods: string[] = DEFAULT_OPTIONAL_SHUTDOWN_METHODS
): PlatformValidationResult {
    const normalizedName = normalizePlatformName(platformName);
    const methods = Array.isArray(requiredMethods) && requiredMethods.length > 0
        ? requiredMethods
        : DEFAULT_REQUIRED_METHODS;
    const shutdownMethods = Array.isArray(optionalShutdownMethods) && optionalShutdownMethods.length > 0
        ? optionalShutdownMethods
        : DEFAULT_OPTIONAL_SHUTDOWN_METHODS;

    const issues: string[] = [];
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

function assertPlatformInterface<T>(
    platformName: unknown,
    instance: T,
    requiredMethods: string[] = DEFAULT_REQUIRED_METHODS
): T {
    const result = validatePlatformInterface(platformName, instance, requiredMethods);
    if (!result.valid) {
        throw new Error(result.issues.join(' '));
    }

    return instance;
}

export { assertPlatformInterface };
