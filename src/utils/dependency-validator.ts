type LoggerLike = {
    debug: (message: string, scope?: string, payload?: unknown) => void;
    info: (message: string, scope?: string, payload?: unknown) => void;
    error: (message: string, scope?: string, payload?: unknown) => void;
    warn: (message: string, scope?: string, payload?: unknown) => void;
};

type NotificationManagerLike = {
    emit: (eventName: string, payload?: unknown) => unknown;
    on: (eventName: string, handler: (...args: unknown[]) => void) => unknown;
    removeListener?: (eventName: string, handler: (...args: unknown[]) => void) => unknown;
};

type ConnectionFactoryLike = {
    createConnection: (platform: string, config: unknown, dependencies: unknown) => unknown;
};

type YouTubePlatformDependencies = {
    logger: LoggerLike;
    streamDetectionService: {
        detectLiveStreams: (channelHandle: string) => unknown;
    };
    notificationManager?: NotificationManagerLike;
    viewerCountProvider?: {
        getViewerCount: () => unknown;
    };
    [key: string]: unknown;
};

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

function validateLoggerInterface(logger: unknown): asserts logger is LoggerLike {
    if (!logger) {
        throw new Error('Logger dependency is required and must be an object with logging methods. ' +
                       'Provide a logger object with debug, info, error, and warn methods.');
    }
    
    if (typeof logger !== 'object') {
        throw new Error(`Logger expected object, received ${typeof logger}. ` +
                       'Logger dependency must be an object with debug, info, error, and warn methods.');
    }

    const requiredMethods = ['debug', 'info', 'error', 'warn'];
    const missingMethods: string[] = [];
    const loggerRecord = logger as Record<string, unknown>;

    for (const method of requiredMethods) {
        if (typeof loggerRecord[method] !== 'function') {
            missingMethods.push(method);
        }
    }

    if (missingMethods.length > 0) {
        throw new Error(`Logger interface missing required methods: ${missingMethods.join(', ')}. ` +
                       `Please add these methods to your logger: ${missingMethods.map(m => `${m}(message, platform, error?)`).join(', ')}`);
    }

}

function validateNotificationManagerInterface(notificationManager: unknown): asserts notificationManager is NotificationManagerLike {
    if (!notificationManager || typeof notificationManager !== 'object') {
        throw new Error('NotificationManager dependency is required and must be an object with event management methods. ' +
                       'Provide a notification manager with emit, on, and removeListener methods.');
    }

    const requiredMethods = ['emit', 'on'];
    const missingMethods: string[] = [];
    const managerRecord = notificationManager as Record<string, unknown>;

    for (const method of requiredMethods) {
        if (typeof managerRecord[method] !== 'function') {
            missingMethods.push(method);
        }
    }

    if (missingMethods.length > 0) {
        throw new Error(`NotificationManager missing required methods: ${missingMethods.join(', ')}. ` +
                       `Ensure your notification manager implements these event methods.`);
    }
}

function validateConnectionFactoryInterface(factory: unknown): asserts factory is ConnectionFactoryLike {
    if (!factory || typeof factory !== 'object') {
        throw new Error('Connection factory is required and must be an object with createConnection method. ' +
                       'Provide a factory that can create platform connections.');
    }

    if (typeof (factory as { createConnection?: unknown }).createConnection !== 'function') {
        throw new Error('Factory missing createConnection method. ' +
                       'The connection factory must implement createConnection(platform, config, dependencies) method.');
    }
}

function validateYouTubePlatformDependencies(dependencies: unknown): asserts dependencies is YouTubePlatformDependencies {
    if (!dependencies || typeof dependencies !== 'object') {
        throw new Error('Dependencies are required for YouTube platform initialization. ' +
                       'Provide dependencies object with logger, streamDetectionService, and other required services.');
    }

    const dependencyRecord = dependencies as Record<string, unknown>;

    // Validate required core dependencies
    if (!dependencyRecord.logger) {
        throw new Error('Missing required dependencies: logger. ' +
                       'Please provide a logger object with debug, info, error, and warn methods.');
    }

    const streamDetectionService = dependencyRecord.streamDetectionService;
    const hasDetectLiveStreams = typeof (streamDetectionService as { detectLiveStreams?: unknown } | undefined)?.detectLiveStreams === 'function';
    if (!streamDetectionService || !hasDetectLiveStreams) {
        throw new Error('Missing required dependencies: stream detection service (streamDetectionService) with detectLiveStreams(channelHandle). ' +
                       'Provide a service that can detect live YouTube streams for the configured channel.');
    }

    // Validate logger interface
    validateLoggerInterface(dependencyRecord.logger);

    // Validate optional dependencies when present
    if (dependencyRecord.notificationManager) {
        validateNotificationManagerInterface(dependencyRecord.notificationManager);
    }

    if (dependencyRecord.viewerCountProvider) {
        const viewerCountProvider = dependencyRecord.viewerCountProvider as { getViewerCount?: unknown };
        if (typeof viewerCountProvider.getViewerCount !== 'function') {
            throw new Error('viewerCountProvider must implement getViewerCount() when provided.');
        }
    }

    // Check for invalid dependency types
    const expectedTypes = {
        logger: 'object'
    };

    for (const [depName, expectedType] of Object.entries(expectedTypes)) {
        if (dependencyRecord[depName] && typeof dependencyRecord[depName] !== expectedType) {
            throw new Error(`Dependency '${depName}' expected ${expectedType}, received ${typeof dependencyRecord[depName]}. ` +
                           `Please ensure ${depName} is properly initialized as an ${expectedType}.`);
        }
    }
}

function validateConnectionStateManagerDependencies(config: unknown, dependencies: unknown): void {
    if (!config || typeof config !== 'object') {
        throw new Error('Initialization failed: missing required configuration. ' +
                       'Provide a valid configuration object for connection state management.');
    }

    if (!dependencies || typeof dependencies !== 'object') {
        throw new Error('Initialization failed: missing required dependencies. ' +
                       'Connection state manager requires a dependencies object with logger.');
    }

    const dependencyRecord = dependencies as Record<string, unknown>;

    // Logger is the most critical dependency for state manager
    if (!dependencyRecord.logger) {
        throw new Error('Initialization failed: missing required dependencies (logger). ' +
                       'Connection state manager requires a logger for operation tracking.');
    }

    validateLoggerInterface(dependencyRecord.logger);
}

function validateFactoryCanCreateConnections(factory: unknown, platform: string, config: unknown, dependencies: unknown): Record<string, unknown> {
    try {
        validateConnectionFactoryInterface(factory);
        const connection = factory.createConnection(platform, config, dependencies);
        
        if (!connection) {
            throw new Error(`Factory returned null/undefined connection for ${platform}. ` +
                           'Connection factory must return a valid connection object.');
        }

        if (typeof connection !== 'object') {
            throw new Error(`Factory returned invalid connection type for ${platform}. ` +
                           'Expected object, received ' + typeof connection);
        }

        return connection as Record<string, unknown>;
    } catch (error: unknown) {
        throw new Error(`Factory failed to create valid connection for ${platform}: ${getErrorMessage(error)}`);
    }
}

function createStandardDependencies(platform: string, baseLogger: unknown): {
    logger: LoggerLike;
    notificationManager: NotificationManagerLike;
    displayQueue: {
        add: (item?: unknown) => void;
        process: () => void;
        isReady: () => boolean;
    };
} {
    validateLoggerInterface(baseLogger);
    
    return {
        logger: baseLogger,
        notificationManager: {
            emit: () => {},
            on: () => {},
            removeListener: () => {}
        },
        displayQueue: {
            add: () => {},
            process: () => {},
            isReady: () => true
        }
    };
}

export {
    validateLoggerInterface,
    validateNotificationManagerInterface,
    validateConnectionFactoryInterface,
    validateYouTubePlatformDependencies,
    validateConnectionStateManagerDependencies,
    validateFactoryCanCreateConnections,
    createStandardDependencies
};
