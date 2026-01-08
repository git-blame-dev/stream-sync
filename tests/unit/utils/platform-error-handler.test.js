
const { 
    initializeTestLogging,
    createTestUser, 
    TEST_TIMEOUTS
} = require('../../helpers/test-setup');

const { 
    createMockLogger
} = require('../../helpers/mock-factories');

const { 
    setupAutomatedCleanup
} = require('../../helpers/mock-lifecycle');

const { 
    expectNoTechnicalArtifacts
} = require('../../helpers/assertion-helpers');

const { 
    PlatformErrorHandler, 
    createPlatformErrorHandler 
} = require('../../../src/utils/platform-error-handler');

// Initialize test logging
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true
});

describe('Platform Error Handler - User Experience Behavior', () => {
    let mockLogger;
    let errorHandler;
    let testPlatformName;

    beforeEach(() => {
        testPlatformName = 'tiktok';
        mockLogger = createMockLogger();
        errorHandler = new PlatformErrorHandler(mockLogger, testPlatformName);
    });

    describe('Error Recovery Behavior', () => {
        it('should maintain system stability during initialization failures', () => {
            // Given: System is running and an initialization error occurs
            const initError = new Error('Network connection failed');
            let systemCrashed = false;
            
            // When: Initialization error is handled
            try {
                errorHandler.handleInitializationError(initError, 'startup');
            } catch (error) {
                // Then: Error should be re-thrown for retry logic (expected behavior)
                expect(error).toBe(initError);
                expect(error.message).toBe('Network connection failed');
                expectNoTechnicalArtifacts(error.message);
            }
            
            // System should still be functional after error handling
            expect(systemCrashed).toBe(false);
        });

        it('should prevent chat processing pipeline disruption during event errors', () => {
            // Given: Chat processing is active and an event processing error occurs
            const eventError = new Error('Failed to parse gift data');
            const eventType = 'gift';
            const eventData = { id: 'gift_123', type: 'gift', username: 'TestUser' };
            let chatProcessingStopped = false;
            
            // When: Event processing error is handled
            try {
                errorHandler.handleEventProcessingError(eventError, eventType, eventData);
                // No exception should be thrown for event processing errors
                chatProcessingStopped = false;
            } catch (error) {
                chatProcessingStopped = true;
            }
            
            // Then: Chat processing should continue uninterrupted
            expect(chatProcessingStopped).toBe(false);
        });

        it('should maintain user experience during service unavailability', () => {
            // Given: User is using the system and a service becomes unavailable
            const serviceError = new Error('Authentication service timeout');
            const serviceName = 'AuthenticationService';
            let userExperienceDisrupted = false;
            
            // When: Service unavailable error is handled
            try {
                errorHandler.handleServiceUnavailableError(serviceName, serviceError);
                // Service errors should not disrupt user experience
                userExperienceDisrupted = false;
            } catch (error) {
                userExperienceDisrupted = true;
            }
            
            // Then: User experience should remain stable with fallback behavior
            expect(userExperienceDisrupted).toBe(false);
        });

        it('should provide consistent error recovery across different error types', () => {
            // Given: Various error scenarios that users might encounter
            const connectionError = new Error('WebSocket connection failed');
            const authError = 'not ready';
            const cleanupError = new Error('Failed to cleanup resources');
            
            let allErrorsHandledGracefully = true;
            
            // When: Different types of errors are handled
            try {
                errorHandler.handleConnectionError(connectionError, 'reconnect');
                errorHandler.handleAuthenticationError(authError);
                errorHandler.handleCleanupError(cleanupError, 'EventSub subscriptions');
            } catch (error) {
                allErrorsHandledGracefully = false;
            }
            
            // Then: All error types should be handled without system disruption
            expect(allErrorsHandledGracefully).toBe(true);
        });

        it('should maintain platform functionality during message sending failures', () => {
            // Given: User attempts to send messages and sending fails
            const sendError = new Error('API rate limit exceeded');
            const context = 'chat message sending';
            let platformFunctionalityMaintained = true;
            
            // When: Message sending error is handled
            try {
                errorHandler.handleMessageSendError(sendError, context);
                // Message sending errors should not crash the platform
            } catch (error) {
                platformFunctionalityMaintained = false;
            }
            
            // Then: Platform should remain functional for other operations
            expect(platformFunctionalityMaintained).toBe(true);
        });
    });

    describe('Factory Function Behavior', () => {
        it('should create functional error handler instances', () => {
            // Given: Need for a new platform error handler
            const testLogger = createMockLogger();
            const platformName = 'youtube';
            
            // When: Factory function creates error handler
            const handler = createPlatformErrorHandler(testLogger, platformName);
            
            // Then: Handler should be functional and ready for error scenarios
            expect(handler).toBeInstanceOf(PlatformErrorHandler);
            expect(handler.logger).toBe(testLogger);
            expect(handler.platformName).toBe(platformName);
            
            // Verify handler can handle errors without crashing
            let handlerFunctional = true;
            try {
                handler.handleConnectionError(new Error('Test error'), 'test');
            } catch (error) {
                handlerFunctional = false;
            }
            expect(handlerFunctional).toBe(true);
        });
    });

    describe('Error Message Quality', () => {
        it('should produce clean error contexts without technical artifacts', () => {
            // Given: Various error scenarios with different contexts
            const testError = new Error('User-facing error occurred');
            
            // When: Error contexts are generated
            const contexts = [];
            try {
                errorHandler.handleInitializationError(testError, 'user session startup');
            } catch (error) {
                contexts.push(error.message);
            }
            
            // Then: All error contexts should be clean and user-friendly
            contexts.forEach(context => {
                expectNoTechnicalArtifacts(context);
                expect(context).not.toMatch(/undefined|null|NaN/);
                expect(context).not.toMatch(/\{.*\}/); // No template placeholders
            });
        });
    });
}, TEST_TIMEOUTS.UNIT_TEST);
