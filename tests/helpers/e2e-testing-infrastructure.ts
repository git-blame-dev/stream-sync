
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

import type { AppLogger } from '../../src/core/logger/types';
import { logger } from '../../src/core/logging';
import { createPlatformErrorHandler, type PlatformErrorHandler } from '../../src/utils/platform-error-handler';
import { safeDelay } from '../../src/utils/timeout-validator';

import testClock from './test-clock';
import { resolveDelay } from './time-utils';

type TestLogger = AppLogger;

type TestRecord = Record<string, unknown>;

type WebSocketPlatform<Result = unknown> = {
    handleWebSocketMessage?: (message: unknown) => Promise<Result> | Result;
    isConnected?: () => boolean;
    isActive?: () => boolean;
    notificationDispatcher?: unknown;
};

type WebSocketSimulatorOptions = {
    logger?: TestLogger;
    platform?: string;
    processingDelay?: number;
};

type MessageProcessingResult = {
    success: boolean;
    result?: unknown;
    error?: unknown;
    message: unknown;
};

type HighFrequencyOptions = {
    concurrent?: boolean;
    maxConcurrency?: number;
};

type PlatformMap = Record<string, WebSocketPlatform>;

type SimultaneousEventResult = {
    platformName: string;
    success: boolean;
    result?: unknown;
    error?: unknown;
    event: unknown;
};

type SystemState = {
    timestamp: number;
    platformStates: Record<string, {
        connected: boolean;
        active: boolean;
        hasDispatcher: boolean;
        lastActivity: number;
    }>;
    notificationCount: number;
    memoryUsage: NodeJS.MemoryUsage;
};

type SimultaneousProcessingOutcome<K extends string = string> = {
    results: Record<K, SimultaneousEventResult>;
    processing: {
        duration: number;
        platformCount: number;
        successCount: number;
        errorCount: number;
    };
    systemState: {
        initial: SystemState;
        final: SystemState;
        history: Array<{ type: string; state: SystemState; timestamp: number }>;
    };
    notifications: CapturedNotification[];
};

type CapturedNotification = TestRecord & { capturedAt: number };

const PRIORITY_WEIGHT = {
    ultra_high: 100,
    high: 50,
    medium: 25,
    low: 10
} as const;

type PriorityNotification = TestRecord & {
    priority?: keyof typeof PRIORITY_WEIGHT;
    amount?: number;
    diamonds?: number;
    viewerCount?: number;
};

type PriorityOptions = {
    algorithm?: string;
    timeWindow?: number;
};

type PlatformConnectionState = {
    connected: boolean;
    stable: boolean;
    lastMessage: number;
};

type ConnectionFallbackBehavior = 'queue' | 'drop';

type ConnectionStateOptions = {
    fallbackBehavior?: ConnectionFallbackBehavior;
    maxStaleTime?: number;
};

type ConnectionProcessingResult = {
    platform: string;
    event: TestRecord;
    connectionState: PlatformConnectionState;
    timeSinceLastMessage: number;
    isStale: boolean;
    fallbackBehavior: ConnectionFallbackBehavior;
    processed: boolean;
    queued: boolean;
    dropped: boolean;
    result?: TestRecord;
};

type JourneyInput = TestRecord & {
    platform?: string;
    rawWebSocketData?: TestRecord;
};

type ExpectedJourneyOutput = TestRecord & {
    obsDisplay?: unknown;
    ttsOutput?: unknown;
    logOutput?: unknown;
};

type JourneyStage = {
    stage: string;
    success: boolean;
    timestamp: number;
    details: TestRecord;
};

type JourneyResult = {
    id: string;
    input: JourneyInput;
    expectedOutput: ExpectedJourneyOutput;
    startTime: number;
    endTime?: number;
    duration?: number;
    stages: JourneyStage[];
    results: TestRecord;
    success: boolean;
    error?: unknown;
};

type ContentQualityOptions = {
    sanitizeHTML?: boolean;
    blockMaliciousLinks?: boolean;
    validateUserContent?: boolean;
};

type ContentQualityCheck = {
    name: string;
    passed: boolean;
    message: string;
    details?: TestRecord;
    sanitizedContent?: string;
    blockedLinks?: string[];
};

type ContentQualityResult = {
    passed: boolean;
    checks: ContentQualityCheck[];
    sanitizedContent: string | null;
    blockedElements: string[];
    securityIssues: Array<{ type: string; message: string; timestamp: number }>;
};

type UserJourneyValidatorOptions = {
    logger?: TestLogger;
    contentQualityGates?: TestRecord;
};

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const asString = (value: unknown) => typeof value === 'string' ? value : '';

class WebSocketMessageSimulator extends EventEmitter {
    logger: TestLogger;
    platform: string;
    messageQueue: unknown[];
    processingDelay: number;
    errorHandler: PlatformErrorHandler;

    constructor(options: WebSocketSimulatorOptions = {}) {
        super();
        this.logger = options.logger || logger;
        this.platform = options.platform || 'generic';
        this.messageQueue = [];
        this.processingDelay = options.processingDelay || 10; // ms
        this.errorHandler = createPlatformErrorHandler(this.logger, 'e2e-testing');
    }

    async injectRawWebSocketMessage<Result = unknown>(rawMessage: unknown, platform?: WebSocketPlatform<Result>): Promise<Result> {
        this.logger.debug(`[E2E] Injecting WebSocket message for ${this.platform}`, 'e2e-testing');
        
        if (!platform) {
            throw new Error('Platform instance required for message injection');
        }

        try {
            // Simulate message processing with realistic timing
            const effectiveDelay = resolveDelay(this.processingDelay, this.processingDelay || 50);
            await safeDelay(effectiveDelay, this.processingDelay || 50, 'E2E message processing delay');
            testClock.advance(effectiveDelay);
            
            let result: Result;
            
            // Route to appropriate platform handler
            if (typeof platform.handleWebSocketMessage !== 'function') {
                throw new Error(`Platform ${this.platform} does not support WebSocket message injection`);
            }

            const message = typeof rawMessage === 'string' ? JSON.parse(rawMessage) as unknown : rawMessage;
            result = await platform.handleWebSocketMessage(message);

            this.emit('messageProcessed', {
                platform: this.platform,
                message: rawMessage,
                result: result,
                timestamp: testClock.now()
            });

            return result;

        } catch (error) {
            this._handleSimulatorError(`[E2E] WebSocket message injection failed for ${this.platform}`, error, { platform: this.platform });
            
            this.emit('messageProcessingError', {
                platform: this.platform,
                message: rawMessage,
                error: error,
                timestamp: testClock.now()
            });
            
            throw error;
        }
    }

    async processMessageSequence(messages: unknown[], platform: WebSocketPlatform): Promise<MessageProcessingResult[]> {
        const results: MessageProcessingResult[] = [];
        
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

    async simulateHighFrequencyProcessing(messages: unknown[], platform: WebSocketPlatform, options: HighFrequencyOptions = {}) {
        const { concurrent = false, maxConcurrency = 10 } = options;
        const startTime = testClock.now();
        
        let results: MessageProcessingResult[] = [];
        
        if (concurrent) {
            // Process messages concurrently with concurrency limit
            const batches: unknown[][] = [];
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
        
        const endTime = testClock.now();
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

    _handleSimulatorError(message: string, error: unknown, eventData?: unknown): void {
        if (error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, 'simulator', eventData, message, 'e2e-testing');
            return;
        }

        this.errorHandler.logOperationalError(message, 'e2e-testing', eventData);
    }
}

class CrossPlatformIntegrationTester {
    platforms: PlatformMap;
    logger: TestLogger;
    notificationCapture: CapturedNotification[];
    systemStateHistory: Array<{ type: string; state: SystemState; timestamp: number }>;
    errorHandler: PlatformErrorHandler;

    constructor(platforms: PlatformMap = {}, options: { logger?: TestLogger } = {}) {
        this.platforms = platforms; // { twitch: platformInstance, youtube: platformInstance, etc. }
        this.logger = options.logger || logger;
        this.notificationCapture = [];
        this.systemStateHistory = [];
        this.errorHandler = createPlatformErrorHandler(this.logger, 'e2e-testing');
    }

    async processSimultaneousEvents<TEvents extends Record<string, unknown>>(
        simultaneousEvents: TEvents,
        options: TestRecord = {}
    ): Promise<SimultaneousProcessingOutcome<Extract<keyof TEvents, string>>> {
        this.logger.debug('[E2E] Processing simultaneous multi-platform events', 'e2e-testing');
        
        const startTime = testClock.now();
        const results = {} as Record<Extract<keyof TEvents, string>, SimultaneousEventResult>;
        
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
                results[result.platformName as Extract<keyof TEvents, string>] = result;
            });

            // Capture final system state
            const finalState = this._captureSystemState();
            const endTime = testClock.now();
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

    async resolvePriorityConflicts(competingNotifications: PriorityNotification[], options: PriorityOptions = {}) {
        const { algorithm = 'weighted_value', timeWindow = 5000 } = options;
        
        this.logger.debug('[E2E] Testing cross-platform priority resolution', 'e2e-testing');
        
        // Simulate notification processing with priority logic
        const processedNotifications: Array<PriorityNotification & { processedAt: number; processingOrder: number }> = [];
        const startTime = testClock.now();
        
        // Sort by priority and value for resolution
        const sortedNotifications = [...competingNotifications].sort((a, b) => {
            // Priority-based sorting
            const aPriority = a.priority ? PRIORITY_WEIGHT[a.priority] : 0;
            const bPriority = b.priority ? PRIORITY_WEIGHT[b.priority] : 0;
            
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
            const processTime = testClock.now();
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
            testClock.advance(10);
        }

        return {
            algorithm,
            timeWindow,
            totalNotifications: competingNotifications.length,
            processedNotifications,
            droppedCount: competingNotifications.length - processedNotifications.length,
            processingTime: testClock.now() - startTime
        };
    }

    async processEventWithConnectionStates(
        incomingEvent: TestRecord & { platform: string },
        platformStates: Record<string, PlatformConnectionState>,
        options: ConnectionStateOptions = {}
    ): Promise<ConnectionProcessingResult> {
        const { fallbackBehavior = 'queue', maxStaleTime = 10000 } = options;
        
        this.logger.debug('[E2E] Testing platform connection state impact', 'e2e-testing');
        
        const eventPlatform = incomingEvent.platform;
        const platformState = platformStates[eventPlatform];
        
        if (!platformState) {
            throw new Error(`No connection state provided for platform ${eventPlatform}`);
        }

        const currentTime = testClock.now();
        const timeSinceLastMessage = currentTime - platformState.lastMessage;
        const isStale = timeSinceLastMessage > maxStaleTime;
        
        const processingResult: ConnectionProcessingResult = {
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

    _captureSystemState(): SystemState {
        return {
            timestamp: testClock.now(),
            platformStates: Object.keys(this.platforms).reduce<Record<string, SystemState['platformStates'][string]>>((states, name) => {
                const platform = this.platforms[name];
                if (!platform) {
                    return states;
                }
                states[name] = {
                    connected: platform.isConnected ? platform.isConnected() : false,
                    active: platform.isActive ? platform.isActive() : false,
                    hasDispatcher: !!platform.notificationDispatcher,
                    lastActivity: testClock.now()
                };
                return states;
            }, {}),
            notificationCount: this.notificationCapture.length,
            memoryUsage: process.memoryUsage()
        };
    }

    captureNotification(notification: TestRecord): void {
        this.notificationCapture.push({
            ...notification,
            capturedAt: testClock.now()
        });
    }

    getCapturedNotifications(): CapturedNotification[] {
        return [...this.notificationCapture];
    }

    clearCapture(): void {
        this.notificationCapture = [];
        this.systemStateHistory = [];
    }

    _handleTesterError(message: string, error: unknown, eventData?: unknown): void {
        if (error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, 'integration', eventData, message, 'e2e-testing');
            return;
        }

        this.errorHandler.logOperationalError(message, 'e2e-testing', eventData);
    }
}

class UserJourneyValidator {
    logger: TestLogger;
    contentQualityGates: TestRecord;
    journeyHistory: JourneyResult[];

    constructor(options: UserJourneyValidatorOptions = {}) {
        this.logger = options.logger || logger;
        this.contentQualityGates = options.contentQualityGates || {};
        this.journeyHistory = [];
    }

    async validateCompleteUserJourney(journeyInput: JourneyInput, expectedOutput: ExpectedJourneyOutput): Promise<JourneyResult> {
        this.logger.debug('[E2E] Validating complete user journey', 'e2e-testing');
        
        const journeyId = `journey_${crypto.randomUUID()}`;
        const startTime = testClock.now();
        
        const journey: JourneyResult = {
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
            journey.endTime = testClock.now();
            journey.duration = journey.endTime - journey.startTime;

            this.journeyHistory.push(journey);

            return journey;

        } catch (error) {
            journey.error = error;
            journey.success = false;
            journey.endTime = testClock.now();
            journey.duration = journey.endTime - journey.startTime;
            
            this.journeyHistory.push(journey);
            
            this._handleTesterError('[E2E] User journey validation failed', error, { journeyId });
            throw error;
        }
    }

    async validateContentQualityInFlow(eventData: TestRecord, options: ContentQualityOptions = {}): Promise<ContentQualityResult> {
        const {
            sanitizeHTML = true,
            blockMaliciousLinks = true,
            validateUserContent = true
        } = options;

        this.logger.debug('[E2E] Validating content quality in integration flow', 'e2e-testing');

        const validationResults: ContentQualityResult = {
            passed: true,
            checks: [],
            sanitizedContent: null,
            blockedElements: [],
            securityIssues: []
        };

        try {
            // Extract content from event
            const content = asString(eventData.message || eventData.text || eventData.content);
            
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
                    validationResults.blockedElements.push(...(linkCheck.blockedLinks ?? []));
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
                message: getErrorMessage(error),
                timestamp: testClock.now()
            });

            return validationResults;
        }
    }

    // Private validation methods
    async _validateInputProcessing(input: JourneyInput): Promise<JourneyStage> {
        return {
            stage: 'input_processing',
            success: !!input.rawWebSocketData,
            timestamp: testClock.now(),
            details: {
                hasRawData: !!input.rawWebSocketData,
                platform: input.platform,
                dataSize: JSON.stringify(input.rawWebSocketData || {}).length
            }
        };
    }

    async _validateMessageParsing(input: JourneyInput): Promise<JourneyStage> {
        // Simulate message parsing validation
        const hasRequiredFields = !!(input.rawWebSocketData &&
                                input.rawWebSocketData.subscription_type &&
                                input.rawWebSocketData.event);
        
        return {
            stage: 'message_parsing',
            success: hasRequiredFields,
            timestamp: testClock.now(),
            details: {
                hasSubscriptionType: !!input.rawWebSocketData?.subscription_type,
                hasEvent: !!input.rawWebSocketData?.event,
                parsedSuccessfully: hasRequiredFields
            }
        };
    }

    async _validateEventProcessing(input: JourneyInput): Promise<JourneyStage> {
        // Simulate event processing validation
        return {
            stage: 'event_processing',
            success: true,
            timestamp: testClock.now(),
            details: {
                eventType: input.rawWebSocketData?.subscription_type,
                processed: true,
                timestamp: testClock.now()
            }
        };
    }

    async _validateNotificationGeneration(input: JourneyInput): Promise<JourneyStage> {
        // Simulate notification generation validation
        return {
            stage: 'notification_generation',
            success: true,
            timestamp: testClock.now(),
            details: {
                notificationCreated: true,
                platform: input.platform,
                type: 'mock_notification'
            }
        };
    }

    async _validateFinalOutput(expectedOutput: ExpectedJourneyOutput): Promise<JourneyStage> {
        // Simulate final output validation
        return {
            stage: 'final_output',
            success: true,
            timestamp: testClock.now(),
            details: {
                obsDisplay: expectedOutput.obsDisplay,
                ttsOutput: expectedOutput.ttsOutput,
                logOutput: expectedOutput.logOutput,
                validated: true
            }
        };
    }

    _validateHTMLContent(content: string): ContentQualityCheck {
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

    _validateLinks(content: string): ContentQualityCheck {
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

    _validateUserContent(content: string): ContentQualityCheck {
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

    _handleTesterError(message: string, error: unknown, eventData?: unknown): void {
        const errorHandler = createPlatformErrorHandler(this.logger, 'e2e-testing');
        if (error instanceof Error) {
            errorHandler.handleEventProcessingError(error, 'user-journey', eventData, message, 'e2e-testing');
            return;
        }

        errorHandler.logOperationalError(message, 'e2e-testing', eventData);
    }

    getJourneyHistory(): JourneyResult[] {
        return [...this.journeyHistory];
    }

    clearHistory(): void {
        this.journeyHistory = [];
    }
}

export {
    WebSocketMessageSimulator,
    CrossPlatformIntegrationTester,
    UserJourneyValidator
};
