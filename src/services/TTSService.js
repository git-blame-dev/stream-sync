const crypto = require('crypto');
const { safeDelay } = require('../utils/timeout-validator');
const { validateLoggerInterface } = require('../utils/dependency-validator');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { PlatformEvents } = require('../interfaces/PlatformEvents');

class TTSService {
    constructor(config, eventBus = null, options = {}) {
        if (!config || typeof config !== 'object') {
            throw new Error('TTSService requires config object');
        }
        this.config = config;
        this.eventBus = eventBus;
        validateLoggerInterface(options.logger);
        this.logger = options.logger;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'tts-service');

        // TTS providers
        this.provider = options.provider || this._createDefaultProvider();
        this.fallbackProvider = options.fallbackProvider || null;
        this.supportedVoices = options.supportedVoices || [];

        // TTS queue and state management
        this.ttsQueue = [];
        this.isProcessing = false;
        this.currentTTS = null;

        // Performance monitoring
        this.stats = {
            totalRequests: 0,
            successfulSpeech: 0,
            failedSpeech: 0,
            queuedItems: 0,
            avgProcessingTime: 0,
            providerSwitches: 0
        };

        // Health monitoring
        this.healthCheckInterval = options.healthCheckInterval || null;
        this.healthTimer = null;

        if (this.eventBus && typeof this.eventBus.on === 'function') {
            this._setupPlatformEventListeners();
        }

        this.logger.debug('[TTSService] Initialized', 'tts-service', {
            hasConfig: !!config,
            hasEventBus: !!eventBus,
            hasProvider: !!this.provider,
            hasFallback: !!this.fallbackProvider
        });
    }

    async speak(text, options = {}) {
        const startTime = Date.now();
        this.stats.totalRequests++;

        try {
            if (!this._isTTSEnabled()) {
                this.logger.debug('[TTSService] TTS disabled, skipping speech', 'tts-service');
                return false;
            }

            // Validate and clean text
            const cleanText = this._cleanText(text);
            if (!cleanText) {
                this.logger.debug('[TTSService] Empty or invalid text after cleaning, skipping', 'tts-service');
                return false;
            }

            // Validate voice if provided
            let voice = options.voice || this._getDefaultVoice();
            if (this.supportedVoices.length > 0 && !this.supportedVoices.includes(voice)) {
                this.logger.debug(`[TTSService] Unsupported voice '${voice}', using default`, 'tts-service');
                voice = this._getDefaultVoice();
            }

            // Create TTS request
            const ttsRequest = {
                id: `tts_${crypto.randomUUID()}`,
                text: cleanText,
                originalText: text,
                options: {
                    priority: options.priority || 'normal',
                    voice,
                    rate: options.rate || this._getDefaultRate(),
                    volume: options.volume || this._getDefaultVolume(),
                    interrupt: options.interrupt || false,
                    platform: options.platform
                },
                timestamp: Date.now(),
                retries: 0
            };

            // Add to queue or process immediately
            if (ttsRequest.options.interrupt && this.currentTTS) {
                // Interrupt current TTS and process immediately
                await this._interruptAndSpeak(ttsRequest);
            } else {
                // Add to queue with priority handling
                this._addToQueue(ttsRequest);

                // Start processing if not already processing
                if (!this.isProcessing) {
                    this._processQueue();
                }
            }

            this.stats.successfulSpeech++;
            this.stats.avgProcessingTime = (this.stats.avgProcessingTime + (Date.now() - startTime)) / 2;

            this.logger.debug(`[TTSService] TTS request queued: ${cleanText.substring(0, 50)}`, 'tts-service');
            return ttsRequest.id;

        } catch (error) {
            this.stats.failedSpeech++;
            this._handleError(`[TTSService] TTS error: ${error.message}`, error, 'speak');

            return false;
        }
    }

    async stop() {
        try {
            this.ttsQueue = [];
            this.isProcessing = false;
            
            if (this.currentTTS) {
                // Stop current TTS if possible (would need actual TTS engine integration)
                this.logger.debug('[TTSService] Stopping current TTS', 'tts-service');
                this.currentTTS = null;
            }

            this.logger.debug('[TTSService] TTS stopped and queue cleared', 'tts-service');

        } catch (error) {
            const errorMessage = error?.message || String(error);
            this._handleError(`[TTSService] Error stopping TTS: ${errorMessage}`, error, 'stop');
        }
    }

    getStatus() {
        return {
            isEnabled: this._isTTSEnabled(),
            isProcessing: this.isProcessing,
            queueLength: this.ttsQueue.length,
            currentTTS: this.currentTTS ? {
                id: this.currentTTS.id,
                text: this.currentTTS.text.substring(0, 50),
                startTime: this.currentTTS.startTime
            } : null,
            stats: { ...this.stats }
        };
    }

    getConfig() {
        const ttsConfig = this.config.tts || {};
        return {
            enabled: !!this.config.general?.ttsEnabled,
            onlyForGifts: ttsConfig.onlyForGifts,
            voice: ttsConfig.voice || 'default',
            rate: ttsConfig.rate || 1.0,
            volume: ttsConfig.volume || 1.0
        };
    }

    setProvider(provider) {
        try {
            if (!provider || typeof provider.speak !== 'function') {
                this.logger.warn('[TTSService] Invalid provider provided', 'tts-service');
                return false;
            }

            this.provider = provider;
            this.logger.debug(`[TTSService] Provider switched to ${provider.name}`, 'tts-service');
            return true;

        } catch (error) {
            const errorMessage = error?.message || String(error);
            this._handleError(`[TTSService] Error setting provider: ${errorMessage}`, error, 'set-provider');
            return false;
        }
    }

    getCurrentProvider() {
        return this.provider?.name || 'default';
    }

    getQueueStatus() {
        return {
            length: this.ttsQueue.length,
            items: this.ttsQueue.map(item => ({
                id: item.id,
                text: item.text.substring(0, 50),
                priority: item.options.priority,
                timestamp: item.timestamp
            })),
            isProcessing: this.isProcessing
        };
    }

    removeFromQueue(requestId) {
        try {
            const initialLength = this.ttsQueue.length;
            this.ttsQueue = this.ttsQueue.filter(item => item.id !== requestId);

            const removed = this.ttsQueue.length < initialLength;

            if (removed) {
                this.logger.debug(`[TTSService] Removed request ${requestId} from queue`, 'tts-service');

            }

            return removed;

        } catch (error) {
            const errorMessage = error?.message || String(error);
            this._handleError(`[TTSService] Error removing from queue: ${errorMessage}`, error, 'queue-remove');
            return false;
        }
    }

    async getSampleVoices() {
        try {
            if (this.supportedVoices.length > 0) {
                return this.supportedVoices.map(voice => ({
                    id: voice,
                    name: voice,
                    language: voice.split('-').slice(0, 2).join('-')
                }));
            }

            return [{
                id: 'default',
                name: 'Default Voice',
                language: 'en-US'
            }];

        } catch (error) {
            const errorMessage = error?.message || String(error);
            this._handleError(`[TTSService] Error getting sample voices: ${errorMessage}`, error, 'sample-voices');
            return [];
        }
    }

    getHealth() {
        try {
            const primaryAvailable = this.provider && this.provider.isAvailable
                ? this.provider.isAvailable()
                : false;

            const fallbackAvailable = this.fallbackProvider && this.fallbackProvider.isAvailable
                ? this.fallbackProvider.isAvailable()
                : false;

            const isHealthy = primaryAvailable || fallbackAvailable;

            return {
                isHealthy,
                primaryProvider: {
                    name: this.provider?.name || 'none',
                    available: primaryAvailable
                },
                fallbackProvider: {
                    name: this.fallbackProvider?.name || 'none',
                    available: fallbackAvailable
                },
                queueLength: this.ttsQueue.length,
                isProcessing: this.isProcessing,
                stats: { ...this.stats }
            };

        } catch (error) {
            const errorMessage = error?.message || String(error);
            this._handleError(`[TTSService] Error getting health: ${errorMessage}`, error, 'health');
            return { isHealthy: false, error: errorMessage };
        }
    }

    async dispose() {
        try {
            // Stop health monitoring
            if (this.healthTimer) {
                clearInterval(this.healthTimer);
                this.healthTimer = null;
            }

            // Clear queue
            this.ttsQueue = [];
            this.isProcessing = false;
            this.currentTTS = null;

            // Dispose providers
            if (this.provider && typeof this.provider.dispose === 'function') {
                await this.provider.dispose();
            }

            if (this.fallbackProvider && typeof this.fallbackProvider.dispose === 'function') {
                await this.fallbackProvider.dispose();
            }

            this.logger.debug('[TTSService] Service disposed', 'tts-service');
            return true;

        } catch (error) {
            const errorMessage = error?.message || String(error);
            this._handleError(`[TTSService] Error disposing service: ${errorMessage}`, error, 'dispose');
            return false;
        }
    }

    // Private methods

    _isTTSEnabled() {
        return this.getConfig().enabled;
    }

    _cleanText(text) {
        if (!text || typeof text !== 'string') {
            return '';
        }

        let cleanText = text.trim();
        
        // Apply text sanitization in safe order
        // 1. URLs first (before special character sanitization breaks them)
        cleanText = cleanText.replace(/(https?:\/\/[^\s]+)/g, '[FILTERED_URL]');
        
        // 2. Special characters last (but preserve our filter placeholders)
        cleanText = cleanText.replace(/[^\w\s.,!?'\[\]_]/g, '[FILTERED_CHAR]');
        
        // 3. Replace all filter placeholders with consistent [filtered]
        cleanText = cleanText.replace(/\[(FILTERED_URL|FILTERED_CHAR)\]/g, '[filtered]');
        
        // 4. Clean up multiple consecutive [filtered] tokens
        cleanText = cleanText.replace(/(\s*\[filtered\]\s*)+/g, ' [filtered] ').trim();
        
        // Remove excessive whitespace
        cleanText = cleanText.replace(/\s+/g, ' ').trim();
        
        // Limit length (TTS engines often have limits)
        const maxLength = 500;
        if (cleanText.length > maxLength) {
            cleanText = cleanText.substring(0, maxLength) + '...';
        }
        
        return cleanText;
    }

    _getDefaultVoice() {
        return this.getConfig().voice;
    }

    _getDefaultRate() {
        return this.getConfig().rate;
    }

    _getDefaultVolume() {
        return this.getConfig().volume;
    }

    _addToQueue(ttsRequest) {
        this.stats.queuedItems++;
        
        // Insert based on priority
        const priorityOrder = { high: 0, normal: 1, low: 2 };
        const requestPriority = priorityOrder[ttsRequest.options.priority] || 1;
        
        let insertIndex = this.ttsQueue.length;
        for (let i = 0; i < this.ttsQueue.length; i++) {
            const queuePriority = priorityOrder[this.ttsQueue[i].options.priority] || 1;
            if (requestPriority < queuePriority) {
                insertIndex = i;
                break;
            }
        }
        
        this.ttsQueue.splice(insertIndex, 0, ttsRequest);
        
        this.logger.debug(`[TTSService] Added to queue at position ${insertIndex} (priority: ${ttsRequest.options.priority})`, 'tts-service');
    }

    async _processQueue() {
        if (this.isProcessing || this.ttsQueue.length === 0) {
            return;
        }

        this.isProcessing = true;
        
        try {
            while (this.ttsQueue.length > 0) {
                const ttsRequest = this.ttsQueue.shift();
                await this._processTTSRequest(ttsRequest);
                
                // Small delay between TTS requests to prevent overlap
                await safeDelay(100, 100, 'TTS queue spacing');
            }
        } catch (error) {
            this._handleError(`[TTSService] Error processing queue: ${error.message}`, error, 'queue-process');
        } finally {
            this.isProcessing = false;
            this.currentTTS = null;
        }
    }

    async _processTTSRequest(ttsRequest) {
        const startTime = Date.now();
        this.currentTTS = { ...ttsRequest, startTime };

        try {
            // Try primary provider first
            let result;
            let usedProvider = 'primary';

            if (this.provider && this.provider.isAvailable && this.provider.isAvailable()) {
                try {
                    result = await this.provider.speak(ttsRequest.text, ttsRequest.options);
                } catch (error) {
                    this.logger.warn(`[TTSService] Primary provider failed: ${error.message}`, 'tts-service');

                    // Try fallback provider
                    if (this.fallbackProvider && this.fallbackProvider.isAvailable && this.fallbackProvider.isAvailable()) {
                        this.logger.debug('[TTSService] Attempting fallback provider', 'tts-service');

                        this.stats.providerSwitches++;
                        usedProvider = 'fallback';
                        result = await this.fallbackProvider.speak(ttsRequest.text, ttsRequest.options);
                    } else {
                        throw error; // Re-throw if no fallback available
                    }
                }
            } else if (this.fallbackProvider && this.fallbackProvider.isAvailable && this.fallbackProvider.isAvailable()) {
                // Primary not available, use fallback directly
                usedProvider = 'fallback';
                result = await this.fallbackProvider.speak(ttsRequest.text, ttsRequest.options);
            } else {
                // No provider available - simulate for backward compatibility
                const processingTime = Math.min(ttsRequest.text.length * 50, 5000);
                await safeDelay(processingTime, processingTime || 100, 'TTS fallback processing');
                result = { success: true, duration: processingTime };
            }

            const completionDuration = Math.max(1, Date.now() - startTime);

            this.logger.debug(`[TTSService] TTS completed: ${ttsRequest.text.substring(0, 50)} (${completionDuration}ms)`, 'tts-service');

        } catch (error) {
            this._handleError(`[TTSService] TTS processing error: ${error.message}`, error, 'tts-process');

            // Retry logic (simple implementation)
            if (ttsRequest.retries < 2) {
                ttsRequest.retries++;
                this.logger.debug(`[TTSService] Retrying TTS request (attempt ${ttsRequest.retries + 1})`, 'tts-service');
                this.ttsQueue.unshift(ttsRequest); // Add back to front of queue
            }
        }
    }

    async _interruptAndSpeak(ttsRequest) {
        if (this.currentTTS) {
            this.logger.debug('[TTSService] Interrupting current TTS for high priority request', 'tts-service');
        }
        
        // Clear queue and stop current
        this.ttsQueue = [];
        this.currentTTS = null;
        
        // Process immediately
        await this._processTTSRequest(ttsRequest);
    }

    _createDefaultProvider() {
        return {
            name: 'default',
            isAvailable: () => true,
            speak: async (text, options) => {
                // Simulate TTS processing
                const processingTime = Math.min(text.length * 50, 5000);
                await safeDelay(processingTime, processingTime || 100, 'TTS default provider processing');
                return { success: true, duration: processingTime };
            },
            stop: async () => true,
            dispose: async () => true
        };
    }

    _handleError(message, error, context, payload = null) {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, context, payload, message, 'tts-service');
            return;
        }

        if (this.errorHandler) {
            this.errorHandler.logOperationalError(message, 'tts-service', payload || error);
        }
    }

    _setupPlatformEventListeners() {
        this.eventBus.on(PlatformEvents.TTS_SPEECH_REQUESTED, async (data = {}) => {
            try {
                if (!data || typeof data !== 'object') {
                    return;
                }

                if (data.source === 'tts-service') {
                    // Ignore instrumentation events emitted by this service to avoid recursion
                    return;
                }

                if (typeof data.text !== 'string' || !data.text.trim()) {
                    return;
                }

                // Check platform-specific settings
                if (!this._isPlatformTTSEnabled(data.platform)) {
                    this.logger.debug(`[TTSService] TTS disabled for platform ${data.platform}`, 'tts-service');
                    return;
                }

                const baseOptions = data.options && typeof data.options === 'object' ? data.options : {};
                const priority = typeof baseOptions.priority === 'string'
                    ? baseOptions.priority
                    : (data.notificationType === 'gift' ? 'high' : undefined);
                const speakOptions = {
                    ...baseOptions,
                    platform: data.platform
                };
                if (priority) {
                    speakOptions.priority = priority;
                }

                await this.speak(data.text, speakOptions);

            } catch (error) {
                const errorMessage = error?.message || String(error);
                this._handleError(`[TTSService] Error handling TTS speak event: ${errorMessage}`, error, 'tts-speak', data);
            }
        });

        this.logger.debug('[TTSService] TTS event listeners setup', 'tts-service');
    }

    _isPlatformTTSEnabled(platform) {
        const platformSettings = this.config.tts?.platformSettings;
        if (platformSettings && platformSettings[platform]) {
            return platformSettings[platform].enabled !== false;
        }
        return true;
    }
}

function createTTSService(config, eventBus = null, options = {}) {
    return new TTSService(config, eventBus, options);
}

// Export the class and factory
module.exports = {
    TTSService,
    createTTSService
};
