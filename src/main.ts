import { RawEventLogWriter } from './services/RawEventLogWriter';
import type { BuiltConfig } from './core/types/config-types';
import { createEventBus } from './core/EventBus';
import { buildLoggingConfig } from './core/config-builders';
import { PRIORITY_LEVELS, NOTIFICATION_CONFIGS } from './core/constants';
import { config as defaultConfig } from './core/config';
import {
    normalizeRowEffects,
    normalizeRowTheme,
    type RowTheme,
    type RowVisualEffectId
} from './core/row-presentation';
import { getOperatorLogSource, getUnifiedLogger, logger, initializeLoggingConfig } from './core/logging';
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
import { acquireSingleInstanceGuard } from './services/SingleInstanceGuard';
import type { SingleInstanceGuard } from './services/SingleInstanceGuard';
import { createUserTrackingService } from './services/UserTrackingService';
import { createVFXCommandService } from './services/VFXCommandService';
import { getGiftAnimationDependencyStatus } from './services/tiktok-gift-animation/resolver';
import {
    createOperatorControlService,
    OPERATOR_CONTROL_KEYS,
    type OperatorControlService,
    type OperatorControls
} from './services/operator/operator-control-service';
import {
    createOperatorAppearanceService,
    type OperatorAppearanceService,
    type OperatorAppearanceSettings
} from './services/operator/operator-appearance-service';
import { TwitchAuth } from './auth/TwitchAuth';
import dependencyFactoryModule from './utils/dependency-factory';
import { validateLoggerInterface } from './utils/dependency-validator';
import { createSpamDetectionConfig, createDonationSpamDetection } from './utils/spam-detection';
import { createOBSEventService } from './obs/obs-event-service';
import { clearExpiredGlobalCooldowns } from './utils/global-command-cooldown';
import { createPlatformErrorHandler } from './utils/platform-error-handler';
import { ensureSecrets } from './utils/secret-manager';
import { createTextProcessingManager } from './utils/text-processing';
import { safeSetInterval, safeSetTimeout } from './utils/timeout-validator';
import { createOBSSubsystem } from './obs/subsystem';
import type { MonetizationValuesConfig } from './core/monetization-values';
import { createUsdRateService, type UsdRateService } from './services/usd-rate-service';
import {
    createFundingGoalService,
    type FundingGoalConfig
} from './services/funding-goal-service';

type YouTubeModuleLike = {
    Innertube: {
        create: (config?: Record<string, unknown>) => Promise<unknown>;
    };
    Parser?: {
        setParserErrorHandler: (handler: (context?: Record<string, unknown>) => void) => void;
    };
    [key: string]: unknown;
};

type InnertubeImporter = () => Promise<YouTubeModuleLike>;

type MainNotificationManager = {
    handleAggregatedDonation: (data: unknown) => void;
    donationSpamDetector?: unknown;
};

const NotificationManager = NotificationManagerModule as new (...args: unknown[]) => MainNotificationManager;
const { DependencyFactory } = dependencyFactoryModule;

type MainCliArgs = {
    debug: boolean;
    help: boolean;
    chat: number | null;
};

type MainLogOptions = {
    eventType: string;
    logContext: string;
};

type ProductionDependencies = Record<string, unknown> & {
    obs: Record<string, unknown>;
    dependencyFactory: PlatformLifecycleDependencyFactory;
    lazyInnertube: unknown;
    axios?: TwitchHttpClient;
    WebSocketCtor?: unknown;
};
type AppRuntimeConfig = ConstructorParameters<typeof AppRuntime>[0];
type AppRuntimeDependencies = ConstructorParameters<typeof AppRuntime>[1];
type TwitchHttpClient = ConstructorParameters<typeof TwitchAuth>[0]['httpClient'];
type YoutubeOwnerOptions = NonNullable<Parameters<InstanceType<typeof DependencyFactory>['createYoutubeInnertubeService']>[0]>;
type PlatformLifecycleDependencyFactory = NonNullable<NonNullable<ConstructorParameters<typeof PlatformLifecycleService>[0]>['dependencyFactory']> & {
    createYoutubeInnertubeService?: InstanceType<typeof DependencyFactory>['createYoutubeInnertubeService'];
};
type MainConfigChangePayload = {
    section?: string;
    value?: Partial<{
        defaultCooldown: number;
        heavyCommandCooldown: number;
        heavyCommandThreshold: number;
        heavyCommandWindow: number;
        globalCooldown: number;
        maxEntries: number;
    }>;
};
type MainGracefulExitConfig = Parameters<typeof createGracefulExitService>[2];

type MainOverrides = Record<string, unknown> & {
    onShutdownComplete?: () => void;
    cliArgs?: Partial<MainCliArgs>;
    config?: MainConfig;
    innertubeImporter?: InnertubeImporter;
    axios?: TwitchHttpClient;
    WebSocketCtor?: unknown;
    dependencyFactory?: PlatformLifecycleDependencyFactory;
    ensureSecrets?: typeof ensureSecrets;
    TwitchAuth?: typeof TwitchAuth;
    createEventBus?: typeof createEventBus;
    createDisplayQueue?: typeof createDisplayQueue;
    initializeDisplayQueue?: typeof initializeDisplayQueue;
    getOBSConnectionManager?: typeof getOBSConnectionManager;
    createVFXCommandService?: typeof createVFXCommandService;
    createUserTrackingService?: typeof createUserTrackingService;
    createOBSEventService?: typeof createOBSEventService;
    NotificationManager?: new (...args: unknown[]) => MainNotificationManager;
    createSpamDetectionConfig?: typeof createSpamDetectionConfig;
    createDonationSpamDetection?: typeof createDonationSpamDetection;
    createGracefulExitService?: typeof createGracefulExitService;
    createProductionDependencies?: typeof createProductionDependencies;
    createSingleInstanceGuard?: typeof acquireSingleInstanceGuard;
    createOperatorControlService?: typeof createOperatorControlService;
    createOperatorAppearanceService?: typeof createOperatorAppearanceService;
    createFundingGoalService?: typeof createFundingGoalService;
    createUsdRateService?: typeof createUsdRateService;
};

type CooldownsConfig = {
    cmdCooldown: number;
    defaultCooldownMs: number;
    heavyCommandCooldownMs: number;
    heavyCommandThreshold: number;
    heavyCommandWindowMs: number;
    globalCmdCooldownMs: number;
    maxEntries: number;
};

type MainConfig = Record<string, Record<string, unknown>> & BuiltConfig & {
    logging?: ReturnType<typeof buildLoggingConfig>;
    general: {
        debugEnabled: boolean;
        keywordParsingEnabled?: boolean;
        gracefulExit: unknown;
        envFilePath?: string;
        envFileReadEnabled?: unknown;
        envFileWriteEnabled?: unknown;
    };
    obs: Record<string, unknown> & {
        address?: string;
        password?: string;
        enabled?: boolean;
        connectionTimeoutMs?: number;
        ttsChatEnabled: boolean;
        ttsNotificationsEnabled: boolean;
    } & Record<string, unknown>;
    displayQueue: Record<string, unknown> & {
        autoProcess: boolean;
        maxQueueSize: number;
        rowIntervalMs: number;
    };
    cooldowns: Record<string, unknown> & CooldownsConfig;
    http: Record<string, unknown> & {
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
        enableNotifications?: boolean;
        enableOperator?: boolean;
        minimalCompactRows?: boolean;
        minimalRowBackgroundsEnabled?: boolean;
        minimalMaxDisplayableBadges?: number;
        streamSupporterChatEffectsEnabled?: boolean;
        memberRowTheme?: RowTheme;
        memberRowEffects?: readonly RowVisualEffectId[];
        showGifts?: boolean;
        notificationIdleHoldMs?: number;
        monetizationIdleHoldMs?: number;
        notificationTransitionMs?: number;
    };
    spam: Record<string, unknown>;
    commands: Record<string, string>;
    farewell: Record<string, string>;
    vfx: {
        filePath: string;
    };
};

function buildOperatorControlDefaults(config: MainConfig): OperatorControls {
    const general = config.general as Record<string, unknown>;
    return Object.fromEntries(OPERATOR_CONTROL_KEYS.map((key) => [key, general[key] !== false])) as OperatorControls;
}

function buildOperatorAppearanceDefaults(config: MainConfig): OperatorAppearanceSettings {
    const gui = config.gui as Record<string, unknown> | undefined;
    return {
        compactRows: gui?.minimalCompactRows !== false,
        rowBackgroundsEnabled: gui?.minimalRowBackgroundsEnabled === true,
        maxDisplayableBadges: typeof gui?.minimalMaxDisplayableBadges === 'number'
            && Number.isSafeInteger(gui.minimalMaxDisplayableBadges)
            && gui.minimalMaxDisplayableBadges >= 0
            ? gui.minimalMaxDisplayableBadges
            : 3,
        streamSupporterChatEffectsEnabled: gui?.streamSupporterChatEffectsEnabled !== false,
        memberRowTheme: normalizeRowTheme(gui?.memberRowTheme) ?? 'green',
        memberRowEffects: normalizeRowEffects(gui?.memberRowEffects) ?? ['sheen']
    };
}

function enableOperatorNotificationPreparation(config: MainConfig): MainConfig {
    const enabledControls = Object.fromEntries(OPERATOR_CONTROL_KEYS.map((key) => [key, true]));
    return {
        ...config,
        general: { ...config.general, ...enabledControls },
        tiktok: { ...config.tiktok, ...enabledControls },
        twitch: { ...config.twitch, ...enabledControls },
        youtube: { ...config.youtube, ...enabledControls }
    } as MainConfig;
}

function createDefaultDependencyFactory(): PlatformLifecycleDependencyFactory {
    const factory = new DependencyFactory();
    return {
        createYoutubeInnertubeService: factory.createYoutubeInnertubeService.bind(factory),
        createYoutubeDependencies: factory.createYoutubeDependencies.bind(factory),
        createTiktokDependencies: factory.createTiktokDependencies.bind(factory),
        createTwitchDependencies: factory.createTwitchDependencies.bind(factory),
        createStreamelementsDependencies: factory.createStreamelementsDependencies.bind(factory)
    };
}

function toGracefulExitConfig(candidate: unknown): MainGracefulExitConfig | undefined {
    return candidate && typeof candidate === 'object'
        ? candidate
        : undefined;
}

function toMainConfigChangePayload(payload: unknown): MainConfigChangePayload | undefined {
    return payload && typeof payload === 'object'
        ? payload
        : undefined;
}

function assertRuntimeDependencies(dependencies: ProductionDependencies): asserts dependencies is ProductionDependencies & AppRuntimeDependencies {
    const requiredKeys: Array<keyof AppRuntimeDependencies> = [
        'logging',
        'displayQueue',
        'notificationManager',
        'eventBus',
        'vfxCommandService',
        'userTrackingService',
        'obsEventService',
        'commandCooldownService',
        'platformLifecycleService'
    ];
    const missingKeys = requiredKeys.filter((key) => dependencies[key] === undefined || dependencies[key] === null);
    if (missingKeys.length > 0) {
        throw new Error(`Runtime dependencies missing required keys: ${missingKeys.join(', ')}`);
    }
}

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
                i += 1;
                const chatArg = args[i];
                if (chatArg === undefined) {
                    process.stderr.write('Error: --chat argument requires a number\n');
                    process.exit(1);
                }
                const chatCount = Number(chatArg);
                if (!/^\+?[0-9]+$/.test(chatArg) || !Number.isSafeInteger(chatCount) || chatCount <= 0) {
                    process.stderr.write('Error: --chat argument requires a positive safe integer\n');
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
Usage: stream-sync [options]

Options:
  --debug              Enable debug mode
  --chat <number>      Exit after processing N actual messages
  --help, -h           Show this help message

Examples:
  stream-sync --debug
  stream-sync --chat 10
`);
    process.exit(0);
}

let config = defaultConfig as MainConfig;

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

function toAppRuntimeConfig(candidate: MainConfig): AppRuntimeConfig {
    if (!candidate.obs || typeof candidate.obs !== 'object') {
        throw new Error('AppRuntime requires obs config');
    }
    if (!candidate.handcam || typeof candidate.handcam !== 'object') {
        throw new Error('AppRuntime requires handcam config');
    }
    return candidate as unknown as AppRuntimeConfig;
}

function createCooldownEventBus(eventBus: ReturnType<typeof createEventBus>) {
    return {
        emit: (eventName: string, payload: unknown) => {
            eventBus.emit(eventName, payload);
        },
        subscribe: (eventName: string, handler: (payload?: MainConfigChangePayload) => void) => eventBus.subscribe(eventName, (payload: unknown) => {
            handler(toMainConfigChangePayload(payload));
        })
    };
}

function summarizeTwitchConfig(twitchConfig: MainConfig['twitch']): Record<string, unknown> {
    return {
        enabled: twitchConfig.enabled,
        hasClientId: typeof twitchConfig.clientId === 'string' && twitchConfig.clientId.length > 0,
        hasUsername: typeof twitchConfig.username === 'string' && twitchConfig.username.length > 0,
        hasTokenStorePath: typeof twitchConfig.tokenStorePath === 'string' && twitchConfig.tokenStorePath.length > 0,
        dataLoggingEnabled: twitchConfig.dataLoggingEnabled === true
    };
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

const MAIN_FUNCTION_OVERRIDE_KEYS = [
    'onShutdownComplete',
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
    'createProductionDependencies',
    'createSingleInstanceGuard',
    'createOperatorControlService',
    'createOperatorAppearanceService',
    'createFundingGoalService'
];

async function releaseSingleInstanceGuard(singleInstanceGuard: SingleInstanceGuard | null) {
    if (!singleInstanceGuard) {
        return;
    }
    try {
        await singleInstanceGuard.release();
    } catch (error) {
        logMainError('Failed to release single-instance listener', error, {
            port: singleInstanceGuard.port
        }, {
            eventType: 'shutdown',
            logContext: 'single-instance'
        });
    }
}

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
        if (!Number.isSafeInteger(cliArgsCandidate.chat) || cliArgsCandidate.chat <= 0) {
            throw new Error('main override cliArgs.chat must be null or a positive integer within the safe numeric range');
        }
    }
}

function configureInnertubeImporter(overrides: MainOverrides) {
    if (overrides.innertubeImporter) {
        InnertubeFactory.configure({ importer: overrides.innertubeImporter });
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
    const logger = getUnifiedLogger();
    validateLoggerInterface(logger);

    const resolvedOverrides = overrides || {};
    configureInnertubeImporter(resolvedOverrides);
    
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
        onShutdownComplete: resolvedOverrides.onShutdownComplete || (() => {
            process.exitCode = 0;
            const forcedExitTimer = safeSetTimeout(() => {
                try {
                    logMainError('[Shutdown] Forced exit due to lingering handles', null, null, { eventType: 'shutdown', logContext: 'system' });
                } catch {
                    // Diagnostics must not prevent the termination fallback.
                }
                process.exit(0);
            }, 2000);
            forcedExitTimer.unref();
        }),
        platforms,
        displayQueue: null,
        notificationManager: null,
        dependencyFactory: resolvedOverrides.dependencyFactory || createDefaultDependencyFactory(),
        lazyInnertube: InnertubeFactory.createLazyReference(),
        axios: resolvedOverrides.axios,
        WebSocketCtor: resolvedOverrides.WebSocketCtor,
        innertubeImporter: resolvedOverrides.innertubeImporter,

        eventBus: null,
        vfxCommandService: null,
        userTrackingService: null
    };
}

function createAppRuntime(config: AppRuntimeConfig, dependencies: AppRuntimeDependencies) {
    if (!dependencies) {
        throw new Error('createAppRuntime requires dependencies');
    }

    return new AppRuntime(config, dependencies);
}

async function main(overrides: MainOverrides = {}) {
    const runtimeOverrides = overrides || {};
    validateMainOverrideContracts(runtimeOverrides);

    if (runtimeOverrides.innertubeImporter !== undefined && typeof runtimeOverrides.innertubeImporter !== 'function') {
        throw new Error('main override innertubeImporter must be a function when provided');
    }

    configureInnertubeImporter(runtimeOverrides);
    const runtimeCliArgs: MainCliArgs = { ...cliArgs, ...(runtimeOverrides.cliArgs || {}) };
    validateRuntimeCliArgs(runtimeCliArgs);
    const runtimeConfig = runtimeOverrides.config || config;
    if (runtimeConfig !== config) {
        config = runtimeConfig;
    }
    initializeLoggingConfig({ logging: { ...config.logging,
        console: { ...config.logging?.console, level: runtimeCliArgs.debug || config.general.debugEnabled ? 'debug' : config.logging?.console?.level ?? 'warn' }
    } }, {
        operatorCaptureEnabled: config.gui?.enableOperator === true
    });
    const logger = getUnifiedLogger();
    if (!runtimeCliArgs.debug && config.general.debugEnabled) {
        logger.info('Debug mode enabled via config.ini', 'main');
    } else if (runtimeCliArgs.debug) {
        logger.info('Debug mode enabled via command line argument', 'main');
    }
    if (config.general.debugEnabled) {
        logger.debug('Twitch config loaded', 'main', summarizeTwitchConfig(config.twitch));
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
    const createSingleInstanceGuardFn = runtimeOverrides.createSingleInstanceGuard || acquireSingleInstanceGuard;
    const createFundingGoalServiceFn = runtimeOverrides.createFundingGoalService || createFundingGoalService;
    const createUsdRateServiceFn = runtimeOverrides.createUsdRateService || createUsdRateService;
    let singleInstanceGuard: SingleInstanceGuard | null = null;
    let fundingGoal: Awaited<ReturnType<typeof createFundingGoalService>> | undefined;
    let app: MainApp | undefined;
    let runtimeOwnsResources = false;
    const construction: Array<() => void | Promise<unknown>> = [];
    try {
        logger.info('Starting main application...', 'main');

        singleInstanceGuard = await createSingleInstanceGuardFn();
        logger.debug('Acquired Stream Sync instance listener', 'single-instance', { port: singleInstanceGuard.port });

        try {
            await ensureSecretsFn({
                config,
                logger,
                interactive: !!(process.stdin && process.stdin.isTTY),
                ...(typeof config.general.envFilePath === 'string' ? { envFilePath: config.general.envFilePath } : {}),
                ...(config.general.envFileReadEnabled !== undefined ? { envFileReadEnabled: config.general.envFileReadEnabled } : {}),
                ...(config.general.envFileWriteEnabled !== undefined ? { envFileWriteEnabled: config.general.envFileWriteEnabled } : {})
            });
        } catch (error) {
            logMainError('Secret setup failed - missing required secrets', error, null, {
                eventType: 'configuration',
                logContext: 'main'
            });
            throw error;
        }

        let usdRateService: UsdRateService = {
            rates: { USD: 1 },
            convertToUsd: (amount, currency) => currency.trim().toUpperCase() === 'USD' ? amount : null
        };
        try {
            usdRateService = await createUsdRateServiceFn({ warn: (message) => logger.warn(message, 'usd-rates') });
        } catch (error) {
            logger.warn(`USD rate service unavailable; foreign YouTube gifts will be skipped: ${error instanceof Error ? error.message : String(error)}`, 'usd-rates');
        }

        let twitchAuth: TwitchAuth | null = null;
        let authValid = true;
        if (config.twitch.enabled) {
            if (typeof config.twitch.tokenStorePath !== 'string' || typeof config.twitch.clientId !== 'string') {
                throw new Error('Twitch authentication requires tokenStorePath and clientId');
            }
            twitchAuth = new TwitchAuthCtor({
                tokenStorePath: config.twitch.tokenStorePath,
                clientId: config.twitch.clientId,
                ...(typeof config.twitch.username === 'string' ? { expectedUsername: config.twitch.username } : {}),
                logger,
                ...(runtimeOverrides.axios !== undefined ? { httpClient: runtimeOverrides.axios } : {})
            });
            construction.push(() => twitchAuth?.dispose());
            try {
                await twitchAuth.initialize();
                authValid = twitchAuth.isReady();
            } catch (error) {
                authValid = false;
                logMainError('Twitch authentication failed - continuing with limited functionality', error, null, {
                    eventType: 'authentication',
                    logContext: 'main'
                });
            }
        }

        const handcamConfig = config.handcam;
        const giftsConfig = config.gifts;
        const operatorControls: OperatorControlService | undefined = config.gui?.enableOperator === true
            ? await (runtimeOverrides.createOperatorControlService || createOperatorControlService)({
                defaults: buildOperatorControlDefaults(config),
                warn: (message) => logger.warn(message, 'operator-controls')
            })
            : undefined;
        const guiEnabled = config.gui?.enableDock === true
            || config.gui?.enableOverlay === true
            || config.gui?.enableNotifications === true
            || config.gui?.enableOperator === true;
        const operatorAppearance: OperatorAppearanceService | undefined = guiEnabled
            ? await (runtimeOverrides.createOperatorAppearanceService || createOperatorAppearanceService)({
                defaults: buildOperatorAppearanceDefaults(config),
                warn: (message) => logger.warn(message, 'operator-appearance')
            })
            : undefined;
        const runtimeProcessingConfig = operatorControls
            ? enableOperatorNotificationPreparation(config)
            : config;
        
        const displayQueueConfig = {
            autoProcess: config.displayQueue.autoProcess,
            maxQueueSize: config.displayQueue.maxQueueSize,
            rowIntervalMs: config.displayQueue.rowIntervalMs,
            obs: config.obs,
            handcam: handcamConfig,
            gifts: giftsConfig,
            youtube: config.youtube,
            twitch: config.twitch,
            tiktok: config.tiktok,
            gui: config.gui,
            notificationIdleHoldMs: config.gui?.notificationIdleHoldMs,
            monetizationIdleHoldMs: config.gui?.monetizationIdleHoldMs,
            notificationTransitionMs: config.gui?.notificationTransitionMs,
            ttsChatEnabled: config.obs.ttsChatEnabled,
            ttsNotificationsEnabled: config.obs.ttsNotificationsEnabled
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

        if (guiGiftAnimationState.giftAnimationsEnabled) {
            const giftAnimationDependencies = getGiftAnimationDependencyStatus();
            logger.debug('Runtime dependency diagnostics', 'main', giftAnimationDependencies);
            if (!giftAnimationDependencies.extraction.available) {
                logger.warn('Runtime dependency missing; gift animations may not play', 'main', {
                    extractionAvailable: giftAnimationDependencies.extraction.available,
                    extractionCommand: giftAnimationDependencies.extraction.command
                });
            }
        }
        
        const priorityLevels = PRIORITY_LEVELS;
        
        const displayQueueConstants = {
            PRIORITY_LEVELS: priorityLevels
        };

        const eventBus = createEventBusFn({ 
            maxListeners: 100
        });

        fundingGoal = await createFundingGoalServiceFn({
            config: config.fundingGoal as unknown as FundingGoalConfig,
            monetizationValuesConfig: config.monetizationValues as unknown as MonetizationValuesConfig,
            fiatToUsd: usdRateService.convertToUsd,
            warn: (message) => logger.warn(message, 'funding-goal'),
            debug: (message) => logger.debug(message, 'funding-goal')
        });

        construction.push(() => fundingGoal?.dispose());

        const obsSubsystem = createOBSSubsystem({
            config,
            logger,
            eventBus,
            getOBSConnectionManager: getOBSConnectionManagerFn,
            createOBSEventService: (deps) => createOBSEventServiceFn(deps as unknown as Parameters<typeof createOBSEventService>[0]),
            usdConverter: usdRateService.convertToUsd
        });

        const provisionalObsService = obsSubsystem.obsEventService as ReturnType<typeof createOBSEventService>;
        construction.push(() => provisionalObsService.destroy?.());
        construction.push(async () => { await provisionalObsService.disconnect?.(); });
        construction.push(() => obsSubsystem.effectsManager.dispose());

        const displayQueueDependencies = {
            sourcesManager: obsSubsystem.sourcesManager,
            goalsManager: obsSubsystem.goalsManager,
            onPresentationStarted: async (item: import('./interfaces/DisplayQueue').DisplayQueueItem) => {
                if (Array.isArray(item.data.contributions)) {
                    await fundingGoal?.processPresentedContributions(item.data.contributions);
                }
            },
            ...(operatorControls ? { operatorControls } : {})
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
        construction.push(() => displayQueue.stop?.());

        const vfxCommandService = createVFXCommandServiceFn(config, eventBus, {
            effectsManager: obsSubsystem.effectsManager
        });

        const userTrackingService = createUserTrackingServiceFn();

        const obsEventService = obsSubsystem.obsEventService;

        const notificationManager = new NotificationManagerCtor({
            displayQueue: displayQueue,
            eventBus: eventBus,
            config: runtimeProcessingConfig,
            vfxCommandService: vfxCommandService,
            userTrackingService: userTrackingService,
            logger,
            constants: coreConstants,
            textProcessing
        });

        const spamConfig = createSpamDetectionConfigFn(config.spam, { logger });
        const donationSpamDetector = createDonationSpamDetectionFn(spamConfig, {
            logger,
            onAggregatedDonation: (data: unknown) => notificationManager.handleAggregatedDonation(data)
        });
        construction.push(() => donationSpamDetector.destroy());
        notificationManager.donationSpamDetector = donationSpamDetector;

        if (config.twitch.enabled) {
            if (!authValid) {
                logger.warn('Authentication validation failed - continuing with limited functionality', 'main');
            } else {
                logger.info('Authentication validation successful', 'main');
            }
        }
        
        const { innertubeImporter: _configuredImporter, ...defaultDependencyOverrides } = runtimeOverrides;
        const dependencies = createProductionDependenciesFn(
            runtimeOverrides.createProductionDependencies ? runtimeOverrides : defaultDependencyOverrides,
            obsSubsystem
        ) as unknown as ProductionDependencies;
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
        dependencies.fundingGoal = fundingGoal;
        if (operatorControls) {
            dependencies.operatorControls = operatorControls;
            const operatorLogs = getOperatorLogSource();
            if (!operatorLogs) throw new Error('Operator console requires structured log capture');
            dependencies.operatorLogs = operatorLogs;
        }
        if (operatorAppearance) {
            dependencies.operatorAppearance = operatorAppearance;
        }

        let innertubeService: AppRuntimeDependencies['innertubeService'];
        if (config.youtube.enabled) {
            if (typeof dependencies.dependencyFactory.createYoutubeInnertubeService !== 'function') {
                throw new Error('Enabled YouTube requires dependencyFactory.createYoutubeInnertubeService');
            }
            const owner = dependencies.dependencyFactory.createYoutubeInnertubeService({
                logger,
                Innertube: dependencies.lazyInnertube as NonNullable<YoutubeOwnerOptions['Innertube']>
            });
            construction.push(() => owner.dispose());
            innertubeService = owner;
            dependencies.innertubeService = innertubeService;
        }

        const rawEventLogWriter = new RawEventLogWriter({
            directories: [config.tiktok, config.twitch, config.youtube, config.streamelements]
                .filter(platform => platform.enabled && platform.dataLoggingEnabled && platform.dataLoggingPath)
                .map(platform => platform.dataLoggingPath!),
            archiveMaxBytes: config.logging.rawArchiveMaxBytes,
            archiveMaxAgeDays: config.logging.rawArchiveMaxAgeDays
        });
        construction.push(() => rawEventLogWriter.close());
        dependencies.rawEventLogWriter = rawEventLogWriter;
        const sharedPlatformDependencies: Record<string, unknown> = {
            rawEventLogWriter,
            innertubeService,
            logger,
            notificationManager,
            twitchAuth,
            USER_AGENTS: config.http.userAgents,
            config,
            Innertube: dependencies.lazyInnertube,
            axios: dependencies.axios,
            WebSocketCtor: dependencies.WebSocketCtor
        };

        const commandCooldownService = new CommandCooldownService({
            eventBus: createCooldownEventBus(eventBus),
            logger,
            config
        });

        construction.push(() => commandCooldownService.dispose());

        const platformLifecycleService = new PlatformLifecycleService({
            config,
            eventBus,
            dependencyFactory: dependencies.dependencyFactory,
            logger,
            sharedDependencies: sharedPlatformDependencies
        });

        dependencies.commandCooldownService = commandCooldownService;
        dependencies.platformLifecycleService = platformLifecycleService;
        
        assertRuntimeDependencies(dependencies);
        app = createAppRuntime(toAppRuntimeConfig(runtimeProcessingConfig), dependencies);
        runtimeOwnsResources = true;

        const gracefulExitService = createGracefulExitServiceFn(
            app,
            runtimeCliArgs.chat,
            toGracefulExitConfig(config.general.gracefulExit)
        );
        dependencies.gracefulExitService = gracefulExitService;

        await app.start();

        if (process.env.CHAT_BOT_STARTUP_ONLY === 'true') {
            logger.info('Startup-only mode enabled; shutting down after initialization', 'main');
            await app.shutdown();
            await releaseSingleInstanceGuard(singleInstanceGuard);
            singleInstanceGuard = null;
            return {
                success: true,
                appStarted: true,
                viewerCountActive: app && app.viewerCountSystem ? app.viewerCountSystem.isPolling : false,
                authValid
            };
        }
        
        logger.info('Runtime ready', 'main');

        if (!runtimeCliArgs.chat) {

            const keepAliveInterval = safeSetInterval(() => {
                try {
                    clearExpiredGlobalCooldowns(300000);
                } catch (error) {
                    logMainError('Error during periodic global cooldown cleanup', error, null, { eventType: 'maintenance', logContext: 'maintenance' });
                }
            }, 1000 * 60 * 60);
            
            if (app) {
                app.keepAliveInterval = keepAliveInterval;
            }
        }

        return {
            success: true,
            appStarted: true,
            viewerCountActive: app && app.viewerCountSystem ? app.viewerCountSystem.isPolling : false,
            authValid
        };

    } catch (error) {
        if (!runtimeOwnsResources) {
            try {
                let failed = false;
                let firstError: unknown;
                while (construction.length > 0) {
                    try {
                        await construction.pop()!();
                    } catch (cleanupError) {
                        if (!failed) firstError = cleanupError;
                        failed = true;
                    }
                }
                if (failed) throw firstError;
            } catch (disposeError) {
                try {
                    logMainError('Failed to retire resources before runtime adoption', disposeError, null, {
                        eventType: 'startup-rollback',
                        logContext: 'main'
                    });
                } catch {
                    // Preserve the startup failure after every provisional disposer ran.
                }
            }
        }
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
        await releaseSingleInstanceGuard(singleInstanceGuard);
        singleInstanceGuard = null;
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

if (require.main === module) {
    void runMainEntrypoint();
}

export { main, AppRuntime, runMainEntrypoint, createProductionDependencies };
