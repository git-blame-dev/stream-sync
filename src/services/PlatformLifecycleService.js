
const { logger } = require('../core/logging');
const { safeDelay } = require('../utils/timeout-validator');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { assertPlatformInterface } = require('../utils/platform-interface-validator');
const { getSystemTimestampISO } = require('../utils/timestamp');
const { PlatformEvents } = require('../interfaces/PlatformEvents');

class PlatformLifecycleService {
    constructor(options = {}) {
        this.config = options.config || {};
        this.eventBus = options.eventBus || null;
        this.streamDetector = options.streamDetector;
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
        this.streamStatuses = {};

        this.logger.debug('PlatformLifecycleService initialized', 'PlatformLifecycleService');
    }

    async initializeAllPlatforms(platformModules, eventHandlers = null) {
        this.logger.info('Initializing platform connections...', 'PlatformLifecycleService');

        for (const platformName in platformModules) {
            this.logger.debug(`Processing platform: ${platformName}`, 'PlatformLifecycleService');
            const platformConfig = this.config?.[platformName];

            this.ensurePlatformHealthEntry(platformName);

            // Skip disabled platforms
            if (!platformConfig || !platformConfig.enabled) {
                this.logger.debug(`Skipping platform: ${platformName} (disabled or not configured)`, 'PlatformLifecycleService');
                this.updatePlatformHealth(platformName, { state: 'disabled' });
                continue;
            }

            this.logger.debug(`Platform ${platformName} is enabled, initializing...`, 'PlatformLifecycleService');
            this.updatePlatformHealth(platformName, { state: 'initializing' });

            try {
                // Validate platform configuration
                if (platformName === 'youtube' && !platformConfig.username) {
                    this._handleLifecycleError('YouTube is enabled but no username is provided in config.ini.', null, 'configuration');
                    this.updatePlatformHealth(platformName, {
                        state: 'failed',
                        lastError: 'Missing username'
                    });
                    continue;
                }

                const PlatformClass = platformModules[platformName];
                const configCopy = { ...platformConfig };

                // Create platform instance with dependency injection
                const platformInstance = await this.createPlatformInstance(
                    platformName,
                    PlatformClass,
                    configCopy
                );

                this.platforms[platformName] = platformInstance;
                this.logger.debug(`Platform ${platformName} added to platforms object`, 'PlatformLifecycleService');

                // Get platform-specific event handlers
                const handlers = this.resolveEventHandlers(platformName, eventHandlers);

                this.logger.info(`Initializing platform ${platformName}...`, 'PlatformLifecycleService');

                // Initialize platform with stream detection
                await this.initializePlatformWithStreamDetection(
                    platformName,
                    platformInstance,
                    handlers,
                    configCopy
                );

                this.logger.info(`Platform ${platformName} initialized`, 'PlatformLifecycleService');

            } catch (error) {
                this._handleLifecycleError(`Failed to initialize platform ${platformName}: ${error.message}`, error, 'initialize');
                this.markPlatformFailure(platformName, error);
            }
        }

        this.logger.debug('Platform initialization loop completed', 'PlatformLifecycleService');
        return this.platforms;
    }

    resolveEventHandlers(platformName, providedHandlers) {
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

    createDefaultEventHandlers(platformName) {
        const handlers = {
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
            onStreamDetected: (data) => this.emitPlatformEvent(platformName, PlatformEvents.STREAM_DETECTED, data)
        };

        return handlers;
    }

    emitPlatformEvent(platformName, type, data) {
        if (!this.eventBus || typeof this.eventBus.emit !== 'function') {
            this.logger.debug(`EventBus unavailable for platform event ${type}`, 'PlatformLifecycleService');
            return;
        }

        const sanitizedData = this._sanitizePlatformEventData(platformName, type, data);
        const requiresTimestamp = new Set([
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
            if (!sanitizedData || typeof sanitizedData !== 'object' || !sanitizedData.timestamp) {
                this.logger.warn(`Platform event missing timestamp: ${type}`, 'PlatformLifecycleService', {
                    platform: platformName
                });
                return;
            }
        }

        this.eventBus.emit('platform:event', {
            platform: platformName,
            type,
            data: sanitizedData
        });
    }

    _sanitizePlatformEventData(platformName, type, data) {
        if (!data || typeof data !== 'object') {
            return data;
        }

        const { type: originalType, platform: originalPlatform, ...rest } = data;

        if (originalType && originalType !== type) {
            rest.sourceType = originalType;
        }
        if (originalPlatform && originalPlatform !== platformName) {
            rest.sourcePlatform = originalPlatform;
        }

        return rest;
    }

    async createPlatformInstance(platformName, PlatformClass, config) {
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

            if (typeof this.dependencyFactory[factoryMethodName] !== 'function') {
                this.logger.debug(`No factory method ${factoryMethodName}, creating ${platformName} without DI`, 'PlatformLifecycleService');
                instance = new PlatformClass(config);
            } else {
                // Create dependencies using factory with shared dependencies
                const dependencies = this.dependencyFactory[factoryMethodName](config, this.sharedDependencies);

                this.logger.debug(`${platformName} platform instance created via factory`, 'PlatformLifecycleService');
                instance = new PlatformClass(config, dependencies);
            }
        }

        assertPlatformInterface(platformName, instance);
        return instance;
    }

    async initializePlatformWithStreamDetection(platformName, platformInstance, handlers, platformConfig) {
        // Create stream-aware wrapper for the connect callback
        const connectCallback = async () => {
            this.logger.info(`Connecting to ${platformName}...`, 'PlatformLifecycleService');

            await platformInstance.initialize(handlers);

            this.markPlatformReady(platformName);

            return platformInstance;
        };

        // Create status callback for stream detection updates
        const statusCallback = (status, message) => {
            const timestamp = getSystemTimestampISO();
            const normalizedStatus = typeof status === 'string' ? status.toLowerCase() : status;
            const isLive = normalizedStatus === 'live';
            this.logger.info(`${platformName} stream status: ${status} - ${message}`, 'PlatformLifecycleService');
            this.streamStatuses[platformName] = {
                status: normalizedStatus || status,
                message,
                timestamp,
                isLive
            };

            this.emitPlatformEvent(platformName, PlatformEvents.STREAM_STATUS, {
                status: normalizedStatus || status,
                message,
                isLive,
                timestamp
            });
        };

        // Use stream detection for connection management
        try {
            const shouldRunInBackground = this.shouldRunPlatformInBackground(platformName, platformConfig);

            if (shouldRunInBackground) {
                this.logger.info(`Initializing ${platformName} in background (non-blocking)`, 'PlatformLifecycleService');

                const backgroundInit = this.initializePlatformAsync(
                    platformName,
                    platformConfig,
                    connectCallback,
                    statusCallback
                );

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

            if (!this.streamDetector) {
                throw new Error(`Stream detection unavailable for ${platformName}. Configure a stream detector or disable the platform.`);
            }

            await this.streamDetector.startStreamDetection(
                platformName,
                platformConfig,
                connectCallback,
                statusCallback
            );
        } catch (error) {
            this._handleLifecycleError(`Failed to start stream detection for ${platformName}: ${error.message}`, error, 'stream-detection');
            throw error;
        }
    }

    shouldRunPlatformInBackground(platformName, platformConfig) {
        // TikTok blocks waiting for stream to go live
        if (platformName === 'tiktok') {
            return true;
        }

        // Add other platforms that might block here
        return false;
    }

    async initializePlatformAsync(platformName, platformConfig, connectCallback, statusCallback) {
        try {
            this.logger.info(`[${platformName}] Background initialization started`, 'PlatformLifecycleService');

            if (platformName === 'tiktok') {
                // TikTok uses its own built-in stream detection
                await connectCallback();
            } else if (this.streamDetector) {
                await this.streamDetector.startStreamDetection(
                    platformName,
                    platformConfig,
                    connectCallback,
                    statusCallback
                );
            } else {
                throw new Error(`Stream detection unavailable for ${platformName}. Configure a stream detector or disable the platform.`);
            }

            this.logger.info(`[${platformName}] Background initialization completed successfully`, 'PlatformLifecycleService');
        } catch (error) {
            this._handleLifecycleError(`[${platformName}] Background initialization failed: ${error.message}`, error, 'background-init');
            this.markPlatformFailure(platformName, error);
            // Don't rethrow - let other systems continue
        }
    }

    recordPlatformConnection(platformName) {
        this.platformConnectionTimes[platformName] = Date.now();
        this.logger.debug(`Platform ${platformName} connection time recorded`, 'PlatformLifecycleService');
    }

    getPlatformConnectionTime(platformName) {
        return this.platformConnectionTimes[platformName] || null;
    }

    isPlatformAvailable(platformName) {
        return !!this.platforms[platformName];
    }

    getPlatform(platformName) {
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

        return {
            timestamp: getSystemTimestampISO(),
            totalConfigured: Object.keys(this.config || {}).length,
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
            streamStatuses: { ...this.streamStatuses },
            backgroundInitializations: this.backgroundPlatformInits.length,
            recentErrors: this.platformErrors.slice(-10)
        };
    }

    ensurePlatformHealthEntry(platformName) {
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

    updatePlatformHealth(platformName, patch = {}) {
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

    markPlatformReady(platformName) {
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

    markPlatformFailure(platformName, error) {
        const timestamp = getSystemTimestampISO();
        this.platformErrors.push({
            platform: platformName,
            message: error?.message || String(error),
            timestamp
        });

        this.updatePlatformHealth(platformName, {
            state: 'failed',
            lastError: error?.message || String(error),
            lastUpdated: timestamp
        });
    }

    async disconnectAll() {
        this.logger.info('Cleaning up all platforms...', 'PlatformLifecycleService');

        // Wait for any background initializations to complete
        await this.waitForBackgroundInits(10000);

        // Disconnect from all platforms
        for (const platformName in this.platforms) {
            try {
                const platform = this.platforms[platformName];
                if (platform && typeof platform.cleanup === 'function') {
                    await platform.cleanup();
                    this.logger.info(`Cleaned up ${platformName}`, 'PlatformLifecycleService');
                } else {
                    const error = new Error(`Platform ${platformName} is missing cleanup()`);
                    this._handleLifecycleError(`Unable to cleanup ${platformName}: cleanup() missing`, error, 'cleanup');
                }

                delete this.platforms[platformName];
                delete this.platformConnectionTimes[platformName];
            } catch (error) {
                this._handleLifecycleError(`Error disconnecting from ${platformName}: ${error.message}`, error, 'disconnect');
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
        this.streamStatuses = {};

        this.logger.debug('PlatformLifecycleService disposed', 'PlatformLifecycleService');
    }

    _handleLifecycleError(message, error, eventType = 'lifecycle') {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, eventType, null, message);
        } else {
            this.errorHandler?.logOperationalError(message, 'PlatformLifecycleService', error);
        }
    }
}

module.exports = PlatformLifecycleService;
