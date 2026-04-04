
function validateLoggerInterface(logger) {
    if (!logger) {
        throw new Error('Logger dependency is required and must be an object with logging methods. ' +
                       'Provide a logger object with debug, info, error, and warn methods.');
    }
    
    if (typeof logger !== 'object') {
        throw new Error(`Logger expected object, received ${typeof logger}. ` +
                       'Logger dependency must be an object with debug, info, error, and warn methods.');
    }

    const requiredMethods = ['debug', 'info', 'error', 'warn'];
    const missingMethods = [];

    for (const method of requiredMethods) {
        if (typeof logger[method] !== 'function') {
            missingMethods.push(method);
        }
    }

    if (missingMethods.length > 0) {
        throw new Error(`Logger interface missing required methods: ${missingMethods.join(', ')}. ` +
                       `Please add these methods to your logger: ${missingMethods.map(m => `${m}(message, platform, error?)`).join(', ')}`);
    }

}

function validateNotificationManagerInterface(notificationManager) {
    if (!notificationManager || typeof notificationManager !== 'object') {
        throw new Error('NotificationManager dependency is required and must be an object with event management methods. ' +
                       'Provide a notification manager with emit, on, and removeListener methods.');
    }

    const requiredMethods = ['emit', 'on'];
    const missingMethods = [];

    for (const method of requiredMethods) {
        if (typeof notificationManager[method] !== 'function') {
            missingMethods.push(method);
        }
    }

    if (missingMethods.length > 0) {
        throw new Error(`NotificationManager missing required methods: ${missingMethods.join(', ')}. ` +
                       `Ensure your notification manager implements these event methods.`);
    }
}

function validateConnectionFactoryInterface(factory) {
    if (!factory || typeof factory !== 'object') {
        throw new Error('Connection factory is required and must be an object with createConnection method. ' +
                       'Provide a factory that can create platform connections.');
    }

    if (typeof factory.createConnection !== 'function') {
        throw new Error('Factory missing createConnection method. ' +
                       'The connection factory must implement createConnection(platform, config, dependencies) method.');
    }
}

function validateYouTubePlatformDependencies(dependencies) {
    if (!dependencies || typeof dependencies !== 'object') {
        throw new Error('Dependencies are required for YouTube platform initialization. ' +
                       'Provide dependencies object with logger, streamDetectionService, and other required services.');
    }

    // Validate required core dependencies
    if (!dependencies.logger) {
        throw new Error('Missing required dependencies: logger. ' +
                       'Please provide a logger object with debug, info, error, and warn methods.');
    }

    if (!dependencies.streamDetectionService || typeof dependencies.streamDetectionService.detectLiveStreams !== 'function') {
        throw new Error('Missing required dependencies: stream detection service (streamDetectionService) with detectLiveStreams(channelHandle). ' +
                       'Provide a service that can detect live YouTube streams for the configured channel.');
    }

    // Validate logger interface
    validateLoggerInterface(dependencies.logger);

    // Validate optional dependencies when present
    if (dependencies.notificationManager) {
        validateNotificationManagerInterface(dependencies.notificationManager);
    }

    if (dependencies.viewerCountProvider) {
        if (typeof dependencies.viewerCountProvider.getViewerCount !== 'function') {
            throw new Error('viewerCountProvider must implement getViewerCount() when provided.');
        }
    }

    // Check for invalid dependency types
    const expectedTypes = {
        logger: 'object'
    };

    for (const [depName, expectedType] of Object.entries(expectedTypes)) {
        if (dependencies[depName] && typeof dependencies[depName] !== expectedType) {
            throw new Error(`Dependency '${depName}' expected ${expectedType}, received ${typeof dependencies[depName]}. ` +
                           `Please ensure ${depName} is properly initialized as an ${expectedType}.`);
        }
    }
}

function validateConnectionStateManagerDependencies(config, dependencies) {
    if (!config || typeof config !== 'object') {
        throw new Error('Initialization failed: missing required configuration. ' +
                       'Provide a valid configuration object for connection state management.');
    }

    if (!dependencies || typeof dependencies !== 'object') {
        throw new Error('Initialization failed: missing required dependencies. ' +
                       'Connection state manager requires a dependencies object with logger.');
    }

    // Logger is the most critical dependency for state manager
    if (!dependencies.logger) {
        throw new Error('Initialization failed: missing required dependencies (logger). ' +
                       'Connection state manager requires a logger for operation tracking.');
    }

    validateLoggerInterface(dependencies.logger);
}

function validateFactoryCanCreateConnections(factory, platform, config, dependencies) {
    try {
        const connection = factory.createConnection(platform, config, dependencies);
        
        if (!connection) {
            throw new Error(`Factory returned null/undefined connection for ${platform}. ` +
                           'Connection factory must return a valid connection object.');
        }

        if (typeof connection !== 'object') {
            throw new Error(`Factory returned invalid connection type for ${platform}. ` +
                           'Expected object, received ' + typeof connection);
        }

        return connection;
    } catch (error) {
        throw new Error(`Factory failed to create valid connection for ${platform}: ${error.message}`);
    }
}

function createStandardDependencies(platform, baseLogger) {
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

module.exports = {
    validateLoggerInterface,
    validateNotificationManagerInterface,
    validateConnectionFactoryInterface,
    validateYouTubePlatformDependencies,
    validateConnectionStateManagerDependencies,
    validateFactoryCanCreateConnections,
    createStandardDependencies
};
