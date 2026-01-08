
// Initialize logging first
const { 
    initializeTestLogging, 
    createTestUser, 
    TEST_TIMEOUTS
} = require('../../helpers/test-setup');
initializeTestLogging();

const { 
    translateError,
    formatErrorForConsole,
    formatErrorForLog,
    showUserFriendlyError,
    handleUserFacingError,
    ERROR_MESSAGES,
    TECHNICAL_ERROR_PATTERNS
} = require('../../../src/utils/user-friendly-errors');

const { 
    expectNoTechnicalArtifacts,
    validateUserFacingString,
    expectContentReadabilityForAudience
} = require('../../helpers/assertion-helpers');

const { 
    setupAutomatedCleanup
} = require('../../helpers/mock-lifecycle');

const {
    createMockLogger
} = require('../../helpers/mock-factories');

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    logPerformanceMetrics: true
});

describe('User-Friendly Error System', () => {
    describe('translateError', () => {
        describe('when translating authentication errors', () => {
            it('should translate missing Twitch credentials error', () => {
                const technicalError = 'Missing clientId or clientSecret';
                
                const friendlyError = translateError(technicalError);
                
                expect(friendlyError.title).toBe('Twitch Setup Required');
                expect(friendlyError.category).toBe('authentication');
                expectNoTechnicalArtifacts(friendlyError.message);
                expectContentReadabilityForAudience(friendlyError.message, 'user');
            });

            it('should translate token expiration error', () => {
                const technicalError = new Error('401: Invalid OAuth token - expired');
                
                const friendlyError = translateError(technicalError);
                
                expect(friendlyError.title).toBe('Twitch Connection Expired');
                expect(friendlyError.severity).toBe('warning');
                expectNoTechnicalArtifacts(friendlyError.message);
                expectNoTechnicalArtifacts(friendlyError.action);
            });

            it('should translate OAuth flow failure', () => {
                const technicalError = 'OAuth flow failed: ECONNRESET';
                
                const friendlyError = translateError(technicalError);
                
                expect(friendlyError.title).toBe('Account Connection Failed');
                expectNoTechnicalArtifacts(friendlyError.message);
                expect(friendlyError.action).toContain('try again');
            });
        });

        describe('when translating configuration errors', () => {
            it('should translate missing config file error', () => {
                const technicalError = new Error('Configuration file not found');
                
                const friendlyError = translateError(technicalError);
                
                expect(friendlyError.title).toBe('Settings File Missing');
                expectNoTechnicalArtifacts(friendlyError.message);
                expectNoTechnicalArtifacts(friendlyError.action);
            });

            it('should translate config format error', () => {
                const technicalError = 'Failed to load configuration: Parse error at line 5';
                
                const friendlyError = translateError(technicalError);
                
                expect(friendlyError.title).toBe('Settings File Problem');
                expectNoTechnicalArtifacts(friendlyError.message);
                // Config-related actions can reference configuration files
                expectNoTechnicalArtifacts(friendlyError.action);
            });

            it('should translate YouTube API key missing', () => {
                const technicalError = 'YouTube API key is required but not configured';
                
                const friendlyError = translateError(technicalError);
                
                expect(friendlyError.title).toBe('YouTube Setup Required');
                expect(friendlyError.severity).toBe('warning');
                expectNoTechnicalArtifacts(friendlyError.message);
            });
        });

        describe('when translating connection errors', () => {
            it('should translate OBS connection failure', () => {
                const technicalError = 'Failed to connect to OBS WebSocket server on localhost:4455';
                
                const friendlyError = translateError(technicalError);
                
                expect(friendlyError.title).toBe('OBS Connection Problem');
                expect(friendlyError.category).toBe('connection');
                expectNoTechnicalArtifacts(friendlyError.message);
                expect(friendlyError.action).toContain('OBS Studio');
            });

            it('should translate network error', () => {
                const technicalError = new Error('ECONNREFUSED 127.0.0.1:80');
                
                const friendlyError = translateError(technicalError);
                
                expect(friendlyError.title).toBe('Internet Connection Problem');
                expectNoTechnicalArtifacts(friendlyError.message);
                expectContentReadabilityForAudience(friendlyError.action, 'user');
            });

            it('should translate platform connection failure', () => {
                const technicalError = 'Platform connection failed: timeout after 30000ms';
                
                const friendlyError = translateError(technicalError);
                
                expect(friendlyError.title).toBe('Platform Connection Problem');
                expectNoTechnicalArtifacts(friendlyError.message);
            });
        });

        describe('when translating system errors', () => {
            it('should translate permission denied error', () => {
                const technicalError = new Error('EACCES: permission denied, open \'/path/to/file\'');
                
                const friendlyError = translateError(technicalError);
                
                expect(friendlyError.title).toBe('File Access Problem');
                expect(friendlyError.category).toBe('system');
                expectNoTechnicalArtifacts(friendlyError.message);
            });

            it('should translate disk full error', () => {
                const technicalError = 'ENOSPC: no space left on device';
                
                const friendlyError = translateError(technicalError);
                
                expect(friendlyError.title).toBe('Storage Space Problem');
                expectNoTechnicalArtifacts(friendlyError.message);
                expectContentReadabilityForAudience(friendlyError.action, 'user');
            });
        });

        describe('when handling unknown errors', () => {
            it('should provide generic user-friendly fallback', () => {
                const technicalError = 'SomeUnknownModuleError: mysterious failure in subsystem 42';
                
                const friendlyError = translateError(technicalError);
                
                expect(friendlyError.title).toBe('Unexpected Problem');
                expect(friendlyError.category).toBe('unknown');
                expectNoTechnicalArtifacts(friendlyError.message);
                expectContentReadabilityForAudience(friendlyError.message, 'user');
            });

            it('should not expose technical details in fallback by default', () => {
                const technicalError = new Error('TypeError: Cannot read property \'foo\' of undefined at module.js:123');
                
                const friendlyError = translateError(technicalError);
                
                expect(friendlyError.technicalDetails).toBeUndefined();
                expectNoTechnicalArtifacts(friendlyError.message);
                expectNoTechnicalArtifacts(friendlyError.action);
            });

            it('should include technical details when requested', () => {
                const technicalError = 'Internal server error 500';
                
                const friendlyError = translateError(technicalError, { includeTechnical: true });
                
                expect(friendlyError.technicalDetails).toBe(technicalError);
                expectNoTechnicalArtifacts(friendlyError.message); // User message should still be clean
            });
        });
    });

    describe('formatErrorForConsole', () => {
        describe('when formatting user-facing content', () => {
            const mockFriendlyError = {
                title: 'Connection Problem',
                message: 'Unable to connect to streaming platform.',
                action: 'Please check your internet connection and try again.',
                severity: 'error',
                category: 'connection'
            };

            it('should create clean console output without technical artifacts', () => {
                const consoleOutput = formatErrorForConsole(mockFriendlyError);
                
                expectNoTechnicalArtifacts(consoleOutput);
                expect(consoleOutput).toContain('CONNECTION PROBLEM');
                expect(consoleOutput).toContain('Unable to connect');
                expect(consoleOutput).toContain('What to do:');
            });

            it('should use appropriate severity labels', () => {
                const errorOutput = formatErrorForConsole(mockFriendlyError);
                expect(errorOutput).toContain('ERROR:');

                const warningError = { ...mockFriendlyError, severity: 'warning' };
                const warningOutput = formatErrorForConsole(warningError);
                expect(warningOutput).toContain('WARNING:');

                const infoError = { ...mockFriendlyError, severity: 'info' };
                const infoOutput = formatErrorForConsole(infoError);
                expect(infoOutput).toContain('INFO:');
            });

            it('should hide technical details by default', () => {
                const errorWithTechnical = {
                    ...mockFriendlyError,
                    technicalDetails: 'TypeError: foo is not defined at bar.js:123'
                };
                
                const consoleOutput = formatErrorForConsole(errorWithTechnical);
                
                expectNoTechnicalArtifacts(consoleOutput);
                expect(consoleOutput).not.toContain('TypeError');
                expect(consoleOutput).not.toContain('bar.js');
            });

            it('should show technical details when requested', () => {
                const errorWithTechnical = {
                    ...mockFriendlyError,
                    technicalDetails: 'Connection timeout after 30s'
                };
                
                const consoleOutput = formatErrorForConsole(errorWithTechnical, { showTechnical: true });
                
                expect(consoleOutput).toContain('Technical details:');
                expect(consoleOutput).toContain('Connection timeout');
            });

            it('should handle errors without actions gracefully', () => {
                const errorWithoutAction = {
                    title: 'Minor Issue',
                    message: 'Something happened.',
                    severity: 'info',
                    category: 'system'
                };
                
                const consoleOutput = formatErrorForConsole(errorWithoutAction);
                
                expectNoTechnicalArtifacts(consoleOutput);
                expect(consoleOutput).toContain('Something happened.');
                expect(consoleOutput).not.toContain('What to do:');
            });
        });
    });

    describe('formatErrorForLog', () => {
        it('should create structured log messages', () => {
            const friendlyError = {
                title: 'Authentication Failed',
                message: 'Your credentials need to be updated.',
                action: 'Please run the setup process.',
                technicalDetails: 'Invalid OAuth token: 401 Unauthorized'
            };
            
            const logMessage = formatErrorForLog(friendlyError);
            
            expect(logMessage).toContain('Authentication Failed:');
            expect(logMessage).toContain('Your credentials need to be updated.');
            expect(logMessage).toContain('Action: Please run the setup process.');
            expect(logMessage).toContain('Technical: Invalid OAuth token');
        });

        it('should handle missing fields gracefully', () => {
            const minimalError = {
                title: 'Problem',
                message: 'Something went wrong.',
                severity: 'error'
            };
            
            const logMessage = formatErrorForLog(minimalError);
            
            expect(logMessage).toBe('Problem: Something went wrong.');
        });
    });

    describe('handleUserFacingError', () => {
        let mockLogger;
        let consoleOutput;

        beforeEach(() => {
            consoleOutput = [];
            mockLogger = createMockLogger('debug');
            mockLogger.console = (message) => {
                consoleOutput.push(message);
            };
        });

        describe('when showing user-facing errors', () => {
            it('should display user-friendly console message', () => {
                const technicalError = 'Missing clientId or clientSecret';
                
                handleUserFacingError(technicalError, { logger: mockLogger });
                
                const output = consoleOutput.join('\n');
                expectNoTechnicalArtifacts(output);
                expectContentReadabilityForAudience(output, 'user');
            });

            it('should log technical details when logger provided', () => {
                const technicalError = new Error('Token validation failed: 401 Unauthorized');
                
                handleUserFacingError(technicalError, { 
                    logger: mockLogger,
                    category: 'authentication'
                });
                
                expect(mockLogger.error).toHaveBeenCalled();
                const logArgs = mockLogger.error.mock.calls[0];
                expect(logArgs[1]).toBe('authentication');
                expect(logArgs[2]).toMatchObject({
                    error: 'Token validation failed: 401 Unauthorized',
                    eventType: 'user-friendly-error'
                });
            });

            it('should not show console output when disabled', () => {
                const technicalError = 'Some error';
                
                handleUserFacingError(technicalError, { logger: mockLogger }, { 
                    showInConsole: false 
                });
                
                expect(consoleOutput).toHaveLength(0);
            });

            it('should handle warnings with appropriate logging', () => {
                const warningError = 'YouTube API key missing';
                
                handleUserFacingError(warningError, { 
                    logger: mockLogger,
                    category: 'configuration'
                });
                
                // Should log as warning for YouTube API key issues
                expect(mockLogger.warn).toHaveBeenCalled();
            });
        });

        describe('when handling exit scenarios', () => {
            let mockProcessExit;

            beforeEach(() => {
                mockProcessExit = jest.spyOn(process, 'exit').mockImplementation(() => {});
            });

            afterEach(() => {
                mockProcessExit.mockRestore();
            });

            it('should exit when exitOnError is true', () => {
                const criticalError = 'Authentication validation failed';
                
                handleUserFacingError(criticalError, { logger: mockLogger }, { 
                    exitOnError: true 
                });
                
                expect(mockProcessExit).toHaveBeenCalledWith(1);
            });

            it('should not exit by default', () => {
                const normalError = 'Some recoverable error';
                
                handleUserFacingError(normalError, { logger: mockLogger });
                
                expect(mockProcessExit).not.toHaveBeenCalled();
            });
        });
    });

    describe('content quality validation for all error messages', () => {
        it('should validate all predefined error messages for content quality', () => {
            Object.keys(ERROR_MESSAGES).forEach(errorKey => {
                const errorMessage = ERROR_MESSAGES[errorKey];
                
                // Validate title
                expectNoTechnicalArtifacts(errorMessage.title);
                validateUserFacingString(errorMessage.title, {
                    minLength: 5,
                    mustNotContain: ['API', 'config', 'OAuth', 'WebSocket', 'HTTP']
                });
                
                // Validate message content
                expectNoTechnicalArtifacts(errorMessage.message);
                validateUserFacingString(errorMessage.message);
                // Allow configuration file references for config-related errors
                if (errorMessage.category !== 'configuration') {
                    expectContentReadabilityForAudience(errorMessage.message, 'user');
                }
                
                // Validate action (if present)
                if (errorMessage.action) {
                    expectNoTechnicalArtifacts(errorMessage.action);
                    validateUserFacingString(errorMessage.action);
                    // Allow configuration file references for config-related errors
                    if (errorMessage.category !== 'configuration') {
                        expectContentReadabilityForAudience(errorMessage.action, 'user');
                    }
                }
                
                // Validate severity is appropriate
                expect(['error', 'warning', 'info']).toContain(errorMessage.severity);
                
                // Validate category is appropriate
                expect(['authentication', 'configuration', 'connection', 'system']).toContain(errorMessage.category);
            });
        });

        it('should ensure technical error patterns are comprehensive', () => {
            // Test that each error message has at least one pattern that can trigger it
            Object.keys(ERROR_MESSAGES).forEach(errorKey => {
                const hasPattern = TECHNICAL_ERROR_PATTERNS.some(patternGroup => 
                    patternGroup.errorKey === errorKey
                );
                
                expect(hasPattern).toBe(true);
            });
        });

        it('should validate pattern matching works for common error scenarios', () => {
            const testCases = [
                {
                    technicalError: 'Configuration file not found',
                    expectedTitle: 'Settings File Missing'
                },
                {
                    technicalError: 'Access token expired',
                    expectedTitle: 'Twitch Connection Expired'
                },
                {
                    technicalError: 'Failed to connect to OBS on localhost:4455',
                    expectedTitle: 'OBS Connection Problem'
                },
                {
                    technicalError: 'Missing clientId or clientSecret',
                    expectedTitle: 'Twitch Setup Required'
                },
                {
                    technicalError: 'ECONNREFUSED - connection refused',
                    expectedTitle: 'Internet Connection Problem'
                }
            ];
            
            testCases.forEach(({ technicalError, expectedTitle }) => {
                const friendlyError = translateError(technicalError);
                expect(friendlyError.title).toBe(expectedTitle);
                expectNoTechnicalArtifacts(friendlyError.message);
                expectContentReadabilityForAudience(friendlyError.message, 'user');
            });
        });
    });

    describe('integration with existing error handling', () => {
        it('should work seamlessly with Error objects', () => {
            const errorObject = new Error('Token validation failed: Invalid grant');
            errorObject.code = 'INVALID_GRANT';
            
            const friendlyError = translateError(errorObject);
            
            expect(friendlyError.title).toBe('Twitch Connection Problem');
            expectNoTechnicalArtifacts(friendlyError.message);
        });

        it('should preserve context information', () => {
            const technicalError = 'Authentication failed';
            const context = {
                platform: 'twitch',
                operation: 'startup',
                userId: 'testuser123'
            };
            
            const friendlyError = translateError(technicalError, context);
            
            expect(friendlyError.context).toEqual(context);
        });

        it('should handle string and Error object inputs consistently', () => {
            const message = 'OAuth flow failed';
            const errorObject = new Error(message);
            
            const stringResult = translateError(message);
            const objectResult = translateError(errorObject);
            
            expect(stringResult.title).toBe(objectResult.title);
            expect(stringResult.message).toBe(objectResult.message);
        });
    });
}, TEST_TIMEOUTS.FAST);
