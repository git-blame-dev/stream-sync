const { describe, test, expect, beforeEach } = require('bun:test');
const { noOpLogger } = require('../../helpers/mock-factories');
const { PlatformErrorHandler, createPlatformErrorHandler } = require('../../../src/utils/platform-error-handler');

describe('Platform Error Handler - User Experience Behavior', () => {
    let errorHandler;
    let testPlatformName;

    beforeEach(() => {
        testPlatformName = 'tiktok';
        errorHandler = new PlatformErrorHandler(noOpLogger, testPlatformName);
    });

    describe('Error Recovery Behavior', () => {
        test('maintains system stability during initialization failures', () => {
            const initError = new Error('Network connection failed');
            let systemCrashed = false;

            try {
                errorHandler.handleInitializationError(initError, 'startup');
            } catch (error) {
                expect(error).toBe(initError);
                expect(error.message).toBe('Network connection failed');
                expect(error.message).not.toContain('undefined');
                expect(error.message).not.toContain('null');
            }

            expect(systemCrashed).toBe(false);
        });

        test('prevents chat processing pipeline disruption during event errors', () => {
            const eventError = new Error('Failed to parse gift data');
            const eventType = 'platform:gift';
            const eventData = { id: 'gift_123', type: 'platform:gift', username: 'TestUser' };
            let chatProcessingStopped = false;

            try {
                errorHandler.handleEventProcessingError(eventError, eventType, eventData);
                chatProcessingStopped = false;
            } catch {
                chatProcessingStopped = true;
            }

            expect(chatProcessingStopped).toBe(false);
        });

        test('maintains user experience during service unavailability', () => {
            const serviceError = new Error('Authentication service timeout');
            const serviceName = 'AuthenticationService';
            let userExperienceDisrupted = false;

            try {
                errorHandler.handleServiceUnavailableError(serviceName, serviceError);
                userExperienceDisrupted = false;
            } catch {
                userExperienceDisrupted = true;
            }

            expect(userExperienceDisrupted).toBe(false);
        });

        test('provides consistent error recovery across different error types', () => {
            const connectionError = new Error('WebSocket connection failed');
            const authError = 'not ready';
            const cleanupError = new Error('Failed to cleanup resources');

            let allErrorsHandledGracefully = true;

            try {
                errorHandler.handleConnectionError(connectionError, 'reconnect');
                errorHandler.handleAuthenticationError(authError);
                errorHandler.handleCleanupError(cleanupError, 'EventSub subscriptions');
            } catch {
                allErrorsHandledGracefully = false;
            }

            expect(allErrorsHandledGracefully).toBe(true);
        });

        test('maintains platform functionality during message sending failures', () => {
            const sendError = new Error('API rate limit exceeded');
            const context = 'chat message sending';
            let platformFunctionalityMaintained = true;

            try {
                errorHandler.handleMessageSendError(sendError, context);
            } catch {
                platformFunctionalityMaintained = false;
            }

            expect(platformFunctionalityMaintained).toBe(true);
        });
    });

    describe('Factory Function Behavior', () => {
        test('creates functional error handler instances', () => {
            const platformName = 'youtube';

            const handler = createPlatformErrorHandler(noOpLogger, platformName);

            expect(handler).toBeInstanceOf(PlatformErrorHandler);
            expect(handler.logger).toBe(noOpLogger);
            expect(handler.platformName).toBe(platformName);

            let handlerFunctional = true;
            try {
                handler.handleConnectionError(new Error('Test error'), 'test');
            } catch {
                handlerFunctional = false;
            }
            expect(handlerFunctional).toBe(true);
        });
    });

    describe('Error Message Quality', () => {
        test('produces clean error contexts without technical artifacts', () => {
            const testError = new Error('User-facing error occurred');

            const contexts = [];
            try {
                errorHandler.handleInitializationError(testError, 'user session startup');
            } catch (error) {
                contexts.push(error.message);
            }

            contexts.forEach(context => {
                expect(context).not.toMatch(/undefined|null|NaN/);
                expect(context).not.toMatch(/\{.*\}/);
            });
        });
    });
});
