// Parse command line arguments FIRST, before any imports
const args = process.argv.slice(2);

// Enhanced command line argument parsing
const cliArgs = {
    noMsg: false,
    debug: false,
    help: false,
    logLevel: null,
    chat: null
};

// Parse command line arguments
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
        case '--no-msg':
            cliArgs.noMsg = true;
            break;
        case '--debug':
            cliArgs.debug = true;
            break;
        case '--help':
        case '-h':
            cliArgs.help = true;
            break;

        case '--log-level':
            if (i + 1 < args.length) {
                cliArgs.logLevel = args[++i];
            }
            break;
        case '--chat':
            if (i + 1 < args.length) {
                const chatCount = parseInt(args[++i]);
                if (isNaN(chatCount) || chatCount <= 0) {
                    // Use process.stderr.write for CLI errors to avoid logging system interference
                    process.stderr.write('Error: --chat argument requires a positive number\n');
                    process.exit(1);
                }
                cliArgs.chat = chatCount;
            } else {
                // Use process.stderr.write for CLI errors to avoid logging system interference
                process.stderr.write('Error: --chat argument requires a number\n');
                process.exit(1);
            }
            break;
    }
}

// Handle help flag IMMEDIATELY, before any imports
if (cliArgs.help) {
    // Use process.stdout.write for help text to avoid logging system interference
    process.stdout.write(`
Usage: bun src/main.js [options]

Options:
  --no-msg             Suppress console output of chat messages
  --debug              Enable debug mode
  --log-level <level>  Set log level (debug, info, warn, error)
  --chat <number>      Exit after processing N actual messages
  --help, -h           Show this help message

Examples:
  bun src/main.js --no-msg
  bun src/main.js --log-level warn
  bun src/main.js --debug
`);
    process.exit(0);
}

// --- STEP 1: EARLY LOGGING SYSTEM INITIALIZATION ---
// This must happen BEFORE any other imports that might use logging
const crypto = require('crypto');
const { validateLoggingConfig } = require('./core/config');
const { 
    setConfigValidator, 
    setDebugMode, 
    initializeLoggingConfig,
    getLogger,
    initializeConsoleOverride
} = require('./core/logging');
const { safeSetTimeout, safeSetInterval } = require('./utils/timeout-validator');
const { createPlatformErrorHandler } = require('./utils/platform-error-handler');
const { ensureSecrets } = require('./utils/secret-manager');
const TwitchAuth = require('./auth/TwitchAuth');

// Set up logging system immediately
setConfigValidator(validateLoggingConfig);

// Set debug mode from command line argument FIRST
if (cliArgs.debug) {
    setDebugMode(true);
}

// Apply command line argument overrides for keyword parsing
// Note: Logger access will be moved after logger initialization
let keywordParsingDisabledViaCLI = false;
if (cliArgs.disableKeywordParsing) {
    keywordParsingDisabledViaCLI = true;
}

const { createRetrySystem } = require('./utils/retry-system');
const { getSystemTimestampISO } = require('./utils/timestamp');

// Import authentication
const { InnertubeFactory } = require('./factories/innertube-factory');

// --- STEP 2: CORE SYSTEM IMPORTS ---
// Now that logging is initialized, we can safely import other modules
const { config: configModule, logging } = require('./core');
const { config } = configModule;

const innertubeInstanceManager = require('./services/innertube-instance-manager');

const loggingInitWarnings = [];

// Initialize logging configuration with the loaded config
try {
    if (typeof initializeLoggingConfig !== 'function') {
        throw new Error('initializeLoggingConfig unavailable');
    }
    initializeLoggingConfig(config);
} catch (error) {
    throw error;
}

// Get the unified logger instance (now properly initialized)
const logger = getLogger();
if (!logger || typeof logger.debug !== 'function') {
    throw new Error('Logger missing required methods');
}

const retrySystem = createRetrySystem({ logger });

let mainErrorHandler = null;

function getMainErrorHandler() {
    if (!mainErrorHandler && logger) {
        mainErrorHandler = createPlatformErrorHandler(logger, 'main');
    }
    return mainErrorHandler;
}

function logMainError(message, error, payload, options) {
    const handler = getMainErrorHandler();
    if (!options) {
        throw new Error('logMainError requires options');
    }
    const { eventType, logContext } = options;

    if (!handler) {
        return;
    }

    if (error instanceof Error) {
        handler.handleEventProcessingError(error, eventType, payload, message, logContext);
        return;
    }

    handler.logOperationalError(message, logContext, payload);
}

// Log command line argument overrides after logger is initialized
if (keywordParsingDisabledViaCLI) {
    logger.info('Keyword parsing disabled via command line argument', 'system');
}

if (loggingInitWarnings.length) {
    loggingInitWarnings.forEach((warning) => {
        logger.warn(warning, 'logging');
    });
}

// Set debug mode from config if not already set by command line
if (!cliArgs.debug && config.general.debugEnabled) {
    setDebugMode(true);
    logger.info('Debug mode enabled via config.ini', 'system');
} else if (cliArgs.debug) {
    logger.info('Debug mode enabled via command line argument', 'system');
}

// Modern logging approach - use logger.debug directly instead of wrapper function
const coreConstants = require('./core/constants');
const {
    PRIORITY_LEVELS,
    NOTIFICATION_CONFIGS
} = coreConstants;

// OBS integration imports
const { getOBSConnectionManager, initializeOBSConnection } = require('./obs/connection');
const { initializeDisplayQueue } = require('./obs/display-queue');
const { getDefaultGoalsManager } = require('./obs/goals');


// Platform imports - will be lazy-loaded after preloader completes

// Utility imports
const { textProcessing: textProcessingModule } = require('./utils');
const { createTextProcessingManager } = textProcessingModule;
const textProcessing = createTextProcessingManager({ logger });
const { formatChatMessage } = textProcessing;
// YouTube channel ID resolution now handled internally via search
const { CommandParser } = require('./chat/commands');
const { AppRuntime } = require('./runtime/AppRuntime');
const { clearExpiredGlobalCooldowns } = require('./utils/command-parser');

// Notification system
const NotificationManager = require('./notifications/NotificationManager');
const { createSpamDetectionConfig, createDonationSpamDetection } = require('./utils/spam-detection');

// Event-driven architecture services
const { createEventBus } = require('./core/EventBus');
const { createVFXCommandService } = require('./services/VFXCommandService');
const { createUserTrackingService } = require('./services/UserTrackingService');
const CommandCooldownService = require('./services/CommandCooldownService');
const PlatformLifecycleService = require('./services/PlatformLifecycleService');
const { createGracefulExitService } = require('./services/GracefulExitService');

// OBS Event-driven services
const { createOBSEventService } = require('./obs/obs-event-service');
const { createSceneManagementService } = require('./obs/scene-management-service');


// Viewer count system


// Debug: Print the raw twitch config after loading (only in debug mode)
if (config.general.debugEnabled) {
    logger.debug('Raw twitch config:', 'system', config.twitch);
}

// Apply CLI arguments to config
if (cliArgs.noMsg) {
    config.general.noMsg = true;
}

if (cliArgs.logLevel) {
    config.general.logLevel = cliArgs.logLevel;
}

let app; // Declare app instance at the module level

function createProductionDependencies(overrides = {}) {
    const { validateLoggerInterface } = require('./utils/dependency-validator');
    const { DependencyFactory } = require('./utils/dependency-factory');
    const effects = require('./obs/effects');
    const sources = require('./obs/sources');

    validateLoggerInterface(logger);

    const resolvedOverrides = overrides || {};
    if (resolvedOverrides.innertubeImporter) {
        InnertubeFactory.configure({ importer: resolvedOverrides.innertubeImporter });
    }
    
    return {
        obs: {
            connectionManager: require('./obs/connection').getOBSConnectionManager({ config: config.obs }),
            sourcesManager: sources.getDefaultSourcesManager(),
            effectsManager: effects.getDefaultEffectsManager()
        },
        sourcesFactory: sources,
        effectsFactory: effects,
        logging: logger,
        logger: logger,
        platforms: require('./platforms'),
        displayQueue: null,
        notificationManager: null,
        dependencyFactory: resolvedOverrides.dependencyFactory || new DependencyFactory(),
        lazyInnertube: InnertubeFactory.createLazyReference(),
        axios: resolvedOverrides.axios,
        WebSocketCtor: resolvedOverrides.WebSocketCtor,
        tiktokConnector: resolvedOverrides.tiktokConnector,
        innertubeImporter: resolvedOverrides.innertubeImporter,

        eventBus: null,
        vfxCommandService: null,
        userTrackingService: null
    };
}

function createAppRuntime(config, dependencies) {
    if (!dependencies) {
        throw new Error('createAppRuntime requires dependencies');
    }
    const deps = dependencies;

    logger.info('Creating AppRuntime', 'system');

    const commandParserConfig = {
        ...config,
        cliArgs: {
            disableKeywordParsing: cliArgs.disableKeywordParsing
        }
    };
    deps.commandParser = deps.commandParser || new CommandParser(commandParserConfig);

    return new AppRuntime(config, deps);
}

async function main(overrides = {}) {
    if (overrides?.innertubeImporter) {
        innertubeInstanceManager.setInnertubeImporter(overrides.innertubeImporter);
    }
    try {
        logger.console('Starting main application...', 'main');
        logger.info('Main application started, beginning initialization...', 'Main');
        logger.debug('About to set up display queue configuration...', 'Main');
        logger.info('Setting up display queue configuration...', 'Main');

        try {
            await ensureSecrets({
                config,
                logger,
                interactive: !!(process.stdin && process.stdin.isTTY),
                envFilePath: config.general.envFilePath,
                envFileReadEnabled: config.general.envFileReadEnabled,
                envFileWriteEnabled: config.general.envFileWriteEnabled
            });
        } catch (error) {
            logMainError('Secret setup failed - missing required secrets', error, null, {
                eventType: 'configuration',
                logContext: 'Main'
            });
            throw error;
        }

        let twitchAuth = null;
        let authValid = true;
        if (config.twitch.enabled) {
            twitchAuth = new TwitchAuth({
                tokenStorePath: config.twitch.tokenStorePath,
                clientId: config.twitch.clientId,
                expectedUsername: config.twitch.username,
                logger,
                httpClient: overrides?.axios
            });
            try {
                await twitchAuth.initialize();
                authValid = twitchAuth.isReady();
            } catch (error) {
                authValid = false;
                logMainError('Twitch authentication failed - continuing with limited functionality', error, null, {
                    eventType: 'authentication',
                    logContext: 'Main'
                });
            }
        }

        if (!config.general || !config.obs) {
            throw new Error('Display queue requires general and obs config');
        }
        const { chatMsgTxt, chatMsgScene, chatMsgGroup, ttsEnabled } = config.general;
        if (!chatMsgTxt || !chatMsgScene) {
            throw new Error('Display queue requires chatMsgTxt and chatMsgScene');
        }
        const chatSourceName = chatMsgTxt;
        const chatSceneName = chatMsgScene;
        const chatGroupName = chatMsgGroup;
        const chatLogos = config.obs.chatPlatformLogos;
        const notificationLogos = config.obs.notificationPlatformLogos;
        const { notificationMsgGroup, notificationTxt, notificationScene } = config.obs;
        if (!notificationTxt || !notificationScene) {
            throw new Error('Display queue requires notificationTxt and notificationScene');
        }
        const notificationGroupName = notificationMsgGroup;
        const obsNotificationTxt = notificationTxt;
        const obsNotificationScene = notificationScene;
        const handcamConfig = config.handcam;
        const giftsConfig = config.gifts;
        const ttsEnabledConfig = ttsEnabled;
        
        const displayQueueConfig = {
            autoProcess: config.displayQueue.autoProcess,
            maxQueueSize: config.displayQueue.maxQueueSize,
            chatOptimization: config.displayQueue.chatOptimization,
            chat: {
                sourceName: chatSourceName,
                sceneName: chatSceneName,
                groupName: chatGroupName,
                platformLogos: chatLogos
            },
            notification: {
                sourceName: obsNotificationTxt,
                sceneName: obsNotificationScene,
                groupName: notificationGroupName,
                platformLogos: notificationLogos
            },
            obs: config.obs,
            handcam: handcamConfig,
            gifts: giftsConfig,
            timing: config.timing,
            youtube: config.youtube,
            twitch: config.twitch,
            tiktok: config.tiktok,
            ttsEnabled: ttsEnabledConfig
        };
        
        // Debug: Log the display queue configuration 
        logger.debug(`[Display Queue Config] Notification: ${displayQueueConfig.notification.sourceName}, Chat: ${displayQueueConfig.chat.sourceName}`, 'Main');
        
        const chatTransitionDelay = config.timing.transitionDelay;
        const notificationClearDelay = config.timing.notificationClearDelay;
        const chatMessageDuration = config.timing.chatMessageDuration;
        const notificationConfigs = NOTIFICATION_CONFIGS;
        const priorityLevels = PRIORITY_LEVELS;
        
        const displayQueueConstants = {
            CHAT_TRANSITION_DELAY: chatTransitionDelay, 
            NOTIFICATION_CLEAR_DELAY: notificationClearDelay,
            CHAT_MESSAGE_DURATION: chatMessageDuration,
            NOTIFICATION_CONFIGS: notificationConfigs,
            PRIORITY_LEVELS: priorityLevels
        };
        
        logger.debug('Creating EventBus...', 'Main');
        const eventBus = createEventBus({ 
            debugEnabled: config.general.debugEnabled,
            maxListeners: 100
        });
        logger.debug('EventBus created', 'Main');

        logger.debug('About to initialize display queue...', 'Main');
        const obsManager = getOBSConnectionManager({ config: config.obs });
        const displayQueue = initializeDisplayQueue(obsManager, displayQueueConfig, displayQueueConstants, eventBus);
        logger.debug('Display queue initialized', 'Main');
        
        logger.debug('Creating VFXCommandService...', 'Main');
        const vfxCommandService = createVFXCommandService(config, eventBus);
        logger.debug('VFXCommandService created', 'Main');
        
        logger.debug('Creating UserTrackingService...', 'Main');
        const userTrackingService = createUserTrackingService();
        logger.debug('UserTrackingService created', 'Main');

        // Create OBS event-driven services
        logger.debug('Creating OBS event-driven services...', 'Main');
        const obsConnectionManager = getOBSConnectionManager({ config: config.obs });
        const obsSources = require('./obs/sources').getDefaultSourcesManager();

        const obsEventService = createOBSEventService({
            eventBus,
            obsConnection: obsConnectionManager,
            obsSources,
            logger
        });
        logger.debug('OBSEventService created', 'Main');

        const sceneManagementService = createSceneManagementService({
            eventBus,
            obsConnection: obsConnectionManager,
            logger
        });
        logger.debug('SceneManagementService created', 'Main');

        const obsGoals = getDefaultGoalsManager();

        // After displayQueue and services are created, create NotificationManager
        logger.debug('About to create notification manager...', 'Main');
        logger.info('Creating notification manager...', 'Main');
        const notificationManager = new NotificationManager({
            displayQueue: displayQueue,
            eventBus: eventBus,
            config: config,
            vfxCommandService: vfxCommandService,
            userTrackingService: userTrackingService,
            logger,
            constants: coreConstants,
            textProcessing,
            obsGoals
        });
        
        logger.debug('Creating spam detection service...', 'Main');
        const spamConfig = createSpamDetectionConfig(config.spam, { logger });
        const donationSpamDetector = createDonationSpamDetection(spamConfig, {
            logger,
            onAggregatedDonation: (data) => notificationManager.handleAggregatedDonation(data)
        });
        notificationManager.donationSpamDetector = donationSpamDetector;
        logger.debug('Spam detection service created and wired', 'Main');
        
        if (config.twitch.enabled) {
            if (!authValid) {
                logger.warn('Authentication validation failed - continuing with limited functionality', 'Main');
            } else {
                logger.info('Authentication validation successful', 'Main');
            }
        }
        
        const dependencies = createProductionDependencies(overrides);
        dependencies.displayQueue = displayQueue;
        dependencies.notificationManager = notificationManager;
        dependencies.twitchAuth = twitchAuth;
        
        // Add event-driven services to dependencies
        dependencies.eventBus = eventBus;
        dependencies.vfxCommandService = vfxCommandService;
        dependencies.userTrackingService = userTrackingService;
        dependencies.obsEventService = obsEventService;
        dependencies.sceneManagementService = sceneManagementService;

        const sharedPlatformDependencies = {
            logger,
            notificationManager,
            twitchAuth,
            USER_AGENTS: config.http.userAgents,
            config,
            Innertube: dependencies.lazyInnertube,
            axios: dependencies.axios,
            WebSocketCtor: dependencies.WebSocketCtor,
            tiktokConnector: dependencies.tiktokConnector
        };

        const commandCooldownService = new CommandCooldownService({
            eventBus,
            logger,
            config
        });

        const platformLifecycleService = new PlatformLifecycleService({
            config,
            eventBus,
            dependencyFactory: dependencies.dependencyFactory,
            logger,
            sharedDependencies: sharedPlatformDependencies
        });

        dependencies.commandCooldownService = commandCooldownService;
        dependencies.platformLifecycleService = platformLifecycleService;
        
        app = createAppRuntime(config, dependencies);

        const gracefulExitService = createGracefulExitService(
            app,
            cliArgs.chat,
            config.general?.gracefulExit
        );
        dependencies.gracefulExitService = gracefulExitService;

        // NotificationManager uses event-driven architecture; no manual bridging required
        
        logger.info('Starting AppRuntime application...', 'Main');
        await app.start();
        logger.info('AppRuntime started successfully', 'Main');

        if (process.env.CHAT_BOT_STARTUP_ONLY === 'true') {
            logger.info('Startup-only mode enabled; shutting down after initialization', 'Main');
            await app.shutdown();
            return {
                success: true,
                appStarted: true,
                viewerCountActive: app && app.viewerCountSystem ? app.viewerCountSystem.isPolling : false,
                authValid
            };
        }
        
        logger.info('Runtime main components are running. Holding process open.', 'system');
        logger.debug('Runtime main components are running. Holding process open.', 'Main');

        // Only keep the application alive if graceful exit is not enabled
        if (!cliArgs.chat) {
            logger.debug('Setting up keep-alive interval (graceful exit not enabled)', 'Main');
            // Keep the application alive to listen for events
            const keepAliveInterval = safeSetInterval(() => {
                // This interval keeps the Node.js process alive.
                // Perform periodic maintenance tasks
                try {
                    // Clean up expired global command cooldowns to prevent memory leaks
                    const cleanedCount = clearExpiredGlobalCooldowns(300000); // 5 minutes
                    if (cleanedCount > 0) {
                        logger.debug(`Periodic cleanup: removed ${cleanedCount} expired global cooldowns`, 'maintenance');
                    }
                } catch (error) {
                    logMainError('Error during periodic global cooldown cleanup', error, null, { eventType: 'maintenance', logContext: 'maintenance' });
                }
            }, 1000 * 60 * 60); // Run every hour
            
            // Store the interval ID in the app instance for cleanup during shutdown
            if (app) {
                app.keepAliveInterval = keepAliveInterval;
            }
        } else {
            logger.debug('Graceful exit enabled - no keep-alive interval needed', 'Main');
        }

        // Return startup completion status
        logger.debug('Main function completing successfully', 'Main');
        return {
            success: true,
            appStarted: true,
            viewerCountActive: app && app.viewerCountSystem ? app.viewerCountSystem.isPolling : false,
            authValid
        };

    } catch (error) {
        logMainError(`Critical error occurred: ${error.message}`, error, null, { eventType: 'startup', logContext: 'main' });
        throw error; // Re-throw to ensure the error is visible
    }
}

// Suppress Node.js deprecation warnings for cleaner output
process.noDeprecation = true;

if (require.main === module) {
    main();
}

// Unhandled promise rejection handler - will be set up after logger is initialized

module.exports = { main, AppRuntime }; 
