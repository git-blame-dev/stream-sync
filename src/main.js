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
Usage: node src/main.js [options]

Options:
  --no-msg             Suppress console output of chat messages
  --debug              Enable debug mode
  --log-level <level>  Set log level (debug, info, warn, error)
  --chat <number>      Exit after processing N actual messages
  --help, -h           Show this help message

Examples:
  node src/main.js --no-msg
  node src/main.js --log-level warn
  node src/main.js --debug
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
const { loadTokens } = require('./utils/token-store');

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

// Import authentication validation
const { validateAuthentication } = require('./auth/token-validator');
// Import stream detection system
const { StreamDetector } = require('./utils/stream-detector');
const { InnertubeFactory } = require('./factories/innertube-factory');

// --- STEP 2: CORE SYSTEM IMPORTS ---
// Now that logging is initialized, we can safely import other modules
const { config: configModule, logging } = require('./core');
const { createRuntimeConstants } = require('./core/runtime-constants');
const wireStreamStatusHandlers = require('./viewer-count/stream-status-handler');
const { configManager, config } = configModule;

// --- STEP 3: CONFIGURATION LOADING ---
// Load config once and only once
configManager.load();
const runtimeConstants = createRuntimeConstants(configManager.getRaw());
const innertubeInstanceManager = require('./services/innertube-instance-manager');
innertubeInstanceManager.setRuntimeConstants(runtimeConstants);

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

async function hydrateTwitchTokensFromStore() {
    const twitchConfig = config.twitch;
    if (!twitchConfig || !twitchConfig.enabled) {
        return;
    }

    const tokenStorePath = twitchConfig.tokenStorePath;

    try {
        const tokens = await loadTokens({ tokenStorePath, logger });
        if (!tokens) {
            return;
        }

        if (configManager.config && configManager.config.twitch) {
            configManager.config.twitch.accessToken = tokens.accessToken;
            configManager.config.twitch.refreshToken = tokens.refreshToken;
            if (Object.prototype.hasOwnProperty.call(configManager.config.twitch, 'apiKey')) {
                configManager.config.twitch.apiKey = tokens.accessToken;
            }
            if (tokens.expiresAt) {
                configManager.config.twitch.tokenExpiresAt = tokens.expiresAt;
            }
        }

        twitchConfig.accessToken = tokens.accessToken;
        twitchConfig.refreshToken = tokens.refreshToken;
        if (Object.prototype.hasOwnProperty.call(twitchConfig, 'apiKey')) {
            twitchConfig.apiKey = tokens.accessToken;
        }
        if (tokens.expiresAt) {
            twitchConfig.tokenExpiresAt = tokens.expiresAt;
        }
    } catch (error) {
        logMainError('Failed to load token store tokens', error, { tokenStorePath }, {
            eventType: 'configuration',
            logContext: 'token-store'
        });
        throw error;
    }
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
const { clearExpiredGlobalCooldowns } = require('./utils/command-parser');

// Notification system
const NotificationManager = require('./notifications/NotificationManager');
const { PlatformEvents } = require('./interfaces/PlatformEvents');

// Event-driven architecture services
const { createEventBus } = require('./core/EventBus');
const { createConfigService } = require('./services/ConfigService');
const { createTTSService } = require('./services/TTSService');
const { createVFXCommandService } = require('./services/VFXCommandService');
const { createUserTrackingService } = require('./services/UserTrackingService');
const CommandCooldownService = require('./services/CommandCooldownService');
const PlatformLifecycleService = require('./services/PlatformLifecycleService');
const PlatformEventRouter = require('./services/PlatformEventRouter');
const ChatNotificationRouter = require('./services/ChatNotificationRouter');
const { createGracefulExitService } = require('./services/GracefulExitService');

// OBS Event-driven services
const { createOBSEventService } = require('./obs/obs-event-service');
const { createSceneManagementService } = require('./obs/scene-management-service');


// Viewer count system
const { ViewerCountSystem } = require('./utils/viewer-count');
const { OBSViewerCountObserver } = require('./observers/obs-viewer-count-observer');


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

function createProductionDependencies(runtimeConstants) {
    // FAIL-FAST: Validate core dependencies before creating production dependencies
    const { validateLoggerInterface } = require('./utils/dependency-validator');
    const { DependencyFactory } = require('./utils/dependency-factory');
    const effects = require('./obs/effects');
    const sources = require('./obs/sources');
    
    // Validate the main logger is properly initialized
    validateLoggerInterface(logger);
    
    // Create TimestampExtractionService instance for dependency injection
    const TimestampExtractionService = require('./services/TimestampExtractionService');
    const timestampService = new TimestampExtractionService({ logger });
    
    return {
        obs: {
            connectionManager: require('./obs/connection').getOBSConnectionManager({ runtimeConstants }),
            sourcesManager: sources.getDefaultSourcesManager({ runtimeConstants }),
            effectsManager: effects.getDefaultEffectsManager()
        },
        sourcesFactory: sources,
        effectsFactory: effects,
        logging: logger, // Use the properly initialized logger
        logger: logger, // Also provide as 'logger' for platform compatibility
        platforms: require('./platforms'),
        displayQueue: null, // Will be set by main function
        notificationManager: null, // Will be set by main function
        timestampService: timestampService, // Add timestamp service for platform dependency injection
        dependencyFactory: new DependencyFactory(), // Factory for creating platform-specific dependencies
        lazyInnertube: InnertubeFactory.createLazyReference(),
        runtimeConstants,

        // Event-driven architecture services (will be created in main function)
        eventBus: null,
        configService: null,
        ttsService: null,
        vfxCommandService: null,
        userTrackingService: null
    };
}

function createAppRuntime(config, dependencies) {
    if (!dependencies) {
        throw new Error('createAppRuntime requires dependencies');
    }
    const deps = dependencies;
    
    logger.info(`Creating AppRuntime`, 'system');
    
    return new AppRuntime(config, deps);
}

class AppRuntime {
    async handleUnifiedNotification(type, platform, username, options) {
        if (!options || typeof options !== 'object') {
            throw new Error('handleUnifiedNotification requires options');
        }
        if (!this.config || !this.config.general) {
            throw new Error(`AppRuntime config unavailable for ${type} notification`);
        }

        try {
            if (!username || typeof username !== 'string' || !username.trim()) {
                throw new Error(`Missing username for ${type} notification`);
            }
            if (!options.userId) {
                throw new Error(`Missing userId for ${type} notification`);
            }
            if (!options.timestamp) {
                throw new Error(`Missing timestamp for ${type} notification`);
            }

            const notificationData = {
                username,
                userId: options.userId,
                platform: platform,
                timestamp: options.timestamp,
                ...options
            };

            // Delegate to NotificationManager for all processing
            if (this.notificationManager) {
                await this.notificationManager.handleNotification(type, platform, notificationData);
            } else {
                throw new Error(`Notification manager not available for ${type} notification`);
            }
        } catch (error) {
            this._handleAppRuntimeError(
                `Error handling ${type} notification for ${username}: ${error.message}`,
                error,
                { notificationType: type, username, platform },
                { eventType: 'notification', logContext: platform }
            );
        }
    }

    // Chat message handling is delegated to ChatNotificationRouter (see handleChatMessage)

    buildPlatformSharedDependencies() {
        return {
            authManager: this.authManager,
            authFactory: this.dependencies.authFactory,
            notificationManager: this.notificationManager,
            timestampService: this.dependencies.timestampService,
            logger: logging.getUnifiedLogger(),
            platformLogger: logger,
            config: this.config,
            retrySystem: retrySystem,
            streamDetectionService: this.youtubeDetectionService,
            youtubeDetectionService: this.youtubeDetectionService,
            Innertube: this.lazyInnertube,
            USER_AGENTS: this.runtimeConstants.USER_AGENTS,
            runtimeConstants: this.runtimeConstants
        };
    }

    _createYoutubeDetectionService() {
        const youtubeConfig = this.config?.youtube;
        if (!youtubeConfig || youtubeConfig.streamDetectionMethod !== 'youtubei') {
            return null;
        }

        const dependencyFactory = this.dependencies?.dependencyFactory;
        if (!dependencyFactory || typeof dependencyFactory.createYoutubeDependencies !== 'function') {
            throw new Error('dependencyFactory.createYoutubeDependencies required for YouTube detection');
        }

        try {
            const LazyInnertube = this.lazyInnertube;
            const dependencies = dependencyFactory.createYoutubeDependencies(youtubeConfig, {
                Innertube: LazyInnertube,
                logger: this.logger
            });

            if (!dependencies || !dependencies.streamDetectionService) {
                throw new Error('YouTube streamDetectionService unavailable');
            }
            if (this.logger && typeof this.logger.debug === 'function') {
                this.logger.debug('Pre-created YouTube stream detection service for StreamDetector', 'AppRuntime');
            }

            return dependencies.streamDetectionService;
        } catch (error) {
            throw error;
        }
    }

    constructor(config, dependencies) {
        if (!dependencies) {
            throw new Error('AppRuntime requires dependencies');
        }
        if (!logger || typeof logger.debug !== 'function') {
            throw new Error('AppRuntime requires logger');
        }
        logger.debug('[AppRuntime] Constructor starting...', 'system');
        this.config = config;
        this.dependencies = dependencies;
        this.runtimeConstants = this.dependencies.runtimeConstants;
        if (!this.runtimeConstants) {
            throw new Error('AppRuntime requires runtimeConstants');
        }
        
        // Store auth manager for platform dependency injection
        this.authManager = this.dependencies.authManager;
        
        // Initialize logging using unified logger
        this.logger = this.dependencies.logging;
        this.errorHandler = this.logger ? createPlatformErrorHandler(this.logger, 'AppRuntime') : null;
        
        this.lazyInnertube = this.dependencies.lazyInnertube || InnertubeFactory.createLazyReference();

        // Initialize display queue and notification manager from dependencies or create them
        this.displayQueue = this.dependencies.displayQueue;
        this.notificationManager = this.dependencies.notificationManager;
        
        // Initialize event-driven services from dependencies
        this.eventBus = this.dependencies.eventBus;
        this.configService = this.dependencies.configService;
        this.ttsService = this.dependencies.ttsService;
        this.vfxCommandService = this.dependencies.vfxCommandService;
        this.userTrackingService = this.dependencies.userTrackingService;
        this.obsEventService = this.dependencies.obsEventService;
        this.sceneManagementService = this.dependencies.sceneManagementService;

        // Initialize viewer count system with injected platform provider
        this.viewerCountSystem = new ViewerCountSystem({
            platformProvider: () => this.getPlatforms(),
            logger,
            runtimeConstants: this.runtimeConstants
        });
        this.viewerCountSystemStarted = false; // Track early initialization
        
        // Initialize stream detection system
        const youtubeDetectionService = this._createYoutubeDetectionService();
        this.youtubeDetectionService = youtubeDetectionService;
        if (!this.config || !this.config.general) {
            throw new Error('AppRuntime requires general config for StreamDetector');
        }
        const { streamDetectionEnabled, streamRetryInterval, streamMaxRetries, continuousMonitoringInterval } = this.config.general;
        if (streamDetectionEnabled === undefined || streamRetryInterval === undefined || streamMaxRetries === undefined || continuousMonitoringInterval === undefined) {
            throw new Error('StreamDetector requires streamDetectionEnabled, streamRetryInterval, streamMaxRetries, and continuousMonitoringInterval');
        }
        this.streamDetector = new StreamDetector({
            streamDetectionEnabled,
            streamRetryInterval,
            streamMaxRetries,
            continuousMonitoringInterval
        }, {
            youtubeDetectionService
        });

        // --- GRACEFUL EXIT: Message Counter System ---
        // Note: Now handled by GracefulExitService (initialized in start() method)
        this.gracefulExitTargetCount = cliArgs.chat; // Store for service initialization
        
        // Initialize command parser with CLI arguments
        logger.debug('Initializing command parser...', 'AppRuntime');
        const commandParserConfig = {
            ...config,
            cliArgs: {
                disableKeywordParsing: cliArgs.disableKeywordParsing
            }
        };
        this.commandParser = new CommandParser(commandParserConfig);
        logger.debug('Command parser initialized', 'AppRuntime');

        // Initialize orchestration services
        this.commandCooldownService = this.dependencies.commandCooldownService;
        this.platformLifecycleService = this.dependencies.platformLifecycleService;
        if (this.platformLifecycleService && !this.platformLifecycleService.streamDetector) {
            this.platformLifecycleService.streamDetector = this.streamDetector;
        }
        if (!this.commandCooldownService || !this.platformLifecycleService) {
            throw new Error('AppRuntime requires commandCooldownService and platformLifecycleService');
        }
        const requiredDependencies = [
            'displayQueue',
            'notificationManager',
            'eventBus',
            'configService',
            'vfxCommandService',
            'ttsService',
            'userTrackingService',
            'obsEventService',
            'sceneManagementService',
            'commandCooldownService',
            'platformLifecycleService'
        ];
        const missingDeps = requiredDependencies.filter((dep) => !this[dep]);
        if (missingDeps.length > 0) {
            throw new Error(`AppRuntime missing required dependencies: ${missingDeps.join(', ')}`);
        }
        // Note: GracefulExitService needs 'this' reference, so it's initialized after other setup
        this.gracefulExitService = null; // Will be initialized in start() method

        this.platformEventRouter = new PlatformEventRouter({
            eventBus: this.eventBus,
            runtime: this,
            notificationManager: this.notificationManager,
            configService: this.configService,
            logger
        });
        this.chatNotificationRouter = new ChatNotificationRouter({
            runtime: this,
            logger,
            runtimeConstants: this.runtimeConstants
        });
        
        // Register event handlers for event-driven architecture
        this.registerEventHandlers();

        logger.debug('Constructor completed', 'AppRuntime');
    }

    get platforms() {
        return this.platformLifecycleService ? this.platformLifecycleService.getAllPlatforms() : {};
    }

    registerEventHandlers() {
        if (!this.eventBus) {
            throw new Error('EventBus required for event handler registration');
        }

        logger.debug('Registering event handlers...', 'AppRuntime');

        this.viewerCountStatusCleanup = wireStreamStatusHandlers({
            eventBus: this.eventBus,
            viewerCountSystem: this.viewerCountSystem,
            logger
        });

        // VFX command events - execute VFX commands
        this.eventBus.subscribe('vfx:command', async (event) => {
            try {
                const { command, commandKey, username, platform, userId, context, source } = event;
                if (!context || typeof context !== 'object') {
                    throw new Error('VFX command event requires context');
                }

                if (source === 'eventbus' || source === 'vfx-service') {
                    logger.debug('[EventHandler] Ignoring VFX command already processed by EventBus handler', 'AppRuntime');
                    return;
                }

                if (!username) {
                    throw new Error('VFX command event requires username');
                }
                if (!platform) {
                    throw new Error('VFX command event requires platform');
                }
                if (!userId) {
                    throw new Error('VFX command event requires userId');
                }
                const skipCooldown = context?.skipCooldown;
                if (typeof skipCooldown !== 'boolean') {
                    throw new Error('VFX command event requires skipCooldown boolean');
                }
                const correlationId = context?.correlationId || event.correlationId;
                if (!correlationId) {
                    throw new Error('VFX command event requires correlationId');
                }

                const executionContext = {
                    ...context,
                    username,
                    platform,
                    userId,
                    source: 'eventbus',
                    skipCooldown,
                    correlationId
                };

                if (!this.vfxCommandService) {
                    throw new Error('VFXCommandService not available for VFX command');
                }

                if (command && typeof this.vfxCommandService.executeCommand === 'function') {
                    logger.debug(`[EventHandler] Executing VFX command string: ${command}`, 'AppRuntime');
                    await this.vfxCommandService.executeCommand(command, executionContext);
                } else if (commandKey && typeof this.vfxCommandService.executeCommandForKey === 'function') {
                    logger.debug(`[EventHandler] Executing VFX command key: ${commandKey}`, 'AppRuntime');
                    await this.vfxCommandService.executeCommandForKey(commandKey, executionContext);
                } else {
                    logger.warn('[EventHandler] No command or commandKey provided for VFX command event', 'AppRuntime', { event });
                }
            } catch (error) {
                logMainError('[EventHandler] Error executing VFX command', error, { event }, { eventType: 'event-handler', logContext: 'AppRuntime' });
            }
        });

        // TTS events - handle text-to-speech
        this.eventBus.subscribe(PlatformEvents.TTS_SPEECH_REQUESTED, async (event) => {
            try {
                if (event?.source === 'tts-service') {
                    return;
                }

                const { text, platform, options } = event;
                if (!options || typeof options !== 'object') {
                    throw new Error('TTS speak event requires options');
                }
                logger.debug(`[EventHandler] TTS speak event received for platform: ${platform}`, 'AppRuntime');
                
                // Use existing speakTTS logic if available
                if (this.speakTTS && typeof this.speakTTS === 'function') {
                    await this.speakTTS(text, platform, options);
                } else {
                    throw new Error('speakTTS method not available');
                }
            } catch (error) {
                logMainError('[EventHandler] Error handling TTS speak event', error, { event }, { eventType: 'event-handler', logContext: 'AppRuntime' });
            }
        });

        logger.debug('Event handlers registered successfully', 'AppRuntime');
    }

    async handleStreamDetected(platform, data) {
        if (!platform) {
            throw new Error('Stream detection event requires platform');
        }
        if (!data || typeof data !== 'object') {
            throw new Error('Stream detection event requires data');
        }
        const { eventType } = data;
        if (eventType && eventType !== 'stream-detected') {
            return;
        }
        const { newStreamIds } = data;
        if (!Array.isArray(newStreamIds)) {
            throw new Error('Stream detection event requires newStreamIds array');
        }
        if (newStreamIds.length === 0) {
            return;
        }

        logger.info(`[EventHandler] Stream detection event received: ${platform} detected ${newStreamIds.length} new streams`, 'AppRuntime');

        if (platform === 'youtube' && this.youtube && typeof this.youtube.initialize === 'function') {
            logger.info(`[EventHandler] Triggering YouTube reconnection for ${newStreamIds.length} new stream(s)`, 'AppRuntime');
            try {
                await this.youtube.initialize({}, true);
            } catch (reconnectError) {
                logger.warn('[EventHandler] YouTube reconnection attempted but may have already been processed', 'AppRuntime');
            }
        }
    }

    isFirstMessage(userId, context = {}) {
        if (!this.userTrackingService || typeof this.userTrackingService.isFirstMessage !== 'function') {
            throw new Error('UserTrackingService not available for first message check');
        }
        return this.userTrackingService.isFirstMessage(userId, context);
    }

    checkCommandCooldown(userId, currentPlatformCmdCoolDownMs, currentPlatformHeavyCmdCoolDownMs) {
        return this.commandCooldownService.checkUserCooldown(
            userId,
            currentPlatformCmdCoolDownMs,
            currentPlatformHeavyCmdCoolDownMs
        );
    }

    updateUserCommandTimestamps(userId) {
        this.commandCooldownService.updateUserCooldown(userId);
    }

    async initializePlatforms() {
        logger.info('Initializing platform connections...', 'AppRuntime');

        // Lazy-load platform modules
        logger.debug('Loading platform modules...', 'AppRuntime');
        const { TikTokPlatform, TwitchPlatform, YouTubePlatform } = require('./platforms');
        logger.debug('Platform modules loaded', 'AppRuntime');

        const platformModules = {
            twitch: TwitchPlatform,
            youtube: YouTubePlatform,
            tiktok: TikTokPlatform
        };

        // Delegate all platform initialization to service
        await this.platformLifecycleService.initializeAllPlatforms(platformModules);

        logger.debug('Platform initialization delegated to service', 'AppRuntime');
    }
    
    
    async handleChatMessage(platform, normalizedData) {
        try {
            logger.debug(`Received message from ${platform}: ${normalizedData?.username} - ${normalizedData?.message}`, 'chat-handler');
            if (platform === 'tiktok') {
                logger.debug(`[TikTok Debug] Message received in main handler: ${normalizedData?.username}: ${normalizedData?.message}`, 'system');
            }

            if (this.chatNotificationRouter) {
                await this.chatNotificationRouter.handleChatMessage(platform, normalizedData);
            } else {
                throw new Error('ChatNotificationRouter not initialized');
            }
        } catch (error) {
            this._handleAppRuntimeError(
                `Error processing chat message from ${platform}: ${error.message}`,
                error,
                { platform, normalizedData },
                { eventType: 'chat-message', logContext: 'system' }
            );
        }
    }
    
    recordPlatformConnection(platform) {
        this.platformLifecycleService.recordPlatformConnection(platform);
    }

    updateViewerCount(platform, count) {
        // Handle real-time viewer count updates from platform events
        logger.debug(`[${platform}] Viewer count updated: ${count}`, 'system');
        
        // Update the ViewerCountSystem's internal count tracking and notify observers
        if (this.viewerCountSystem) {
            const previousCount = this.viewerCountSystem.counts[platform.toLowerCase()];
            this.viewerCountSystem.counts[platform.toLowerCase()] = count;
            
            // Notify observers of real-time count update - handle async properly
            const notificationPromise = this.viewerCountSystem.notifyObservers(platform, count, previousCount);
            if (notificationPromise && notificationPromise.catch) {
                notificationPromise.catch((error) => {
                    // Handle observer notification errors gracefully - don't let them crash the system
                    logger.warn(`Observer notification failed for ${platform}: ${error.message}`, 'system');
                });
            }
        }
    }
    
    async shutdown() {
        this.logger.info('Shutting down application...', 'system');
        
        // Delegate platform disconnection to service
        await this.platformLifecycleService.disconnectAll();
        
        // Disconnect from OBS
        if (this.obsEventService) {
            try {
                await this.obsEventService.disconnect();
                this.logger.info('Disconnected from OBS via OBSEventService.', 'system');
            } catch (error) {
                this._handleAppRuntimeError(
                    `Error disconnecting OBS via OBSEventService: ${error.message}`,
                    error,
                    null,
                    { eventType: 'shutdown', logContext: 'system' }
                );
            }
        } else {
            try {
                const obsManager = getOBSConnectionManager();
                if (obsManager && obsManager.isConnected()) {
                    await obsManager.disconnect();
                    this.logger.info('Disconnected from OBS.', 'system');
                }
            } catch (error) {
                this._handleAppRuntimeError(
                    `Error disconnecting from OBS: ${error.message}`,
                    error,
                    null,
                    { eventType: 'shutdown', logContext: 'system' }
                );
            }
        }

        if (this.platformEventRouter && typeof this.platformEventRouter.dispose === 'function') {
            this.platformEventRouter.dispose();
        }
        
        // Stop viewer count polling
        try {
            if (this.viewerCountSystem) {
                this.viewerCountSystem.stopPolling();
                this.logger.debug('Stopped viewer count polling', 'system');
            }
        } catch (error) {
            this._handleAppRuntimeError(
                `Error stopping viewer count polling: ${error.message}`,
                error,
                null,
                { eventType: 'shutdown', logContext: 'system' }
            );
        }
        
        // Stop stream detection monitoring
        try {
            if (this.streamDetector) {
                this.streamDetector.cleanup();
                this.logger.debug('Stopped stream detection monitoring', 'system');
            }
        } catch (error) {
            this._handleAppRuntimeError(
                `Error stopping stream detection: ${error.message}`,
                error,
                null,
                { eventType: 'shutdown', logContext: 'system' }
            );
        }
        
        // Stop notification manager cleanup intervals
        try {
            if (this.notificationManager) {
                this.notificationManager.stopSuppressionCleanup();
                this.logger.debug('Stopped notification manager cleanup intervals', 'system');
            }
        } catch (error) {
            this._handleAppRuntimeError(
                `Error stopping notification manager: ${error.message}`,
                error,
                null,
                { eventType: 'shutdown', logContext: 'system' }
            );
        }
        
        // Clear the keep-alive interval if it exists
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.logger.debug('Cleared keep-alive interval', 'system');
        }
        
        this.emitSystemShutdown({ reason: 'manual-shutdown' });
    }

    emitSystemShutdown({ reason, restartRequested = false } = {}) {
        if (this.eventBus) {
            this.eventBus.emit('system:shutdown', {
                reason,
                restartRequested,
                timestamp: new Date().toISOString()
            });
        }

        if (restartRequested) {
            this.eventBus?.emit('service:restart-requested', {
                reason,
                timestamp: new Date().toISOString()
            });
        }

        this.logger.info('Shutdown complete. Exiting.', 'system');
        logger.debug('[Shutdown] Calling process.exit(0)', 'system');
        // Force exit fallback in case something keeps the process alive
        safeSetTimeout(() => {
            this._handleAppRuntimeError('[Shutdown] Forced exit due to lingering handles', null, null, { eventType: 'shutdown', logContext: 'system' });
            process.exit(0);
        }, 2000);
        process.exit(0);
    }

    async start() {
        logger.info('AppRuntime.start() method called', 'AppRuntime');
        logger.debug('Start method called...', 'AppRuntime');

        // VFXCommandService will be created after OBS initialization
        
        logger.debug('Initializing platforms...', 'AppRuntime');
        // Simplified platform initialization (timeout temporarily disabled for debugging)
        try {
            await this.initializePlatforms();
        } catch (error) {
            logMainError('Platform initialization failed:', error, null, { eventType: 'startup', logContext: 'AppRuntime' });
            throw error;
        }
        logger.info('Platform connections initialized', 'AppRuntime');
        logger.debug('Starting system initialization (OBS, ViewerCount)', 'AppRuntime');
        logger.debug('ViewerCount system exists?', this.viewerCountSystem ? 'YES' : 'NO', 'AppRuntime');

        // Initialize systems
        try {
            logger.info('Initializing OBS connection...', 'AppRuntime');
            
            // Wrap OBS initialization in try-catch to prevent it from blocking VFXCommandService creation
            try {
                await initializeOBSConnection(this.config.obs, {
                    handcam: this.config.handcam,
                    obsEventService: this.obsEventService,
                    runtimeConstants: this.runtimeConstants
                });
                logger.info('OBS connection initialized', 'AppRuntime');
            } catch (obsError) {
                logMainError(`OBS initialization failed: ${obsError.message}`, obsError, null, { eventType: 'startup', logContext: 'AppRuntime' });
                logger.info('Continuing without OBS connection; VFX system remains available.', 'AppRuntime');
            }
            
            // Now that OBS is initialized, create VFXCommandService
            if (!this.vfxCommandService) {
                logger.debug('Creating VFXCommandService after OBS initialization...', 'AppRuntime');

                this.vfxCommandService = createVFXCommandService(this.configService, this.eventBus);
                logger.debug('VFXCommandService created and ready', 'AppRuntime');
            }
        } catch (error) {
            throw error;
        }
        
        try {
            // Clear previous displays on startup (similar to viewer count initialization)
            logger.info('Clearing previous displays...', 'AppRuntime');
            // Clear OBS startup displays
            const { clearStartupDisplays } = require('./obs/startup');
            await clearStartupDisplays(this.config, this.runtimeConstants);
            logger.info('Displays cleared', 'AppRuntime');
            
            logger.info('Initializing goal display...', 'AppRuntime');
            const goalsManager = getDefaultGoalsManager({ runtimeConstants: this.runtimeConstants });
            await goalsManager.initializeGoalDisplay();
            logger.info('Goal display initialized', 'AppRuntime');
            
            // Register OBS observer for viewer count updates
            const obsManager = getOBSConnectionManager();
            const obsObserver = new OBSViewerCountObserver(obsManager, logger);
            this.viewerCountSystem.addObserver(obsObserver);
            
            // Initialize viewer count system (will set all counts to 0 in OBS)
            logger.info('Initializing viewer count system...', 'AppRuntime');
            logger.debug('Starting viewerCountSystem.initialize()', 'AppRuntime');
            await this.viewerCountSystem.initialize();
            logger.debug('viewerCountSystem.initialize() completed', 'AppRuntime');

            await this.viewerCountSystem.startPolling();
        } catch (error) {
            throw error;
        }

        // Initialize GracefulExitService (after all other services are ready)
        this.gracefulExitService = this.dependencies.gracefulExitService;
        if (!this.gracefulExitService) {
            throw new Error('GracefulExitService dependency required');
        }
        if (this.gracefulExitService.isEnabled()) {
            logger.info(`Graceful exit enabled: will exit after ${this.gracefulExitService.getTargetMessageCount()} messages`, 'AppRuntime');
        }

        this.emitSystemReady({});
    }

    async startViewerCountSystemEarly() {
        try {
            logger.debug('ViewerCount system initialization starting', 'AppRuntime');
            
            // Initialize viewer count system without OBS dependency
            await this.viewerCountSystem.initialize();
            logger.debug('ViewerCount system initialization completed', 'AppRuntime');
            
            // Start polling immediately
            await this.viewerCountSystem.startPolling();
            logger.debug('ViewerCount system polling started successfully', 'AppRuntime');
            
        } catch (error) {
            logMainError(`EARLY: ViewerCount system failed to start: ${error.message}`, error, null, {
                eventType: 'viewer-count-init',
                logContext: 'AppRuntime'
            });
        }
    }

    getPlatforms() {
        return this.platformLifecycleService.getAllPlatforms();
    }

    emitSystemReady(options) {
        if (!options || typeof options !== 'object') {
            throw new Error('emitSystemReady requires options');
        }
        const { correlationId } = options;
        if (!this.eventBus || typeof this.eventBus.emit !== 'function') {
            throw new Error('EventBus emit unavailable for system:ready');
        }

        const readyPayload = {
            services: this.getReadyServices(),
            timestamp: new Date().toISOString()
        };

        if (correlationId) {
            readyPayload.correlationId = correlationId;
        }

        if (this.platformLifecycleService?.getStatus) {
            readyPayload.platforms = this.platformLifecycleService.getStatus();
        }

        if (this.commandCooldownService?.getStatus) {
            readyPayload.cooldowns = this.commandCooldownService.getStatus();
        }

        this.eventBus.emit('system:ready', readyPayload);
        logger.debug('system:ready event emitted', 'AppRuntime', readyPayload);
    }

    getReadyServices() {
        const readinessMap = {
            notificationManager: !!this.notificationManager,
            ttsService: !!this.ttsService,
            vfxCommandService: !!this.vfxCommandService,
            commandCooldownService: !!this.commandCooldownService,
            platformLifecycleService: !!this.platformLifecycleService
        };

        return Object.entries(readinessMap)
            .filter(([, isReady]) => isReady)
            .map(([name]) => name);
    }

    async handleFollowNotification(platform, username, options) {
        if (!options || typeof options !== 'object') {
            throw new Error('handleFollowNotification requires options');
        }
        return this.handleUnifiedNotification('follow', platform, username, options);
    }

    async handleShareNotification(platform, username, options) {
        if (!options || typeof options !== 'object') {
            throw new Error('handleShareNotification requires options');
        }
        return this.handleUnifiedNotification('share', platform, username, options);
    }

    async handlePaypiggyNotification(platform, username, options) {
        if (!options || typeof options !== 'object') {
            throw new Error('handlePaypiggyNotification requires options');
        }
        return this.handleUnifiedNotification('paypiggy', platform, username, options);
    }

    async handleNotificationEvent(platform, type, data) {
        try {
            if (!data || typeof data !== 'object') {
                throw new Error('handleNotificationEvent requires data');
            }
            // Method name mapping for consistent routing
            const methodMap = {
                'paypiggy': 'handlePaypiggyNotification',
                'follow': 'handleFollowNotification',
                'gift': 'handleGiftNotification'
            };

            const methodName = methodMap[type];
            if (methodName && typeof this[methodName] === 'function') {
                if (!data.username) {
                    throw new Error(`Missing username for ${type} notification`);
                }
                await this[methodName](platform, data.username, data);
            } else {
                throw new Error(`Unknown notification type: ${type}`);
            }
        } catch (error) {
            this._handleAppRuntimeError(
                `Error handling ${type} notification event: ${error.message}`,
                error,
                { platform, type, data },
                { eventType: 'notification-event', logContext: platform }
            );
        }
    }

    async handleRaidNotification(platform, raiderName, options) {
        if (!options || typeof options !== 'object') {
            throw new Error('handleRaidNotification requires options');
        }
        if (options.viewerCount === undefined) {
            throw new Error('handleRaidNotification requires viewerCount');
        }
        return this.handleUnifiedNotification('raid', platform, raiderName, {
            viewerCount: options.viewerCount,
            ...options
        });
    }

    async handleRedemptionNotification(platform, username, options) {
        if (!options || typeof options !== 'object') {
            throw new Error('handleRedemptionNotification requires options');
        }
        if (!options.rewardTitle || options.rewardCost === undefined) {
            throw new Error('handleRedemptionNotification requires rewardTitle and rewardCost');
        }
        return this.handleUnifiedNotification('redemption', platform, username, {
            rewardTitle: options.rewardTitle,
            rewardCost: options.rewardCost,
            ...options
        });
    }

    async handleGiftNotification(platform, username, options) {
        if (!options || typeof options !== 'object') {
            throw new Error('handleGiftNotification requires options');
        }
        if (!options.userId || !options.timestamp) {
            throw new Error('handleGiftNotification requires userId and timestamp');
        }
        if (!this.config || !this.config.general) {
            throw new Error('AppRuntime config unavailable for gift notifications');
        }

        if (!username || (typeof username === 'string' && username.trim().length === 0)) {
            this.logger.warn('Missing username for gift notification', platform, { options });
            return;
        }

        const isError = options.isError === true;
        const giftType = typeof options.giftType === 'string' ? options.giftType.trim() : '';
        const giftCount = Number(options.giftCount);
        const amount = Number(options.amount);
        const currency = typeof options.currency === 'string' ? options.currency.trim() : '';
        const repeatCount = options.repeatCount;

        if (!giftType || !Number.isFinite(giftCount) || giftCount < 0 || !Number.isFinite(amount) || amount < 0 || !currency) {
            throw new Error('Gift notification requires giftType, giftCount, amount, and currency');
        }
        if (!isError && (giftCount <= 0 || amount <= 0)) {
            throw new Error('Gift notification requires giftType, giftCount, amount, and currency');
        }

        // Get random VFX command for gift
        let giftVFXConfig = null;
        if (this.vfxCommandService && typeof this.vfxCommandService.getVFXConfig === 'function') {
            try {
                giftVFXConfig = await this.vfxCommandService.getVFXConfig('gifts', null);
            } catch (vfxError) {
                this._handleAppRuntimeError(
                    `Error resolving gift VFX config: ${vfxError.message}`,
                    vfxError,
                    null,
                    { eventType: 'notification', logContext: 'system' }
                );
            }
        } else {
            throw new Error('VFXCommandService unavailable for gift notification');
        }

        const notificationType = options.type;
        if (!notificationType) {
            throw new Error('Gift notification requires type');
        }
        if (!isError && !options.id) {
            throw new Error('Gift notification requires id');
        }
        const notificationPayload = {
            ...options,
            giftCount,
            giftType,
            amount,
            currency,
            repeatCount,
            vfxConfig: giftVFXConfig,
            ...(options.id ? { id: options.id } : {})
        };

        // Delegate to handleUnifiedNotification with preprocessed gift data
        return this.handleUnifiedNotification(notificationType, platform, username, notificationPayload);
    }

    async handleFarewellNotification(platform, username, options) {
        if (!options || typeof options !== 'object') {
            throw new Error('handleFarewellNotification requires options');
        }
        if (!options.command) {
            throw new Error('handleFarewellNotification requires command');
        }
        return this.handleUnifiedNotification('farewell', platform, username, {
            command: options.command,
            ...options
        });
    }

    async handleGiftPaypiggyEvent(platform, username, options) {
        if (!options || typeof options !== 'object') {
            throw new Error('handleGiftPaypiggyEvent requires options');
        }
        const requiresTier = platform === 'twitch';
        if (options.giftCount === undefined || (requiresTier && options.tier === undefined)) {
            throw new Error(requiresTier
                ? 'handleGiftPaypiggyEvent requires tier and giftCount'
                : 'handleGiftPaypiggyEvent requires giftCount');
        }
        const giftCount = Number(options.giftCount);
        if (!Number.isFinite(giftCount)) {
            throw new Error('handleGiftPaypiggyEvent requires giftCount');
        }
        const isError = options.isError === true;
        const payload = {
            giftCount,
            userId: options.userId,
            timestamp: options.timestamp,
            ...(isError ? { isError: true } : {})
        };
        if (options.tier !== undefined) {
            payload.tier = options.tier;
        }
        if (options.cumulativeTotal !== undefined) {
            payload.cumulativeTotal = options.cumulativeTotal;
        }
        if (options.isAnonymous !== undefined) {
            payload.isAnonymous = options.isAnonymous;
        }

        return this.handleUnifiedNotification('giftpaypiggy', platform, username, payload);
    }

    async handleResubEvent(platform, username, options) {
        if (!options || typeof options !== 'object') {
            throw new Error('handleResubEvent requires options');
        }
        if (options.tier === undefined || options.months === undefined || options.message === undefined) {
            throw new Error('handleResubEvent requires tier, months, and message');
        }
        return this.handleUnifiedNotification('paypiggy', platform, username, {
            tier: options.tier,
            months: options.months,
            message: options.message,
            isRenewal: true,
            ...options
        });
    }

    async handleEnvelopeNotification(platform, data) {
        try {
            this.logger.info(`[Envelope] Treasure chest event on ${platform}`, platform);
            if (!data || typeof data !== 'object') {
                throw new Error('handleEnvelopeNotification requires data');
            }
            if (!data.userId || !data.username) {
                throw new Error('Envelope notification requires userId and username');
            }
            const isError = data.isError === true;
            const giftType = typeof data.giftType === 'string' ? data.giftType.trim() : '';
            const giftCount = Number(data.giftCount);
            const amount = Number(data.amount);
            const currency = typeof data.currency === 'string' ? data.currency.trim() : '';
            const repeatCount = data.repeatCount;
            if (!giftType || !Number.isFinite(giftCount) || giftCount < 0 || !Number.isFinite(amount) || amount < 0 || !currency || !data.timestamp) {
                throw new Error('Envelope notification requires giftType, giftCount, amount, currency, timestamp, and id');
            }
            if (!isError && (giftCount <= 0 || amount <= 0 || !data.id)) {
                throw new Error('Envelope notification requires giftType, giftCount, amount, currency, timestamp, and id');
            }
            
            // Pass to handleGiftNotification as a special gift type
            await this.handleGiftNotification(platform, data.username, {
                giftType,
                giftCount,
                amount,
                currency,
                repeatCount,
                type: 'envelope',
                isError,
                userId: data.userId,
                timestamp: data.timestamp,
                ...(data.id ? { id: data.id } : {}),
                // Include original data for any platform-specific processing
                originalEnvelopeData: data
            });
            
        } catch (error) {
            this._handleAppRuntimeError(
                `Error handling envelope notification: ${error.message}`,
                error,
                { platform, envelopeData: data },
                { eventType: 'notification', logContext: platform }
            );
        }
    }

    async handleGiftPaypiggyNotification(platform, username, options) {
        try {
            // Delegate to existing handleGiftPaypiggyEvent method
            await this.handleGiftPaypiggyEvent(platform, username, options);
        } catch (error) {
            this._handleAppRuntimeError(
                `Error handling giftpaypiggy notification for ${username}: ${error.message}`,
                error,
                { platform, username, options },
                { eventType: 'notification', logContext: platform }
            );
        }
    }

    async handleResubNotification(platform, username, options) {
        try {
            // Delegate to existing handleResubEvent method
            await this.handleResubEvent(platform, username, options);
        } catch (error) {
            this._handleAppRuntimeError(
                `Error handling resub notification for ${username}: ${error.message}`,
                error,
                { platform, username, options },
                { eventType: 'notification', logContext: platform }
            );
        }
    }

	    async handleNotification(platform, normalizedData) {
	        let options;
	        let type;
	        try {
	            if (!normalizedData || !normalizedData.type) {
	                this.logger.warn(`Invalid notification data received from ${platform}`, platform);
	                return;
	            }

            ({ type } = normalizedData);
            const { username, ...notificationOptions } = normalizedData;
            options = notificationOptions;
            if (!username) {
                this.logger.warn(`Missing username for ${type} notification`, platform, { normalizedData });
                return;
            }

            this.logger.debug(`Routing ${type} notification from ${platform} for ${username}`, platform);

            switch (type) {
                case 'chat':
                    // Route chat messages to notification manager
                    if (this.notificationManager) {
                        if (!normalizedData.message || !normalizedData.timestamp || !normalizedData.userId) {
                            throw new Error('Chat notification requires message, timestamp, and userId');
                        }
                        await this.notificationManager.handleNotification('chat', platform, {
                            username,
                            message: normalizedData.message,
                            timestamp: normalizedData.timestamp,
                            userId: normalizedData.userId,
                            ...options
                        });
                    } else {
                        throw new Error('NotificationManager unavailable for chat notifications');
                    }
                    break;
                    
                case 'follow':
                    await this.handleFollowNotification(platform, username, options);
                    break;
                
                case 'paypiggy':
                    await this.handlePaypiggyNotification(platform, username, options);
                    break;
                
                case 'raid':
                    if (normalizedData.viewerCount === undefined) {
                        throw new Error('Raid notification requires viewerCount');
                    }
                    await this.handleRaidNotification(platform, username, {
                        viewerCount: normalizedData.viewerCount,
                        ...options
                    });
                    break;

                case 'giftpaypiggy': {
                    const requiresTier = platform === 'twitch';
                    if (normalizedData.giftCount === undefined || !normalizedData.userId || !normalizedData.timestamp || (requiresTier && normalizedData.tier === undefined)) {
                        throw new Error(requiresTier
                            ? 'Giftpaypiggy notification requires giftCount, tier, userId, and timestamp'
                            : 'Giftpaypiggy notification requires giftCount, userId, and timestamp');
                    }
                    await this.handleGiftPaypiggyNotification(platform, username, {
                        giftCount: normalizedData.giftCount,
                        userId: normalizedData.userId,
                        timestamp: normalizedData.timestamp,
                        isAnonymous: normalizedData.isAnonymous,
                        cumulativeTotal: normalizedData.cumulativeTotal,
                        ...(normalizedData.tier !== undefined ? { tier: normalizedData.tier } : {}),
                        ...(normalizedData.isError === true ? { isError: true } : {})
                    });
                    break;
                }

                case 'gift':
                    {
                        const isError = normalizedData.isError === true;
                        if (normalizedData.giftCount === undefined || !normalizedData.giftType || normalizedData.amount === undefined || !normalizedData.currency || !normalizedData.userId || !normalizedData.timestamp || (!isError && !normalizedData.id)) {
                            throw new Error('Gift notification requires giftCount, giftType, amount, currency, id, userId, and timestamp');
                        }
                        await this.handleGiftNotification(platform, username, {
                            amount: normalizedData.amount,
                            giftCount: normalizedData.giftCount,
                            tier: normalizedData.tier,
                            giftType: normalizedData.giftType,
                            currency: normalizedData.currency,
                            repeatCount: normalizedData.repeatCount,
                            ...(normalizedData.id ? { id: normalizedData.id } : {}),
                            type: 'gift',
                            userId: normalizedData.userId,
                            timestamp: normalizedData.timestamp,
                            ...options
                        });
                    }
                    break;
                
                default:
                    throw new Error(`Unknown notification type '${type}' from ${platform}`);
            }
        } catch (error) {
            const errorType = normalizedData ? normalizedData.type : undefined;
            this._handleAppRuntimeError(
                `Error handling ${errorType} notification from ${platform}: ${error.message}`,
                error,
                { platform, normalizedData, options },
                { eventType: 'notification', logContext: platform }
            );
        }
    }

    _handleAppRuntimeError(message, error, payload, options) {
        if (!options) {
            throw new Error('_handleAppRuntimeError requires options');
        }
        const { eventType, logContext } = options;
        if (!eventType || !logContext) {
            throw new Error('_handleAppRuntimeError requires eventType and logContext');
        }

        if (!this.errorHandler && this.logger) {
            this.errorHandler = createPlatformErrorHandler(this.logger, 'AppRuntime');
        }

        const handler = this.errorHandler;
        if (!handler) {
            const errorDetails = error instanceof Error
                ? (error.stack || error.message)
                : (error ? String(error) : '');
            const output = errorDetails ? `${message}\n${errorDetails}` : message;
            process.stderr.write(`${output}\n`);
            return;
        }

        if (error instanceof Error) {
            handler.handleEventProcessingError(error, eventType, payload, message, logContext);
            return;
        }

        handler.logOperationalError(message, logContext, payload);
    }
}

async function main() {
    try {
        logger.console('Starting main application...', 'main');
        logger.info('Main application started, beginning initialization...', 'Main');
        logger.debug('About to set up display queue configuration...', 'Main');
        logger.info('Setting up display queue configuration...', 'Main');

        try {
            await ensureSecrets({
                configManager,
                config,
                logger,
                interactive: Boolean(process.stdin && process.stdin.isTTY),
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

        await hydrateTwitchTokensFromStore();

        if (!config.general || !config.obs) {
            throw new Error('Display queue requires general and obs config');
        }
        const { chatMsgTxt, chatMsgScene, chatMsgGroup, ttsEnabled } = config.general;
        if (!chatMsgTxt || !chatMsgScene) {
            throw new Error('Display queue requires chatMsgTxt and chatMsgScene');
        }
        if (typeof ttsEnabled !== 'boolean') {
            throw new Error('Display queue requires boolean ttsEnabled');
        }
        const chatSourceName = chatMsgTxt;
        const chatSceneName = chatMsgScene;
        const chatGroupName = chatMsgGroup;
        const chatLogos = runtimeConstants.CHAT_PLATFORM_LOGOS;
        const notificationLogos = runtimeConstants.NOTIFICATION_PLATFORM_LOGOS;
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
            ttsEnabled: ttsEnabledConfig
        };
        
        // Debug: Log the display queue configuration 
        logger.debug(`[Display Queue Config] Notification: ${displayQueueConfig.notification.sourceName}, Chat: ${displayQueueConfig.chat.sourceName}`, 'Main');
        
        const chatTransitionDelay = runtimeConstants.CHAT_TRANSITION_DELAY;
        const notificationClearDelay = runtimeConstants.NOTIFICATION_CLEAR_DELAY;
        const chatMessageDuration = runtimeConstants.CHAT_MESSAGE_DURATION;
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
        if (typeof config.general.debugEnabled !== 'boolean') {
            throw new Error('EventBus requires boolean general.debugEnabled');
        }
        const eventBus = createEventBus({ 
            debugEnabled: config.general.debugEnabled,
            maxListeners: 100
        });
        logger.debug('EventBus created', 'Main');

        logger.debug('About to initialize display queue...', 'Main');
        const obsManager = getOBSConnectionManager({ runtimeConstants, config: config.obs });
        const displayQueue = initializeDisplayQueue(obsManager, displayQueueConfig, displayQueueConstants, eventBus, runtimeConstants);
        logger.debug('Display queue initialized', 'Main');
        
        logger.debug('Creating ConfigService...', 'Main');
        const configService = createConfigService(config, eventBus);
        logger.debug('ConfigService created', 'Main');
        
        logger.debug('Creating TTSService...', 'Main');
        const ttsService = createTTSService(configService, eventBus, { logger });
        logger.debug('TTSService created', 'Main');
        
        logger.debug('Creating VFXCommandService...', 'Main');
        const vfxCommandService = createVFXCommandService(configService, eventBus);
        logger.debug('VFXCommandService created', 'Main');
        
        logger.debug('Creating UserTrackingService...', 'Main');
        const userTrackingService = createUserTrackingService();
        logger.debug('UserTrackingService created', 'Main');

        // Create OBS event-driven services
        logger.debug('Creating OBS event-driven services...', 'Main');
        const obsConnectionManager = getOBSConnectionManager({ runtimeConstants, config: config.obs });
        const obsSources = require('./obs/sources').getDefaultSourcesManager({ runtimeConstants });

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

        const obsGoals = getDefaultGoalsManager({ runtimeConstants });

        // After displayQueue and services are created, create NotificationManager
        logger.debug('About to create notification manager...', 'Main');
        logger.info('Creating notification manager...', 'Main');
        const notificationManager = new NotificationManager({
            displayQueue: displayQueue,
            eventBus: eventBus,
            configService: configService,
            ttsService: ttsService,
            vfxCommandService: vfxCommandService,
            userTrackingService: userTrackingService,
            logger,
            constants: coreConstants,
            textProcessing,
            obsGoals
        });
        
        logger.info('About to call validateAuthentication...', 'Main');
        const authResult = await validateAuthentication(config);
        logger.info('validateAuthentication returned successfully', 'Main');
        if (!authResult.isValid) {
            logger.warn('Authentication validation failed - continuing with limited functionality', 'Main');
            // Don't exit process - allow startup to continue for core functionality
        } else {
            logger.info('Authentication validation successful', 'Main');
        }
        
        const dependencies = createProductionDependencies(runtimeConstants);
        dependencies.displayQueue = displayQueue;
        dependencies.notificationManager = notificationManager;
        dependencies.authFactory = authResult.authFactory;
        dependencies.authManager = authResult.authManager;
        
        // Add event-driven services to dependencies
        dependencies.eventBus = eventBus;
        dependencies.configService = configService;
        dependencies.ttsService = ttsService;
        dependencies.vfxCommandService = vfxCommandService;
        dependencies.userTrackingService = userTrackingService;
        dependencies.obsEventService = obsEventService;
        dependencies.sceneManagementService = sceneManagementService;

        const sharedPlatformDependencies = {
            logger,
            notificationManager,
            timestampService: dependencies.timestampService,
            authManager: authResult.authManager,
            authFactory: authResult.authFactory,
            runtimeConstants,
            USER_AGENTS: runtimeConstants.USER_AGENTS,
            config: configManager,
            Innertube: dependencies.lazyInnertube
        };

        const commandCooldownService = new CommandCooldownService({
            eventBus,
            configService,
            logger,
            runtimeConstants
        });

        const platformLifecycleService = new PlatformLifecycleService({
            config,
            eventBus,
            streamDetector: null,
            dependencyFactory: dependencies.dependencyFactory,
            logger,
            sharedDependencies: sharedPlatformDependencies
        });

        dependencies.commandCooldownService = commandCooldownService;
        dependencies.platformLifecycleService = platformLifecycleService;
        
        app = createAppRuntime(config, dependencies);

        const gracefulExitService = createGracefulExitService(
            eventBus,
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
                authValid: authResult.isValid
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
            authValid: authResult.isValid
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
