
const { createHttpClient } = require('./http-client');
const { validateExponentialBackoff, safeSetTimeout, safeSetInterval } = require('./timeout-validator');
const { createPlatformErrorHandler: defaultCreatePlatformErrorHandler } = require('./platform-error-handler');
const { validateLoggerInterface } = require('./dependency-validator');
const { YOUTUBE } = require('../core/endpoints');

class StreamDetector {
    constructor(config = {}, services = {}) {
        this.logger = this._resolveLogger(services.logger);
        this.config = this._resolveConfig(config);

        this.retryAttempts = new Map();
        this.retryTimeouts = new Map();

        this.monitoringIntervals = new Map();
        this.platformConfigs = new Map();
        this.platformCallbacks = new Map();
        this.platformStreamStatus = new Map();

        const createPlatformErrorHandler = services.createPlatformErrorHandler || defaultCreatePlatformErrorHandler;
        this._errorHandler = createPlatformErrorHandler(this.logger, 'stream-detector');

        // Optional injected detection services (constructor DI)
        const {
            youtubeDetectionService = null,
            tiktokDetectionService = null
        } = services || {};
        this._youtubeDetectionService = youtubeDetectionService || null;
        this._tiktokDetectionService = tiktokDetectionService || null;

        this.httpClient = services.httpClient || createHttpClient();

        // Internal helpers for lazy creation/caching
        this._dependencyFactory = null;
        this._youtubeLoggerBridge = null;
        
        this.logger.debug('StreamDetector initialized', 'stream-detector', {
            retryInterval: this.config.streamRetryInterval / 1000 + 's',
            maxRetries: this.config.streamMaxRetries,
            continuousMonitoringInterval: this.config.continuousMonitoringInterval / 1000 + 's'
        });
    }

    _resolveLogger(providedLogger) {
        const candidates = [];
        if (providedLogger) {
            candidates.push(providedLogger);
        }

        try {
            const logging = require('../core/logging');
            if (typeof logging.getUnifiedLogger === 'function') {
                const unified = logging.getUnifiedLogger();
                if (unified) {
                    candidates.push(unified);
                }
            }
            if (logging.logger) {
                candidates.push(logging.logger);
            }
        } catch {
            // Logging module may not be initialized yet; continue to other candidates
        }

        if (global.__TEST_LOGGER__) {
            candidates.push(global.__TEST_LOGGER__);
        }

        const selected = candidates.find(Boolean);
        if (!selected) {
            throw new Error('StreamDetector requires a logger dependency');
        }

        const normalized = this._normalizeLoggerMethods(selected);
        validateLoggerInterface(normalized);
        return normalized;
    }

    _normalizeLoggerMethods(logger) {
        const required = ['debug', 'info', 'warn', 'error'];
        const normalized = { ...logger };
        required.forEach((method) => {
            if (typeof normalized[method] !== 'function') {
                normalized[method] = () => {};
            }
        });
        return normalized;
    }

    _resolveConfig(config) {
        if (!config || typeof config !== 'object') {
            throw new Error('StreamDetector requires a config object');
        }

        const streamDetectionEnabled = this._requireBooleanConfig(config.streamDetectionEnabled, 'streamDetectionEnabled');
        const streamRetryInterval = this._requirePositiveNumberConfig(config.streamRetryInterval, 'streamRetryInterval');
        const streamMaxRetries = this._requireStreamMaxRetries(config.streamMaxRetries);
        const continuousMonitoringInterval = this._requirePositiveNumberConfig(config.continuousMonitoringInterval, 'continuousMonitoringInterval');

        return {
            streamDetectionEnabled,
            streamRetryInterval: streamRetryInterval * 1000,
            streamMaxRetries,
            continuousMonitoringInterval: continuousMonitoringInterval * 1000
        };
    }

    _requireBooleanConfig(value, fieldName) {
        if (typeof value !== 'boolean') {
            throw new Error(`StreamDetector requires ${fieldName} to be a boolean`);
        }
        return value;
    }

    _requirePositiveNumberConfig(value, fieldName) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
            throw new Error(`StreamDetector requires ${fieldName} to be a positive number`);
        }
        return value;
    }

    _requireStreamMaxRetries(value) {
        if (typeof value !== 'number' || !Number.isFinite(value) || (value !== -1 && value < 0)) {
            throw new Error('StreamDetector requires streamMaxRetries to be -1 or a non-negative number');
        }
        return value;
    }

    _calculateSafeRetryDelay(attemptNumber) {
        // Use centralized validation utility for consistent timeout handling
        return validateExponentialBackoff(
            this.config.streamRetryInterval, 
            2, // 2x multiplier for exponential backoff
            attemptNumber, 
            300000 // Max 5 minutes
        );
    }

    _getYoutubeLoggerBridge() {
        if (this._youtubeLoggerBridge) {
            return this._youtubeLoggerBridge;
        }

        this._youtubeLoggerBridge = {
            debug: (msg, context) => this.logger.debug(msg, context || 'stream-detector'),
            info: (msg, context) => this.logger.info(msg, context || 'stream-detector'),
            warn: (msg, context) => this.logger.warn(msg, context || 'stream-detector'),
            error: (msg, context, err) => this._handleStreamDetectorError(msg, err, context || 'stream-detector')
        };

        return this._youtubeLoggerBridge;
    }

    async _getYoutubeDetectionService(config) {
        if (this._youtubeDetectionService) {
            return this._youtubeDetectionService;
        }

        // Lazily create required dependencies so tests without youtubei still work
        const { DependencyFactory } = require('./dependency-factory');
        const { InnertubeFactory } = require('../factories/innertube-factory');

        if (!this._dependencyFactory) {
            this._dependencyFactory = new DependencyFactory();
        }

        try {
            const LazyInnertube = InnertubeFactory.createLazyReference();
            const dependencies = this._dependencyFactory.createYoutubeDependencies(config, {
                Innertube: LazyInnertube,
                logger: this._getYoutubeLoggerBridge()
            });

            if (!dependencies || !dependencies.streamDetectionService) {
                throw new Error('YouTube stream detection service not available');
            }

            this._youtubeDetectionService = dependencies.streamDetectionService;
            this.logger.debug('YouTube stream detection service cached for StreamDetector', 'stream-detector');
            return this._youtubeDetectionService;
        } catch (error) {
            this.logger.debug(`Failed to initialize youtube detection service: ${error.message}`, 'stream-detector');
            throw error;
        }
    }

    async startStreamDetection(platform, platformConfig, connectCallback, statusCallback = null) {

        // Skip detection for Twitch (chat always available)
        if (platform === 'twitch') {
            this.logger.debug('Skipping stream detection for Twitch (chat always available)', 'stream-detector');
            return await connectCallback();
        }

        // Skip detection if streamDetectionEnabled is false
        if (!this.config.streamDetectionEnabled) {
            this.logger.debug(`Stream detection disabled, connecting directly to ${platform}`, 'stream-detector');
            return await connectCallback();
        }

        this.logger.info(`Starting stream detection for ${platform}...`, 'stream-detector');
        this.retryAttempts.set(platform, 0);

        // Store platform configuration and callbacks for continuous monitoring
        this.platformConfigs.set(platform, platformConfig);
        this.platformCallbacks.set(platform, { connectCallback, statusCallback });
        this.platformStreamStatus.set(platform, false);

        try {
            const result = await this._detectStreamWithRetry(platform, platformConfig, connectCallback, statusCallback);
            
            // Start continuous monitoring for platforms that support it (currently TikTok and YouTube)
            if (platform === 'tiktok' || platform === 'youtube') {
                this.startContinuousMonitoring(platform);
            }
            
            return result;
        } catch (error) {
            this._handleStreamDetectorError(`Stream detection failed for ${platform}: ${error.message}`, error, 'stream-detection', { platform });
            
            // Still start continuous monitoring even if initial detection failed
            if (platform === 'tiktok' || platform === 'youtube') {
                this.startContinuousMonitoring(platform);
            }
            
            throw error;
        }
    }

    async _detectStreamWithRetry(platform, platformConfig, connectCallback, statusCallback) {
        const attemptNumber = this.retryAttempts.get(platform) || 0;
        this.retryAttempts.set(platform, attemptNumber + 1);

        try {
            const isLive = await this.checkStreamStatus(platform, platformConfig);
            
            if (isLive) {
                this.logger.info(`Stream detected as live for ${platform}, connecting...`, 'stream-detector');
                this._clearRetryTimeout(platform);
                this.retryAttempts.delete(platform);
                
                if (statusCallback) {
                    statusCallback('live', `Stream is live, connecting to ${platform}`);
                }
                
                return await connectCallback();
            } else {
                this.logger.debug(`Stream not live for ${platform} (attempt ${attemptNumber})`, 'stream-detector');
                
                if (statusCallback) {
                    statusCallback('waiting', `Waiting for ${platform} stream to go live (attempt ${attemptNumber})`);
                }

                // Check if we've exceeded max retries
                if (this.config.streamMaxRetries > 0 && attemptNumber >= this.config.streamMaxRetries) {
                    this.logger.warn(`Max retry attempts (${this.config.streamMaxRetries}) reached for ${platform}`, 'stream-detector');
                    if (statusCallback) {
                        statusCallback('failed', `Max retry attempts reached for ${platform}`);
                    }
                    return;
                }

                // Schedule next retry
                this.logger.debug(`Retrying ${platform} stream detection in ${this.config.streamRetryInterval / 1000} seconds`, 'stream-detector');
                
                const timeout = safeSetTimeout(() => {
                    this._detectStreamWithRetry(platform, platformConfig, connectCallback, statusCallback);
                }, this.config.streamRetryInterval);
                
                this.retryTimeouts.set(platform, timeout);
            }
        } catch (error) {
            this._handleStreamDetectorError(`Error detecting stream status for ${platform}`, error, 'stream-detection', { platform });
            
            if (statusCallback) {
                statusCallback('error', `Error detecting ${platform} stream: ${error.message}`);
            }

            // On error, retry with exponential backoff
            const retryDelay = this._calculateSafeRetryDelay(attemptNumber);
            this.logger.debug(`Retrying ${platform} after error in ${retryDelay / 1000} seconds`, 'stream-detector');
            
            const timeout = safeSetTimeout(() => {
                this._detectStreamWithRetry(platform, platformConfig, connectCallback, statusCallback);
            }, retryDelay);
            
            this.retryTimeouts.set(platform, timeout);
        }
    }

    async checkStreamStatus(platform, config) {
        switch (platform) {
            case 'tiktok':
                return await this._checkTikTokStreamStatus(config);
            case 'youtube':
                return await this._checkYouTubeStreamStatus(config);
            case 'twitch':
                return true; // Twitch chat is always available
            default:
                this.logger.warn(`Unknown platform for stream detection: ${platform}`, 'stream-detector');
                return false;
        }
    }

    async _checkTikTokStreamStatus(config) {
        const connection = config.connection || null;

        // Use injected detection service if available
        if (this._tiktokDetectionService && typeof this._tiktokDetectionService.isLive === 'function') {
            try {
                const isLive = await this._tiktokDetectionService.isLive(config.username, connection);
                this.logger.debug(`TikTok stream status via injected service for ${config.username}: ${isLive ? 'LIVE' : 'NOT LIVE'}`, 'stream-detector');
                return !!isLive;
            } catch (error) {
                this.logger.debug(`Injected TikTok detection service failed: ${error.message}`, 'stream-detector');
            }
        }

        if (connection) {
            // Prefer explicit method if provided by the WebSocket client
            if (typeof connection.isConnected === 'function') {
                const isLive = connection.isConnected();
                this.logger.debug(`TikTok stream status via connection.isConnected for ${config.username}: ${isLive ? 'LIVE' : 'NOT LIVE'}`, 'stream-detector');
                return !!isLive;
            }

            // Support connectors that expose state or boolean flags
            if (typeof connection.getState === 'function') {
                const state = connection.getState();
                if (state && typeof state.isConnected !== 'undefined') {
                    const isLive = !!state.isConnected;
                    this.logger.debug(`TikTok stream status via connection.getState for ${config.username}: ${isLive ? 'LIVE' : 'NOT LIVE'}`, 'stream-detector');
                    return isLive;
                }
            }

            if (typeof connection.isConnected === 'boolean') {
                this.logger.debug(`TikTok stream status via boolean isConnected for ${config.username}: ${connection.isConnected ? 'LIVE' : 'NOT LIVE'}`, 'stream-detector');
                return connection.isConnected;
            }

            if (typeof connection.connected === 'boolean') {
                this.logger.debug(`TikTok stream status via boolean connected for ${config.username}: ${connection.connected ? 'LIVE' : 'NOT LIVE'}`, 'stream-detector');
                return connection.connected;
            }
        }

        // With WebSocket client, treat detection as live to allow connection; EulerStream manages live gating
        this.logger.debug(`TikTok WebSocket detection: no connection state available for ${config.username}; allowing connection attempt`, 'stream-detector');
        return true;
    }

    async _checkYouTubeStreamStatus(config) {
        try {
            this.logger.debug(`Checking YouTube stream status for channel: ${config.username}`, 'stream-detector');
            
            // Check for youtubei method
            if (config.streamDetectionMethod === 'youtubei') {
                return await this._checkYouTubeStreamStatusYoutubei(config);
            }
            
            // Default to scraping method
            return await this._checkYouTubeStreamStatusScraping(config);
            
        } catch (error) {
            this.logger.debug(`Error checking YouTube stream status: ${error.message}`, 'stream-detector');
            return false;
        }
    }

    async _checkYouTubeStreamStatusYoutubei(config) {
        try {
            const youtubeService = await this._getYoutubeDetectionService(config);
            if (!youtubeService || typeof youtubeService.detectLiveStreams !== 'function') {
                throw new Error('YouTube stream detection service not available');
            }
            
            const channelToDetect = config.username;
            this.logger.debug(`YouTube detection using username: "${config.username}"`, 'stream-detector');
            const result = await youtubeService.detectLiveStreams(channelToDetect);
            
            if (result.success && result.videoIds && result.videoIds.length > 0) {
                this.logger.debug(`YouTube youtubei detected ${result.videoIds.length} live streams`, 'stream-detector');
                return true;
            }
            
            this.logger.debug(`YouTube youtubei found no live streams`, 'stream-detector');
            return false;
            
        } catch (error) {
            this.logger.debug(`YouTube youtubei service error: ${error.message}`, 'stream-detector');
            throw error; // Re-throw to trigger fallback
        }
    }

    async _checkYouTubeStreamStatusScraping(config) {
        try {
            // Simple HTTP check for YouTube streams page
            const handleForUrl = config.username.startsWith('@') ? config.username : `@${config.username}`;
            const liveUrl = YOUTUBE.buildStreamsUrl(handleForUrl);
            
            const response = await this.httpClient.get(liveUrl);
            
            // Look for specific live stream indicators - more precise than before
            // Use more specific detection to reduce false positives
            const isLive = response.data.includes('"isLiveContent":true') ||
                          (response.data.includes('"style":"LIVE"') && response.data.includes('watching now')) ||
                          response.data.includes('"badges":[{"metadataBadgeRenderer":{"style":"BADGE_STYLE_TYPE_LIVE_NOW"') ||
                          response.data.includes('"text":"LIVE"') && response.data.includes('viewCountText');
            
            this.logger.debug(`YouTube scraping stream status for ${config.username}: ${isLive ? 'LIVE' : 'NOT LIVE'}`, 'stream-detector');
            
            // Additional validation: If we think it's live, double-check with more specific indicators
            if (isLive) {
                const hasLiveBadge = response.data.includes('BADGE_STYLE_TYPE_LIVE_NOW') ||
                                   response.data.includes('"style":"LIVE"');
                const hasViewerCount = response.data.includes('watching now') ||
                                     response.data.includes('viewCountText');
                
                if (!hasLiveBadge && !hasViewerCount) {
                    this.logger.debug(`YouTube scraping stream status refined check - missing live indicators, marking as NOT LIVE`, 'stream-detector');
                    return false;
                }
            }
            
            return isLive;
            
        } catch (error) {
            this.logger.debug(`Error checking YouTube stream status via scraping: ${error.message}`, 'stream-detector');
            return false;
        }
    }

    stopStreamDetection(platform) {
        this._clearRetryTimeout(platform);
        this.retryAttempts.delete(platform);
        this.logger.debug(`Stream detection stopped for ${platform}`, 'stream-detector');
    }

    _clearRetryTimeout(platform) {
        const timeout = this.retryTimeouts.get(platform);
        if (timeout) {
            clearTimeout(timeout);
            this.retryTimeouts.delete(platform);
        }
    }

    startContinuousMonitoring(platform) {
        // Don't start if already monitoring
        if (this.monitoringIntervals.has(platform)) {
            this.logger.debug(`Continuous monitoring already active for ${platform}`, 'stream-detector');
            return;
        }

        this.logger.info(`Starting continuous stream monitoring for ${platform} (interval: ${this.config.continuousMonitoringInterval / 1000}s)`, 'stream-detector');

        const interval = safeSetInterval(async () => {
            await this._performContinuousCheck(platform);
        }, this.config.continuousMonitoringInterval);

        this.monitoringIntervals.set(platform, interval);
    }

    stopContinuousMonitoring(platform) {
        const interval = this.monitoringIntervals.get(platform);
        if (interval) {
            clearInterval(interval);
            this.monitoringIntervals.delete(platform);
            this.logger.debug(`Continuous monitoring stopped for ${platform}`, 'stream-detector');
        }
    }

    async _performContinuousCheck(platform) {
        try {
            const platformConfig = this.platformConfigs.get(platform);
            const callbacks = this.platformCallbacks.get(platform);
            const lastStatus = this.platformStreamStatus.get(platform);

            if (!platformConfig || !callbacks) {
                this.logger.warn(`Missing configuration or callbacks for continuous monitoring of ${platform}`, 'stream-detector');
                return;
            }

            const currentStatus = await this.checkStreamStatus(platform, platformConfig);
            
            // Only act on status changes
            if (currentStatus !== lastStatus) {
                this.platformStreamStatus.set(platform, currentStatus);
                
                if (currentStatus) {
                    // Stream went live - connect
                    this.logger.info(`Stream started for ${platform} - connecting...`, 'stream-detector');
                    
                    if (callbacks.statusCallback) {
                        callbacks.statusCallback('live', `Stream started for ${platform}`);
                    }
                    
                    try {
                        await callbacks.connectCallback();
                        this.logger.info(`Successfully connected to ${platform} stream`, 'stream-detector');
                    } catch (error) {
                        this._handleStreamDetectorError(`Failed to connect to ${platform} stream: ${error.message}`, error, 'stream-monitoring', { platform });
                    }
                } else {
                    // Stream went offline
                    this.logger.info(`Stream ended for ${platform}`, 'stream-detector');
                    
                    if (callbacks.statusCallback) {
                        callbacks.statusCallback('offline', `Stream ended for ${platform}`);
                    }
                }
            } else {
                this.logger.debug(`Stream status unchanged for ${platform}: ${currentStatus ? 'LIVE' : 'OFFLINE'}`, 'stream-detector');
            }
        } catch (error) {
            this._handleStreamDetectorError(`Error during continuous monitoring check for ${platform}: ${error.message}`, error, 'stream-monitoring', { platform });
        }
    }

    getStatus() {
        return {
            enabled: this.config.streamDetectionEnabled,
            retryAttempts: Object.fromEntries(this.retryAttempts),
            monitoringIntervals: Array.from(this.monitoringIntervals.keys()),
            platformConfigs: Array.from(this.platformConfigs.keys()),
            platformStreamStatus: Object.fromEntries(this.platformStreamStatus)
        };
    }

    isEnabled() {
        return this.config.streamDetectionEnabled;
    }

    cleanup() {
        // Clear all retry timeouts
        for (const [platform] of this.retryTimeouts) {
            this._clearRetryTimeout(platform);
        }

        // Clear all monitoring intervals
        for (const [platform] of this.monitoringIntervals) {
            this.stopContinuousMonitoring(platform);
        }

        // Clear all state
        this.retryAttempts.clear();
        this.retryTimeouts.clear();
        this.monitoringIntervals.clear();
        this.platformConfigs.clear();
        this.platformCallbacks.clear();
        this.platformStreamStatus.clear();

        this.logger.debug('StreamDetector cleanup completed', 'stream-detector');
    }
}

module.exports = { StreamDetector };

StreamDetector.prototype._handleStreamDetectorError = function(message, error = null, eventType = 'stream-detector', eventData = null) {
    if (!this._errorHandler) {
        this._errorHandler = defaultCreatePlatformErrorHandler(this.logger, 'stream-detector');
    }

    if (error instanceof Error) {
        this._errorHandler.handleEventProcessingError(error, eventType, eventData, message, 'stream-detector');
        return;
    }

    this._errorHandler.logOperationalError(message, 'stream-detector', eventData);
};
