
const fs = require('fs');

const { EventEmitter } = require('events');

const { createRetrySystem } = require('../utils/retry-system');

const { safeSetInterval, validateTimeout } = require('../utils/timeout-validator');
const { withTimeout } = require('../utils/timeout-wrapper');
const innertubeInstanceManager = require('../services/innertube-instance-manager');
const { ViewerCountProviderFactory } = require('../utils/viewer-count-providers');

const { normalizeYouTubeConfig, DEFAULT_YOUTUBE_CONFIG } = require('../utils/config-normalizer');
const { YouTubeNotificationDispatcher } = require('../utils/youtube-notification-dispatcher');
const { YouTubeConnectionManager } = require('../utils/youtube-connection-manager');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { PlatformEvents } = require('../interfaces/PlatformEvents');
const { YouTubeLiveStreamService } = require('../services/youtube-live-stream-service');
const { createYouTubeEventDispatchTable } = require('./youtube/events/youtube-event-dispatch-table');
const { normalizeYouTubeChatItem } = require('./youtube/events/youtube-chat-item-normalizer');
const { createYouTubeEventFactory } = require('./youtube/events/youtube-event-factory');
const { YouTubeBaseEventHandler } = require('./youtube/notifications/youtube-base-event-handler');
const {
    shouldSuppressYouTubeNotification,
    UnifiedNotificationProcessor
} = require('./youtube/notifications/youtube-unified-notification-processor');
const { createYouTubeConnectionFactory } = require('./youtube/connections/youtube-connection-factory');
const { createYouTubeMultiStreamManager } = require('./youtube/streams/youtube-multistream-manager');

// Timeout and limit constants
const INNERTUBE_CREATION_TIMEOUT_MS = 3000; // 3 seconds for Innertube instance creation

class YouTubePlatform extends EventEmitter {
    constructor(config = {}, dependencies) {
        super();

        this.handlers = {};
        dependencies = dependencies || {};
        
        // FAIL-FAST: Validate dependencies before proceeding
        const { validateYouTubePlatformDependencies } = require('../utils/dependency-validator');
        
        // Allow flexible constructor patterns - handle incorrect dependency injection patterns
        if (typeof dependencies === 'string' || typeof dependencies === 'number') {
            throw new Error('Dependencies should be a single object with logger property, not separate parameters. ' +
                           'Use: new YouTubePlatform(config, { logger, notificationManager, ... }) instead of separate arguments.');
        }

        try {
            validateYouTubePlatformDependencies(dependencies);
        } catch (error) {
            throw new Error(`YouTube platform initialization failed: ${error.message}`);
        }

        this.logger = dependencies.logger;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'youtube');
        this.platformLogger = this.logger;
        
        // Rate limiting removed - unified processing handles message flow control

        // Normalize configuration with canonical camelCase keys.
        let normalizedConfig;
        try {
            normalizedConfig = normalizeYouTubeConfig(config);
        } catch (error) {
            throw new Error(`YouTube config normalization failed: ${error.message}`);
        }
        
        this.config = { ...normalizedConfig };
        this.platformName = 'youtube';
        this.eventFactory = createYouTubeEventFactory();
        this._ensureDataLoggingPath();

        // Extract dependencies (all required, no fallbacks)
        this.USER_AGENTS = dependencies.USER_AGENTS;
        this.Innertube = dependencies.Innertube; // Lazy-loaded youtubei.js Innertube (null initially for startup performance)
        this.timestampService = dependencies.timestampService || null; // Timestamp extraction service
        this.viewerService = dependencies.viewerService || null;

        const ChatFileLoggingService = dependencies.ChatFileLoggingService || require('../services/ChatFileLoggingService');
        this.chatFileLoggingService = dependencies.chatFileLoggingService || new ChatFileLoggingService({
            logger: this.logger,
            config: this.config
        });

        this.notificationDispatcher = dependencies.notificationDispatcher || new YouTubeNotificationDispatcher({
            logger: this.logger,
            platform: this
        });
        
        // Logger reference for debug calls
        
        
        // Track initialization and monitoring states
        this.isInitialized = false;
        this.monitoringInterval = null;
        
        // Stream shortage warning state tracking
        this.shortageState = {
            lastWarningTime: null,
            isInShortage: false,
            lastKnownAvailable: 0,
            lastKnownRequired: 0
        };
        this._validateAndFixConfiguration();

        // Initialize user agent manager
        const { YouTubeUserAgentManager } = require('../utils/youtube-user-agent-manager');
        this.userAgentManager = new YouTubeUserAgentManager(this.logger, {
            userAgents: this.USER_AGENTS
        });

        this.retrySystem = dependencies.retrySystem || createRetrySystem({ logger: this.logger });
        
        // Replace old connection management with new utility
        this.connectionManager = new YouTubeConnectionManager(this.logger, {
            config: this.config
        });

        this._youtubeConnectionFactory = createYouTubeConnectionFactory({
            platform: this,
            innertubeInstanceManager,
            withTimeout,
            innertubeCreationTimeoutMs: INNERTUBE_CREATION_TIMEOUT_MS
        });

        this._youtubeMultiStreamManager = createYouTubeMultiStreamManager({
            platform: this,
            safeSetInterval,
            validateTimeout,
            now: () => Date.now()
        });

        // Initialize stream detection service from dependencies
        this.streamDetectionService = dependencies.streamDetectionService;

        // Initialize extracted services
        // Initialize base event handler for eliminating code duplication
        try {
            this.baseEventHandler = new YouTubeBaseEventHandler(this);
        } catch (error) {
            this._handleProcessingError('Failed to create baseEventHandler', error, 'configuration');
            throw error;
        }
        
        // Multi-stream support - track multiple live streams and their connections

        this.logger.debug('Platform initialized with configuration', 'youtube', this.config);

        // Dependency injection for modular utilities/services
        // Set dependencies before creating UnifiedNotificationProcessor
        // ALWAYS prioritize dependencies - no overrides later in the constructor
        // Explicit check to ensure proper dependency injection for tests
        if (dependencies.AuthorExtractor !== undefined) {
            this.AuthorExtractor = dependencies.AuthorExtractor;
        } else {
            this.AuthorExtractor = require('../utils/youtube-author-extractor');
        }
        
        if (dependencies.NotificationBuilder) {
            this.NotificationBuilder = dependencies.NotificationBuilder;
        } else {
            this.NotificationBuilder = require('../utils/notification-builder');
        }
        try {
            this.unifiedNotificationProcessor = new UnifiedNotificationProcessor(this);
        } catch (error) {
            this._handleProcessingError('Failed to create UnifiedNotificationProcessor', error, 'configuration');
            throw error;
        }
        
        // Validate critical properties are defined
        if (!this.handleChatMessage) {
            this._handleProcessingError(
                'handleChatMessage not defined after constructor',
                new Error('handleChatMessage not defined after constructor'),
                'configuration'
            );
        }
        if (!this.baseEventHandler) {
            this._handleProcessingError(
                'baseEventHandler not defined after constructor',
                new Error('baseEventHandler not defined after constructor'),
                'configuration'
            );
        }
        if (!this.config) {
            this._handleProcessingError(
                'config not defined after constructor',
                new Error('config not defined after constructor'),
                'configuration'
            );
        }
        
        // Initialize viewer count provider with dependency injection support
        if (dependencies.viewerCountProvider) {
            this.viewerCountProvider = dependencies.viewerCountProvider;
            this.logger.debug('Using injected viewer count provider', 'youtube');
        } else {
            // Create default provider using service layer dependencies
            try {
                this.viewerCountProvider = ViewerCountProviderFactory.createYouTubeProvider(
                    innertubeInstanceManager,
                    this.config,
                    () => this.getDetectedStreamIds(),
                    this.Innertube, // Can be null initially, service layer handles YouTube.js loading
                    {
                        // Pass service layer dependencies for clean architecture
                        viewerExtractionService: dependencies.viewerExtractionService,
                        innertubeService: dependencies.innertubeService,
                        logger: this.logger
                    }
                );
                this.logger.debug('Created YouTube viewer count provider with service layer dependencies', 'youtube');
            } catch (error) {
                this.logger.warn('Failed to create viewer count provider, viewer counts will return 0', 'youtube', error);
                this.viewerCountProvider = null;
            }
        }
    }


    getNextUserAgent() {
        return this.userAgentManager.getNextUserAgent();
    }


    // Multi-stream helper functions
    
    removeYouTubeConnection(videoId) {
        this.connectionManager.removeConnection(videoId);
        
        // Clear active stream in viewer service if this was the active stream
        if (this.viewerService && typeof this.viewerService.clearActiveStream === 'function') {
            try {
                // Check if this videoId matches the current active stream
                if (this.viewerService._activeStream && this.viewerService._activeStream.videoId === videoId) {
                    this.viewerService.clearActiveStream();
                    this.logger.debug(`Cleared active stream from viewer service: ${videoId}`, 'youtube');
                }
            } catch (serviceError) {
                this.logger.warn(`Failed to clear active stream in viewer service: ${serviceError.message}`, 'youtube');
            }
        }
    }

    async disconnectFromYouTubeStream(videoId, reason = 'unknown') {
        if (!this.connectionManager) {
            return false;
        }

        const previousCount = this.connectionManager.getConnectionCount();
        const result = await this.connectionManager.disconnectFromStream(videoId, reason);
        this._emitStreamStatusIfNeeded(previousCount, { videoId, reason });
        return result;
    }

    setYouTubeConnectionReady(videoId) {
        this.connectionManager.setConnectionReady(videoId);
    }

    isAnyYouTubeStreamReady() {
        return this.connectionManager.isAnyConnectionReady();
    }

    getActiveYouTubeVideoIds() {
        if (!this.connectionManager) {
            return [];
        }
        // Only return connections that are actually ready (have received start event)
        return this.connectionManager.getActiveVideoIds().filter(videoId => 
            this.connectionManager.isConnectionReady(videoId)
        );
    }

    getDetectedStreamIds() {
        if (!this.connectionManager) {
            return [];
        }
        // Return ALL detected streams - chat-independent for viewer count aggregation
        return this.connectionManager.getActiveVideoIds();
    }

    _validateAndFixConfiguration() {
        const fixes = [];
        const invalidValues = [];

        const applyNumericFix = (key, minValue, defaultValue) => {
            const value = this.config[key];
            const isNumber = typeof value === 'number' && !Number.isNaN(value);
            const isValid = isNumber && value >= minValue;

            if (isValid) {
                return;
            }

            invalidValues.push(`${key}=${value}`);
            this.config[key] = defaultValue;
            fixes.push(key);

            this.logger?.warn?.(
                `Invalid ${key} configuration (${value}), defaulting to ${defaultValue}`,
                'youtube'
            );
        };
        
        applyNumericFix('retryAttempts', 1, DEFAULT_YOUTUBE_CONFIG.retryAttempts);
        applyNumericFix('streamPollingInterval', 1, DEFAULT_YOUTUBE_CONFIG.streamPollingInterval);
        applyNumericFix('maxStreams', 0, DEFAULT_YOUTUBE_CONFIG.maxStreams);
        applyNumericFix('fullCheckInterval', 1, DEFAULT_YOUTUBE_CONFIG.fullCheckInterval);
        
        if (fixes.length > 0 && this.logger && this.logger.info) {
            this.logger.info(
                `Applied configuration fixes: ${fixes.join(', ')}`,
                'youtube'
            );
        }

        if (invalidValues.length > 0) {
            const details = invalidValues.join(', ');
            const configError = new Error(`YouTube configuration adjusted for: ${details}`);
            this.errorHandler?.handleConfigurationError?.(configError, 'youtube:config');
        }
    }

    async initialize(handlers = {}, forceReconnect = false) {

        // Validate configuration at initialization time (for test-created instances)
        if (!this.configurationValidated) {
            this._validateAndFixConfiguration();
            this.configurationValidated = true;
        }

        // SMART GUARD: Allow reconnection when new streams are detected
        // Only skip reinitialization if BOTH conditions are true:
        // 1. Already initialized (isInitialized = true)
        // 2. Already have active stream connections (getConnectionCount() > 0)
        // 3. No force reconnect flag
        if (this.isInitialized) {
            // Check if we have active stream connections
            const activeConnectionCount = this.connectionManager.getConnectionCount();

            // Skip reinitialization only if we already have streams connected
            if (activeConnectionCount > 0 && !forceReconnect) {
                this.logger.debug(
                    `Already initialized with ${activeConnectionCount} active stream(s), skipping reinitialization`,
                    'youtube'
                );
                return;
            }

            // Allow reinitialization if:
            // - No active streams (even if initialized), OR
            // - forceReconnect flag is set
            if (activeConnectionCount === 0) {
                this.logger.debug(
                    'Already initialized but no active streams detected, allowing reinitialization for new stream detection',
                    'youtube'
                );
            } else if (forceReconnect) {
                this.logger.debug(
                    'Forcing reinitialization due to explicit reconnection request',
                    'youtube'
                );
            }
        }

        try {
            this.logger.info('Initializing YouTube platform with retry system...', 'youtube');
            
            // Reset retry count on initialization
            this.retrySystem.resetRetryCount('YouTube');
            
            this.handlers = { ...this.handlers, ...handlers };

            if (this.config.enabled && this.config.username) {
                try {
                    await this.startMultiStreamMonitoring();
                } catch (error) {
                    this._handleConnectionErrorLogging(`Failed to start multi-stream monitoring: ${error.message}`, error, 'multi-stream monitoring');
                    throw error;
                }
            }

            // Handle successful connection
            this.retrySystem.handleConnectionSuccess('YouTube', this.connectionManager.getAllConnections(), 'YouTube Live Chat');
            
            // Mark as initialized and update statistics
            this.isInitialized = true;
            
        } catch (error) {
            this._handleProcessingError(`Error during initialization: ${error.message}`, error, 'initialization');
            // Handle connection error with retry logic
            await this.retrySystem.handleConnectionError(
                'YouTube',
                error,
                () => this.initialize(handlers, true),
                () => this.cleanup()
            );
            throw error;
        }
    }

    async startMultiStreamMonitoring() {
        return await this._youtubeMultiStreamManager.startMonitoring();
    }

    async checkMultiStream(options = {}) {
        return await this._youtubeMultiStreamManager.checkMultiStream(options);
    }

    checkStreamShortageAndWarn(availableCount, maxStreams) {
        return this._youtubeMultiStreamManager.checkStreamShortageAndWarn(availableCount, maxStreams);
    }


    async getLiveVideoIds() {
        this.logger.debug('Using youtubei method for stream detection', 'youtube');
        
        // Check configuration for youtubei availability
        if (!this.config.username) {
            throw new Error('YouTube stream detection youtubei failed: No channel username provided. Please configure your YouTube channel username.');
        }
        
        return this.getLiveVideoIdsByYoutubei();
    }



    async getLiveVideoIdsByYoutubei() {
        this.logger.debug('[YouTube] getLiveVideoIdsByYoutubei() called', 'youtube');
        
        const channelHandle = this.config.username;
        if (!channelHandle) {
            const error = new Error('YouTube stream detection youtubei failed: No channel username provided. Please configure your YouTube channel username.');
            this._handleProcessingError(error.message, error, 'stream-detection');
            throw error;
        }

        if (!this.streamDetectionService || typeof this.streamDetectionService.detectLiveStreams !== 'function') {
            const error = new Error('YouTube stream detection youtubei failed: Service unavailable');
            this._handleProcessingError(error.message, error, 'stream-detection');
            throw error;
        }

        const result = await this.streamDetectionService.detectLiveStreams(channelHandle);

        if (result.success && Array.isArray(result.videoIds) && result.videoIds.length > 0) {
            const method = result.detectionMethod || 'youtubei';
            this.logger.debug(`[YouTube] Found ${result.videoIds.length} live streams via youtubei service (method: ${method})`, 'youtube');
            return result.videoIds;
        }

        const message = result.error || result.message || 'No live streams detected';
        this.logger.debug(`[YouTube] youtubei service returned no live streams: ${message}`, 'youtube');
        return [];
    }


    async connectToYouTubeStream(videoId, options = {}) {
        // Check existing connection status before attempting
        const hasExisting = this.connectionManager.hasConnection(videoId);
        
        if (hasExisting) {
            return true; // Already connected
        }

        const previousCount = this.connectionManager.getConnectionCount();
        
        try {
            // Use the centralized connection manager
            const success = await this.connectionManager.connectToStream(
                videoId, 
                (videoId) => this._createYouTubeConnection(videoId),
                { reason: 'stream detected', ...options }
            );
            
            if (success) {
                this.logger.info(`Connected to YouTube stream: ${videoId}`, 'youtube');
                const connectionId = `youtube-${videoId}`;
                const timestamp = new Date().toISOString();
                const chatConnectedEvent = this.eventFactory.createChatConnectedEvent({ videoId, connectionId, timestamp });
                const eventPlatform = chatConnectedEvent.platform;
                this.emit('platform:event', {
                    platform: eventPlatform,
                    type: PlatformEvents.CHAT_CONNECTED,
                    data: chatConnectedEvent
                });
                this._emitStreamStatusIfNeeded(previousCount, {
                    videoId,
                    reason: options.reason || 'stream detected'
                });
            } else {
                this.logger.warn(`Failed to connect to YouTube stream: ${videoId}`, 'youtube');
            }
            
            return success;
            
        } catch (error) {
            this._handleConnectionErrorLogging(`Failed to connect to YouTube stream: ${error.message}`, error, 'stream-connect');
            throw error;
        }
    }

    async _createYouTubeConnection(videoId) {
        try {
            const connection = await this._youtubeConnectionFactory.createConnection(videoId);
            await this._setupConnectionEventListeners(connection, videoId);
            return connection;
        } catch (error) {
            this._handleConnectionErrorLogging(`Failed to create YouTube connection: ${error.message}`, error, 'connection-create');
            throw error;
        }
    }
    
    async _setupConnectionEventListeners(connection, videoId) {
        return await this._youtubeConnectionFactory.setupConnectionEventListeners(connection, videoId);
	    }

    get eventDispatchTable() {
        if (this._cachedEventDispatchTable) {
            return this._cachedEventDispatchTable;
        }
        try {
            this._cachedEventDispatchTable = createYouTubeEventDispatchTable(this);
            return this._cachedEventDispatchTable;
        } catch (error) {
            this._handleProcessingError(`Error creating event dispatch table: ${error.message}`, error, 'configuration');
            throw error;
        }
    }

    handleChatMessage(chatItem) {
        this.logger.debug('handleChatMessage() called', 'youtube');
        
        // Enhanced validation with better error handling
        if (!chatItem) {
            this.logger.debug('Received null/undefined chat item, skipping', 'youtube');
            return;
        }

        // Rate limiting removed - unified processing eliminates spam naturally
        
        const modernEventType = chatItem.item?.type;
        const { normalizedChatItem, eventType, debugMetadata } = normalizeYouTubeChatItem(chatItem);
        const resolvedEventType = eventType || modernEventType;
        if (!normalizedChatItem) {
            this.logger.debug('Chat item has no recognizable structure, skipping', 'youtube', debugMetadata);
            return;
        }

        // Skip events that should be filtered
        if (this._shouldSkipEvent(normalizedChatItem)) {
            this.logger.debug('Skipping filtered event', 'youtube', {
                eventType: resolvedEventType,
                author: normalizedChatItem.author?.name || normalizedChatItem.item?.author?.name
            });
            return;
        }

        // Use dispatch table for event routing (unified processing)
        const handler = this.eventDispatchTable[resolvedEventType];
        if (!handler) {
            this._handleMissingChatEvent(resolvedEventType, normalizedChatItem);
            return;
        }
        
        this.logger.debug('YouTube event routing', 'youtube', {
            eventType: resolvedEventType,
            author: normalizedChatItem.author?.name || normalizedChatItem.item?.author?.name
        });
        
        try {
            handler(normalizedChatItem);
        } catch (error) {
            this._handleProcessingError(
                `Error handling event type ${resolvedEventType}: ${error.message}`,
                error,
                resolvedEventType,
                normalizedChatItem
            );
        }
    }

    async handleSuperChat(chatItem) {
        await this.baseEventHandler.handleEvent(chatItem, {
            eventType: 'superchat',
            dispatchMethod: 'dispatchSuperChat'
        });
    }

    async handleSuperSticker(chatItem) {
        await this.baseEventHandler.handleEvent(chatItem, {
            eventType: 'supersticker',
            dispatchMethod: 'dispatchSuperSticker'
        });
    }



    _shouldSkipEvent(chatItem) {
        return chatItem.type === 'RemoveChatItemByAuthorAction' ||
               chatItem.type === 'RemoveChatItemAction' ||
               chatItem.type === 'MarkChatItemsByAuthorAsDeletedAction';
    }

    _processRegularChatMessage(chatItem, authorName) {
        
        // Normalize message
        const { normalizeYouTubeMessage } = require('../utils/message-normalization');
        const normalizedData = normalizeYouTubeMessage(chatItem, 'youtube', this.timestampService);
        
        
        // Skip empty messages
        if (!normalizedData.message || normalizedData.message.trim() === '') {
            this.logger.debug('Skipping empty message', 'youtube', {
                author: chatItem.author?.name,
                extractedMessage: normalizedData.message
            });
            return;
        }
        
        // Add video ID context
        normalizedData.videoId = chatItem.videoId;
        
        this.logger.debug(`Processing multi-stream chat from ${chatItem.videoId || 'unknown'}: ${normalizedData.username} - ${normalizedData.message}`, 'youtube');

        // Emit standardized chat message event
        try {
            const eventData = this.eventFactory.createChatMessageEvent(normalizedData);
            this._emitPlatformEvent(PlatformEvents.CHAT_MESSAGE, eventData);
            this.logger.debug(`Chat message event emitted for ${normalizedData.username}`, 'youtube');
        } catch (eventError) {
            this._handleProcessingError(`Error emitting chat message event: ${eventError.message}`, eventError, 'chat-message', normalizedData);
        }
    }

    async handleMembership(chatItem) {
        await this.baseEventHandler.handleEvent(chatItem, {
            eventType: 'Membership',
            dispatchMethod: 'dispatchMembership'
        });
    }
    
    async handleGiftMembershipPurchase(chatItem) {
        await this.baseEventHandler.handleEvent(chatItem, {
            eventType: 'GiftMembershipPurchase',
            dispatchMethod: 'dispatchGiftMembership'
        });
    }

    handleGiftMembershipRedemption() {
        // Intentionally no-op to avoid double counting gift membership redemptions.
    }
    
    async handleViewerEngagement(chatItem) {
        if (!this.unifiedNotificationProcessor) {
            const error = new Error('UnifiedNotificationProcessor unavailable for viewer engagement');
            this._handleProcessingError(
                'Viewer engagement notification skipped: unified processor missing',
                error,
                'viewer-engagement',
                chatItem
            );
            return;
        }
        await this.unifiedNotificationProcessor.processNotification(chatItem, 'engagement', {
            isSystemMessage: true
        });
    }
    
    async handleRendererVariant(chatItem, rendererType) {
        const author = chatItem.author?.name || chatItem.item?.author?.name || '';
        const authorLabel = author ? ` from ${author}` : '';
        
        if (this.logger) {
            this.logger.debug(
                `[RENDERER VARIANT] Ignoring ${rendererType}${authorLabel} (duplicate format - using standard handler instead)`,
                'youtube',
                {
                    rendererType,
                    author: author || null,
                    hasStandardHandler: true,
                    action: 'ignored_to_prevent_double_processing'
                }
            );
        }
        
        // Intentionally do nothing - this is a no-op to prevent unknown event logging
        // The corresponding standard format handler will process the actual event
    }
    
    async handleLowPriorityEvent(chatItem, eventType) {
        const author = chatItem.author?.name || chatItem.item?.author?.name || '';
        const authorLabel = author ? ` from ${author}` : '';
        
        if (this.logger) {
            this.logger.debug(
                `[LOW PRIORITY EVENT] Ignoring ${eventType}${authorLabel} (not needed for core functionality)`,
                'youtube',
                {
                    eventType,
                    author: author || null,
                    action: 'ignored_intentionally',
                    reason: 'not_critical_for_core_functionality'
                }
            );
        }
        
        // Intentionally do nothing - this is a no-op to prevent unknown event logging
        // These events are not critical for core streaming functionality
    }
    

    
    async getViewerCount() {
        try {
            this.logger.debug('YouTube getViewerCount() called - using provider', 'youtube');
            
            if (!this.viewerCountProvider) {
                this.logger.warn('Viewer count provider not available', 'youtube');
                return 0;
            }
            
            const viewerCount = await this.viewerCountProvider.getViewerCount();
            this.logger.debug(`Provider returned viewer count: ${viewerCount}`, 'youtube');
            
            return viewerCount;
            
        } catch (error) {
            this._handleProcessingError('Error getting viewer count via provider', error, 'viewer-count');
            return 0;
        }
    }

    async getViewerCountByYoutubei() {
        return await this.getViewerCount();
    }

    async getViewerCountForVideo(videoId) {
        this.logger.debug('Using provider for single video viewer count', 'youtube');
        
        if (!this.viewerCountProvider) {
            this.logger.warn('Viewer count provider not available for single video', 'youtube');
            return 0;
        }
        
        try {
            // Use provider's internal method if available (for single video)
            if (typeof this.viewerCountProvider.getViewerCountForVideo === 'function') {
                return await this.viewerCountProvider.getViewerCountForVideo(videoId);
            } else {
                // Fallback: provider doesn't support single video, return 0
                this.logger.debug('Provider does not support single video viewer count', 'youtube');
                return 0;
            }
        } catch (error) {
            this._handleProcessingError(`Error getting viewer count for video ${videoId} via provider: ${error.message}`, error, 'viewer-count', { videoId });
            return 0;
        }
    }








    async logRawPlatformData(eventType, data) {
        // Delegate to centralized service
        return this.chatFileLoggingService.logRawPlatformData('youtube', eventType, data, this.config);
    }

    async logUnknownEvent(eventType, chatItem, author) {
        const resolvedVideoId = chatItem?.videoId ||
            chatItem?.item?.videoId ||
            this.currentVideoId ||
            'unknown';

        const enhancedData = {
            ...chatItem,
            author,
            metadata: {
                handler: 'handleActions',
                videoId: resolvedVideoId
            }
        };
        // Delegate to centralized service
        return this.chatFileLoggingService.logUnknownEvent('youtube', eventType, enhancedData, this.config);
    }

    getConnectionState() {
        const activeConnections = this.getActiveYouTubeVideoIds();
        const connectionState = {
            isConnected: this.connectionManager ? this.connectionManager.getConnectionCount() > 0 : false,
            isMonitoring: !!this.monitoringInterval,
            activeConnections,
            totalConnections: this.connectionManager ? this.connectionManager.getConnectionCount() : 0
        };

        return connectionState;
    }

    getStats() {
        const stats = {
            platform: 'youtube',
            enabled: this.config.enabled,
            connected: this.connectionManager ? this.connectionManager.getConnectionCount() > 0 : false,
            monitoring: !!this.monitoringInterval,
            activeConnections: this.getActiveYouTubeVideoIds().length,
            totalConnections: this.connectionManager ? this.connectionManager.getConnectionCount() : 0
        };

        return stats;
    }

    isConfigured() {
        return !!(this.config.enabled && this.config.username);
    }

    validateConfig() {
        const issues = [];

        if (!this.config.enabled) {
            issues.push('Platform is disabled');
        }
        
        if (!this.config.username) {
            issues.push('No username configured');
        }
        

        return {
            isValid: issues.length === 0,
            issues: issues
        };
    }


    isConnected() {
        // Use extracted connection service if available
        if (this.connectionManager) {
            return this.connectionManager.getConnectionCount() > 0;
        }
        
        // Fallback to old method
        return this.isAnyYouTubeStreamReady();
    }

    async sendMessage(message) {
        // Try all active multi-stream connections
        for (const videoId of this.connectionManager.getAllVideoIds()) {
            const connection = this.connectionManager.getConnection(videoId);
            if (connection && this.connectionManager.getConnectionStatus(videoId)?.ready) {
                try {
                    const success = await connection.sendMessage(message);
                    if (success) {
                        this.logger.debug(`Message sent to stream ${videoId}`, 'youtube');
                        return true;
                    }
                } catch (error) {
                    this.logger.debug(`Failed to send message to stream ${videoId}: ${error.message}`, 'youtube');
                }
            }
        }
        return false;
    }

    _validateVideoForConnection(videoId, info) {
        const basicInfo = info?.basic_info || {};
        const streamingData = info?.streaming_data || {};
        const playabilityStatus = info?.playability_status || {};
        
        const liveStatus = basicInfo.live_status;
        const liveSignals = {
            isLive: Boolean(basicInfo.is_live),
            isLiveContent: Boolean(basicInfo.is_live_content),
            isLiveDvr: Boolean(basicInfo.is_live_dvr_enabled),
            isLowLatency: Boolean(basicInfo.is_low_latency_live_stream),
            liveStatusFlag: typeof liveStatus === 'string' && liveStatus.toLowerCase().startsWith('live'),
            hasHlsManifest: Boolean(streamingData.hls_manifest_url),
            hasLiveStreamability: Boolean(playabilityStatus.liveStreamability)
        };
        
        const badgeDetectedLive = typeof YouTubeLiveStreamService?.isVideoLive === 'function'
            ? YouTubeLiveStreamService.isVideoLive(basicInfo)
            : false;
        
        const isLive = Object.values(liveSignals).some(Boolean) || badgeDetectedLive;
        const isUpcoming = Boolean(basicInfo.is_upcoming);
        
        this.logger.debug('YouTube live validation snapshot', 'youtube', {
            videoId,
            liveSignals,
            badgeDetectedLive,
            isUpcoming,
            playabilityStatus: playabilityStatus.status || null
        });
        
        if (isLive) {
            this._handlePremiereDetection(videoId, isLive, isUpcoming, info);
            return { shouldConnect: true, isLive, isUpcoming, liveStatus, reason: 'Stream is live' };
        }
        
        if (isUpcoming) {
            return { shouldConnect: false, isLive, isUpcoming, liveStatus, reason: 'Stream is upcoming but not yet live' };
        }
        
        const isPlayable = playabilityStatus.status === undefined || playabilityStatus.status === 'OK';
        
        if (!isPlayable) {
            return { shouldConnect: false, isLive, isUpcoming, liveStatus, reason: 'Video is not live content (replay/VOD)' };
        }
        
        // Default: treat as VOD if no modern live signals are present
        return { shouldConnect: false, isLive, isUpcoming, liveStatus, reason: 'Video is not live content (replay/VOD)' };
    }

    _handlePremiereDetection(videoId, isLive, isUpcoming, info) {
        // Check if this is a YouTube Premiere (both live AND upcoming)
        if (isLive && isUpcoming) {
            const title = info?.basic_info?.title || 'Unknown Title';
            this.logger.info(`Premiere detected: ${title} (${videoId})`, 'youtube');
            this.logger.info('Premiere connection established, waiting for start event...', 'youtube');
        }
    }

    _logMultiStreamStatus(includeDetails = false, includeActiveStreamsList = false) {
        return this._youtubeMultiStreamManager.logStatus(includeDetails, includeActiveStreamsList);
    }

    _generateErrorMessage(context, videoId = null) {
        switch (context) {
            case 'connectToYouTubeStream':
                return `Failed to connect to YouTube stream ${videoId}. This commonly occurs if a stream is a 'Premiere' that has ended, or is not currently live.`;
            case 'liveChatListener':
                return `A live chat error occurred.`;
            case 'checkMultiStream':
                return `Error occurred while checking multi-stream connections.`;
            case 'getLiveVideoIds':
                return `Failed to retrieve live video IDs from YouTube.`;
            default:
                return `An unexpected error occurred in ${context}.`;
        }
    }

    _handleError(error, context, { shouldDisconnect = false, shouldEmit = true, videoId = null } = {}) {
        const errorDetails = error instanceof Error ? error : new Error(JSON.stringify(error, null, 2));
        const message = this._generateErrorMessage(context, videoId);
        const normalizedContext = typeof context === 'object' ? context : { operation: context };

        this._handleProcessingError(`${message} Raw error`, errorDetails, context, { videoId });

        if (shouldEmit) {
            const eventData = this.eventFactory.createErrorEvent({
                error: errorDetails,
                context: normalizedContext,
                recoverable: !shouldDisconnect,
                videoId,
                timestamp: new Date().toISOString()
            });

            const eventPlatform = eventData.platform;
            this.emit('platform:event', {
                platform: eventPlatform,
                type: PlatformEvents.ERROR,
                data: eventData
            });
        }
        if (shouldDisconnect) {
            Promise.resolve(this.cleanup()).catch((cleanupError) => {
                this._handleCleanupErrorLogging(
                    `Error cleaning up after ${context}: ${cleanupError.message}`,
                    cleanupError,
                    'cleanup'
                );
            });
        }
    }

    async reconnect() {
        this.logger.info('Attempting to reconnect to YouTube', 'youtube');
        try {
            await this.initialize(this.handlers);
        } catch (error) {
            this._handleConnectionErrorLogging(`Reconnection failed: ${error.message}`, error, 'reconnect');
            throw error;
        }
    }

    updateViewerCountForStream(streamId, count) {
        if (!this.streamViewerCounts) {
            this.streamViewerCounts = new Map();
        }
        
        this.streamViewerCounts.set(streamId, count);
        this.logger.debug(`Updated viewer count for ${streamId}: ${count}`, 'youtube');

        // Emit total viewer count
        const totalViewers = this.getTotalViewerCount();
        try {
            const eventData = this.eventFactory.createViewerCountEvent({
                count: totalViewers,
                streamId,
                streamViewerCount: count,
                timestamp: new Date().toISOString()
            });
            this._emitPlatformEvent(PlatformEvents.VIEWER_COUNT, eventData);
        } catch (eventError) {
            this._handleProcessingError(`Error emitting viewer count event: ${eventError.message}`, eventError, 'viewer-count', {
                streamId,
                count,
                totalViewers
            });
        }
    }

    getTotalViewerCount() {
        if (!this.streamViewerCounts) {
            return 0;
        }

        let total = 0;
        for (const count of this.streamViewerCounts.values()) {
            total += count;
        }
        return total;
    }

    _emitPlatformEvent(type, payload) {
        const platform = payload?.platform || 'youtube';

        // Emit unified platform:event for local listeners
        this.emit('platform:event', { platform, type, data: payload });

        // Forward to injected handlers (e.g., EventBus via PlatformLifecycleService)
        const handlerMap = {
            [PlatformEvents.CHAT_MESSAGE]: 'onChat',
            [PlatformEvents.GIFT]: 'onGift',
            [PlatformEvents.GIFTPAYPIGGY]: 'onGiftPaypiggy',
            [PlatformEvents.PAYPIGGY]: 'onMembership',
            [PlatformEvents.STREAM_STATUS]: 'onStreamStatus',
            [PlatformEvents.STREAM_DETECTED]: 'onStreamDetected',
            [PlatformEvents.VIEWER_COUNT]: 'onViewerCount'
        };

        const handlerName = handlerMap[type];
        const handler = this.handlers?.[handlerName];

        if (typeof handler === 'function') {
            handler(payload);
        } else {
            this.logger.debug(`No handler registered for event type: ${type}`, 'youtube');
        }
    }

    _emitStreamStatusIfNeeded(previousCount, context = {}) {
        if (!this.connectionManager) {
            return;
        }

        const nextCount = this.connectionManager.getConnectionCount();
        const becameLive = previousCount === 0 && nextCount > 0;
        const wentOffline = previousCount > 0 && nextCount === 0;

        if (!becameLive && !wentOffline) {
            return;
        }

        const isLive = becameLive;
        this._emitPlatformEvent(PlatformEvents.STREAM_STATUS, {
            platform: 'youtube',
            isLive,
            timestamp: new Date().toISOString()
        });

    }

    getHealthStatus() {
        const activeConnections = this.connectionManager ? this.connectionManager.getConnectionCount() : 0;
        const monitoringActive = Boolean(this.monitoringInterval);
        const overall = activeConnections > 0 ? 'healthy' : (monitoringActive ? 'idle' : 'degraded');

        return {
            overall,
            services: {
                connectionManager: activeConnections > 0 ? 'healthy' : 'idle',
                monitoring: monitoringActive ? 'active' : 'stopped'
            },
            lastRecovery: this.lastRecoveryTime || null
        };
    }


    _clearMonitoringInterval() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
    }

    _ensureDataLoggingPath() {
        if (!this.config || !this.config.dataLoggingPath) {
            return;
        }
        try {
            fs.mkdirSync(this.config.dataLoggingPath, { recursive: true });
        } catch (error) {
            this.errorHandler?.handleConfigurationError?.(error, 'youtube:dataLoggingPath');
            this.logger?.warn?.(
                `Failed to prepare data logging path '${this.config.dataLoggingPath}': ${error.message}`,
                'youtube'
            );
        }
    }


    async cleanup() {
        this.logger.debug('Cleaning up YouTube platform resources', 'youtube');

        try {
            this._clearMonitoringInterval();

            if (this.connectionManager) {
                await this.connectionManager.cleanupAllConnections();
                const activeStreams = this.connectionManager.getActiveVideoIds();
                for (const videoId of activeStreams) {
                    await this.connectionManager.removeConnection(videoId);
                }
            }
        } catch (error) {
            this._handleCleanupErrorLogging(`Error disconnecting from YouTube: ${error.message}`, error, 'disconnect');
        }

        try {
            if (this.viewerService) {
                this.viewerService.cleanup();
            }
        } catch (error) {
            this._handleCleanupErrorLogging('Error during cleanup: viewerService', error, 'viewerService');
        }

        this.isInitialized = false;
    }

    isActive() {
        try {
            return this.isConnected() && this.config?.enabled === true;
        } catch (error) {
            this._handleProcessingError('Error checking active status', error, 'active-status');
            return false;
        }
    }

    _extractMessagesFromChatItem(chatItem) {
        try {
            if (!chatItem || typeof chatItem !== 'object') {
                return [];
            }

            // Handle different chat item structures
            const messages = [];
            
            // Check if this is a batched update with multiple actions
            if (chatItem.actions && Array.isArray(chatItem.actions)) {
                // Multiple messages in batch
                for (const action of chatItem.actions) {
                    if (action.addChatItemAction && action.addChatItemAction.item) {
                        messages.push({
                            type: action.addChatItemAction.item.type || 'unknown',
                            item: action.addChatItemAction.item,
                            author: action.addChatItemAction.item.author,
                            message: action.addChatItemAction.item.message,
                            originalChatItem: chatItem
                        });
                    }
                }
            } else {
                // Single message - wrap in standardized format
                messages.push({
                    type: chatItem.type || 'unknown',
                    item: chatItem.item || chatItem,
                    author: chatItem.item?.author || chatItem.author,
                    message: chatItem.item?.message || chatItem.message,
                    originalChatItem: chatItem
                });
            }

            return messages;
        } catch (error) {
            this.logger.debug(`Error extracting messages from chat item: ${error.message}`, 'youtube');
            return [];
        }
    }

    _shouldSkipMessage(message) {
        try {
            if (!message || !message.type) {
                return true; // Skip invalid messages
            }

            // Skip renderer variants that duplicate standard events
            const rendererVariants = [
                'LiveChatPaidMessageRenderer',
                'LiveChatPaidStickerRenderer', 
                'LiveChatMembershipItemRenderer',
                'LiveChatTickerPaidMessageItemRenderer',
                'LiveChatTickerSponsorItemRenderer',
                'LiveChatTickerSponsorshipsItemRenderer',
                'LiveChatSponsorshipsGiftRedemptionAnnouncementRenderer'
            ];

            if (rendererVariants.includes(message.type)) {
                return true; // Skip renderer variants
            }

            // Skip system messages that don't need processing
            const systemMessages = [
                'LiveChatViewerEngagementMessage',
                'LiveChatPurchaseMessage',
                'LiveChatPlaceholderItem',
                'LiveChatSponsorshipsGiftRedemptionAnnouncement',
                'UpdateLiveChatPollAction',
                'RemoveChatItemAction',
                'RemoveChatItemByAuthorAction',
                'MarkChatItemsByAuthorAsDeletedAction'
            ];

            if (systemMessages.includes(message.type)) {
                return true; // Skip system messages
            }

            return false; // Process this message
        } catch (error) {
            this.logger.debug(`Error checking if message should be skipped: ${error.message}`, 'youtube');
            return true; // Skip on error to be safe
        }
    }

    async getConnectionStatus() {
        return {
            platform: 'youtube',
            status: this.isConnected() ? 'connected' : 'disconnected',
            timestamp: new Date().toISOString()
        };
    }

    _handleProcessingError(message, error, eventType = 'general', eventData = null) {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, eventType, eventData, message);
            return;
        }

        this.errorHandler?.logOperationalError(message, eventType, {
            eventData,
            error: error?.message || error
        });
    }

    _handleMissingChatEvent(eventType, chatItem) {
        const resolvedEventType = eventType || 'unknown';
        const author = chatItem.author?.name || chatItem.item?.author?.name || null;
        this.logger?.debug?.(`Unknown event type: ${resolvedEventType}`, 'youtube', {
            eventType: resolvedEventType,
            author
        });
        if (typeof this.logUnknownEvent === 'function') {
            this.logUnknownEvent(resolvedEventType, chatItem, author).catch((error) => {
                this.logger?.debug?.(`Failed to log unknown event: ${error.message}`, 'youtube');
            });
        }
    }

    _handleConnectionErrorLogging(message, error, action = 'operation') {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleConnectionError(error, action, message);
            return;
        }

        this.errorHandler?.logOperationalError(message, action, {
            error: error?.message || error
        });
    }

    _handleCleanupErrorLogging(message, error, resource = 'resource') {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleCleanupError(error, resource, message);
            return;
        }

        this.errorHandler?.logOperationalError(message, resource, {
            error: error?.message || error
        });
    }
}

module.exports = {
    YouTubePlatform
};
