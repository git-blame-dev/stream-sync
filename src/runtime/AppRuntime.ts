import { DEFAULT_AVATAR_URL } from '../constants/avatar';
import { InnertubeFactory } from '../factories/innertube-factory';
import { PlatformEvents } from '../interfaces/PlatformEvents';
import { OBSViewerCountObserver } from '../observers/obs-viewer-count-observer';
import { getOBSConnectionManager, initializeOBSConnection } from '../obs/connection';
import { clearStartupDisplays } from '../obs/startup';
import { getDefaultGoalsManager } from '../obs/goals';
import { ChatNotificationRouter } from '../services/ChatNotificationRouter';
import { PlatformEventRouter } from '../services/PlatformEventRouter';
import { createGuiTransportService, isGuiActive } from '../services/gui/gui-transport-service';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { getSystemTimestampISO } from '../utils/timestamp';
import { safeSetTimeout } from '../utils/timeout-validator';
import { ViewerCountSystem } from '../utils/viewer-count';
import { wireStreamStatusHandlers } from '../viewer-count/stream-status-handler';

const createAppRuntimeErrorHandler = (logger) => createPlatformErrorHandler(logger, 'AppRuntime');

const AVATAR_REQUIRED_NOTIFICATION_TYPES = new Set([
    PlatformEvents.CHAT_MESSAGE,
    PlatformEvents.FOLLOW,
    PlatformEvents.SHARE,
    PlatformEvents.RAID,
    PlatformEvents.GIFT,
    PlatformEvents.PAYPIGGY,
    PlatformEvents.GIFTPAYPIGGY,
    PlatformEvents.ENVELOPE
]);

function resolveNotificationAvatarUrl(type, options = {}) {
    if (!AVATAR_REQUIRED_NOTIFICATION_TYPES.has(type)) {
        return undefined;
    }

    const avatarUrl = typeof options.avatarUrl === 'string' ? options.avatarUrl.trim() : '';
    return avatarUrl || DEFAULT_AVATAR_URL;
}

function getErrorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

class AppRuntime {
    async handleUnifiedNotification(type, platform, username, options) {
        if (!options || typeof options !== 'object') {
            throw new Error('handleUnifiedNotification requires options');
        }
        if (!this.config) {
            throw new Error(`AppRuntime config unavailable for ${type} notification`);
        }

        try {
            const isError = options.isError === true;
            const allowAnonymous = options.isAnonymous === true &&
                (type === 'platform:gift' || type === 'platform:giftpaypiggy');
            if (!username || typeof username !== 'string' || !username.trim()) {
                if (!isError && !allowAnonymous) {
                    throw new Error(`Missing username for ${type} notification`);
                }
            }
            if (!isError) {
                if (!options.userId && !allowAnonymous) {
                    throw new Error(`Missing userId for ${type} notification`);
                }
                if (!options.timestamp) {
                    throw new Error(`Missing timestamp for ${type} notification`);
                }
            }

            const notificationData = {
                ...options
            };
            if (username) {
                notificationData.username = username;
            }
            if (options.userId !== undefined) {
                notificationData.userId = options.userId;
            }
            notificationData.platform = platform;
            if (options.timestamp !== undefined) {
                notificationData.timestamp = options.timestamp;
            }

            const avatarUrl = resolveNotificationAvatarUrl(type, options);
            if (avatarUrl !== undefined) {
                notificationData.avatarUrl = avatarUrl;
            }

            if (!this.notificationManager) {
                throw new Error(`Notification manager not available for ${type} notification`);
            }

            const managerResult = await this.notificationManager.handleNotification(type, platform, notificationData);
            if (managerResult && typeof managerResult === 'object' && typeof managerResult.success === 'boolean') {
                return managerResult;
            }
            throw new Error('Notification manager returned invalid result shape');
        } catch (error) {
            this._handleAppRuntimeError(
                `Error handling ${type} notification for ${username}: ${error.message}`,
                error,
                { notificationType: type, username, platform },
                { eventType: 'notification', logContext: platform }
            );

            return {
                success: false,
                error: error.message,
                notificationType: type,
                platform,
                username: typeof username === 'string' ? username : null
            };
        }
    }

    constructor(config, dependencies) {
        if (!dependencies) {
            throw new Error('AppRuntime requires dependencies');
        }

        this.dependencies = dependencies;
        this.logger = this.dependencies.logging;
        if (!this.logger || typeof this.logger.debug !== 'function') {
            throw new Error('AppRuntime requires logger');
        }
        this.logger.debug('[AppRuntime] Constructor starting...', 'system');
        this.config = config;

        this.twitchAuth = this.dependencies.twitchAuth;

        this.errorHandler = this.logger ? createAppRuntimeErrorHandler(this.logger) : null;

        this.lazyInnertube = this.dependencies.lazyInnertube || InnertubeFactory.createLazyReference();

        this.displayQueue = this.dependencies.displayQueue;
        this.notificationManager = this.dependencies.notificationManager;

        this.eventBus = this.dependencies.eventBus;
        this.vfxCommandService = this.dependencies.vfxCommandService;
        this.userTrackingService = this.dependencies.userTrackingService;
        this.guiTransportService = this.dependencies.guiTransportService || createGuiTransportService({
            config: this.config,
            eventBus: this.eventBus,
            logger: this.logger
        });
        this.obsEventService = this.dependencies.obsEventService;
        this.sceneManagementService = this.dependencies.sceneManagementService;

        this.viewerCountSystem = new ViewerCountSystem({
            platformProvider: () => this.getPlatforms(),
            logger: this.logger,
            config: this.config
        });
        this.viewerCountSystemStarted = false;

        if (!this.config) {
            throw new Error('AppRuntime requires config');
        }

        this.commandCooldownService = this.dependencies.commandCooldownService;
        this.platformLifecycleService = this.dependencies.platformLifecycleService;
        if (!this.commandCooldownService || !this.platformLifecycleService) {
            throw new Error('AppRuntime requires commandCooldownService and platformLifecycleService');
        }
        if (typeof this.platformLifecycleService.getAllPlatforms !== 'function') {
            throw new Error('AppRuntime requires platformLifecycleService.getAllPlatforms function');
        }
        const requiredDependencies = [
            'displayQueue',
            'notificationManager',
            'eventBus',
            'vfxCommandService',
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
        if (typeof this.eventBus.subscribe !== 'function') {
            throw new Error('AppRuntime requires eventBus.subscribe function');
        }
        this.gracefulExitService = null;
        this.vfxCommandUnsubscribe = null;
        this.isStarting = false;
        this.isStarted = false;
        this.isShuttingDown = false;

        this.platformEventRouter = new PlatformEventRouter({
            eventBus: this.eventBus,
            runtime: this,
            notificationManager: this.notificationManager,
            config: this.config,
            logger: this.logger
        });
        this.chatNotificationRouter = new ChatNotificationRouter({
            runtime: this,
            logger: this.logger,
            config: this.config
        });

        this.registerEventHandlers();

        this.logger.debug('Constructor completed', 'AppRuntime');
    }

    get platforms() {
        return this.platformLifecycleService ? this.platformLifecycleService.getAllPlatforms() : {};
    }

    registerEventHandlers() {
        if (!this.eventBus) {
            throw new Error('EventBus required for event handler registration');
        }

        this.logger.debug('Registering event handlers...', 'AppRuntime');

        this.viewerCountStatusCleanup = wireStreamStatusHandlers({
            eventBus: this.eventBus,
            viewerCountSystem: this.viewerCountSystem,
            logger: this.logger
        });

        this.vfxCommandUnsubscribe = this.eventBus.subscribe(PlatformEvents.VFX_COMMAND_RECEIVED, async (event) => {
            try {
                const { command, commandKey, username, platform, userId, context, source } = event;
                if (!context || typeof context !== 'object') {
                    throw new Error('VFX command event requires context');
                }

                if (source === 'eventbus' || source === 'vfx-service') {
                    this.logger.debug('[EventHandler] Ignoring VFX command already processed by EventBus handler', 'AppRuntime');
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
                    this.logger.debug(`[EventHandler] Executing VFX command string: ${command}`, 'AppRuntime');
                    await this.vfxCommandService.executeCommand(command, executionContext);
                } else if (commandKey && typeof this.vfxCommandService.executeCommandForKey === 'function') {
                    this.logger.debug(`[EventHandler] Executing VFX command key: ${commandKey}`, 'AppRuntime');
                    await this.vfxCommandService.executeCommandForKey(commandKey, executionContext);
                } else {
                    this.logger.warn('[EventHandler] No command or commandKey provided for VFX command event', 'AppRuntime', { event });
                }
            } catch (error) {
                this._handleAppRuntimeError(
                    '[EventHandler] Error executing VFX command',
                    error,
                    { event },
                    { eventType: 'event-handler', logContext: 'AppRuntime' }
                );
            }
        });

        this.logger.debug('Event handlers registered successfully', 'AppRuntime');
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

        this.logger.info(`[EventHandler] Stream detection event received: ${platform} detected ${newStreamIds.length} new streams`, 'AppRuntime');

        if (platform === 'youtube' && this.youtube && typeof this.youtube.initialize === 'function') {
            this.logger.info(`[EventHandler] Triggering YouTube reconnection for ${newStreamIds.length} new stream(s)`, 'AppRuntime');
            try {
                await this.youtube.initialize({}, true);
            } catch (_reconnectError) {
                this.logger.warn('[EventHandler] YouTube reconnection attempted but may have already been processed', 'AppRuntime');
            }
        }
    }

    isFirstMessage(userId, context = {}) {
        if (!this.userTrackingService || typeof this.userTrackingService.isFirstMessage !== 'function') {
            throw new Error('UserTrackingService not available for first message check');
        }
        return this.userTrackingService.isFirstMessage(userId, context);
    }

    async initializePlatforms() {
        this.logger.info('Initializing platform connections...', 'AppRuntime');

        this.logger.debug('Loading platform modules...', 'AppRuntime');
        const {
            TikTokPlatform,
            TwitchPlatform,
            YouTubePlatform,
            StreamElementsPlatform
        } = await import('../platforms');
        this.logger.debug('Platform modules loaded', 'AppRuntime');

        const platformModules = {
            twitch: TwitchPlatform,
            youtube: YouTubePlatform,
            tiktok: TikTokPlatform,
            streamelements: StreamElementsPlatform
        };

        await this.platformLifecycleService.initializeAllPlatforms(platformModules);

        this.logger.debug('Platform initialization delegated to service', 'AppRuntime');
    }

    async handleChatMessage(platform, normalizedData) {
        try {
            const messageText = typeof normalizedData?.message === 'string'
                ? normalizedData.message
                : (typeof normalizedData?.message?.text === 'string' ? normalizedData.message.text : '');
            this.logger.debug(`Received message from ${platform}: ${normalizedData?.username} - ${messageText}`, 'chat-handler');
            if (platform === 'tiktok') {
                this.logger.debug(`[TikTok Debug] Message received in main handler: ${normalizedData?.username}: ${messageText}`, 'system');
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
        this.logger.debug(`[${platform}] Viewer count updated: ${count}`, 'system');

        if (this.viewerCountSystem) {
            const previousCount = this.viewerCountSystem.counts[platform.toLowerCase()];
            this.viewerCountSystem.counts[platform.toLowerCase()] = count;

            const notificationPromise = this.viewerCountSystem.notifyObservers(platform, count, previousCount);
            if (notificationPromise && notificationPromise.catch) {
                notificationPromise.catch((error) => {
                    this.logger.warn(`Observer notification failed for ${platform}: ${error.message}`, 'system');
                });
            }
        }
    }

    async shutdown() {
        if (this.isShuttingDown) {
            return;
        }
        this.isShuttingDown = true;
        this.logger.info('Shutting down application...', 'system');

        try {
            await this._stopGuiTransport();
        } catch (error) {
            this._handleAppRuntimeError(
                `Error stopping GUI transport: ${getErrorMessage(error)}`,
                error,
                null,
                { eventType: 'shutdown', logContext: 'system' }
            );
        }

        try {
            await this.platformLifecycleService.disconnectAll();
        } catch (error) {
            this._handleAppRuntimeError(
                `Error disconnecting platforms: ${getErrorMessage(error)}`,
                error,
                null,
                { eventType: 'shutdown', logContext: 'system' }
            );
        }

        if (this.obsEventService) {
            try {
                await this.obsEventService.disconnect();
                this.logger.info('Disconnected from OBS via OBSEventService.', 'system');
            } catch (error) {
                this._handleAppRuntimeError(
                    `Error disconnecting OBS via OBSEventService: ${getErrorMessage(error)}`,
                    error,
                    null,
                    { eventType: 'shutdown', logContext: 'system' }
                );
            }

            try {
                if (typeof this.obsEventService.destroy === 'function') {
                    this.obsEventService.destroy();
                }
            } catch (error) {
                this._handleAppRuntimeError(
                    `Error destroying OBSEventService: ${getErrorMessage(error)}`,
                    error,
                    null,
                    { eventType: 'shutdown', logContext: 'system' }
                );
            }
        } else {
            try {
                const obsManager = this._getObsConnectionManager();
                if (obsManager && obsManager.isConnected()) {
                    await obsManager.disconnect();
                    this.logger.info('Disconnected from OBS.', 'system');
                }
            } catch (error) {
                this._handleAppRuntimeError(
                    `Error disconnecting from OBS: ${getErrorMessage(error)}`,
                    error,
                    null,
                    { eventType: 'shutdown', logContext: 'system' }
                );
            }
        }

        if (this.platformEventRouter && typeof this.platformEventRouter.dispose === 'function') {
            this.platformEventRouter.dispose();
        }

        if (this.sceneManagementService && typeof this.sceneManagementService.destroy === 'function') {
            try {
                this.sceneManagementService.destroy();
            } catch (error) {
                this._handleAppRuntimeError(
                    `Error destroying scene management service: ${getErrorMessage(error)}`,
                    error,
                    null,
                    { eventType: 'shutdown', logContext: 'system' }
                );
            }
        }

        try {
            if (this.viewerCountSystem) {
                this.viewerCountSystem.stopPolling();
                if (typeof this.viewerCountSystem.cleanup === 'function') {
                    await this.viewerCountSystem.cleanup();
                }
                this.logger.debug('Stopped viewer count polling', 'system');
            }
        } catch (error) {
            this._handleAppRuntimeError(
                `Error stopping viewer count polling: ${getErrorMessage(error)}`,
                error,
                null,
                { eventType: 'shutdown', logContext: 'system' }
            );
        }

        try {
            if (typeof this.vfxCommandUnsubscribe === 'function') {
                this.vfxCommandUnsubscribe();
                this.vfxCommandUnsubscribe = null;
            }
        } catch (error) {
            this._handleAppRuntimeError(
                `Error unsubscribing VFX command handler: ${getErrorMessage(error)}`,
                error,
                null,
                { eventType: 'shutdown', logContext: 'system' }
            );
        }

        try {
            if (typeof this.viewerCountStatusCleanup === 'function') {
                this.viewerCountStatusCleanup();
                this.logger.debug('Stopped viewer count status listeners', 'system');
            }
        } catch (error) {
            this._handleAppRuntimeError(
                `Error cleaning up viewer count status listeners: ${getErrorMessage(error)}`,
                error,
                null,
                { eventType: 'shutdown', logContext: 'system' }
            );
        }

        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.logger.debug('Cleared keep-alive interval', 'system');
        }

        this.isStarted = false;
        this.isStarting = false;
        this.isShuttingDown = false;

        this.emitSystemShutdown({ reason: 'manual-shutdown' });
    }

    emitSystemShutdown({ reason, restartRequested = false } = {}) {
        const shutdownReason = typeof reason === 'string' && reason.trim() ? reason : 'unknown';
        const shutdownMode = restartRequested ? 'restart' : 'exit';
        this.logger.info(`Shutdown complete (${shutdownReason}); ${shutdownMode} requested.`, 'system');
        this.logger.debug('[Shutdown] Calling process.exit(0)', 'system');
        safeSetTimeout(() => {
            this._handleAppRuntimeError('[Shutdown] Forced exit due to lingering handles', null, null, { eventType: 'shutdown', logContext: 'system' });
            process.exit(0);
        }, 2000);
        process.exit(0);
    }

    async start() {
        if (this.isStarting) {
            throw new Error('AppRuntime start in progress');
        }
        if (this.isStarted) {
            throw new Error('AppRuntime already started');
        }
        this.isStarting = true;

        this.logger.info('AppRuntime.start() method called', 'AppRuntime');
        this.logger.debug('Start method called...', 'AppRuntime');

        try {
            try {
                await this._startGuiTransport();
            } catch (error) {
                this._handleAppRuntimeError(
                    `GUI transport initialization failed: ${getErrorMessage(error)}`,
                    error,
                    null,
                    { eventType: 'startup', logContext: 'AppRuntime' }
                );
            }

            this.logger.debug('Initializing platforms...', 'AppRuntime');
            try {
                await this.initializePlatforms();
                const failedPlatforms = this._getFailedPlatformInitializations();
                if (failedPlatforms.length === 0) {
                    this.logger.info('Platform connections initialized', 'AppRuntime');
                } else {
                    this.logger.warn(`Platform initialization completed with failures: ${failedPlatforms.join(', ')}`, 'AppRuntime');
                }
            } catch (error) {
                this._handleAppRuntimeError(
                    'Platform initialization failed',
                    error,
                    null,
                    { eventType: 'startup', logContext: 'AppRuntime' }
                );
                throw error;
            }
            this.logger.debug('Starting system initialization (OBS, ViewerCount)', 'AppRuntime');
            this.logger.debug('ViewerCount system exists?', this.viewerCountSystem ? 'YES' : 'NO', 'AppRuntime');

            this.logger.info('Initializing OBS connection...', 'AppRuntime');
            try {
                await initializeOBSConnection(this.config.obs, {
                    handcam: this.config.handcam,
                    obsEventService: this.obsEventService
                });
                this.logger.info('OBS connection initialized', 'AppRuntime');
            } catch (obsError) {
                this._handleAppRuntimeError(
                    `OBS initialization failed: ${getErrorMessage(obsError)}`,
                    obsError,
                    null,
                    { eventType: 'startup', logContext: 'AppRuntime' }
                );
                this.logger.info('Continuing without OBS connection; VFX system remains available.', 'AppRuntime');
            }

            if (!this.vfxCommandService) {
                throw new Error('VFXCommandService unavailable for runtime startup');
            }

            const obsManager = this._getObsConnectionManager();
            const sourcesManager = this._getObsSourcesManager();

            this.logger.info('Clearing previous displays...', 'AppRuntime');
            await clearStartupDisplays(this.config, {
                logger: this.logger,
                obsManager,
                ...(sourcesManager ? { sourcesManager } : {})
            });
            this.logger.info('Displays cleared', 'AppRuntime');

            this.logger.info('Initializing goal display...', 'AppRuntime');
            const goalsManager = this._getDefaultGoalsManager();
            await goalsManager.initializeGoalDisplay();
            this.logger.info('Goal display initialized', 'AppRuntime');

            const obsObserver = new OBSViewerCountObserver(obsManager, this.logger, { config: this.config });
            this.viewerCountSystem.addObserver(obsObserver);
            this.logger.info('Initializing viewer count system...', 'AppRuntime');
            this.logger.debug('Starting viewerCountSystem.initialize()', 'AppRuntime');
            await this.viewerCountSystem.initialize();
            this.logger.debug('viewerCountSystem.initialize() completed', 'AppRuntime');

            await this.viewerCountSystem.startPolling();

            this.gracefulExitService = this.dependencies.gracefulExitService;
            if (!this.gracefulExitService) {
                throw new Error('GracefulExitService dependency required');
            }
            if (this.gracefulExitService.isEnabled()) {
                this.logger.info(`Graceful exit enabled: will exit after ${this.gracefulExitService.getTargetMessageCount()} messages`, 'AppRuntime');
            }

            this.emitSystemReady({});
            this.isStarted = true;
        } catch (error) {
            await this.rollbackStartup();
            throw error;
        } finally {
            this.isStarting = false;
        }
    }

    _getFailedPlatformInitializations() {
        if (!this.platformLifecycleService || typeof this.platformLifecycleService.getStatus !== 'function') {
            return [];
        }

        const status = this.platformLifecycleService.getStatus();
        const failedPlatforms = Array.isArray(status?.failedPlatforms)
            ? status.failedPlatforms
            : [];
        return failedPlatforms
            .map((entry) => entry?.name)
            .filter((name) => typeof name === 'string' && name.length > 0);
    }

    async rollbackStartup() {
        await this._runStartupRollbackStep('stop GUI transport', async () => {
            await this._stopGuiTransport();
        });

        await this._runStartupRollbackStep('disconnect platforms', async () => {
            if (this.platformLifecycleService && typeof this.platformLifecycleService.disconnectAll === 'function') {
                await this.platformLifecycleService.disconnectAll();
            }
        });

        await this._runStartupRollbackStep('disconnect and destroy OBS event service', async () => {
            if (this.obsEventService && typeof this.obsEventService.disconnect === 'function') {
                await this.obsEventService.disconnect();
            }
            if (this.obsEventService && typeof this.obsEventService.destroy === 'function') {
                this.obsEventService.destroy();
            }
        });

        await this._runStartupRollbackStep('destroy scene management service', async () => {
            if (this.sceneManagementService && typeof this.sceneManagementService.destroy === 'function') {
                this.sceneManagementService.destroy();
            }
        });

        await this._runStartupRollbackStep('stop and cleanup viewer count system', async () => {
            if (this.viewerCountSystem && typeof this.viewerCountSystem.stopPolling === 'function') {
                this.viewerCountSystem.stopPolling();
            }
            if (this.viewerCountSystem && typeof this.viewerCountSystem.cleanup === 'function') {
                await this.viewerCountSystem.cleanup();
            }
        });

        this.isStarted = false;
    }

    async _runStartupRollbackStep(stepName, stepFn) {
        try {
            await stepFn();
        } catch (error) {
            this._handleAppRuntimeError(
                `Startup rollback failed while attempting to ${stepName}: ${getErrorMessage(error)}`,
                error,
                null,
                { eventType: 'startup-rollback', logContext: 'AppRuntime' }
            );
        }
    }

    async startViewerCountSystemEarly() {
        try {
            this.logger.debug('ViewerCount system initialization starting', 'AppRuntime');

            await this.viewerCountSystem.initialize();
            this.logger.debug('ViewerCount system initialization completed', 'AppRuntime');
            await this.viewerCountSystem.startPolling();
            this.logger.debug('ViewerCount system polling started successfully', 'AppRuntime');

        } catch (error) {
            this._handleAppRuntimeError(
                `EARLY: ViewerCount system failed to start: ${error.message}`,
                error,
                null,
                {
                    eventType: 'viewer-count-init',
                    logContext: 'AppRuntime'
                }
            );
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

        const readyPayload = {
            services: this.getReadyServices(),
            timestamp: getSystemTimestampISO()
        };

        if (correlationId) {
            readyPayload.correlationId = correlationId;
        }

        if (this.platformLifecycleService?.getStatus) {
            readyPayload.platforms = this.platformLifecycleService.getStatus();
            const failedPlatforms = Array.isArray(readyPayload.platforms?.failedPlatforms)
                ? readyPayload.platforms.failedPlatforms
                : [];
            if (failedPlatforms.length > 0) {
                readyPayload.degraded = true;
                readyPayload.degradationReasons = ['platform-initialization-failed'];
            }
        }

        if (this.commandCooldownService?.getStatus) {
            readyPayload.cooldowns = this.commandCooldownService.getStatus();
        }

        this.logger.debug('system:ready payload built', 'AppRuntime', readyPayload);
        return readyPayload;
    }

    getReadyServices() {
        const readinessMap = {
            notificationManager: !!this.notificationManager,
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
        return this.handleUnifiedNotification('platform:follow', platform, username, options);
    }

    async handleShareNotification(platform, username, options) {
        if (!options || typeof options !== 'object') {
            throw new Error('handleShareNotification requires options');
        }
        return this.handleUnifiedNotification('platform:share', platform, username, options);
    }

    async handlePaypiggyNotification(platform, username, options) {
        if (!options || typeof options !== 'object') {
            throw new Error('handlePaypiggyNotification requires options');
        }
        return this.handleUnifiedNotification('platform:paypiggy', platform, username, options);
    }

    async handleRaidNotification(platform, raiderName, options) {
        if (!options || typeof options !== 'object') {
            throw new Error('handleRaidNotification requires options');
        }
        if (options.viewerCount === undefined) {
            throw new Error('handleRaidNotification requires viewerCount');
        }
        return this.handleUnifiedNotification('platform:raid', platform, raiderName, {
            viewerCount: options.viewerCount,
            ...options
        });
    }

    async handleGiftNotification(platform, username, options) {
        if (!options || typeof options !== 'object') {
            throw new Error('handleGiftNotification requires options');
        }
        const isError = options.isError === true;
        const allowAnonymous = options.isAnonymous === true;
        if (!isError) {
            if (!options.timestamp) {
                throw new Error('handleGiftNotification requires timestamp');
            }
            if (!options.userId && !allowAnonymous) {
                throw new Error('handleGiftNotification requires userId');
            }
        }
        if (!this.config) {
            throw new Error('AppRuntime config unavailable for gift notifications');
        }

        if (!username || (typeof username === 'string' && username.trim().length === 0)) {
            if (!isError && !allowAnonymous) {
                this.logger.warn('Missing username for gift notification', platform, { options });
                return;
            }
        }

        let giftType = typeof options.giftType === 'string' ? options.giftType.trim() : '';
        const rawGiftCount = options.giftCount;
        let giftCount = rawGiftCount === undefined || rawGiftCount === null ? undefined : Number(rawGiftCount);
        const rawAmount = options.amount;
        let amount = rawAmount === undefined || rawAmount === null ? undefined : Number(rawAmount);
        let currency = typeof options.currency === 'string' ? options.currency.trim() : '';
        const repeatCount = options.repeatCount;

        if (!isError) {
            if (!giftType || !Number.isFinite(giftCount) || giftCount < 0 || !Number.isFinite(amount) || amount < 0 || !currency) {
                throw new Error('Gift notification requires giftType, giftCount, amount, and currency');
            }
        }
        if (!isError && (giftCount <= 0 || amount <= 0)) {
            throw new Error('Gift notification requires giftType, giftCount, amount, and currency');
        }

        if (isError) {
            if (!giftType) {
                giftType = undefined;
            }
            if (giftCount !== undefined && (!Number.isFinite(giftCount) || giftCount < 0)) {
                giftCount = undefined;
            }
            if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
                amount = undefined;
            }
            if (!currency) {
                currency = undefined;
            }
        }

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
        const {
            giftType: _giftType,
            giftCount: _giftCount,
            amount: _amount,
            currency: _currency,
            id: giftId,
            ...payloadBase
        } = options;

        const notificationPayload = {
            ...payloadBase,
            ...(giftType ? { giftType } : {}),
            ...(giftCount !== undefined ? { giftCount } : {}),
            ...(amount !== undefined ? { amount } : {}),
            ...(currency ? { currency } : {}),
            ...(repeatCount !== undefined ? { repeatCount } : {}),
            vfxConfig: giftVFXConfig,
            ...(giftId ? { id: giftId } : {})
        };

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
        const isError = options.isError === true;
        const requiresTier = platform === 'twitch';
        const rawGiftCount = options.giftCount;
        let giftCount = rawGiftCount === undefined || rawGiftCount === null ? undefined : Number(rawGiftCount);
        if (!isError) {
            if (giftCount === undefined || (requiresTier && options.tier === undefined)) {
                throw new Error(requiresTier
                    ? 'handleGiftPaypiggyEvent requires tier and giftCount'
                    : 'handleGiftPaypiggyEvent requires giftCount');
            }
            if (!Number.isFinite(giftCount)) {
                throw new Error('handleGiftPaypiggyEvent requires giftCount');
            }
        } else if (giftCount !== undefined && (!Number.isFinite(giftCount) || giftCount < 0)) {
            giftCount = undefined;
        }
        const payload = {
            ...(giftCount !== undefined ? { giftCount } : {}),
            userId: options.userId,
            timestamp: options.timestamp,
            ...(options.avatarUrl !== undefined ? { avatarUrl: options.avatarUrl } : {}),
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

        return this.handleUnifiedNotification('platform:giftpaypiggy', platform, username, payload);
    }

    async handleResubEvent(platform, username, options) {
        if (!options || typeof options !== 'object') {
            throw new Error('handleResubEvent requires options');
        }
        if (options.tier === undefined || options.months === undefined || options.message === undefined) {
            throw new Error('handleResubEvent requires tier, months, and message');
        }
        return this.handleUnifiedNotification('platform:paypiggy', platform, username, {
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
            const isError = data.isError === true;
            const giftType = typeof data.giftType === 'string' ? data.giftType.trim() : '';
            const rawGiftCount = data.giftCount;
            let giftCount = rawGiftCount === undefined || rawGiftCount === null ? undefined : Number(rawGiftCount);
            const rawAmount = data.amount;
            let amount = rawAmount === undefined || rawAmount === null ? undefined : Number(rawAmount);
            const currency = typeof data.currency === 'string' ? data.currency.trim() : '';
            const repeatCount = data.repeatCount;
            if (!isError) {
                if (!data.userId || !data.username) {
                    throw new Error('Envelope notification requires userId and username');
                }
                if (!giftType || !Number.isFinite(giftCount) || giftCount < 0 || !Number.isFinite(amount) || amount < 0 || !currency || !data.timestamp) {
                    throw new Error('Envelope notification requires giftType, giftCount, amount, currency, timestamp, and id');
                }
                if (giftCount <= 0 || amount <= 0 || !data.id) {
                    throw new Error('Envelope notification requires giftType, giftCount, amount, currency, timestamp, and id');
                }
            }
            if (giftCount !== undefined && (!Number.isFinite(giftCount) || giftCount < 0)) {
                giftCount = undefined;
            }
            if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
                amount = undefined;
            }

            await this.handleUnifiedNotification('platform:envelope', platform, data.username, {
                giftType,
                giftCount,
                amount,
                currency,
                ...(repeatCount !== undefined ? { repeatCount } : {}),
                type: 'platform:envelope',
                isError,
                userId: data.userId,
                avatarUrl: data.avatarUrl,
                timestamp: data.timestamp,
                ...(data.id ? { id: data.id } : {}),
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

    _handleAppRuntimeError(message, error, payload, options) {
        if (!options) {
            throw new Error('_handleAppRuntimeError requires options');
        }
        const { eventType, logContext } = options;
        if (!eventType || !logContext) {
            throw new Error('_handleAppRuntimeError requires eventType and logContext');
        }

        if (!this.errorHandler && this.logger) {
            this.errorHandler = createAppRuntimeErrorHandler(this.logger);
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

    _getObsConnectionManager() {
        if (this.dependencies?.obs?.connectionManager) {
            return this.dependencies.obs.connectionManager;
        }
        return getOBSConnectionManager({ config: this.config.obs });
    }

    _getDefaultGoalsManager() {
        if (this.dependencies?.obs?.goalsManager) {
            return this.dependencies.obs.goalsManager;
        }
        return getDefaultGoalsManager();
    }

    _getObsSourcesManager() {
        if (this.dependencies?.obs?.sourcesManager) {
            return this.dependencies.obs.sourcesManager;
        }
        return null;
    }

    async _startGuiTransport() {
        if (!this.guiTransportService || typeof this.guiTransportService.start !== 'function') {
            return;
        }

        if (!isGuiActive(this.config)) {
            return;
        }

        await this.guiTransportService.start();
    }

    async _stopGuiTransport() {
        if (!this.guiTransportService || typeof this.guiTransportService.stop !== 'function') {
            return;
        }

        await this.guiTransportService.stop();
    }
}

export { AppRuntime };
