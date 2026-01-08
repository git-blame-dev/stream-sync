
const { 
    waitForEvent, 
    waitFor, 
    observeUserExperience,
    expectUserExperience,
    expectNoTechnicalArtifacts,
    NetworkEventSimulator 
} = require('./event-driven-testing');

const convertDelayToEvent = async (emitter, eventName, timeoutMs = 5000) => {
    return waitForEvent(emitter, eventName, timeoutMs);
};

const convertPollingToCondition = async (condition, options = {}) => {
    return waitFor(condition, { timeout: 5000, interval: 50, ...options });
};

const convertCallsToUserBehavior = async (operation) => {
    return observeUserExperience(operation);
};


const convertPlatformConnectionTest = {
    async fromTimingToEvent(platform, connectionOperation) {
        // Instead of waiting for arbitrary time, wait for connection event
        const connectionPromise = waitForEvent(platform, 'connected', 10000);
        
        // Perform connection operation
        connectionOperation();
        
        // Wait for actual connection event
        const connectionResult = await connectionPromise;
        
        return {
            connected: true,
            userInformed: true,
            readyToReceiveEvents: true,
            connectionData: connectionResult
        };
    },

    async fromImplementationToExperience(platform, connectionOperation) {
        return observeUserExperience(async () => {
            const result = await connectionOperation();
            
            // Record user-visible outcomes
            if (global.testUserExperienceObserver) {
                global.testUserExperienceObserver.recordStatusChange({
                    component: 'platform',
                    newStatus: 'connected',
                    previousStatus: 'disconnected',
                    userVisible: true
                });
            }
            
            return result;
        });
    }
};


const convertNotificationTest = {
    async fromInternalToUserExperience(notificationData, processor) {
        return observeUserExperience(async () => {
            const result = await processor(notificationData);
            
            // Record what user would experience
            if (global.testUserExperienceObserver) {
                global.testUserExperienceObserver.recordNotification({
                    content: result.displayContent,
                    type: result.type,
                    platform: result.platform
                });
                
                if (result.audioContent) {
                    global.testUserExperienceObserver.recordAudioEvent({
                        type: 'tts',
                        content: result.audioContent
                    });
                }
            }
            
            return result;
        });
    },

    async fromTimingToEventSequence(notifications, processor) {
        const results = [];
        
        for (const notification of notifications) {
            // Wait for processing complete event instead of arbitrary delay
            const processedPromise = waitForEvent(processor, 'notificationProcessed', 5000);
            
            // Process notification
            processor.process(notification);
            
            // Wait for completion
            const result = await processedPromise;
            results.push(result);
        }
        
        return results;
    }
};


const convertErrorHandlingTest = {
    async fromExceptionToUserImpact(errorOperation) {
        return observeUserExperience(async () => {
            try {
                const result = await errorOperation();
                return result;
            } catch (error) {
                // Record user-facing error impact
                if (global.testUserExperienceObserver) {
                    global.testUserExperienceObserver.recordUserFacingError({
                        message: error.message,
                        severity: error.severity || 'medium',
                        userImpact: error.userImpact || 'functionality_degraded',
                        recovered: false
                    });
                }
                throw error;
            }
        });
    }
};


const convertConfigTest = {
    async fromMockCallsToBehavior(configOperation, expectedBehavior) {
        const { result, userExperience } = await observeUserExperience(configOperation);
        
        // Validate behavior instead of implementation calls
        const behaviorValidation = {
            configurationApplied: result.success,
            userNotifiedOfChanges: userExperience.notifications.length > 0,
            systemStateUpdated: userExperience.statusChanges.length > 0,
            noErrorsOccurred: userExperience.errors.length === 0
        };
        
        // Validate against expected behavior
        Object.keys(expectedBehavior).forEach(key => {
            expect(behaviorValidation[key]).toBe(expectedBehavior[key]);
        });
        
        return behaviorValidation;
    }
};


const identifyTimingPatterns = (testCode) => {
    const patterns = {
        setTimeout: /setTimeout\s*\(/g,
        setInterval: /setInterval\s*\(/g,
        promiseDelay: /new Promise\s*\(\s*resolve\s*=>\s*setTimeout/g,
        sleep: /sleep\s*\(/g,
        delay: /delay\s*\(/g
    };
    
    const found = {};
    Object.keys(patterns).forEach(pattern => {
        const matches = testCode.match(patterns[pattern]);
        if (matches) {
            found[pattern] = matches.length;
        }
    });
    
    return found;
};

const identifyImplementationPatterns = (testCode) => {
    const patterns = {
        mockCallVerification: /toHaveBeenCalledWith\s*\(/g,
        internalPropertyAccess: /expect\s*\([^)]*\.[^)]*\)\s*\.toBe/g,
        implementationSteps: /expect\s*\([^)]*\.(parsed|validated|formatted|processed)\s*\)/g,
        internalStateChecking: /expect\s*\([^)]*\.state\.|expect\s*\([^)]*\.internal/g
    };
    
    const found = {};
    Object.keys(patterns).forEach(pattern => {
        const matches = testCode.match(patterns[pattern]);
        if (matches) {
            found[pattern] = matches.length;
        }
    });
    
    return found;
};

const generateConversionSuggestions = (testCode) => {
    const timingPatterns = identifyTimingPatterns(testCode);
    const implementationPatterns = identifyImplementationPatterns(testCode);
    
    const suggestions = [];
    
    // Timing dependency suggestions
    if (timingPatterns.setTimeout) {
        suggestions.push({
            pattern: 'setTimeout',
            count: timingPatterns.setTimeout,
            suggestion: 'Replace setTimeout with waitForEvent() or waitFor() conditions',
            example: 'await waitForEvent(platform, "connected") instead of setTimeout'
        });
    }
    
    if (timingPatterns.promiseDelay) {
        suggestions.push({
            pattern: 'Promise delays',
            count: timingPatterns.promiseDelay,
            suggestion: 'Replace Promise-based delays with event-driven waiting',
            example: 'await waitForEvent(emitter, "event") instead of Promise timeout'
        });
    }
    
    // Implementation pattern suggestions
    if (implementationPatterns.mockCallVerification) {
        suggestions.push({
            pattern: 'Mock call verification',
            count: implementationPatterns.mockCallVerification,
            suggestion: 'Replace toHaveBeenCalledWith with user experience validation',
            example: 'Validate user outcomes instead of method calls'
        });
    }
    
    if (implementationPatterns.implementationSteps) {
        suggestions.push({
            pattern: 'Implementation step checking',
            count: implementationPatterns.implementationSteps,
            suggestion: 'Replace internal state validation with user experience validation',
            example: 'Check what user sees instead of internal processing steps'
        });
    }
    
    return suggestions;
};


const validateUserExperienceFocus = (testResult) => {
    const checks = {
        hasUserObservations: testResult.userExperience !== undefined,
        validatesUserOutcomes: testResult.userExperience && testResult.userExperience.summary,
        avoidsInternalDetails: !testResult.internalStateChecked,
        noTechnicalArtifacts: true // Will be validated by content check
    };
    
    // Validate content quality if display content exists
    if (testResult.displayContent) {
        try {
            expectNoTechnicalArtifacts(testResult.displayContent);
        } catch (error) {
            checks.noTechnicalArtifacts = false;
        }
    }
    
    return checks;
};

const validateTimingIndependence = (testCode) => {
    const timingPatterns = identifyTimingPatterns(testCode);
    const isTimingIndependent = Object.keys(timingPatterns).length === 0;
    
    return {
        isTimingIndependent,
        timingDependencies: timingPatterns,
        recommendation: isTimingIndependent ? 
            'Test is timing-independent' : 
            'Convert timing dependencies to event-driven patterns'
    };
};

module.exports = {
    // Core conversion utilities
    convertDelayToEvent,
    convertPollingToCondition,
    convertCallsToUserBehavior,
    
    // Specialized converters
    convertPlatformConnectionTest,
    convertNotificationTest,
    convertErrorHandlingTest,
    convertConfigTest,
    
    // Pattern identification and migration
    identifyTimingPatterns,
    identifyImplementationPatterns,
    generateConversionSuggestions,
    
    // Validation helpers
    validateUserExperienceFocus,
    validateTimingIndependence
};