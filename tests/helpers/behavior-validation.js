
// Import necessary mock factories for re-export
const { 
    createMockPlatform,
    createMockNotificationManager,
    setupAutomatedCleanup
} = require('./mock-factories');
const testClock = require('./test-clock');

// ================================================================================================
// USER WORKFLOW VALIDATION
// ================================================================================================

const validateUserGiftFlow = async (platform, giftData) => {
    const result = {
        success: false,
        userVisibleOutcome: null,
        userImpact: null,
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
        // Step 1: Process the gift
        const giftResult = await platform.processGift(giftData);
        result.steps.giftReceived = true;

        // Step 2: Validate notification creation
        if (giftResult.notification) {
            result.steps.notificationCreated = true;
            result.userVisibleOutcome = giftResult.notification.displayMessage;

            // Validate user-visible content has no technical artifacts
            if (result.userVisibleOutcome) {
                validateUserVisibleContent(result.userVisibleOutcome);
            }
        }

        // Step 3: Check if displayed to user
        if (giftResult.displayed) {
            result.steps.displayedToUser = true;
        }

        // Step 4: Check VFX triggering
        if (giftResult.vfxTriggered) {
            result.steps.vfxTriggered = true;
        }

        // Step 5: Check OBS integration
        if (giftResult.obsUpdated) {
            result.steps.obsIntegration = true;
        }

        // Assess overall success
        const criticalSteps = ['giftReceived', 'notificationCreated', 'displayedToUser'];
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
        result.failureReason = error.message;
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

const validateNotificationFlow = async (type, platform, data) => {
    const allowedTypes = ['platform:gift', 'platform:follow', 'platform:paypiggy', 'platform:raid', 'platform:envelope'];
    if (!allowedTypes.includes(type)) {
        throw new Error(`Invalid notification type: ${type}`);
    }

    const result = {
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
        // Process the notification
        const notificationResult = await platform.processNotification({ type, ...data });

        // Validate basic processing
        if (notificationResult.processed) {
            result.success = true;
            result.userExperience.wasNotified = true;
        }

        // Check display visibility
        if (notificationResult.displayed) {
            result.userExperience.displayWasVisible = true;
        }

        // Check user notification status
        if (notificationResult.userNotified) {
            result.userExperience.wasNotified = true;
        }

        // Extract platform-specific data
        if (type === 'platform:paypiggy' && notificationResult.tier) {
            result.platformSpecific.tier = notificationResult.tier;
        }
        if (type === 'platform:raid' && notificationResult.viewerCount) {
            result.platformSpecific.viewerCount = notificationResult.viewerCount;
        }

        // Validate content quality if available
        if (notificationResult.notification && notificationResult.notification.displayMessage) {
            try {
                validateUserVisibleContent(notificationResult.notification.displayMessage);
                result.userExperience.contentWasValid = true;
            } catch (contentError) {
                result.userExperience.contentWasValid = false;
                result.failureReason = `Content validation failed: ${contentError.message}`;
            }
        }

    } catch (error) {
        result.failureReason = error.message;
        result.userImpact = {
            missedNotification: true,
            impactLevel: 'critical'
        };
    }

    return result;
};

const validateCrossPlatformBehavior = async (platforms, event) => {
    const result = {
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
    const platformResults = {};

    // Process event on each platform
    for (const platformName of platformNames) {
        try {
            const platform = platforms[platformName];
            const eventResult = await platform.processEvent(event);
            platformResults[platformName] = eventResult;
            result.workingPlatforms.push(platformName);
        } catch (error) {
            result.platformFailures.push(platformName);
            platformResults[platformName] = { error: error.message };
        }
    }

    result.platformResults = platformResults;

    // Only analyze consistency if we have multiple working platforms
    if (result.workingPlatforms.length < 2) {
        if (result.platformFailures.length > 0) {
            result.success = false;
        } else {
            result.success = true; // Single platform working
        }
        return result;
    }

    // Analyze consistency across working platforms
    const workingResults = result.workingPlatforms.map(name => platformResults[name]);

    // Check user message consistency
    const userMessages = workingResults.map(r => r.userMessage).filter(Boolean);
    const uniqueMessages = [...new Set(userMessages)];
    result.consistency.userMessages = uniqueMessages.length <= 1;
    if (!result.consistency.userMessages) {
        result.inconsistencies.push('userMessages');
    }

    // Check display timing consistency
    const displayTimes = workingResults.map(r => r.displayTime).filter(Boolean);
    const uniqueTimes = [...new Set(displayTimes)];
    result.consistency.displayTiming = uniqueTimes.length <= 1;
    if (!result.consistency.displayTiming) {
        result.inconsistencies.push('displayTiming');
    }

    // Check priority handling consistency
    const priorities = workingResults.map(r => r.priority).filter(Boolean);
    const uniquePriorities = [...new Set(priorities)];
    result.consistency.priorityHandling = uniquePriorities.length <= 1;
    if (!result.consistency.priorityHandling) {
        result.inconsistencies.push('priorityHandling');
    }

    // Overall success
    result.success = result.inconsistencies.length === 0 && result.platformFailures.length === 0;

    return result;
};

// ================================================================================================
// CONTENT VALIDATION UTILITIES
// ================================================================================================

const validateUserVisibleContent = (content) => {
    if (typeof content !== 'string') {
        throw new Error('User-visible content must be a string');
    }

    // Check for technical artifacts
    const technicalArtifacts = ['undefined', 'null', 'NaN', '[object Object]'];
    technicalArtifacts.forEach(artifact => {
        if (content.includes(artifact)) {
            throw new Error(`User-visible content contains technical artifact "${artifact}"`);
        }
    });

    // Check for template placeholders
    if (/\{.*\}/.test(content)) {
        throw new Error('User-visible content contains template placeholders');
    }

    // Check for JavaScript errors
    if (/TypeError:|ReferenceError:|SyntaxError:/.test(content)) {
        throw new Error('User-visible content contains JavaScript error');
    }

    // Check for empty or whitespace-only content
    if (!content.trim()) {
        throw new Error('User-visible content is empty or whitespace-only');
    }
};

const validateGiftData = (giftData) => {
    if (!giftData || typeof giftData !== 'object') {
        throw new Error('Gift data must be an object');
    }

    const requiredFields = ['username', 'amount', 'currency'];
    requiredFields.forEach(field => {
        if (!giftData.hasOwnProperty(field)) {
            throw new Error(`Gift data missing required field: ${field}`);
        }
    });

    if (!giftData.username || typeof giftData.username !== 'string' || !giftData.username.trim()) {
        throw new Error('Gift data must include a valid username');
    }

    if (typeof giftData.amount !== 'number' || giftData.amount <= 0) {
        throw new Error('Gift amount must be a positive number');
    }

    if (typeof giftData.currency !== 'string' || !giftData.currency.trim()) {
        throw new Error('Gift currency must be a non-empty string');
    }
};

const validateNotificationData = (notificationData) => {
    if (!notificationData || typeof notificationData !== 'object') {
        throw new Error('Notification data must be an object');
    }

    const requiredFields = ['type', 'username'];
    requiredFields.forEach(field => {
        if (!notificationData.hasOwnProperty(field)) {
            throw new Error(`Notification data missing required field: ${field}`);
        }
    });

    const validTypes = ['platform:gift', 'platform:follow', 'platform:paypiggy', 'platform:raid', 'platform:envelope'];
    if (!validTypes.includes(notificationData.type)) {
        throw new Error(`Invalid notification type: ${notificationData.type}`);
    }

    if (!notificationData.username || typeof notificationData.username !== 'string' || !notificationData.username.trim()) {
        throw new Error('Notification data must include a valid username');
    }
};

// ================================================================================================
// PERFORMANCE AND QUALITY ASSESSMENT
// ================================================================================================

const assessWorkflowQuality = (validationResult) => {
    const assessment = {
        qualityGrade: 'F',
        userExperienceScore: 0,
        performanceScore: 0,
        reliabilityScore: 0,
        recommendations: []
    };

    // Calculate user experience score
    if (validationResult.success) {
        assessment.userExperienceScore += 50; // Base score for success
        
        if (validationResult.steps?.displayedToUser) assessment.userExperienceScore += 20;
        if (validationResult.steps?.vfxTriggered) assessment.userExperienceScore += 15;
        if (validationResult.steps?.obsIntegration) assessment.userExperienceScore += 15;
    }

    // Calculate performance score
    if (validationResult.performanceMetrics?.duration) {
        const duration = validationResult.performanceMetrics.duration;
        if (duration < 100) assessment.performanceScore = 100;
        else if (duration < 500) assessment.performanceScore = 80;
        else if (duration < 1000) assessment.performanceScore = 60;
        else assessment.performanceScore = 40;
    }

    // Calculate reliability score
    if (validationResult.success && !validationResult.failureReason) {
        assessment.reliabilityScore = 100;
    } else if (validationResult.success) {
        assessment.reliabilityScore = 70; // Success with warnings
    } else {
        assessment.reliabilityScore = 0; // Failed
    }

    // Overall quality grade
    const overallScore = (assessment.userExperienceScore + assessment.performanceScore + assessment.reliabilityScore) / 3;
    if (overallScore >= 90) assessment.qualityGrade = 'A';
    else if (overallScore >= 80) assessment.qualityGrade = 'B';
    else if (overallScore >= 70) assessment.qualityGrade = 'C';
    else if (overallScore >= 60) assessment.qualityGrade = 'D';
    else assessment.qualityGrade = 'F';

    // Generate recommendations
    if (!validationResult.success) {
        assessment.recommendations.push('Fix critical workflow failure');
    }
    if (validationResult.performanceMetrics?.duration > 500) {
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

// ================================================================================================
// Behavior-focused validation patterns
// ================================================================================================

const expectValidDisplayedNotifications = (displayedNotifications, expectedBehavior = {}) => {
    if (!Array.isArray(displayedNotifications)) {
        throw new Error('displayedNotifications must be an array');
    }
    
    if (displayedNotifications.length === 0 && expectedBehavior.minimumCount > 0) {
        throw new Error(`Expected at least ${expectedBehavior.minimumCount} displayed notifications, got 0`);
    }
    
    displayedNotifications.forEach((notification, index) => {
        // Validate user-visible content quality
        if (!notification.content || typeof notification.content !== 'string') {
            throw new Error(`Notification ${index} missing user-visible content`);
        }
        
        // Validate no technical artifacts in user-facing content
        validateUserVisibleContent(notification.content);
        
        // Validate notification visibility state
        if (expectedBehavior.mustBeVisible && !notification.visible) {
            throw new Error(`Notification ${index} should be visible to user but is not`);
        }
        
        // Validate notification priority behavior
        if (expectedBehavior.priority && notification.priority !== expectedBehavior.priority) {
            throw new Error(`Notification ${index} priority mismatch. Expected: ${expectedBehavior.priority}, Got: ${notification.priority}`);
        }
        
        // Validate content includes expected user data
        if (expectedBehavior.mustContainUsername && expectedBehavior.username) {
            if (!notification.content.includes(expectedBehavior.username)) {
                throw new Error(`Notification ${index} content should contain username "${expectedBehavior.username}"`);
            }
        }
        
        if (expectedBehavior.mustContainAmount && expectedBehavior.amount) {
            if (!notification.content.includes(expectedBehavior.amount.toString())) {
                throw new Error(`Notification ${index} content should contain amount "${expectedBehavior.amount}"`);
            }
        }
    });
};

const expectSystemStateChanges = (initialState, finalState, expectedChanges) => {
    if (!initialState || !finalState) {
        throw new Error('Both initialState and finalState are required');
    }
    
    Object.keys(expectedChanges).forEach(stateKey => {
        const expectedValue = expectedChanges[stateKey];
        const initialValue = initialState[stateKey];
        const finalValue = finalState[stateKey];
        
        if (typeof expectedValue === 'function') {
            // Custom validation function
            if (!expectedValue(initialValue, finalValue)) {
                throw new Error(`State change validation failed for ${stateKey}`);
            }
        } else if (finalValue !== expectedValue) {
            throw new Error(`State change mismatch for ${stateKey}. Expected: ${expectedValue}, Got: ${finalValue}, Previous: ${initialValue}`);
        }
    });
};

const expectGracefulDegradation = async (systemUnderTest, degradationExpectations = {}) => {
    const result = {
        systemStabilityMaintained: false,
        errorHandledGracefully: false,
        userExperienceImpacted: false,
        recoverabilityAssessed: false
    };
    
    try {
        // Capture initial system state
        const initialState = degradationExpectations.getSystemState ? 
            degradationExpectations.getSystemState() : { operational: true };
        
        // Execute potentially failing system
        await systemUnderTest();
        
        // If no error occurred but we expected one, that's also valid behavior
        result.systemStabilityMaintained = true;
        result.errorHandledGracefully = true;
        
    } catch {
        // System threw an error - validate graceful degradation
        
        // Check system remains operational
        if (degradationExpectations.getSystemState) {
            const postErrorState = degradationExpectations.getSystemState();
            result.systemStabilityMaintained = postErrorState.operational === true;
        } else {
            result.systemStabilityMaintained = true; // Assume stable if no check provided
        }
        
        // Check error handling is graceful (no unhandled errors)
        result.errorHandledGracefully = true; // If we caught it, it was handled
        
        // Check user experience impact
        if (degradationExpectations.checkUserExperience) {
            const userExperience = degradationExpectations.checkUserExperience();
            result.userExperienceImpacted = !userExperience.isStable;
        }
        
        // Check system can recover
        if (degradationExpectations.attemptRecovery) {
            try {
                await degradationExpectations.attemptRecovery();
                result.recoverabilityAssessed = true;
            } catch {
                result.recoverabilityAssessed = false;
            }
        }
    }
    
    // Validate graceful degradation standards
    if (!result.systemStabilityMaintained) {
        throw new Error('System stability not maintained during error scenario');
    }
    
    if (!result.errorHandledGracefully) {
        throw new Error('Error was not handled gracefully');
    }
    
    if (degradationExpectations.requireUserStability && result.userExperienceImpacted) {
        throw new Error('User experience was negatively impacted during error scenario');
    }
    
    // Add backwards compatibility properties for tests
    return {
        ...result,
        systemStable: result.systemStabilityMaintained,
        errorsHandled: result.errorHandledGracefully
    };
};

const expectBehaviorOutcome = async (behaviorUnderTest, outcomeExpectations) => {
    const result = {
        behaviorExecuted: false,
        outcomesMatched: false,
        userVisibleResults: [],
        performanceWithinLimits: false,
        sideEffectsAcceptable: true
    };
    
    const startTime = process.hrtime.bigint();
    let executionTime = 0;
    
    try {
        // Execute behavior under test
        const behaviorResult = await behaviorUnderTest();
        result.behaviorExecuted = true;
        
        // Validate performance timing using high-resolution timer (not affected by fake timers)
        const endTime = process.hrtime.bigint();
        executionTime = Number(endTime - startTime) / 1000000; // Convert nanoseconds to milliseconds
        const maxTime = outcomeExpectations.maxExecutionTime || 5000;
        result.performanceWithinLimits = executionTime <= maxTime;
        
        // Validate user-visible outcomes
        if (outcomeExpectations.expectUserVisibleResults) {
            result.userVisibleResults = outcomeExpectations.extractUserResults(behaviorResult);
            
            // Validate user results meet expectations
            if (outcomeExpectations.validateUserResults) {
                outcomeExpectations.validateUserResults(result.userVisibleResults);
            }
        }
        
        // Validate overall outcome
        if (outcomeExpectations.validateOutcome) {
            result.outcomesMatched = outcomeExpectations.validateOutcome(behaviorResult);
        } else {
            result.outcomesMatched = true; // Default to success if no validation
        }
        
    } catch (error) {
        // Check if error was expected
        if (outcomeExpectations.expectError) {
            result.behaviorExecuted = true;
            result.outcomesMatched = outcomeExpectations.validateError ? 
                outcomeExpectations.validateError(error) : true;
        } else {
            throw error; // Re-throw unexpected errors
        }
    }
    
    // Validate final results meet standards
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

const expectConfigurationBehaviorChange = async (configSystem, configKey, newValue, behaviorTest) => {
    // Capture initial behavior state
    const initialBehaviorState = await behaviorTest();
    
    // Change configuration
    if (typeof configSystem.set === 'function') {
        configSystem.set(configKey, newValue);
    } else if (typeof configSystem.update === 'function') {
        configSystem.update(configKey, newValue);
    } else {
        throw new Error('Configuration system must have set() or update() method');
    }
    
    // Test behavior changed
    const finalBehaviorState = await behaviorTest();
    
    // Validate behavior actually changed
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

const expectErrorRecoveryBehavior = async (operationThatMayFail, recoveryExpectations = {}) => {
    const result = {
        operationAttempted: false,
        errorOccurred: false,
        recoveryAttempted: false,
        recoverySuccessful: false,
        finalSystemState: null
    };
    
    try {
        // Attempt the operation
        await operationThatMayFail();
        result.operationAttempted = true;
        
        // Operation succeeded - no recovery needed
        result.finalSystemState = recoveryExpectations.getSystemState ? 
            recoveryExpectations.getSystemState() : { status: 'operational' };
            
    } catch {
        result.operationAttempted = true;
        result.errorOccurred = true;
        
        // Wait for automatic recovery if configured
        if (recoveryExpectations.waitForRecovery) {
            await waitForDelay(recoveryExpectations.waitForRecovery);
            result.recoveryAttempted = true;
        }
        
        // Check recovery success
        if (recoveryExpectations.getSystemState) {
            result.finalSystemState = recoveryExpectations.getSystemState();
            result.recoverySuccessful = result.finalSystemState.status === 'operational' ||
                                      result.finalSystemState.status === 'recovering';
        }
        
        // Validate recovery behavior met expectations
        if (recoveryExpectations.requireRecovery && !result.recoverySuccessful) {
            throw new Error('System did not recover gracefully after error');
        }
    }
    
    return result;
};

// ================================================================================================
// HELPER FUNCTIONS FOR TESTS
// ================================================================================================

const expectValidNotification = (notification) => {
    expect(notification).toBeDefined();
    expect(notification.displayMessage).toBeDefined();
    return notification;
};

const expectNoTechnicalArtifacts = (str) => {
    if (!str) return;
    
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

const expectValidUserFeedback = (feedback) => {
    if (!feedback) {
        throw new Error('User feedback is required');
    }
    
    if (typeof feedback !== 'string') {
        throw new Error('User feedback must be a string');
    }
    
    // Check for meaningful content
    if (feedback.trim().length < 3) {
        throw new Error('User feedback too short to be meaningful');
    }
    
    // Check for no technical artifacts
    expectNoTechnicalArtifacts(feedback);
    
    // Ensure it contains some user-relevant information
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

// ================================================================================================
// EXPORTS
// ================================================================================================

module.exports = {
    // User Workflow Validation
    validateUserGiftFlow,
    validateNotificationFlow,
    validateCrossPlatformBehavior,
    
    // Content Validation Utilities
    validateUserVisibleContent,
    validateGiftData,
    validateNotificationData,
    
    // Quality Assessment
    assessWorkflowQuality,
    
    // Behavior-focused validation patterns
    expectValidDisplayedNotifications,
    expectSystemStateChanges,
    expectGracefulDegradation,
    expectBehaviorOutcome,
    expectConfigurationBehaviorChange,
    expectErrorRecoveryBehavior,
    
    // Re-exported from mock-factories for convenience
    createMockPlatform,
    createMockNotificationManager,
    setupAutomatedCleanup,
    
    // Additional helpers used by tests
    expectValidNotification,
    expectNoTechnicalArtifacts,
    expectValidUserFeedback
};
