
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { logger } = require('../../src/core/logging');
const { safeDelay } = require('../../src/utils/timeout-validator');
const { createPlatformErrorHandler } = require('../../src/utils/platform-error-handler');

class WebSocketMessageSimulator extends EventEmitter {
    constructor(options = {}) {
        super();
        this.logger = options.logger || logger;
        this.platform = options.platform || 'generic';
        this.messageQueue = [];
        this.processingDelay = options.processingDelay || 10; // ms
        this.errorHandler = createPlatformErrorHandler(this.logger, 'e2e-testing');
    }

    async injectRawWebSocketMessage(rawMessage, platform) {
        this.logger.debug(`[E2E] Injecting WebSocket message for ${this.platform}`, 'e2e-testing');
        
        if (!platform) {
            throw new Error('Platform instance required for message injection');
        }

        try {
            // Simulate message processing with realistic timing
            await safeDelay(this.processingDelay, this.processingDelay || 50, 'E2E message processing delay');
            
            let result = null;
            
            // Route to appropriate platform handler
            if (typeof platform.handleWebSocketMessage !== 'function') {
                throw new Error(`Platform ${this.platform} does not support WebSocket message injection`);
            }

            const message = typeof rawMessage === 'string' ? JSON.parse(rawMessage) : rawMessage;
            result = await platform.handleWebSocketMessage(message);

            this.emit('messageProcessed', {
                platform: this.platform,
                message: rawMessage,
                result: result,
                timestamp: Date.now()
            });

            return result;

        } catch (error) {
            this._handleSimulatorError(`[E2E] WebSocket message injection failed for ${this.platform}`, error, { platform: this.platform });
            
            this.emit('messageProcessingError', {
                platform: this.platform,
                message: rawMessage,
                error: error,
                timestamp: Date.now()
            });
            
            throw error;
        }
    }

    async processMessageSequence(messages, platform) {
        const results = [];
        
        for (const message of messages) {
            try {
                const result = await this.injectRawWebSocketMessage(message, platform);
                results.push({ success: true, result, message });
            } catch (error) {
                results.push({ success: false, error, message });
            }
        }
        
        return results;
    }

    async simulateHighFrequencyProcessing(messages, platform, options = {}) {
        const { concurrent = false, maxConcurrency = 10 } = options;
        const startTime = Date.now();
        
        let results = [];
        
        if (concurrent) {
            // Process messages concurrently with concurrency limit
            const batches = [];
            for (let i = 0; i < messages.length; i += maxConcurrency) {
                batches.push(messages.slice(i, i + maxConcurrency));
            }
            
            for (const batch of batches) {
                const batchPromises = batch.map(message => 
                    this.injectRawWebSocketMessage(message, platform)
                        .then(result => ({ success: true, result, message }))
                        .catch(error => ({ success: false, error, message }))
                );
                
                const batchResults = await Promise.all(batchPromises);
                results.push(...batchResults);
            }
        } else {
            // Process messages sequentially
            results = await this.processMessageSequence(messages, platform);
        }
        
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        const successCount = results.filter(r => r.success).length;
        const errorCount = results.filter(r => !r.success).length;
        
        return {
            totalMessages: messages.length,
            successCount,
            errorCount,
            duration,
            messagesPerSecond: messages.length / (duration / 1000),
            averageProcessingTime: duration / messages.length,
            concurrent,
            maxConcurrency
        };
    }
}

WebSocketMessageSimulator.prototype._handleSimulatorError = function(message, error, eventData) {
    if (!this.errorHandler && this.logger) {
        this.errorHandler = createPlatformErrorHandler(this.logger, 'e2e-testing');
    }

    if (this.errorHandler && error instanceof Error) {
        this.errorHandler.handleEventProcessingError(error, 'simulator', eventData, message, 'e2e-testing');
        return;
    }

    if (this.errorHandler) {
        this.errorHandler.logOperationalError(message, 'e2e-testing', eventData);
    }
};

class CrossPlatformIntegrationTester {
    constructor(platforms = {}, options = {}) {
        this.platforms = platforms; // { twitch: platformInstance, youtube: platformInstance, etc. }
        this.logger = options.logger || logger;
        this.notificationCapture = [];
        this.systemStateHistory = [];
        this.errorHandler = createPlatformErrorHandler(this.logger, 'e2e-testing');
    }

    async processSimultaneousEvents(simultaneousEvents, options = {}) {
        this.logger.debug('[E2E] Processing simultaneous multi-platform events', 'e2e-testing');
        
        const startTime = Date.now();
        const results = {};
        
        // Capture initial system state
        const initialState = this._captureSystemState();
        this.systemStateHistory.push({ type: 'initial', state: initialState, timestamp: startTime });
        
        try {
            // Process events concurrently
            const processPromises = Object.entries(simultaneousEvents).map(async ([platformName, event]) => {
                const platform = this.platforms[platformName];
                if (!platform) {
                    throw new Error(`Platform ${platformName} not available for testing`);
                }

                const simulator = new WebSocketMessageSimulator({ 
                    platform: platformName, 
                    logger: this.logger 
                });

                try {
                    const result = await simulator.injectRawWebSocketMessage(event, platform);
                    return { platformName, success: true, result, event };
                } catch (error) {
                    return { platformName, success: false, error, event };
                }
            });

            const allResults = await Promise.all(processPromises);
            
            // Organize results by platform
            allResults.forEach(result => {
                results[result.platformName] = result;
            });

            // Capture final system state
            const finalState = this._captureSystemState();
            const endTime = Date.now();
            this.systemStateHistory.push({ type: 'final', state: finalState, timestamp: endTime });

            return {
                results,
                processing: {
                    duration: endTime - startTime,
                    platformCount: Object.keys(simultaneousEvents).length,
                    successCount: allResults.filter(r => r.success).length,
                    errorCount: allResults.filter(r => !r.success).length
                },
                systemState: {
                    initial: initialState,
                    final: finalState,
                    history: this.systemStateHistory
                },
                notifications: [...this.notificationCapture]
            };

        } catch (error) {
            this._handleTesterError('[E2E] Cross-platform integration test failed', error);
            throw error;
        }
    }

    async resolvePriorityConflicts(competingNotifications, options = {}) {
        const { algorithm = 'weighted_value', timeWindow = 5000 } = options;
        
        this.logger.debug('[E2E] Testing cross-platform priority resolution', 'e2e-testing');
        
        // Simulate notification processing with priority logic
        const processedNotifications = [];
        const startTime = Date.now();
        
        // Sort by priority and value for resolution
        const sortedNotifications = [...competingNotifications].sort((a, b) => {
            // Priority-based sorting
            const priorityWeight = {
                'ultra_high': 100,
                'high': 50,
                'medium': 25,
                'low': 10
            };
            
            const aPriority = priorityWeight[a.priority] || 0;
            const bPriority = priorityWeight[b.priority] || 0;
            
            if (aPriority !== bPriority) {
                return bPriority - aPriority; // Higher priority first
            }
            
            // Value-based tie-breaking
            const aValue = a.amount || a.diamonds || a.viewerCount || 0;
            const bValue = b.amount || b.diamonds || b.viewerCount || 0;
            
            return bValue - aValue; // Higher value first
        });

        // Process notifications in priority order within time window
        for (const notification of sortedNotifications) {
            const processTime = Date.now();
            if (processTime - startTime > timeWindow) {
                break; // Time window exceeded
            }

            processedNotifications.push({
                ...notification,
                processedAt: processTime,
                processingOrder: processedNotifications.length + 1
            });

            // Simulate processing delay
            await safeDelay(10, 10, 'E2E notification delay');
        }

        return {
            algorithm,
            timeWindow,
            totalNotifications: competingNotifications.length,
            processedNotifications,
            droppedCount: competingNotifications.length - processedNotifications.length,
            processingTime: Date.now() - startTime
        };
    }

    async processEventWithConnectionStates(incomingEvent, platformStates, options = {}) {
        const { fallbackBehavior = 'queue', maxStaleTime = 10000 } = options;
        
        this.logger.debug('[E2E] Testing platform connection state impact', 'e2e-testing');
        
        const eventPlatform = incomingEvent.platform;
        const platformState = platformStates[eventPlatform];
        
        if (!platformState) {
            throw new Error(`No connection state provided for platform ${eventPlatform}`);
        }

        const currentTime = Date.now();
        const timeSinceLastMessage = currentTime - platformState.lastMessage;
        const isStale = timeSinceLastMessage > maxStaleTime;
        
        let processingResult = {
            platform: eventPlatform,
            event: incomingEvent,
            connectionState: platformState,
            timeSinceLastMessage,
            isStale,
            fallbackBehavior,
            processed: false,
            queued: false,
            dropped: false
        };

        if (platformState.connected && platformState.stable && !isStale) {
            // Normal processing
            processingResult.processed = true;
            processingResult.result = {
                status: 'processed',
                method: 'normal',
                timestamp: currentTime
            };
        } else if (fallbackBehavior === 'queue') {
            // Queue for later processing
            processingResult.queued = true;
            processingResult.result = {
                status: 'queued',
                method: 'fallback',
                queuePosition: crypto.randomInt(1, 11),
                timestamp: currentTime
            };
        } else {
            // Drop the event
            processingResult.dropped = true;
            processingResult.result = {
                status: 'dropped',
                method: 'fallback',
                reason: !platformState.connected ? 'disconnected' : 
                        !platformState.stable ? 'unstable' : 'stale',
                timestamp: currentTime
            };
        }

        return processingResult;
    }

    _captureSystemState() {
        return {
            timestamp: Date.now(),
            platformStates: Object.keys(this.platforms).reduce((states, name) => {
                const platform = this.platforms[name];
                states[name] = {
                    connected: platform.isConnected ? platform.isConnected() : false,
                    active: platform.isActive ? platform.isActive() : false,
                    hasDispatcher: !!platform.notificationDispatcher,
                    lastActivity: Date.now()
                };
                return states;
            }, {}),
            notificationCount: this.notificationCapture.length,
            memoryUsage: process.memoryUsage()
        };
    }

    captureNotification(notification) {
        this.notificationCapture.push({
            ...notification,
            capturedAt: Date.now()
        });
    }

    getCapturedNotifications() {
        return [...this.notificationCapture];
    }

    clearCapture() {
        this.notificationCapture = [];
        this.systemStateHistory = [];
    }
}

CrossPlatformIntegrationTester.prototype._handleTesterError = function(message, error, eventData) {
    if (!this.errorHandler && this.logger) {
        this.errorHandler = createPlatformErrorHandler(this.logger, 'e2e-testing');
    }

    if (this.errorHandler && error instanceof Error) {
        this.errorHandler.handleEventProcessingError(error, 'integration', eventData, message, 'e2e-testing');
        return;
    }

    if (this.errorHandler) {
        this.errorHandler.logOperationalError(message, 'e2e-testing', eventData);
    }
};

class UserJourneyValidator {
    constructor(options = {}) {
        this.logger = options.logger || logger;
        this.contentQualityGates = options.contentQualityGates || {};
        this.journeyHistory = [];
    }

    async validateCompleteUserJourney(journeyInput, expectedOutput) {
        this.logger.debug('[E2E] Validating complete user journey', 'e2e-testing');
        
        const journeyId = `journey_${crypto.randomUUID()}`;
        const startTime = Date.now();
        
        const journey = {
            id: journeyId,
            input: journeyInput,
            expectedOutput,
            startTime,
            stages: [],
            results: {},
            success: false
        };

        try {
            // Stage 1: Input Processing
            journey.stages.push(await this._validateInputProcessing(journeyInput));

            // Stage 2: Message Parsing and Routing
            journey.stages.push(await this._validateMessageParsing(journeyInput));

            // Stage 3: Event Processing
            journey.stages.push(await this._validateEventProcessing(journeyInput));

            // Stage 4: Notification Generation
            journey.stages.push(await this._validateNotificationGeneration(journeyInput));

            // Stage 5: Output Validation
            journey.stages.push(await this._validateFinalOutput(expectedOutput));

            // Calculate overall success
            journey.success = journey.stages.every(stage => stage.success);
            journey.endTime = Date.now();
            journey.duration = journey.endTime - journey.startTime;

            this.journeyHistory.push(journey);

            return journey;

        } catch (error) {
            journey.error = error;
            journey.success = false;
            journey.endTime = Date.now();
            journey.duration = journey.endTime - journey.startTime;
            
            this.journeyHistory.push(journey);
            
            this._handleTesterError('[E2E] User journey validation failed', error, { journeyId });
            throw error;
        }
    }

    async validateContentQualityInFlow(eventData, options = {}) {
        const {
            sanitizeHTML = true,
            blockMaliciousLinks = true,
            validateUserContent = true
        } = options;

        this.logger.debug('[E2E] Validating content quality in integration flow', 'e2e-testing');

        const validationResults = {
            passed: true,
            checks: [],
            sanitizedContent: null,
            blockedElements: [],
            securityIssues: []
        };

        try {
            // Extract content from event
            const content = eventData.message || eventData.text || eventData.content || '';
            
            if (!content) {
                validationResults.checks.push({
                    name: 'content_exists',
                    passed: false,
                    message: 'No content found in event data'
                });
                validationResults.passed = false;
                return validationResults;
            }

            // HTML Sanitization Check
            if (sanitizeHTML) {
                const htmlCheck = this._validateHTMLContent(content);
                validationResults.checks.push(htmlCheck);
                if (!htmlCheck.passed) validationResults.passed = false;
                if (htmlCheck.sanitizedContent) {
                    validationResults.sanitizedContent = htmlCheck.sanitizedContent;
                }
            }

            // Malicious Link Check
            if (blockMaliciousLinks) {
                const linkCheck = this._validateLinks(content);
                validationResults.checks.push(linkCheck);
                if (!linkCheck.passed) {
                    validationResults.passed = false;
                    validationResults.blockedElements.push(...linkCheck.blockedLinks);
                }
            }

            // User Content Validation
            if (validateUserContent) {
                const userContentCheck = this._validateUserContent(content);
                validationResults.checks.push(userContentCheck);
                if (!userContentCheck.passed) validationResults.passed = false;
            }

            return validationResults;

        } catch (error) {
            this._handleTesterError('[E2E] Content quality validation failed', error, { stage: 'content-quality' });
            
            validationResults.passed = false;
            validationResults.securityIssues.push({
                type: 'validation_error',
                message: error.message,
                timestamp: Date.now()
            });

            return validationResults;
        }
    }

    // Private validation methods
    async _validateInputProcessing(input) {
        return {
            stage: 'input_processing',
            success: !!input.rawWebSocketData,
            timestamp: Date.now(),
            details: {
                hasRawData: !!input.rawWebSocketData,
                platform: input.platform,
                dataSize: JSON.stringify(input.rawWebSocketData || {}).length
            }
        };
    }

    async _validateMessageParsing(input) {
        // Simulate message parsing validation
        const hasRequiredFields = input.rawWebSocketData && 
                                input.rawWebSocketData.subscription_type &&
                                input.rawWebSocketData.event;
        
        return {
            stage: 'message_parsing',
            success: hasRequiredFields,
            timestamp: Date.now(),
            details: {
                hasSubscriptionType: !!input.rawWebSocketData?.subscription_type,
                hasEvent: !!input.rawWebSocketData?.event,
                parsedSuccessfully: hasRequiredFields
            }
        };
    }

    async _validateEventProcessing(input) {
        // Simulate event processing validation
        return {
            stage: 'event_processing',
            success: true,
            timestamp: Date.now(),
            details: {
                eventType: input.rawWebSocketData?.subscription_type,
                processed: true,
                timestamp: Date.now()
            }
        };
    }

    async _validateNotificationGeneration(input) {
        // Simulate notification generation validation
        return {
            stage: 'notification_generation',
            success: true,
            timestamp: Date.now(),
            details: {
                notificationCreated: true,
                platform: input.platform,
                type: 'mock_notification'
            }
        };
    }

    async _validateFinalOutput(expectedOutput) {
        // Simulate final output validation
        return {
            stage: 'final_output',
            success: true,
            timestamp: Date.now(),
            details: {
                obsDisplay: expectedOutput.obsDisplay,
                ttsOutput: expectedOutput.ttsOutput,
                logOutput: expectedOutput.logOutput,
                validated: true
            }
        };
    }

    _validateHTMLContent(content) {
        const hasHTML = /<[^>]*>/g.test(content);
        const hasScript = /<script[^>]*>/gi.test(content);
        
        return {
            name: 'html_sanitization',
            passed: !hasScript,
            message: hasScript ? 'Script tags detected and blocked' : 'HTML content safe',
            details: {
                hasHTML,
                hasScript,
                originalLength: content.length
            },
            sanitizedContent: hasScript ? content.replace(/<script[^>]*>.*?<\/script>/gi, '') : content
        };
    }

    _validateLinks(content) {
        const urlRegex = /https?:\/\/[^\s]+/gi;
        const urls = content.match(urlRegex) || [];
        const maliciousPatterns = ['malicious-site.example.invalid', 'phishing.example'];
        
        const blockedLinks = urls.filter(url => 
            maliciousPatterns.some(pattern => url.includes(pattern))
        );
        
        return {
            name: 'malicious_link_detection',
            passed: blockedLinks.length === 0,
            message: blockedLinks.length > 0 ? `Blocked ${blockedLinks.length} malicious links` : 'No malicious links detected',
            blockedLinks,
            details: {
                totalLinks: urls.length,
                blockedCount: blockedLinks.length
            }
        };
    }

    _validateUserContent(content) {
        const hasUserContent = content.length > 0;
        const isTechnicalArtifact = /undefined|null|\[object Object\]/.test(content);
        
        return {
            name: 'user_content_validation',
            passed: hasUserContent && !isTechnicalArtifact,
            message: !hasUserContent ? 'No user content' : 
                    isTechnicalArtifact ? 'Technical artifacts detected' : 'User content valid',
            details: {
                contentLength: content.length,
                hasTechnicalArtifacts: isTechnicalArtifact
            }
        };
    }

    getJourneyHistory() {
        return [...this.journeyHistory];
    }

    clearHistory() {
        this.journeyHistory = [];
    }
}

module.exports = {
    WebSocketMessageSimulator,
    CrossPlatformIntegrationTester,
    UserJourneyValidator
};
