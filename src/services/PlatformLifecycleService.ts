import { logger } from '../core/logging';
import { safeDelay } from '../utils/timeout-validator';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { assertPlatformInterface } from '../utils/platform-interface-validator';
import { getSystemTimestampISO } from '../utils/timestamp';

const PlatformEvents = {
    CHAT_MESSAGE: 'platform:chat-message',
    VIEWER_COUNT: 'platform:viewer-count',
    GIFT: 'platform:gift',
    PAYPIGGY: 'platform:paypiggy',
    GIFTPAYPIGGY: 'platform:giftpaypiggy',
    FOLLOW: 'platform:follow',
    SHARE: 'platform:share',
    RAID: 'platform:raid',
    ENVELOPE: 'platform:envelope',
    STREAM_STATUS: 'platform:stream-status',
    STREAM_DETECTED: 'platform:stream-detected'
} as const;

const PLATFORM_CONFIG_KEYS = ['twitch', 'youtube', 'tiktok', 'streamelements'] as const;

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

type LifecycleRecord = Record<string, unknown>;

type PlatformLifecycleLogger = {
    debug: (message: string, scope: string, data?: unknown) => void;
    info: (message: string, scope: string, data?: unknown) => void;
    warn: (message: string, scope: string, data?: unknown) => void;
};

type PlatformEventBus = {
    emit: (eventName: string, payload: unknown) => void;
};

type PlatformEventHandlers = {
    onChat: (data: unknown) => void;
    onViewerCount: (data: unknown) => void;
    onGift: (data: unknown) => void;
    onPaypiggy: (data: unknown) => void;
    onGiftPaypiggy: (data: unknown) => void;
    onFollow: (data: unknown) => void;
    onShare: (data: unknown) => void;
    onRaid: (data: unknown) => void;
    onEnvelope: (data: unknown) => void;
    onStreamStatus: (data: unknown) => void;
    onStreamDetected: (data: unknown) => void;
    onConnection: (data: unknown) => void;
};

type PlatformEventHandlerMap = Record<string, PlatformEventHandlers> & {
    default?: PlatformEventHandlers;
};

type PlatformConfig = LifecycleRecord & {
    enabled?: unknown;
    username?: unknown;
};

type PlatformLifecycleOptions = {
    config?: Record<string, PlatformConfig>;
    eventBus?: PlatformEventBus | null;
    dependencyFactory?: Record<string, unknown>;
    logger?: PlatformLifecycleLogger;
    sharedDependencies?: LifecycleRecord;
    handlerFactory?: ((platformName: string) => PlatformEventHandlers | null | undefined) | null;
};

type PlatformInstance = {
    initialize: (handlers: PlatformEventHandlers) => Promise<unknown> | unknown;
    cleanup?: () => Promise<void> | void;
    [key: string]: unknown;
};

type PlatformConstructor = new (config: PlatformConfig, dependencies?: unknown) => PlatformInstance;

type PlatformHealthEntry = {
    state: string;
    attempts: number;
    failures: number;
    lastUpdated: string | null;
    lastError: string | null;
    lastConnection: string | null;
};

class PlatformLifecycleService {
    config: Record<string, PlatformConfig> | undefined;
    eventBus: PlatformEventBus | null;
    dependencyFactory: Record<string, unknown> | undefined;
    logger: PlatformLifecycleLogger;
    errorHandler: ReturnType<typeof createPlatformErrorHandler>;
    sharedDependencies: LifecycleRecord;
    handlerFactory: ((platformName: string) => PlatformEventHandlers | null | undefined) | null;
    platforms: Record<string, PlatformInstance>;
    platformConnectionTimes: Record<string, number>;
    backgroundPlatformInits: Array<{ platform: string; promise: Promise<unknown> }>;
    platformHealth: Record<string, PlatformHealthEntry>;
    platformErrors: Array<{ platform: string; message: string; timestamp: string }>;
    shutdownRequested: boolean;

    constructor(options: PlatformLifecycleOptions = {}) {
        this.config = options.config;
        this.eventBus = options.eventBus || null;
        this.dependencyFactory = options.dependencyFactory;
        this.logger = options.logger || logger;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'PlatformLifecycleService');
        this.sharedDependencies = options.sharedDependencies || {};
        this.handlerFactory = options.handlerFactory || null;

        // Track platform instances
        this.platforms = {};
        this.platformConnectionTimes = {};
        this.backgroundPlatformInits = [];
        this.platformHealth = {};
        this.platformErrors = [];
        this.shutdownRequested = false;

        this.logger.debug('PlatformLifecycleService initialized', 'PlatformLifecycleService');
    }

    async initializeAllPlatforms(platformModules: Record<string, PlatformConstructor>, eventHandlers: PlatformEventHandlerMap | null = null) {
        this.shutdownRequested = false;
        this.logger.info('Initializing platform connections...', 'PlatformLifecycleService');

        const initTasks = Object.entries(platformModules || {}).map(([platformName, PlatformClass]) =>
            this.initializePlatform(platformName, PlatformClass, eventHandlers)
        );

        await Promise.allSettled(initTasks);

        this.logger.debug('Platform initialization loop completed', 'PlatformLifecycleService');
        return this.platforms;
    }

    async initializePlatform(platformName: string, PlatformClass: PlatformConstructor, eventHandlers: PlatformEventHandlerMap | null = null) {
        this.logger.debug(`Processing platform: ${platformName}`, 'PlatformLifecycleService');
        const platformConfig = this.config?.[platformName];

        this.ensurePlatformHealthEntry(platformName);

        if (!platformConfig || !platformConfig.enabled) {
            this.logger.debug(`Skipping platform: ${platformName} (disabled or not configured)`, 'PlatformLifecycleService');
            this.updatePlatformHealth(platformName, { state: 'disabled' });
            return;
        }

        this.logger.debug(`Platform ${platformName} is enabled, initializing...`, 'PlatformLifecycleService');
        this.updatePlatformHealth(platformName, { state: 'initializing' });

        try {
            if (platformName === 'youtube' && !platformConfig.username) {
                this._handleLifecycleError('YouTube is enabled but no username is provided in config.ini.', null, 'configuration');
                this.updatePlatformHealth(platformName, {
                    state: 'failed',
                    lastError: 'Missing username'
                });
                return;
            }

            const configCopy: PlatformConfig = { ...platformConfig };

            const platformInstance = await this.createPlatformInstance(
                platformName,
                PlatformClass,
                configCopy
            );

            this.platforms[platformName] = platformInstance;
            this.logger.debug(`Platform ${platformName} added to platforms object`, 'PlatformLifecycleService');

            const handlers = this.resolveEventHandlers(platformName, eventHandlers);

            this.logger.info(`Initializing platform ${platformName}...`, 'PlatformLifecycleService');

            await this.initializePlatformConnection(
                platformName,
                platformInstance,
                handlers,
                configCopy
            );

            this.logger.info(`Platform ${platformName} initialized`, 'PlatformLifecycleService');
        } catch (error) {
            this._handleLifecycleError(`Failed to initialize platform ${platformName}: ${getErrorMessage(error)}`, error, 'initialize');
            this.markPlatformFailure(platformName, error);
        }
    }

    resolveEventHandlers(platformName: string, providedHandlers: PlatformEventHandlerMap | null) {
        if (providedHandlers) {
            if (providedHandlers[platformName]) {
                return providedHandlers[platformName];
            }
            if (providedHandlers.default) {
                return providedHandlers.default;
            }
        }

        if (typeof this.handlerFactory === 'function') {
            const factoryHandlers = this.handlerFactory(platformName);
            if (factoryHandlers) {
                return factoryHandlers;
            }
        }

        return this.createDefaultEventHandlers(platformName);
    }

    createDefaultEventHandlers(platformName: string): PlatformEventHandlers {
        const handlers: PlatformEventHandlers = {
            onChat: (data) => this.emitPlatformEvent(platformName, PlatformEvents.CHAT_MESSAGE, data),
            onViewerCount: (data) => {
                if (typeof data === 'number') {
                    this.logger.warn(`Viewer count missing timestamp for ${platformName}`, 'PlatformLifecycleService', {
                        count: data
                    });
                    return;
                }
                this.emitPlatformEvent(platformName, PlatformEvents.VIEWER_COUNT, data);
            },
            onGift: (data) => this.emitPlatformEvent(platformName, PlatformEvents.GIFT, data),
            onPaypiggy: (data) => this.emitPlatformEvent(platformName, PlatformEvents.PAYPIGGY, data),
            onGiftPaypiggy: (data) => this.emitPlatformEvent(platformName, PlatformEvents.GIFTPAYPIGGY, data),
            onFollow: (data) => this.emitPlatformEvent(platformName, PlatformEvents.FOLLOW, data),
            onShare: (data) => this.emitPlatformEvent(platformName, PlatformEvents.SHARE, data),
            onRaid: (data) => this.emitPlatformEvent(platformName, PlatformEvents.RAID, data),
            onEnvelope: (data) => this.emitPlatformEvent(platformName, PlatformEvents.ENVELOPE, data),
            onStreamStatus: (data) => this.emitPlatformEvent(platformName, PlatformEvents.STREAM_STATUS, data),
            onStreamDetected: (data) => this.emitPlatformEvent(platformName, PlatformEvents.STREAM_DETECTED, data),
            onConnection: (data) => this.handlePlatformConnectionEvent(platformName, data)
        };

        return handlers;
    }

    handlePlatformConnectionEvent(platformName: string, data: unknown) {
        if (this.shutdownRequested) {
            return;
        }

        if (!data || typeof data !== 'object') {
            this.logger.warn('Platform connection event missing payload object', 'PlatformLifecycleService', {
                platform: platformName
            });
            return;
        }

        const payload = data as LifecycleRecord;
        const eventPlatform = this._resolveEventPlatform(platformName, data);
        const status = typeof payload.status === 'string' ? payload.status.trim() : '';
        const timestamp = this.resolveConnectionTimestamp(payload.timestamp);
        const errorMessage = this.resolveConnectionErrorMessage(payload.error);

        if (status === 'connected') {
            this.recordPlatformConnection(eventPlatform, timestamp.epochMs);
            this.updatePlatformHealth(eventPlatform, {
                state: 'ready',
                lastError: null,
                lastConnection: timestamp.iso,
                lastUpdated: timestamp.iso
            });
            return;
        }

        if (status === 'disconnected' || status === 'reconnecting') {
            this.updatePlatformHealth(eventPlatform, {
                state: 'disconnected',
                lastError: errorMessage,
                lastUpdated: timestamp.iso
            });
            return;
        }

        this.logger.warn('Unsupported platform connection status', 'PlatformLifecycleService', {
            platform: eventPlatform,
            status
        });
    }

    resolveConnectionTimestamp(rawTimestamp: unknown) {
        const isoTimestamp = typeof rawTimestamp === 'string' ? rawTimestamp : '';
        const epochMs = isoTimestamp ? Date.parse(isoTimestamp) : Number.NaN;

        if (!Number.isNaN(epochMs)) {
            return { iso: isoTimestamp, epochMs };
        }

        const fallbackIso = getSystemTimestampISO();
        return {
            iso: fallbackIso,
            epochMs: Date.parse(fallbackIso)
        };
    }

    resolveConnectionErrorMessage(rawError: unknown) {
        if (!rawError) {
            return null;
        }

        if (rawError instanceof Error) {
            return rawError.message;
        }

        if (typeof rawError === 'object' && rawError !== null) {
            const errorRecord = rawError as LifecycleRecord;
            const errorMessage = typeof errorRecord.message === 'string' ? errorRecord.message.trim() : '';
            return errorMessage || getErrorMessage(rawError);
        }

        return getErrorMessage(rawError);
    }

    emitPlatformEvent(platformName: string, type: string, data: unknown) {
        if (!this.eventBus || typeof this.eventBus.emit !== 'function') {
            this.logger.debug(`EventBus unavailable for platform event ${type}`, 'PlatformLifecycleService');
            return;
        }

        const eventPlatform = this._resolveEventPlatform(platformName, data);
        const sanitizedData = this._sanitizePlatformEventData(eventPlatform, type, data);
        const requiresTimestamp: Set<string> = new Set([
            PlatformEvents.CHAT_MESSAGE,
            PlatformEvents.FOLLOW,
            PlatformEvents.SHARE,
            PlatformEvents.PAYPIGGY,
            PlatformEvents.GIFTPAYPIGGY,
            PlatformEvents.GIFT,
            PlatformEvents.ENVELOPE,
            PlatformEvents.RAID,
            PlatformEvents.VIEWER_COUNT,
            PlatformEvents.STREAM_STATUS
        ]);

        if (requiresTimestamp.has(type)) {
            const sanitizedRecord = sanitizedData && typeof sanitizedData === 'object'
                ? (sanitizedData as LifecycleRecord)
                : null;
            if (!sanitizedRecord || !sanitizedRecord.timestamp) {
                this.logger.warn(`Platform event missing timestamp: ${type}`, 'PlatformLifecycleService', {
                    platform: eventPlatform
                });
                return;
            }
        }

        this.eventBus.emit('platform:event', {
            platform: eventPlatform,
            type,
            data: sanitizedData
        });
    }

    _resolveEventPlatform(defaultPlatform: string, data: unknown) {
        if (defaultPlatform !== 'streamelements') {
            return defaultPlatform;
        }

        if (!data || typeof data !== 'object') {
            return defaultPlatform;
        }

        const payload = data as LifecycleRecord;
        const payloadPlatform = typeof payload.platform === 'string' ? payload.platform.trim() : '';
        return payloadPlatform || defaultPlatform;
    }

    _sanitizePlatformEventData(platformName: string, type: string, data: unknown) {
        if (!data || typeof data !== 'object') {
            return data;
        }

        const payload = data as LifecycleRecord;
        const { type: originalType, platform: originalPlatform, ...rest } = payload;

        if (originalType && originalType !== type) {
            rest.sourceType = originalType;
        }
        if (originalPlatform && originalPlatform !== platformName) {
            rest.sourcePlatform = originalPlatform;
        }

        return rest;
    }

    async createPlatformInstance(platformName: string, PlatformClass: PlatformConstructor, config: PlatformConfig) {
        // Validate inputs
        if (!PlatformClass || typeof PlatformClass !== 'function') {
            throw new Error(`Invalid PlatformClass for ${platformName}`);
        }

        let instance;

        if (!this.dependencyFactory) {
            // Fallback: create without dependencies
            this.logger.warn(`No dependency factory available, creating ${platformName} without DI`, 'PlatformLifecycleService');
            instance = new PlatformClass(config);
        } else {
            // Check if factory has method for this platform
            const factoryMethodName = `create${platformName.charAt(0).toUpperCase() + platformName.slice(1)}Dependencies`;

            const factoryCandidate = this.dependencyFactory[factoryMethodName];
            if (typeof factoryCandidate !== 'function') {
                this.logger.debug(`No factory method ${factoryMethodName}, creating ${platformName} without DI`, 'PlatformLifecycleService');
                instance = new PlatformClass(config);
            } else {
                const dependencies = factoryCandidate.call(this.dependencyFactory, config, this.sharedDependencies);

                this.logger.debug(`${platformName} platform instance created via factory`, 'PlatformLifecycleService');
                instance = new PlatformClass(config, dependencies);
            }
        }

        assertPlatformInterface(platformName, instance);
        return instance;
    }

    async initializePlatformConnection(platformName: string, platformInstance: PlatformInstance, handlers: PlatformEventHandlers, platformConfig: PlatformConfig) {
        const connectCallback = async () => {
            this.logger.info(`Connecting to ${platformName}...`, 'PlatformLifecycleService');

            await platformInstance.initialize(handlers);

            this.markPlatformReady(platformName);

            return platformInstance;
        };

        // Manage platform connection behavior
        try {
            const shouldRunInBackground = this.shouldRunPlatformInBackground(platformName, platformConfig);

            if (shouldRunInBackground) {
                this.logger.info(`Initializing ${platformName} in background (non-blocking)`, 'PlatformLifecycleService');

                let backgroundInit: Promise<void>;
                backgroundInit = this.initializePlatformAsync(
                    platformName,
                    connectCallback
                ).finally(() => {
                    this.backgroundPlatformInits = this.backgroundPlatformInits.filter((entry) => entry.promise !== backgroundInit);
                });

                this.backgroundPlatformInits.push({
                    platform: platformName,
                    promise: backgroundInit
                });
                return;
            }

            // Normal blocking initialization for platforms that connect quickly
            if (platformName === 'tiktok') {
                this.logger.info(`Using TikTok platform's built-in stream detection`, 'PlatformLifecycleService');
                await connectCallback();
                return;
            }
            if (platformName === 'youtube') {
                this.logger.info(`Using YouTube platform-managed stream monitoring`, 'PlatformLifecycleService');
                await connectCallback();
                return;
            }
            if (platformName === 'twitch') {
                this.logger.info('Using Twitch chat direct connection (no stream detection)', 'PlatformLifecycleService');
                await connectCallback();
                return;
            }

            await connectCallback();
        } catch (error) {
            this._handleLifecycleError(`Failed to initialize connection for ${platformName}: ${getErrorMessage(error)}`, error, 'initialize');
            throw error;
        }
    }

    shouldRunPlatformInBackground(platformName: string, platformConfig: PlatformConfig) {
        // TikTok blocks waiting for stream to go live
        if (platformName === 'tiktok') {
            return true;
        }

        // Add other platforms that might block here
        return false;
    }

    async initializePlatformAsync(platformName: string, connectCallback: () => Promise<PlatformInstance>) {
        try {
            this.logger.info(`[${platformName}] Background initialization started`, 'PlatformLifecycleService');

            if (platformName === 'tiktok') {
                // TikTok uses its own built-in stream detection
                await connectCallback();
            } else {
                await connectCallback();
            }

            this.logger.info(`[${platformName}] Background initialization completed successfully`, 'PlatformLifecycleService');
        } catch (error) {
            this._handleLifecycleError(`[${platformName}] Background initialization failed: ${getErrorMessage(error)}`, error, 'background-init');
            this.markPlatformFailure(platformName, error);
            // Don't rethrow - let other systems continue
        }
    }

    recordPlatformConnection(platformName: string, timestampMs = Date.now()) {
        this.platformConnectionTimes[platformName] = timestampMs;
        this.logger.debug(`Platform ${platformName} connection time recorded`, 'PlatformLifecycleService');
    }

    getPlatformConnectionTime(platformName: string) {
        return this.platformConnectionTimes[platformName] || null;
    }

    isPlatformAvailable(platformName: string) {
        return !!this.platforms[platformName];
    }

    getPlatform(platformName: string) {
        return this.platforms[platformName] || null;
    }

    getAllPlatforms() {
        return { ...this.platforms };
    }

    async waitForBackgroundInits(timeoutMs = 30000) {
        if (this.backgroundPlatformInits.length === 0) {
            return;
        }

        this.logger.info('Waiting for background platform initializations to complete...', 'PlatformLifecycleService');

        const timeout = safeDelay(timeoutMs, timeoutMs, 'platformLifecycle:backgroundInitWait');
        const allInits = Promise.allSettled(
            this.backgroundPlatformInits.map(init => init.promise)
        );

        await Promise.race([allInits, timeout]);
    }

    getStatus() {
        const platformNames = Object.keys(this.platformHealth);
        const ready = platformNames.filter((name) => this.platformHealth[name].state === 'ready');
        const initializing = platformNames.filter((name) => this.platformHealth[name].state === 'initializing');
        const failed = platformNames.filter((name) => this.platformHealth[name].state === 'failed');
        const disabled = platformNames.filter((name) => this.platformHealth[name].state === 'disabled');
        const totalConfigured = PLATFORM_CONFIG_KEYS
            .filter((platformName) => this.config?.[platformName] && typeof this.config[platformName] === 'object')
            .length;

        return {
            timestamp: getSystemTimestampISO(),
            totalConfigured,
            registeredPlatforms: Object.keys(this.platforms),
            initializedPlatforms: ready,
            initializingPlatforms: initializing,
            failedPlatforms: failed.map((name) => ({
                name,
                lastError: this.platformHealth[name].lastError || null,
                failures: this.platformHealth[name].failures || 0,
                lastUpdated: this.platformHealth[name].lastUpdated
            })),
            disabledPlatforms: disabled,
            platformHealth: { ...this.platformHealth },
            connectionTimes: { ...this.platformConnectionTimes },
            backgroundInitializations: this.backgroundPlatformInits.length,
            recentErrors: this.platformErrors.slice(-10)
        };
    }

    ensurePlatformHealthEntry(platformName: string): PlatformHealthEntry {
        if (!this.platformHealth[platformName]) {
            this.platformHealth[platformName] = {
                state: 'unknown',
                attempts: 0,
                failures: 0,
                lastUpdated: null,
                lastError: null,
                lastConnection: null
            };
        }
        return this.platformHealth[platformName];
    }

    updatePlatformHealth(platformName: string, patch: Partial<PlatformHealthEntry> = {}): PlatformHealthEntry {
        const current = this.ensurePlatformHealthEntry(platformName);
        const next = {
            ...current,
            ...patch
        };

        if (patch.state === 'initializing') {
            next.attempts = (current.attempts || 0) + 1;
        } else if (!('attempts' in patch)) {
            next.attempts = current.attempts || 0;
        }

        if (patch.state === 'failed') {
            next.failures = (current.failures || 0) + 1;
        } else if (!('failures' in patch)) {
            next.failures = current.failures || 0;
        }

        next.lastUpdated = patch.lastUpdated || getSystemTimestampISO();

        this.platformHealth[platformName] = next;
        return next;
    }

    markPlatformReady(platformName: string) {
        if (this.shutdownRequested) {
            return;
        }
        if (this.platformHealth[platformName]?.state === 'ready') {
            return;
        }

        const timestamp = getSystemTimestampISO();
        this.recordPlatformConnection(platformName);

        this.updatePlatformHealth(platformName, {
            state: 'ready',
            lastError: null,
            lastConnection: timestamp,
            lastUpdated: timestamp
        });

    }

    markPlatformFailure(platformName: string, error: unknown) {
        const timestamp = getSystemTimestampISO();
        const errorMessage = getErrorMessage(error);
        this.platformErrors.push({
            platform: platformName,
            message: errorMessage,
            timestamp
        });

        delete this.platforms[platformName];
        delete this.platformConnectionTimes[platformName];

        this.updatePlatformHealth(platformName, {
            state: 'failed',
            lastError: errorMessage,
            lastUpdated: timestamp
        });
    }

    async disconnectAll() {
        this.logger.info('Cleaning up all platforms...', 'PlatformLifecycleService');
        this.shutdownRequested = true;

        // Wait for any background initializations to complete
        await this.waitForBackgroundInits(10000);

        // Disconnect from all platforms
        for (const platformName in this.platforms) {
            let cleanupError: unknown = null;
            try {
                const platform = this.platforms[platformName];
                if (platform && typeof platform.cleanup === 'function') {
                    await platform.cleanup();
                    this.logger.info(`Cleaned up ${platformName}`, 'PlatformLifecycleService');
                } else {
                    cleanupError = new Error(`Platform ${platformName} is missing cleanup()`);
                    this._handleLifecycleError(`Unable to cleanup ${platformName}: cleanup() missing`, cleanupError, 'cleanup');
                }
            } catch (error) {
                cleanupError = error;
                this._handleLifecycleError(`Error disconnecting from ${platformName}: ${getErrorMessage(error)}`, error, 'disconnect');
            } finally {
                delete this.platforms[platformName];
                delete this.platformConnectionTimes[platformName];

                if (cleanupError) {
                    this.updatePlatformHealth(platformName, {
                        state: 'failed',
                        lastError: getErrorMessage(cleanupError),
                        lastUpdated: getSystemTimestampISO()
                    });
                } else {
                    this.updatePlatformHealth(platformName, {
                        state: 'disconnected',
                        lastError: null,
                        lastUpdated: getSystemTimestampISO()
                    });
                }
            }
        }
    }

    dispose() {
        // Clear platform references
        this.platforms = {};
        this.platformConnectionTimes = {};
        this.backgroundPlatformInits = [];
        this.platformHealth = {};
        this.platformErrors = [];
        this.shutdownRequested = false;

        this.logger.debug('PlatformLifecycleService disposed', 'PlatformLifecycleService');
    }

    _handleLifecycleError(message: string, error: unknown, eventType = 'lifecycle') {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, eventType, null, message);
        } else {
            this.errorHandler?.logOperationalError(message, 'PlatformLifecycleService', error);
        }
    }
}

export { PlatformLifecycleService };
