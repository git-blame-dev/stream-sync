import { expect } from 'bun:test';

import {
    createMockNotificationManager,
    createMockPlatform,
    setupAutomatedCleanup
} from './mock-factories';
import testClock from './test-clock';
import { waitForDelay } from './time-utils';

type UnknownRecord = Record<string, unknown>;
type NotificationType = 'platform:gift' | 'platform:follow' | 'platform:paypiggy' | 'platform:raid' | 'platform:envelope';

type GiftProcessingResult = UnknownRecord & {
    notification?: { displayMessage?: unknown };
    displayed?: unknown;
    vfxTriggered?: unknown;
    obsUpdated?: unknown;
};

type GiftPlatform = {
    processGift: (giftData: unknown) => Promise<GiftProcessingResult> | GiftProcessingResult;
};

type UserGiftImpact = {
    wasNotified: boolean;
    receivedVisualFeedback?: boolean;
    visibleInStream?: boolean;
    missedNotification?: boolean;
    errorExperienced?: boolean;
    impactLevel?: string;
};

type UserGiftFlowResult = {
    success: boolean;
    userVisibleOutcome: unknown;
    userImpact: UserGiftImpact;
    steps: Record<'giftReceived' | 'notificationCreated' | 'displayedToUser' | 'vfxTriggered' | 'obsIntegration', boolean>;
    failureReason: string | null;
    performanceMetrics: {
        startTime: number;
        endTime: number | null;
        duration: number | null;
    };
};

type NotificationProcessingResult = UnknownRecord & {
    processed?: unknown;
    displayed?: unknown;
    userNotified?: unknown;
    tier?: unknown;
    viewerCount?: unknown;
    notification?: { displayMessage?: unknown };
};

type NotificationPlatform = {
    processNotification: (data: UnknownRecord) => Promise<NotificationProcessingResult> | NotificationProcessingResult;
};

type NotificationFlowResult = {
    success: boolean;
    notificationType: NotificationType;
    userExperience: {
        wasNotified: boolean;
        displayWasVisible: boolean;
        contentWasValid: boolean;
    };
    platformSpecific: UnknownRecord;
    failureReason: string | null;
    userImpact: { missedNotification?: boolean; impactLevel?: string };
};

type EventPlatform = {
    processEvent: (event: unknown) => Promise<UnknownRecord> | UnknownRecord;
};

type CrossPlatformBehaviorResult = {
    success: boolean;
    consistency: {
        userMessages: boolean;
        displayTiming: boolean;
        priorityHandling: boolean;
    };
    inconsistencies: string[];
    platformFailures: string[];
    workingPlatforms: string[];
    platformResults: Record<string, UnknownRecord>;
};

type WorkflowValidationResult = {
    success: boolean;
    steps?: Partial<UserGiftFlowResult['steps']>;
    failureReason?: unknown;
    performanceMetrics?: { duration?: number | null };
};

type WorkflowQualityAssessment = {
    qualityGrade: 'A' | 'B' | 'C' | 'D' | 'F';
    userExperienceScore: number;
    performanceScore: number;
    reliabilityScore: number;
    recommendations: string[];
};

type DisplayedNotification = UnknownRecord & {
    content?: unknown;
    visible?: unknown;
    priority?: unknown;
};

type DisplayedNotificationExpectations = {
    minimumCount?: number;
    mustBeVisible?: boolean;
    priority?: unknown;
    mustContainUsername?: boolean;
    username?: string;
    mustContainAmount?: boolean;
    amount?: number;
};

type StateChangeExpectation = string | number | boolean | null | undefined | UnknownRecord | unknown[] | ((initialValue: unknown, finalValue: unknown) => boolean);
type GracefulDegradationExpectations = {
    getSystemState?: () => { operational?: boolean };
    checkUserExperience?: () => { isStable?: boolean };
    attemptRecovery?: () => Promise<unknown> | unknown;
    requireUserStability?: boolean;
};

type GracefulDegradationResult = {
    systemStabilityMaintained: boolean;
    errorHandledGracefully: boolean;
    userExperienceImpacted: boolean;
    recoverabilityAssessed: boolean;
    systemStable: boolean;
    errorsHandled: boolean;
};

type BehaviorOutcomeExpectations<Result> = {
    maxExecutionTime?: number;
    expectUserVisibleResults?: boolean;
    extractUserResults?: (result: Result) => unknown[];
    validateUserResults?: (results: unknown[]) => void;
    validateOutcome?: (result: Result) => boolean;
    expectError?: boolean;
    validateError?: (error: Error) => boolean;
};

type BehaviorOutcomeResult = {
    behaviorExecuted: boolean;
    outcomesMatched: boolean;
    userVisibleResults: unknown[];
    performanceWithinLimits: boolean;
    sideEffectsAcceptable: boolean;
};

type ConfigSystem<Value = unknown> = {
    set?: (key: string, value: Value) => void;
    update?: (key: string, value: Value) => void;
};

type RecoveryExpectations = {
    getSystemState?: () => UnknownRecord & { status?: unknown };
    waitForRecovery?: number;
    requireRecovery?: boolean;
};

type ErrorRecoveryResult = {
    operationAttempted: boolean;
    errorOccurred: boolean;
    recoveryAttempted: boolean;
    recoverySuccessful: boolean;
    finalSystemState: (UnknownRecord & { status?: unknown }) | null;
};

const isRecord = (value: unknown): value is UnknownRecord => {
    return typeof value === 'object' && value !== null;
};

const requireRecord = (value: unknown, name: string): UnknownRecord => {
    if (!isRecord(value)) {
        throw new Error(`${name} must be an object`);
    }

    return value;
};

const getErrorMessage = (error: unknown): string => {
    return error instanceof Error ? error.message : String(error);
};

const isNotificationType = (type: string): type is NotificationType => {
    return ['platform:gift', 'platform:follow', 'platform:paypiggy', 'platform:raid', 'platform:envelope'].includes(type);
};

const validateUserGiftFlow = async (platform: GiftPlatform, giftData: unknown): Promise<UserGiftFlowResult> => {
    const result: UserGiftFlowResult = {
        success: false,
        userVisibleOutcome: null,
        userImpact: { wasNotified: false },
        steps: {
            giftReceived: false,
            notificationCreated: false,
            displayedToUser: false,
            vfxTriggered: false,
            obsIntegration: false
        },
        failureReason: null,
        performanceMetrics: {
            startTime: testClock.now(),
            endTime: null,
            duration: null
        }
    };

    try {
        const giftResult = await platform.processGift(giftData);
        result.steps.giftReceived = true;

        if (giftResult.notification) {
            result.steps.notificationCreated = true;
            result.userVisibleOutcome = giftResult.notification.displayMessage;

            if (result.userVisibleOutcome) {
                validateUserVisibleContent(result.userVisibleOutcome);
            }
        }

        if (giftResult.displayed) {
            result.steps.displayedToUser = true;
        }

        if (giftResult.vfxTriggered) {
            result.steps.vfxTriggered = true;
        }

        if (giftResult.obsUpdated) {
            result.steps.obsIntegration = true;
        }

        const criticalSteps = ['giftReceived', 'notificationCreated', 'displayedToUser'] as const;
        const criticalStepsPassed = criticalSteps.every(step => result.steps[step]);
        
        if (criticalStepsPassed) {
            result.success = true;
            result.userImpact = {
                wasNotified: true,
                receivedVisualFeedback: result.steps.vfxTriggered,
                visibleInStream: result.steps.obsIntegration
            };
        } else {
            result.userImpact = {
                wasNotified: false,
                missedNotification: true,
                impactLevel: 'critical'
            };
        }

    } catch (error) {
        result.failureReason = getErrorMessage(error);
        result.userImpact = {
            wasNotified: false,
            missedNotification: true,
            errorExperienced: true,
            impactLevel: 'critical'
        };
    }

    result.performanceMetrics.endTime = testClock.now();
    result.performanceMetrics.duration = result.performanceMetrics.endTime - result.performanceMetrics.startTime;

    return result;
};

const validateNotificationFlow = async (type: string, platform: Partial<NotificationPlatform>, data: UnknownRecord): Promise<NotificationFlowResult> => {
    if (!isNotificationType(type)) {
        throw new Error(`Invalid notification type: ${type}`);
    }

    const result: NotificationFlowResult = {
        success: false,
        notificationType: type,
        userExperience: {
            wasNotified: false,
            displayWasVisible: false,
            contentWasValid: false
        },
        platformSpecific: {},
        failureReason: null,
        userImpact: {}
    };

    try {
        if (typeof platform.processNotification !== 'function') {
            throw new Error('Notification platform must provide processNotification');
        }
        const notificationResult = await platform.processNotification({ type, ...data });

        if (notificationResult.processed) {
            result.success = true;
            result.userExperience.wasNotified = true;
        }

        if (notificationResult.displayed) {
            result.userExperience.displayWasVisible = true;
        }

        if (notificationResult.userNotified) {
            result.userExperience.wasNotified = true;
        }

        if (type === 'platform:paypiggy' && notificationResult.tier) {
            result.platformSpecific.tier = notificationResult.tier;
        }
        if (type === 'platform:raid' && notificationResult.viewerCount) {
            result.platformSpecific.viewerCount = notificationResult.viewerCount;
        }

        if (notificationResult.notification && notificationResult.notification.displayMessage) {
            try {
                validateUserVisibleContent(notificationResult.notification.displayMessage);
                result.userExperience.contentWasValid = true;
            } catch (contentError) {
                result.userExperience.contentWasValid = false;
                result.failureReason = `Content validation failed: ${getErrorMessage(contentError)}`;
            }
        }

    } catch (error) {
        result.failureReason = getErrorMessage(error);
        result.userImpact = {
            missedNotification: true,
            impactLevel: 'critical'
        };
    }

    return result;
};

const validateCrossPlatformBehavior = async (platforms: Record<string, EventPlatform>, event: unknown): Promise<CrossPlatformBehaviorResult> => {
    const result: CrossPlatformBehaviorResult = {
        success: false,
        consistency: {
            userMessages: false,
            displayTiming: false,
            priorityHandling: false
        },
        inconsistencies: [],
        platformFailures: [],
        workingPlatforms: [],
        platformResults: {}
    };

    const platformNames = Object.keys(platforms);
    const platformResults: Record<string, UnknownRecord> = {};

    for (const platformName of platformNames) {
        try {
            const platform = platforms[platformName];
            if (!platform) {
                throw new Error(`Missing platform: ${platformName}`);
            }
            const eventResult = await platform.processEvent(event);
            platformResults[platformName] = eventResult;
            result.workingPlatforms.push(platformName);
        } catch (error) {
            result.platformFailures.push(platformName);
            platformResults[platformName] = { error: getErrorMessage(error) };
        }
    }

    result.platformResults = platformResults;

    if (result.workingPlatforms.length < 2) {
        if (result.platformFailures.length > 0) {
            result.success = false;
        } else {
            result.success = true;
        }
        return result;
    }

    const workingResults = result.workingPlatforms.map(name => platformResults[name]).filter(isRecord);

    const userMessages = workingResults.map(r => r.userMessage).filter(Boolean);
    const uniqueMessages = [...new Set(userMessages)];
    result.consistency.userMessages = uniqueMessages.length <= 1;
    if (!result.consistency.userMessages) {
        result.inconsistencies.push('userMessages');
    }

    const displayTimes = workingResults.map(r => r.displayTime).filter(Boolean);
    const uniqueTimes = [...new Set(displayTimes)];
    result.consistency.displayTiming = uniqueTimes.length <= 1;
    if (!result.consistency.displayTiming) {
        result.inconsistencies.push('displayTiming');
    }

    const priorities = workingResults.map(r => r.priority).filter(Boolean);
    const uniquePriorities = [...new Set(priorities)];
    result.consistency.priorityHandling = uniquePriorities.length <= 1;
    if (!result.consistency.priorityHandling) {
        result.inconsistencies.push('priorityHandling');
    }

    result.success = result.inconsistencies.length === 0 && result.platformFailures.length === 0;

    return result;
};

const validateUserVisibleContent = (content: unknown): void => {
    if (typeof content !== 'string') {
        throw new Error('User-visible content must be a string');
    }

    const technicalArtifacts = ['undefined', 'null', 'NaN', '[object Object]'];
    technicalArtifacts.forEach(artifact => {
        if (content.includes(artifact)) {
            throw new Error(`User-visible content contains technical artifact "${artifact}"`);
        }
    });

    if (/\{.*\}/.test(content)) {
        throw new Error('User-visible content contains template placeholders');
    }

    if (/TypeError:|ReferenceError:|SyntaxError:/.test(content)) {
        throw new Error('User-visible content contains JavaScript error');
    }

    if (!content.trim()) {
        throw new Error('User-visible content is empty or whitespace-only');
    }
};

const validateGiftData = (giftData: unknown): void => {
    const giftRecord = requireRecord(giftData, 'Gift data');

    const requiredFields = ['username', 'amount', 'currency'];
    requiredFields.forEach(field => {
        if (!Object.prototype.hasOwnProperty.call(giftRecord, field)) {
            throw new Error(`Gift data missing required field: ${field}`);
        }
    });

    if (!giftRecord.username || typeof giftRecord.username !== 'string' || !giftRecord.username.trim()) {
        throw new Error('Gift data must include a valid username');
    }

    if (typeof giftRecord.amount !== 'number' || giftRecord.amount <= 0) {
        throw new Error('Gift amount must be a positive number');
    }

    if (typeof giftRecord.currency !== 'string' || !giftRecord.currency.trim()) {
        throw new Error('Gift currency must be a non-empty string');
    }
};

const validateNotificationData = (notificationData: unknown): void => {
    const notificationRecord = requireRecord(notificationData, 'Notification data');

    const requiredFields = ['type', 'username'];
    requiredFields.forEach(field => {
        if (!Object.prototype.hasOwnProperty.call(notificationRecord, field)) {
            throw new Error(`Notification data missing required field: ${field}`);
        }
    });

    if (typeof notificationRecord.type !== 'string' || !isNotificationType(notificationRecord.type)) {
        throw new Error(`Invalid notification type: ${notificationRecord.type}`);
    }

    if (!notificationRecord.username || typeof notificationRecord.username !== 'string' || !notificationRecord.username.trim()) {
        throw new Error('Notification data must include a valid username');
    }
};

const assessWorkflowQuality = (validationResult: WorkflowValidationResult): WorkflowQualityAssessment => {
    const assessment: WorkflowQualityAssessment = {
        qualityGrade: 'F',
        userExperienceScore: 0,
        performanceScore: 0,
        reliabilityScore: 0,
        recommendations: []
    };

    if (validationResult.success) {
        assessment.userExperienceScore += 50;
        
        if (validationResult.steps?.displayedToUser) assessment.userExperienceScore += 20;
        if (validationResult.steps?.vfxTriggered) assessment.userExperienceScore += 15;
        if (validationResult.steps?.obsIntegration) assessment.userExperienceScore += 15;
    }

    if (validationResult.performanceMetrics?.duration) {
        const duration = validationResult.performanceMetrics.duration;
        if (duration < 100) assessment.performanceScore = 100;
        else if (duration < 500) assessment.performanceScore = 80;
        else if (duration < 1000) assessment.performanceScore = 60;
        else assessment.performanceScore = 40;
    }

    if (validationResult.success && !validationResult.failureReason) {
        assessment.reliabilityScore = 100;
    } else if (validationResult.success) {
        assessment.reliabilityScore = 70;
    } else {
        assessment.reliabilityScore = 0;
    }

    const overallScore = (assessment.userExperienceScore + assessment.performanceScore + assessment.reliabilityScore) / 3;
    if (overallScore >= 90) assessment.qualityGrade = 'A';
    else if (overallScore >= 80) assessment.qualityGrade = 'B';
    else if (overallScore >= 70) assessment.qualityGrade = 'C';
    else if (overallScore >= 60) assessment.qualityGrade = 'D';
    else assessment.qualityGrade = 'F';

    if (!validationResult.success) {
        assessment.recommendations.push('Fix critical workflow failure');
    }
    const duration = validationResult.performanceMetrics?.duration;
    if (typeof duration === 'number' && duration > 500) {
        assessment.recommendations.push('Optimize performance - workflow taking too long');
    }
    if (!validationResult.steps?.vfxTriggered) {
        assessment.recommendations.push('Consider adding visual feedback for better user experience');
    }
    if (!validationResult.steps?.obsIntegration) {
        assessment.recommendations.push('Ensure OBS integration for stream visibility');
    }

    return assessment;
};

const expectValidDisplayedNotifications = (displayedNotifications: unknown, expectedBehavior: DisplayedNotificationExpectations = {}): void => {
    if (!Array.isArray(displayedNotifications)) {
        throw new Error('displayedNotifications must be an array');
    }
    
    if (displayedNotifications.length === 0 && (expectedBehavior.minimumCount ?? 0) > 0) {
        throw new Error(`Expected at least ${expectedBehavior.minimumCount} displayed notifications, got 0`);
    }
    
    displayedNotifications.forEach((notification: unknown, index) => {
        const notificationRecord = notification as DisplayedNotification;
        if (!notificationRecord.content || typeof notificationRecord.content !== 'string') {
            throw new Error(`Notification ${index} missing user-visible content`);
        }

        validateUserVisibleContent(notificationRecord.content);

        if (expectedBehavior.mustBeVisible && !notificationRecord.visible) {
            throw new Error(`Notification ${index} should be visible to user but is not`);
        }

        if (expectedBehavior.priority && notificationRecord.priority !== expectedBehavior.priority) {
            throw new Error(`Notification ${index} priority mismatch. Expected: ${expectedBehavior.priority}, Got: ${notificationRecord.priority}`);
        }

        if (expectedBehavior.mustContainUsername && expectedBehavior.username) {
            if (!notificationRecord.content.includes(expectedBehavior.username)) {
                throw new Error(`Notification ${index} content should contain username "${expectedBehavior.username}"`);
            }
        }

        if (expectedBehavior.mustContainAmount && expectedBehavior.amount) {
            if (!notificationRecord.content.includes(expectedBehavior.amount.toString())) {
                throw new Error(`Notification ${index} content should contain amount "${expectedBehavior.amount}"`);
            }
        }
    });
};

const expectSystemStateChanges = (initialState: unknown, finalState: unknown, expectedChanges: Record<string, StateChangeExpectation>): void => {
    if (!initialState || !finalState) {
        throw new Error('Both initialState and finalState are required');
    }
    const initialRecord = initialState as UnknownRecord;
    const finalRecord = finalState as UnknownRecord;
    
    Object.keys(expectedChanges).forEach(stateKey => {
        const expectedValue = expectedChanges[stateKey];
        const initialValue = initialRecord[stateKey];
        const finalValue = finalRecord[stateKey];
        
        if (typeof expectedValue === 'function') {
            if (!expectedValue(initialValue, finalValue)) {
                throw new Error(`State change validation failed for ${stateKey}`);
            }
        } else if (finalValue !== expectedValue) {
            throw new Error(`State change mismatch for ${stateKey}. Expected: ${expectedValue}, Got: ${finalValue}, Previous: ${initialValue}`);
        }
    });
};

const expectGracefulDegradation = async (
    systemUnderTest: () => Promise<unknown> | unknown,
    degradationExpectations: GracefulDegradationExpectations = {}
): Promise<GracefulDegradationResult> => {
    const result: Omit<GracefulDegradationResult, 'systemStable' | 'errorsHandled'> = {
        systemStabilityMaintained: false,
        errorHandledGracefully: false,
        userExperienceImpacted: false,
        recoverabilityAssessed: false
    };
    
    try {
        await systemUnderTest();
        
        result.systemStabilityMaintained = true;
        result.errorHandledGracefully = true;
        
    } catch {
        
        if (degradationExpectations.getSystemState) {
            const postErrorState = degradationExpectations.getSystemState();
            result.systemStabilityMaintained = postErrorState.operational === true;
        } else {
            result.systemStabilityMaintained = true;
        }
        
        result.errorHandledGracefully = true;
        
        if (degradationExpectations.checkUserExperience) {
            const userExperience = degradationExpectations.checkUserExperience();
            result.userExperienceImpacted = !userExperience.isStable;
        }
        
        if (degradationExpectations.attemptRecovery) {
            try {
                await degradationExpectations.attemptRecovery();
                result.recoverabilityAssessed = true;
            } catch {
                result.recoverabilityAssessed = false;
            }
        }
    }
    
    if (!result.systemStabilityMaintained) {
        throw new Error('System stability not maintained during error scenario');
    }
    
    if (!result.errorHandledGracefully) {
        throw new Error('Error was not handled gracefully');
    }
    
    if (degradationExpectations.requireUserStability && result.userExperienceImpacted) {
        throw new Error('User experience was negatively impacted during error scenario');
    }
    
    return {
        ...result,
        systemStable: result.systemStabilityMaintained,
        errorsHandled: result.errorHandledGracefully
    };
};

const expectBehaviorOutcome = async <Result>(
    behaviorUnderTest: () => Promise<Result> | Result,
    outcomeExpectations: BehaviorOutcomeExpectations<Result>
) => {
    const result: BehaviorOutcomeResult = {
        behaviorExecuted: false,
        outcomesMatched: false,
        userVisibleResults: [],
        performanceWithinLimits: false,
        sideEffectsAcceptable: true
    };
    
    const startTime = process.hrtime.bigint();
    let executionTime = 0;
    
    try {
        const behaviorResult = await behaviorUnderTest();
        result.behaviorExecuted = true;
        
        // Validate performance timing using high-resolution timer (not affected by fake timers)
        const endTime = process.hrtime.bigint();
        executionTime = Number(endTime - startTime) / 1000000;
        const maxTime = outcomeExpectations.maxExecutionTime || 5000;
        result.performanceWithinLimits = executionTime <= maxTime;
        
        if (outcomeExpectations.expectUserVisibleResults) {
            if (!outcomeExpectations.extractUserResults) {
                throw new Error('extractUserResults is required when expectUserVisibleResults is true');
            }
            result.userVisibleResults = outcomeExpectations.extractUserResults(behaviorResult);
            
            if (outcomeExpectations.validateUserResults) {
                outcomeExpectations.validateUserResults(result.userVisibleResults);
            }
        }
        
        if (outcomeExpectations.validateOutcome) {
            result.outcomesMatched = outcomeExpectations.validateOutcome(behaviorResult);
        } else {
            result.outcomesMatched = true;
        }
        
    } catch (error) {
        if (outcomeExpectations.expectError) {
            result.behaviorExecuted = true;
            result.outcomesMatched = outcomeExpectations.validateError ? 
                outcomeExpectations.validateError(error instanceof Error ? error : new Error(String(error))) : true;
        } else {
            throw error;
        }
    }
    
    if (!result.behaviorExecuted) {
        throw new Error('Behavior did not execute successfully');
    }
    
    if (!result.outcomesMatched) {
        throw new Error('Behavior outcomes did not match expectations');
    }
    
    if (!result.performanceWithinLimits) {
        throw new Error(`Behavior execution exceeded time limit: ${executionTime.toFixed(2)}ms > ${outcomeExpectations.maxExecutionTime}ms`);
    }
    
    return result;
};

const expectConfigurationBehaviorChange = async <State extends UnknownRecord, Value>(
    configSystem: ConfigSystem<Value>,
    configKey: string,
    newValue: Value,
    behaviorTest: () => Promise<State> | State
) => {
    const initialBehaviorState = await behaviorTest();
    
    if (typeof configSystem.set === 'function') {
        configSystem.set(configKey, newValue);
    } else if (typeof configSystem.update === 'function') {
        configSystem.update(configKey, newValue);
    } else {
        throw new Error('Configuration system must have set() or update() method');
    }
    
    const finalBehaviorState = await behaviorTest();
    
    if (JSON.stringify(initialBehaviorState) === JSON.stringify(finalBehaviorState)) {
        throw new Error(`Configuration change for "${configKey}" did not affect system behavior`);
    }
    
    return {
        initialState: initialBehaviorState,
        finalState: finalBehaviorState,
        configKey,
        newValue
    };
};

const expectErrorRecoveryBehavior = async (
    operationThatMayFail: () => Promise<unknown> | unknown,
    recoveryExpectations: RecoveryExpectations = {}
): Promise<ErrorRecoveryResult> => {
    const result: ErrorRecoveryResult = {
        operationAttempted: false,
        errorOccurred: false,
        recoveryAttempted: false,
        recoverySuccessful: false,
        finalSystemState: null
    };
    
    try {
        await operationThatMayFail();
        result.operationAttempted = true;
        
        result.finalSystemState = recoveryExpectations.getSystemState ? 
            recoveryExpectations.getSystemState() : { status: 'operational' };
            
    } catch {
        result.operationAttempted = true;
        result.errorOccurred = true;
        
        if (recoveryExpectations.waitForRecovery) {
            await waitForDelay(recoveryExpectations.waitForRecovery);
            result.recoveryAttempted = true;
        }
        
        if (recoveryExpectations.getSystemState) {
            result.finalSystemState = recoveryExpectations.getSystemState();
            result.recoverySuccessful = result.finalSystemState.status === 'operational' ||
                                      result.finalSystemState.status === 'recovering';
        }
        
        if (recoveryExpectations.requireRecovery && !result.recoverySuccessful) {
            throw new Error('System did not recover gracefully after error');
        }
    }
    
    return result;
};

const expectValidNotification = <Notification>(notification: Notification): Notification => {
    expect(notification).toBeDefined();
    expect((notification as UnknownRecord).displayMessage).toBeDefined();
    return notification;
};

const expectNoTechnicalArtifacts = (str: unknown): string | undefined => {
    if (!str) return;
    if (typeof str !== 'string') {
        throw new Error('Content must be a string');
    }
    
    const technicalPatterns = [
        /undefined/i,
        /null/i,
        /\[object/i,
        /NaN/i,
        /^\s*$/,
        /{.*}/,
        /\$\$/,
        /\bfunction\b/i
    ];
    
    technicalPatterns.forEach(pattern => {
        expect(str).not.toMatch(pattern);
    });
    
    return str;
};

const expectValidUserFeedback = (feedback?: unknown): string => {
    if (!feedback) {
        throw new Error('User feedback is required');
    }
    
    if (typeof feedback !== 'string') {
        throw new Error('User feedback must be a string');
    }
    
    if (feedback.trim().length < 3) {
        throw new Error('User feedback too short to be meaningful');
    }
    
    expectNoTechnicalArtifacts(feedback);
    
    const hasUserRelevantContent = [
        /\b(user|viewer|streamer|chat|effect|VFX|visual|command)\b/i,
        /\b(successful|complete|executed|triggered|displayed)\b/i,
        /\b(welcome|hello|gift|thank|greet)\b/i
    ].some(pattern => pattern.test(feedback));
    
    if (!hasUserRelevantContent) {
        throw new Error('User feedback should contain user-relevant information');
    }
    
    return feedback;
};

export {
    validateUserGiftFlow,
    validateNotificationFlow,
    validateCrossPlatformBehavior,
    
    validateUserVisibleContent,
    validateGiftData,
    validateNotificationData,
    
    assessWorkflowQuality,
    
    expectValidDisplayedNotifications,
    expectSystemStateChanges,
    expectGracefulDegradation,
    expectBehaviorOutcome,
    expectConfigurationBehaviorChange,
    expectErrorRecoveryBehavior,
    
    createMockPlatform,
    createMockNotificationManager,
    setupAutomatedCleanup,
    
    expectValidNotification,
    expectNoTechnicalArtifacts,
    expectValidUserFeedback
};
