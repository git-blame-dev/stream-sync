import type { AppLogger } from '../core/logger/types';
import { logger } from '../core/logging';
import { safeDelay } from '../utils/timeout-validator';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { assertPlatformInterface } from '../utils/platform-interface-validator';
import { getSystemTimestampISO } from '../utils/timestamp';
import type { PlatformInitializationOutcome } from '../interfaces/PlatformLifecycle';

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

type PlatformLifecycleLogger = Pick<AppLogger<string>, 'debug' | 'info' | 'warn'>;

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

type DependencyFactoryMethod = (config: PlatformConfig, sharedDependencies?: LifecycleRecord) => unknown;

type PlatformDependencyFactory = {
    createYoutubeDependencies?: DependencyFactoryMethod;
    createTiktokDependencies?: DependencyFactoryMethod;
    createTwitchDependencies?: DependencyFactoryMethod;
    createStreamelementsDependencies?: DependencyFactoryMethod;
};

type PlatformLifecycleOptions = {
    config?: Record<string, PlatformConfig>;
    eventBus?: PlatformEventBus | null;
    dependencyFactory?: PlatformDependencyFactory | null;
    logger?: PlatformLifecycleLogger;
    sharedDependencies?: LifecycleRecord;
    handlerFactory?: ((platformName: string) => PlatformEventHandlers | null | undefined) | null;
};

type PlatformInstance = {
    initialize: (handlers: PlatformEventHandlers) => Promise<unknown> | unknown;
    on: (eventName: string, handler: (...args: unknown[]) => unknown) => unknown;
    cleanup: () => Promise<void> | void;
    getViewerCount?: () => Promise<unknown> | unknown;
    getStatus?: () => unknown;
    isConnected?: () => boolean;
    isActive?: () => boolean;
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

function isPlatformInitializationOutcome(value: unknown): value is PlatformInitializationOutcome {
    if (!value || typeof value !== 'object' || !('state' in value)) {
        return false;
    }

    return value.state === 'ready' || value.state === 'monitoring' || value.state === 'recovering';
}

class PlatformLifecycleService {
    config: Record<string, PlatformConfig> | undefined;
    eventBus: PlatformEventBus | null;
    dependencyFactory: PlatformDependencyFactory | null;
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
    platformCleanupPromises: Map<PlatformInstance, Promise<void>>;

    private disconnectPromise: Promise<void> | null = null;

    constructor(options: PlatformLifecycleOptions = {}) {
        this.config = options.config;
        this.eventBus = options.eventBus || null;
        this.dependencyFactory = options.dependencyFactory ?? null;
        this.logger = options.logger || logger;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'platform-lifecycle-service');
        this.sharedDependencies = options.sharedDependencies || {};
        this.handlerFactory = options.handlerFactory || null;

        this.platforms = {};
        this.platformConnectionTimes = {};
        this.backgroundPlatformInits = [];
        this.platformHealth = {};
        this.platformErrors = [];
        this.shutdownRequested = false;
        this.platformCleanupPromises = new Map();

    }

    async initializeAllPlatforms(platformModules: Record<string, PlatformConstructor>, eventHandlers: PlatformEventHandlerMap | null = null) {
        this.shutdownRequested = false;

        const initTasks = Object.entries(platformModules || {}).map(([platformName, PlatformClass]) =>
            this.initializePlatform(platformName, PlatformClass, eventHandlers)
        );

        await Promise.allSettled(initTasks);

        return this.platforms;
    }

    async initializePlatform(platformName: string, PlatformClass: PlatformConstructor, eventHandlers: PlatformEventHandlerMap | null = null) {

        const platformConfig = this.config?.[platformName];

        this.ensurePlatformHealthEntry(platformName);

        if (!platformConfig || !platformConfig.enabled) {

            this.updatePlatformHealth(platformName, { state: 'disabled' });
            return;
        }

        this.updatePlatformHealth(platformName, { state: 'initializing' });

        // Only an adopted instance belongs to this attempt. A failed construction
        // must not acquire ownership of a session registered while it was pending.
        let adoptedInstance: PlatformInstance | undefined;
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

            if (this.shutdownRequested) {
                await this.cleanupPlatformInstance(platformInstance);
                return;
            }

            if (platformName === 'twitch' && !this.isTwitchAuthReady()) {
                await this.cleanupPlatformInstance(platformInstance);
                throw new Error('Twitch authentication is unavailable');
            }

            this.platforms[platformName] = platformInstance;
            adoptedInstance = platformInstance;

            const handlers = this.resolveEventHandlers(platformName, eventHandlers);

            await this.initializePlatformConnection(
                platformName,
                platformInstance,
                handlers,
                configCopy
            );

        } catch (error) {
            this._handleLifecycleError(`Failed to initialize platform ${platformName}: ${getErrorMessage(error)}`, error, 'initialize');
            await this.markPlatformFailure(platformName, error, { expectedInstance: adoptedInstance });
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
                    this.logger.warn(`Viewer count missing timestamp for ${platformName}`, 'platform-lifecycle-service', {
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
            this.logger.warn('Platform connection event missing payload object', 'platform-lifecycle-service', {
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

        if (status === 'reconnecting' || (status === 'disconnected' && payload.willReconnect === true)) {
            this.updatePlatformHealth(eventPlatform, {
                state: 'recovering',
                lastError: errorMessage,
                lastUpdated: timestamp.iso
            });
            return;
        }

        if (status === 'disconnected') {
            this.updatePlatformHealth(eventPlatform, {
                state: 'disconnected',
                lastError: errorMessage,
                lastUpdated: timestamp.iso
            });
            return;
        }

        if (status === 'failed') {
            this.updatePlatformHealth(eventPlatform, {
                state: 'failed',
                lastError: errorMessage,
                lastUpdated: timestamp.iso
            });
            return;
        }

        this.logger.warn('Unsupported platform connection status', 'platform-lifecycle-service', {
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
            this.logger.debug(`EventBus unavailable for platform event ${type}`, 'platform-lifecycle-service');
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
                this.logger.warn(`Platform event missing timestamp: ${type}`, 'platform-lifecycle-service', {
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
        if (!PlatformClass || typeof PlatformClass !== 'function') {
            throw new Error(`Invalid PlatformClass for ${platformName}`);
        }

        let instance: PlatformInstance | undefined;
        let localYoutubeDetection: unknown;
        try {
            if (!this.dependencyFactory) {
                this.logger.warn(`No dependency factory available, creating ${platformName} without DI`, 'platform-lifecycle-service');
                instance = new PlatformClass(config);
            } else {
                const factoryMethod = this.getDependencyFactoryMethod(platformName);
                if (!factoryMethod) {

                    instance = new PlatformClass(config);
                } else {
                    const dependencies = factoryMethod.call(this.dependencyFactory, config, this.sharedDependencies);
                    if (platformName === 'youtube' && dependencies && typeof dependencies === 'object' && 'streamDetectionService' in dependencies) {
                        const detector = dependencies.streamDetectionService;
                        if (detector !== this.sharedDependencies.streamDetectionService) localYoutubeDetection = detector;
                    }

                    instance = new PlatformClass(config, dependencies);
                }
            }

            assertPlatformInterface(platformName, instance);
            return instance;
        } catch (error) {
            await this.retireProvisionalPlatformResource(platformName, 'instance', instance);
            // A failed constructor cannot retire its fresh detection domain. Even
            // malformed instance cleanup may omit it or fail before reaching it.
            // Domain cleanup is idempotent; the borrowed root SDK owner is untouched.
            if (localYoutubeDetection !== instance) {
                await this.retireProvisionalPlatformResource(platformName, 'detection', localYoutubeDetection);
            }
            throw error;
        }
    }

    private async retireProvisionalPlatformResource(platformName: string, resourceName: string, resource: unknown): Promise<void> {
        try {
            if (resource && typeof resource === 'object' && 'cleanup' in resource && typeof resource.cleanup === 'function') {
                await resource.cleanup();
            }
        } catch (error) {
            try {
                this._handleLifecycleError(`Failed to retire provisional ${platformName} ${resourceName}`, error, 'construction-cleanup');
            } catch {
                // Cleanup and diagnostics must preserve the original construction
                // failure and must not skip the remaining attempt-local resource.
            }
        }
    }

    getDependencyFactoryMethodName(platformName: string) {
        return `create${platformName.charAt(0).toUpperCase() + platformName.slice(1)}Dependencies`;
    }

    getDependencyFactoryMethod(platformName: string): DependencyFactoryMethod | null {
        if (!this.dependencyFactory) {
            return null;
        }

        const factoryMethod = Reflect.get(
            this.dependencyFactory,
            this.getDependencyFactoryMethodName(platformName)
        );

        return typeof factoryMethod === 'function' ? factoryMethod as DependencyFactoryMethod : null;
    }

    async initializePlatformConnection(platformName: string, platformInstance: PlatformInstance, handlers: PlatformEventHandlers, platformConfig: PlatformConfig) {
        const connectCallback = async () => {

            const outcome = await platformInstance.initialize(handlers);
            if (this.platforms[platformName] !== platformInstance) return platformInstance;
            if (platformName === 'twitch' && !this.isTwitchAuthReady()) {
                await this.markPlatformFailure(platformName, new Error('Twitch authentication is unavailable'), { expectedInstance: platformInstance });
                return platformInstance;
            }
            this.applyPlatformInitializationOutcome(platformName, outcome);

            return platformInstance;
        };

        try {
            const shouldRunInBackground = this.shouldRunPlatformInBackground(platformName, platformConfig);

            if (shouldRunInBackground) {

                let backgroundInit: Promise<void>;
                backgroundInit = this.initializePlatformAsync(
                    platformName,
                    connectCallback,
                    platformInstance
                ).finally(() => {
                    this.backgroundPlatformInits = this.backgroundPlatformInits.filter((entry) => entry.promise !== backgroundInit);
                });

                this.backgroundPlatformInits.push({
                    platform: platformName,
                    promise: backgroundInit
                });
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

        return false;
    }

    async initializePlatformAsync(platformName: string, connectCallback: () => Promise<PlatformInstance>, expectedInstance = this.platforms[platformName]) {
        try {
            await connectCallback();

        } catch (error) {
            // Shutdown already owns cleanup and its health outcome. Cancellation
            // of initialization must not start another cleanup or overwrite it.
            if (this.shutdownRequested) return;
            this._handleLifecycleError(`[${platformName}] Background initialization failed: ${getErrorMessage(error)}`, error, 'background-init');
            await this.markPlatformFailure(platformName, error, { expectedInstance });
        }
    }

    recordPlatformConnection(platformName: string, timestampMs = Date.now()) {
        this.platformConnectionTimes[platformName] = timestampMs;

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

        const abort = new AbortController();
        const timeout = safeDelay(timeoutMs, timeoutMs, 'platformLifecycle:backgroundInitWait', abort.signal);
        const allInits = Promise.allSettled(
            this.backgroundPlatformInits.map(init => init.promise)
        );

        try {
            await Promise.race([allInits, timeout]);
        } finally {
            abort.abort();
        }
    }

    getStatus() {
        const platformNames = Object.keys(this.platformHealth);
        const getHealthEntry = (name: string) => this.platformHealth[name] ?? this.ensurePlatformHealthEntry(name);
        const ready = platformNames.filter((name) => getHealthEntry(name).state === 'ready');
        const monitoring = platformNames.filter((name) => getHealthEntry(name).state === 'monitoring');
        const recovering = platformNames.filter((name) => getHealthEntry(name).state === 'recovering');
        const initializing = platformNames.filter((name) => getHealthEntry(name).state === 'initializing');
        const failed = platformNames.filter((name) => getHealthEntry(name).state === 'failed');
        const disabled = platformNames.filter((name) => getHealthEntry(name).state === 'disabled');
        const totalConfigured = PLATFORM_CONFIG_KEYS
            .filter((platformName) => this.config?.[platformName] && typeof this.config[platformName] === 'object')
            .length;

        return {
            timestamp: getSystemTimestampISO(),
            totalConfigured,
            registeredPlatforms: Object.keys(this.platforms),
            initializedPlatforms: [...ready, ...monitoring],
            monitoringPlatforms: monitoring,
            recoveringPlatforms: recovering.map((name) => ({
                name,
                lastError: getHealthEntry(name).lastError || null,
                failures: getHealthEntry(name).failures || 0,
                lastUpdated: getHealthEntry(name).lastUpdated
            })),
            initializingPlatforms: initializing,
            failedPlatforms: failed.map((name) => ({
                name,
                lastError: getHealthEntry(name).lastError || null,
                failures: getHealthEntry(name).failures || 0,
                lastUpdated: getHealthEntry(name).lastUpdated
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

    applyPlatformInitializationOutcome(platformName: string, outcome: unknown) {
        if (this.shutdownRequested || !this.platforms[platformName]) {
            return;
        }

        if (!isPlatformInitializationOutcome(outcome) || outcome.state === 'ready') {
            this.markPlatformReady(platformName);
            return;
        }

        this.updatePlatformHealth(platformName, {
            state: outcome.state,
            lastError: outcome.state === 'recovering' ? getErrorMessage(outcome.error) : null
        });

        if (outcome.state === 'recovering') {
            this.logger.warn(
                `${platformName} initialized in recovering state`,
                'platform-lifecycle-service',
                outcome.error
            );
        }
    }

    private isTwitchAuthReady(): boolean {
        const auth = this.sharedDependencies.twitchAuth;
        return !auth || typeof auth !== 'object' || !('isReady' in auth) ||
            typeof auth.isReady !== 'function' || auth.isReady() === true;
    }

    async markPlatformFailure(platformName: string, error: unknown, options?: { expectedInstance: { getViewerCount?: () => Promise<unknown> | unknown } | undefined; signal?: AbortSignal }): Promise<void> {
        if (options?.signal?.aborted || (options && this.platforms[platformName] !== options.expectedInstance)) return;
        const timestamp = getSystemTimestampISO();
        const errorMessage = getErrorMessage(error);
        this.platformErrors.push({
            platform: platformName,
            message: errorMessage,
            timestamp
        });

        const platform = this.platforms[platformName];
        if (platform) {
            try {
                await this.cleanupPlatformInstance(platform);
            } catch (cleanupError) {
                try {
                    this._handleLifecycleError(
                        `Error cleaning up failed platform ${platformName}: ${getErrorMessage(cleanupError)}`,
                        cleanupError,
                        'cleanup'
                    );
                } catch {
                    // Reporting must not strand the failed instance or its health.
                }
            }
        }

        if (this.platforms[platformName] !== platform) {
            return;
        }

        delete this.platforms[platformName];
        delete this.platformConnectionTimes[platformName];

        if (this.shutdownRequested) {
            this.updatePlatformHealth(platformName, {
                state: 'disconnected',
                lastError: null,
                lastUpdated: getSystemTimestampISO()
            });
            return;
        }

        this.updatePlatformHealth(platformName, {
            state: 'failed',
            lastError: errorMessage,
            lastUpdated: timestamp
        });
    }

    disconnectAll(): Promise<void> {
        if (this.disconnectPromise) return this.disconnectPromise;
        const stopping = this.retireAllPlatforms().finally(() => {
            if (this.disconnectPromise === stopping) this.disconnectPromise = null;
        });
        this.disconnectPromise = stopping;
        return stopping;
    }

    private async retireAllPlatforms() {

        this.shutdownRequested = true;

        // Admit every owner's cancellation before joining any slow cleanup.
        const retirements = Object.entries(this.platforms).map(async ([platformName, platform]) => {
            let cleanupError: unknown = null;
            try {
                if (platform && typeof platform.cleanup === 'function') {
                    await this.cleanupPlatformInstance(platform);

                } else {
                    cleanupError = new Error(`Platform ${platformName} is missing cleanup()`);
                    this._handleLifecycleError(`Unable to cleanup ${platformName}: cleanup() missing`, cleanupError, 'cleanup');
                }
            } catch (error) {
                cleanupError = error;
                this._handleLifecycleError(`Error disconnecting from ${platformName}: ${getErrorMessage(error)}`, error, 'disconnect');
            } finally {
                if (this.platforms[platformName] !== platform) return;
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
        });
        await Promise.allSettled(retirements);
        await this.waitForBackgroundInits(10000);
    }

    private cleanupPlatformInstance(platform: PlatformInstance): Promise<void> {
        const existingCleanup = this.platformCleanupPromises.get(platform);
        if (existingCleanup) {
            return existingCleanup;
        }

        const cleanupPromise = Promise.resolve()
            .then(() => platform.cleanup())
            .finally(() => {
                if (this.platformCleanupPromises.get(platform) === cleanupPromise) {
                    this.platformCleanupPromises.delete(platform);
                }
            });
        this.platformCleanupPromises.set(platform, cleanupPromise);
        return cleanupPromise;
    }

    dispose() {
        this.platforms = {};
        this.platformConnectionTimes = {};
        this.backgroundPlatformInits = [];
        this.platformHealth = {};
        this.platformErrors = [];
        this.shutdownRequested = false;
        this.platformCleanupPromises.clear();

    }

    _handleLifecycleError(message: string, error: unknown, eventType = 'lifecycle') {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, eventType, null, message);
        } else {
            this.errorHandler?.logOperationalError(message, 'platform-lifecycle-service', error);
        }
    }
}

export { PlatformLifecycleService };
export type {
    PlatformConfig,
    PlatformConstructor,
    PlatformDependencyFactory,
    PlatformEventHandlerMap,
    PlatformEventHandlers,
    PlatformInstance,
    PlatformLifecycleOptions
};
