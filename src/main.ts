const args = process.argv.slice(2);

const cliArgs = {
    debug: false,
    help: false,
    chat: null
};

for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
        case '--debug':
            cliArgs.debug = true;
            break;
        case '--help':
        case '-h':
            cliArgs.help = true;
            break;

        case '--chat':
            if (i + 1 < args.length) {
                const chatCount = Number.parseInt(args[++i], 10);
                if (isNaN(chatCount) || chatCount <= 0) {
                    process.stderr.write('Error: --chat argument requires a positive number\n');
                    process.exit(1);
                }
                cliArgs.chat = chatCount;
            } else {
                process.stderr.write('Error: --chat argument requires a number\n');
                process.exit(1);
            }
            break;
    }
}

if (cliArgs.help) {
    process.stdout.write(`
Usage: bun src/main.ts [options]

Options:
  --debug              Enable debug mode
  --chat <number>      Exit after processing N actual messages
  --help, -h           Show this help message

Examples:
  bun src/main.ts --debug
  bun src/main.ts --chat 10
`);
    process.exit(0);
}

const { 
    setDebugMode, 
    initializeLoggingConfig,
    getUnifiedLogger
} = require('./core/logging');
const { buildLoggingConfig } = require('./core/config-builders');
const { safeSetInterval } = require('./utils/timeout-validator');
const { createPlatformErrorHandler } = require('./utils/platform-error-handler');
const { ensureSecrets } = require('./utils/secret-manager');
const TwitchAuth = require('./auth/TwitchAuth');

if (cliArgs.debug) {
    setDebugMode(true);
}

const { InnertubeFactory } = require('./factories/innertube-factory');

const { config: configModule } = require('./core');
let config = configModule.config;

if (cliArgs.debug) {
    const normalizedConfig = configModule.loadConfig();
    config.logging = buildLoggingConfig(normalizedConfig, { debugMode: true });
}

const innertubeInstanceManager = require('./services/innertube-instance-manager');

initializeLoggingConfig(config);

const logger = getUnifiedLogger();
if (!logger || typeof logger.debug !== 'function') {
    throw new Error('Logger missing required methods');
}

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

const coreConstants = require('./core/constants');
const {
    PRIORITY_LEVELS,
    NOTIFICATION_CONFIGS
} = coreConstants;

const { getOBSConnectionManager } = require('./obs/connection');
const { initializeDisplayQueue } = require('./obs/display-queue');
const { getDefaultGoalsManager } = require('./obs/goals');

const { createTextProcessingManager } = require('./utils/text-processing');
const textProcessing = createTextProcessingManager({ logger });
const { AppRuntime } = require('./runtime/AppRuntime');
const { clearExpiredGlobalCooldowns } = require('./utils/global-command-cooldown');

const NotificationManager = require('./notifications/NotificationManager');
const { createSpamDetectionConfig, createDonationSpamDetection } = require('./utils/spam-detection');

const { createEventBus } = require('./core/EventBus');
const { createVFXCommandService } = require('./services/VFXCommandService');
const { createUserTrackingService } = require('./services/UserTrackingService');
const CommandCooldownService = require('./services/CommandCooldownService');
const PlatformLifecycleService = require('./services/PlatformLifecycleService');
const { createGracefulExitService } = require('./services/GracefulExitService');

const { createOBSEventService } = require('./obs/obs-event-service');
const { createSceneManagementService } = require('./obs/scene-management-service');
const { getGiftAnimationDependencyStatus } = require('./services/tiktok-gift-animation/resolver');

let app;

const MAIN_FUNCTION_OVERRIDE_KEYS = [
    'ensureSecrets',
    'TwitchAuth',
    'createEventBus',
    'initializeDisplayQueue',
    'getOBSConnectionManager',
    'createVFXCommandService',
    'createUserTrackingService',
    'createOBSEventService',
    'createSceneManagementService',
    'NotificationManager',
    'createSpamDetectionConfig',
    'createDonationSpamDetection',
    'createGracefulExitService',
    'createProductionDependencies'
];

function validateMainOverrideContracts(overrides) {
    if (!overrides || typeof overrides !== 'object') {
        throw new Error('main overrides must be an object when provided');
    }

    for (const key of MAIN_FUNCTION_OVERRIDE_KEYS) {
        const overrideValue = overrides[key];
        if (overrideValue !== undefined && typeof overrideValue !== 'function') {
            throw new Error(`main override ${key} must be a function when provided`);
        }
    }

    if (overrides.cliArgs !== undefined && (overrides.cliArgs === null || typeof overrides.cliArgs !== 'object')) {
        throw new Error('main override cliArgs must be an object when provided');
    }
}

function validateRuntimeCliArgs(cliArgsCandidate) {
    if (!cliArgsCandidate || typeof cliArgsCandidate !== 'object') {
        throw new Error('main runtime cliArgs must be an object');
    }

    if (cliArgsCandidate.chat !== undefined && cliArgsCandidate.chat !== null) {
        if (!Number.isInteger(cliArgsCandidate.chat) || cliArgsCandidate.chat <= 0) {
            throw new Error('main override cliArgs.chat must be null or a positive integer');
        }
    }
}

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

    return new AppRuntime(config, deps);
}

async function main(overrides = {}) {
    const runtimeOverrides = overrides || {};
    validateMainOverrideContracts(runtimeOverrides);

    if (runtimeOverrides.innertubeImporter !== undefined && typeof runtimeOverrides.innertubeImporter !== 'function') {
        throw new Error('main override innertubeImporter must be a function when provided');
    }

    if (runtimeOverrides.innertubeImporter) {
        innertubeInstanceManager.setInnertubeImporter(runtimeOverrides.innertubeImporter);
    }
    const runtimeCliArgs = runtimeOverrides.cliArgs || cliArgs;
    validateRuntimeCliArgs(runtimeCliArgs);
    const runtimeConfig = runtimeOverrides.config || config;
    if (runtimeConfig !== config) {
        config = runtimeConfig;
    }
    if (!runtimeCliArgs.debug && config.general.debugEnabled) {
        setDebugMode(true);
        logger.info('Debug mode enabled via config.ini', 'system');
    } else if (runtimeCliArgs.debug) {
        logger.info('Debug mode enabled via command line argument', 'system');
    }
    if (config.general.debugEnabled) {
        logger.debug('Raw twitch config:', 'system', config.twitch);
    }
    const ensureSecretsFn = runtimeOverrides.ensureSecrets || ensureSecrets;
    const TwitchAuthCtor = runtimeOverrides.TwitchAuth || TwitchAuth;
    const createEventBusFn = runtimeOverrides.createEventBus || createEventBus;
    const initializeDisplayQueueFn = runtimeOverrides.initializeDisplayQueue || initializeDisplayQueue;
    const getOBSConnectionManagerFn = runtimeOverrides.getOBSConnectionManager || getOBSConnectionManager;
    const createVFXCommandServiceFn = runtimeOverrides.createVFXCommandService || createVFXCommandService;
    const createUserTrackingServiceFn = runtimeOverrides.createUserTrackingService || createUserTrackingService;
    const createOBSEventServiceFn = runtimeOverrides.createOBSEventService || createOBSEventService;
    const createSceneManagementServiceFn = runtimeOverrides.createSceneManagementService || createSceneManagementService;
    const NotificationManagerCtor = runtimeOverrides.NotificationManager || NotificationManager;
    const createSpamDetectionConfigFn = runtimeOverrides.createSpamDetectionConfig || createSpamDetectionConfig;
    const createDonationSpamDetectionFn = runtimeOverrides.createDonationSpamDetection || createDonationSpamDetection;
    const createGracefulExitServiceFn = runtimeOverrides.createGracefulExitService || createGracefulExitService;
    const createProductionDependenciesFn = runtimeOverrides.createProductionDependencies || createProductionDependencies;
    try {
        logger.console('Starting main application...', 'main');
        logger.info('Main application started, beginning initialization...', 'Main');
        logger.debug('About to set up display queue configuration...', 'Main');
        logger.info('Setting up display queue configuration...', 'Main');

        try {
            await ensureSecretsFn({
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
            twitchAuth = new TwitchAuthCtor({
                tokenStorePath: config.twitch.tokenStorePath,
                clientId: config.twitch.clientId,
                expectedUsername: config.twitch.username,
                logger,
                httpClient: runtimeOverrides?.axios
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

        const { chatMsgTxt, chatMsgScene, chatMsgGroup, ttsEnabled,
            notificationMsgGroup, notificationTxt, notificationScene } = config.obs;
        if (!chatMsgTxt || !chatMsgScene) {
            throw new Error('Display queue requires chatMsgTxt and chatMsgScene');
        }
        if (!notificationTxt || !notificationScene) {
            throw new Error('Display queue requires notificationTxt and notificationScene');
        }
        const chatLogos = config.obs.chatPlatformLogos;
        const notificationLogos = config.obs.notificationPlatformLogos;
        const handcamConfig = config.handcam;
        const giftsConfig = config.gifts;
        
        const displayQueueConfig = {
            autoProcess: config.displayQueue.autoProcess,
            maxQueueSize: config.displayQueue.maxQueueSize,
            chat: {
                sourceName: chatMsgTxt,
                sceneName: chatMsgScene,
                groupName: chatMsgGroup,
                platformLogos: chatLogos
            },
            notification: {
                sourceName: notificationTxt,
                sceneName: notificationScene,
                groupName: notificationMsgGroup,
                platformLogos: notificationLogos
            },
            obs: config.obs,
            handcam: handcamConfig,
            gifts: giftsConfig,
            timing: config.timing,
            youtube: config.youtube,
            twitch: config.twitch,
            tiktok: config.tiktok,
            gui: config.gui,
            ttsEnabled
        };

        const guiGiftAnimationState = {
            enableDock: displayQueueConfig.gui?.enableDock === true,
            enableOverlay: displayQueueConfig.gui?.enableOverlay === true,
            showGifts: displayQueueConfig.gui?.showGifts !== false
        };
        guiGiftAnimationState.guiEnabled = guiGiftAnimationState.enableDock || guiGiftAnimationState.enableOverlay;
        guiGiftAnimationState.giftAnimationsEnabled = guiGiftAnimationState.guiEnabled && guiGiftAnimationState.showGifts;
        
        logger.debug(`[Display Queue Config] Notification: ${displayQueueConfig.notification.sourceName}, Chat: ${displayQueueConfig.chat.sourceName}`, 'Main');
        logger.debug('[Display Queue Config] GUI gift animation gating state', 'Main', guiGiftAnimationState);

        if (guiGiftAnimationState.giftAnimationsEnabled) {
            const giftAnimationDependencies = getGiftAnimationDependencyStatus();
            logger.debug('[Gift Animation] Runtime dependency diagnostics', 'Main', giftAnimationDependencies);
            if (!giftAnimationDependencies.extraction.available) {
                logger.warn('[Gift Animation] Runtime dependency missing; gift animations may not play', 'Main', {
                    extractionAvailable: giftAnimationDependencies.extraction.available,
                    extractionCommand: giftAnimationDependencies.extraction.command
                });
            }
        }
        
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
        const eventBus = createEventBusFn({ 
            debugEnabled: config.general.debugEnabled,
            maxListeners: 100
        });
        logger.debug('EventBus created', 'Main');

        logger.debug('About to initialize display queue...', 'Main');
        const obsManager = getOBSConnectionManagerFn({ config: config.obs });
        const displayQueue = initializeDisplayQueueFn(obsManager, displayQueueConfig, displayQueueConstants, eventBus);
        logger.debug('Display queue initialized', 'Main');
        
        logger.debug('Creating VFXCommandService...', 'Main');
        const vfxCommandService = createVFXCommandServiceFn(config, eventBus);
        logger.debug('VFXCommandService created', 'Main');
        
        logger.debug('Creating UserTrackingService...', 'Main');
        const userTrackingService = createUserTrackingServiceFn();
        logger.debug('UserTrackingService created', 'Main');

        logger.debug('Creating OBS event-driven services...', 'Main');
        const obsConnectionManager = getOBSConnectionManagerFn({ config: config.obs });
        const obsSources = require('./obs/sources').getDefaultSourcesManager();

        const obsEventService = createOBSEventServiceFn({
            eventBus,
            obsConnection: obsConnectionManager,
            obsSources,
            logger
        });
        logger.debug('OBSEventService created', 'Main');

        const sceneManagementService = createSceneManagementServiceFn({
            eventBus,
            obsConnection: obsConnectionManager,
            logger
        });
        logger.debug('SceneManagementService created', 'Main');

        const obsGoals = getDefaultGoalsManager();

        logger.debug('About to create notification manager...', 'Main');
        logger.info('Creating notification manager...', 'Main');
        const notificationManager = new NotificationManagerCtor({
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
        const spamConfig = createSpamDetectionConfigFn(config.spam, { logger });
        const donationSpamDetector = createDonationSpamDetectionFn(spamConfig, {
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
        
        const dependencies = createProductionDependenciesFn(runtimeOverrides);
        dependencies.displayQueue = displayQueue;
        dependencies.notificationManager = notificationManager;
        dependencies.twitchAuth = twitchAuth;
        
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

        const gracefulExitService = createGracefulExitServiceFn(
            app,
            runtimeCliArgs.chat,
            config.general.gracefulExit
        );
        dependencies.gracefulExitService = gracefulExitService;

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

        if (!runtimeCliArgs.chat) {
            logger.debug('Setting up keep-alive interval (graceful exit not enabled)', 'Main');
            const keepAliveInterval = safeSetInterval(() => {
                try {
                    const cleanedCount = clearExpiredGlobalCooldowns(300000);
                    if (cleanedCount > 0) {
                        logger.debug(`Periodic cleanup: removed ${cleanedCount} expired global cooldowns`, 'maintenance');
                    }
                } catch (error) {
                    logMainError('Error during periodic global cooldown cleanup', error, null, { eventType: 'maintenance', logContext: 'maintenance' });
                }
            }, 1000 * 60 * 60);
            
            if (app) {
                app.keepAliveInterval = keepAliveInterval;
            }
        } else {
            logger.debug('Graceful exit enabled - no keep-alive interval needed', 'Main');
        }

        logger.debug('Main function completing successfully', 'Main');
        return {
            success: true,
            appStarted: true,
            viewerCountActive: app && app.viewerCountSystem ? app.viewerCountSystem.isPolling : false,
            authValid
        };

    } catch (error) {
        logMainError(`Critical error occurred: ${error.message}`, error, null, { eventType: 'startup', logContext: 'main' });
        throw error;
    }
}

process.noDeprecation = true;

if (require.main === module) {
    main();
}

module.exports = { main, AppRuntime }; 
