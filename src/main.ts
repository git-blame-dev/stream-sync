import type { BuiltConfig } from './core/types/config-types';
import { createEventBus } from './core/EventBus';
import { buildLoggingConfig } from './core/config-builders';
import { PRIORITY_LEVELS, NOTIFICATION_CONFIGS } from './core/constants';
import { config as defaultConfig, loadConfig } from './core/config';
import { getUnifiedLogger, initializeLoggingConfig, setDebugMode } from './core/logging';
import { InnertubeFactory } from './factories/innertube-factory';
import NotificationManagerModule from './notifications/NotificationManager';
import { getOBSConnectionManager } from './obs/connection';
import { createDisplayQueue, initializeDisplayQueue } from './obs/display-queue';
import { getDefaultEffectsManager } from './obs/effects';
import { getDefaultSourcesManager } from './obs/sources';
import { StreamElementsPlatform, TikTokPlatform, TwitchPlatform, YouTubePlatform } from './platforms';
import { AppRuntime } from './runtime/AppRuntime';
import { CommandCooldownService } from './services/CommandCooldownService';
import { createGracefulExitService } from './services/GracefulExitService';
import { PlatformLifecycleService } from './services/PlatformLifecycleService';
import { createUserTrackingService } from './services/UserTrackingService';
import { createVFXCommandService } from './services/VFXCommandService';
import { getGiftAnimationDependencyStatus } from './services/tiktok-gift-animation/resolver';
import * as innertubeInstanceManager from './services/innertube-instance-manager';
import { TwitchAuth } from './auth/TwitchAuth';
import dependencyFactoryModule from './utils/dependency-factory';
import { validateLoggerInterface } from './utils/dependency-validator';
import { createSpamDetectionConfig, createDonationSpamDetection } from './utils/spam-detection';
import { createOBSEventService } from './obs/obs-event-service';
import { clearExpiredGlobalCooldowns } from './utils/global-command-cooldown';
import { createPlatformErrorHandler } from './utils/platform-error-handler';
import { ensureSecrets } from './utils/secret-manager';
import { createTextProcessingManager } from './utils/text-processing';
import { safeSetInterval } from './utils/timeout-validator';
import { createOBSSubsystem } from './obs/subsystem';

const NotificationManager = NotificationManagerModule as new (...args: unknown[]) => {
    handleAggregatedDonation: (data: unknown) => void;
    donationSpamDetector?: unknown;
};
const { DependencyFactory } = dependencyFactoryModule as {
    DependencyFactory: new () => unknown;
};

type MainCliArgs = {
    debug: boolean;
    help: boolean;
    chat: number | null;
};

type MainLogOptions = {
    eventType: string;
    logContext: string;
};

type MainOverrides = Record<string, unknown> & {
    cliArgs?: Partial<MainCliArgs>;
    config?: MainConfig;
    innertubeImporter?: (...args: unknown[]) => unknown;
    axios?: unknown;
    WebSocketCtor?: unknown;
    tiktokConnector?: unknown;
    dependencyFactory?: unknown;
};

type MainConfig = BuiltConfig & {
    general: {
        debugEnabled: boolean;
        gracefulExit: unknown;
        envFilePath?: string;
        envFileReadEnabled?: unknown;
        envFileWriteEnabled?: unknown;
    };
    obs: {
        chatMsgTxt: string;
        chatMsgScene: string;
        chatMsgGroup: string;
        ttsEnabled: boolean;
        notificationMsgGroup: string;
        notificationTxt: string;
        notificationScene: string;
        chatPlatformLogos: Record<string, unknown>;
        notificationPlatformLogos: Record<string, unknown>;
    } & Record<string, unknown>;
    displayQueue: {
        autoProcess: boolean;
        maxQueueSize: number;
    };
    cooldowns: Record<string, unknown>;
    timing: {
        transitionDelay: number;
        notificationClearDelay: number;
        chatMessageDuration: number;
    };
    http: {
        userAgents: string[];
    };
    twitch: Record<string, unknown> & {
        enabled: boolean;
        tokenStorePath?: string;
        clientId?: string;
        username?: string;
    };
    youtube: Record<string, unknown>;
    tiktok: Record<string, unknown>;
    handcam: Record<string, unknown>;
    gifts: Record<string, unknown>;
    gui?: {
        enableDock?: boolean;
        enableOverlay?: boolean;
        showGifts?: boolean;
    };
    spam: Record<string, unknown>;
};

type MainApp = AppRuntime & {
    keepAliveInterval?: ReturnType<typeof safeSetInterval>;
    viewerCountSystem?: {
        isPolling?: boolean;
    };
};

const args = process.argv.slice(2);

const cliArgs: MainCliArgs = {
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

if (cliArgs.debug) {
    setDebugMode(true);
}

let config = defaultConfig as MainConfig;

if (cliArgs.debug) {
    const normalizedConfig = loadConfig() as Record<string, Record<string, unknown>>;
    config.logging = buildLoggingConfig(normalizedConfig, { debugMode: true });
}

initializeLoggingConfig(config);

const logger = getUnifiedLogger();
if (!logger || typeof logger.debug !== 'function') {
    throw new Error('Logger missing required methods');
}

let mainErrorHandler: ReturnType<typeof createPlatformErrorHandler> | null = null;

function getMainErrorHandler() {
    if (!mainErrorHandler && logger) {
        mainErrorHandler = createPlatformErrorHandler(logger, 'main');
    }
    return mainErrorHandler;
}

function logMainError(message: string, error: unknown, payload: Record<string, unknown> | null, options: MainLogOptions) {
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

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

const textProcessing = createTextProcessingManager({ logger });
const coreConstants = {
    PRIORITY_LEVELS,
    NOTIFICATION_CONFIGS
};
const platforms = {
    TikTokPlatform,
    TwitchPlatform,
    YouTubePlatform,
    StreamElementsPlatform
};

let app: MainApp | undefined;

const MAIN_FUNCTION_OVERRIDE_KEYS = [
    'ensureSecrets',
    'TwitchAuth',
    'createEventBus',
    'createDisplayQueue',
    'initializeDisplayQueue',
    'getOBSConnectionManager',
    'createVFXCommandService',
    'createUserTrackingService',
    'createOBSEventService',
    'NotificationManager',
    'createSpamDetectionConfig',
    'createDonationSpamDetection',
    'createGracefulExitService',
    'createProductionDependencies'
];

function validateMainOverrideContracts(overrides: MainOverrides) {
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

function validateRuntimeCliArgs(cliArgsCandidate: Partial<MainCliArgs> & Record<string, unknown>) {
    if (!cliArgsCandidate || typeof cliArgsCandidate !== 'object') {
        throw new Error('main runtime cliArgs must be an object');
    }

    if (cliArgsCandidate.chat !== undefined && cliArgsCandidate.chat !== null) {
        if (!Number.isInteger(cliArgsCandidate.chat) || cliArgsCandidate.chat <= 0) {
            throw new Error('main override cliArgs.chat must be null or a positive integer');
        }
    }
}

function createProductionDependencies(
    overrides: MainOverrides = {},
    obsSubsystem: {
        connectionManager: unknown;
        sourcesManager: unknown;
        effectsManager: unknown;
        goalsManager: unknown;
    } | null = null
) {
    validateLoggerInterface(logger);

    const resolvedOverrides = overrides || {};
    if (resolvedOverrides.innertubeImporter) {
        InnertubeFactory.configure({ importer: resolvedOverrides.innertubeImporter });
    }
    
    return {
        obs: {
            connectionManager: obsSubsystem?.connectionManager || getOBSConnectionManager({ config: config.obs }),
            sourcesManager: obsSubsystem?.sourcesManager || getDefaultSourcesManager(),
            effectsManager: obsSubsystem?.effectsManager || getDefaultEffectsManager(),
            ...(obsSubsystem?.goalsManager ? { goalsManager: obsSubsystem.goalsManager } : {})
        },
        sourcesFactory: { getDefaultSourcesManager },
        effectsFactory: { getDefaultEffectsManager },
        logging: logger,
        logger: logger,
        platforms,
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

function createAppRuntime(config: MainConfig, dependencies: Record<string, unknown>) {
    if (!dependencies) {
        throw new Error('createAppRuntime requires dependencies');
    }
    const deps = dependencies;

    logger.info('Creating AppRuntime', 'system');

    return new AppRuntime(config, deps);
}

async function main(overrides: MainOverrides = {}) {
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
    const createDisplayQueueFn = runtimeOverrides.createDisplayQueue || createDisplayQueue;
    const initializeDisplayQueueFn = runtimeOverrides.initializeDisplayQueue || initializeDisplayQueue;
    const getOBSConnectionManagerFn = runtimeOverrides.getOBSConnectionManager || getOBSConnectionManager;
    const createVFXCommandServiceFn = runtimeOverrides.createVFXCommandService || createVFXCommandService;
    const createUserTrackingServiceFn = runtimeOverrides.createUserTrackingService || createUserTrackingService;
    const createOBSEventServiceFn = runtimeOverrides.createOBSEventService || createOBSEventService;
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

        const guiGiftAnimationState: {
            enableDock: boolean;
            enableOverlay: boolean;
            showGifts: boolean;
            guiEnabled?: boolean;
            giftAnimationsEnabled?: boolean;
        } = {
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

        const obsSubsystem = createOBSSubsystem({
            config,
            logger,
            eventBus,
            getOBSConnectionManager: getOBSConnectionManagerFn,
            createOBSEventService: createOBSEventServiceFn
        } as Parameters<typeof createOBSSubsystem>[0]);

        logger.debug('About to initialize display queue...', 'Main');
        const displayQueueDependencies = {
            sourcesManager: obsSubsystem.sourcesManager,
            goalsManager: obsSubsystem.goalsManager
        };
        const displayQueue = runtimeOverrides.initializeDisplayQueue
            ? initializeDisplayQueueFn(
                obsSubsystem.connectionManager,
                displayQueueConfig,
                displayQueueConstants,
                eventBus,
                displayQueueDependencies
            )
            : createDisplayQueueFn(
                obsSubsystem.connectionManager,
                displayQueueConfig,
                displayQueueConstants,
                eventBus,
                displayQueueDependencies
            );
        logger.debug('Display queue initialized', 'Main');
        
        logger.debug('Creating VFXCommandService...', 'Main');
        const vfxCommandService = createVFXCommandServiceFn(config, eventBus, {
            effectsManager: obsSubsystem.effectsManager
        });
        logger.debug('VFXCommandService created', 'Main');
        
        logger.debug('Creating UserTrackingService...', 'Main');
        const userTrackingService = createUserTrackingServiceFn();
        logger.debug('UserTrackingService created', 'Main');

        logger.debug('Creating OBS event-driven services...', 'Main');
        const obsEventService = obsSubsystem.obsEventService;
        logger.debug('OBSEventService created', 'Main');

        const obsGoals = obsSubsystem.goalsManager;

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
            onAggregatedDonation: (data: unknown) => notificationManager.handleAggregatedDonation(data)
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
        
        const dependencies = createProductionDependenciesFn(runtimeOverrides, obsSubsystem);
        dependencies.obs = {
            connectionManager: obsSubsystem.connectionManager,
            sourcesManager: obsSubsystem.sourcesManager,
            effectsManager: obsSubsystem.effectsManager,
            goalsManager: obsSubsystem.goalsManager
        };
        dependencies.displayQueue = displayQueue;
        dependencies.notificationManager = notificationManager;
        dependencies.twitchAuth = twitchAuth;
        
        dependencies.eventBus = eventBus;
        dependencies.vfxCommandService = vfxCommandService;
        dependencies.userTrackingService = userTrackingService;
        dependencies.obsEventService = obsEventService;

        const sharedPlatformDependencies: Record<string, unknown> = {
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
        if (app && typeof app.rollbackStartup === 'function') {
            try {
                await app.rollbackStartup();
            } catch (rollbackError) {
                const rollbackMessage = getErrorMessage(rollbackError);
                logMainError(
                    `Startup rollback failed: ${rollbackMessage}`,
                    rollbackError,
                    null,
                    { eventType: 'startup-rollback', logContext: 'main' }
                );
            }
        }
        const message = getErrorMessage(error);
        logMainError(`Critical error occurred: ${message}`, error, null, { eventType: 'startup', logContext: 'main' });
        throw error;
    }
}

async function runMainEntrypoint(mainFn: () => Promise<unknown> = main) {
    try {
        await mainFn();
        return { success: true };
    } catch (error) {
        const message = getErrorMessage(error);
        logMainError(`Fatal startup failure: ${message}`, error, null, { eventType: 'startup', logContext: 'main-entrypoint' });
        process.exitCode = 1;
        return {
            success: false,
            error: message
        };
    }
}

process.noDeprecation = true;

if (import.meta.main) {
    void runMainEntrypoint();
}

export { main, AppRuntime, runMainEntrypoint };
