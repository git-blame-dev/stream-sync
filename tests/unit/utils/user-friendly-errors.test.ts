const { describe, expect, beforeEach, afterEach, it } = require('bun:test');
const { spyOn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { initializeTestLogging, TEST_TIMEOUTS } = require('../../helpers/test-setup');
initializeTestLogging();

const {
    handleUserFacingError
} = require('../../../src/utils/user-friendly-errors.ts');
const {
    expectNoTechnicalArtifacts,
    expectContentReadabilityForAudience
} = require('../../helpers/assertion-helpers');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');
const { noOpLogger } = require('../../helpers/mock-factories');

export {};

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    logPerformanceMetrics: true
});

describe('User-Friendly Error System', () => {
    describe('handleUserFacingError', () => {
        let mockLogger;
        let consoleOutput;

        beforeEach(() => {
            consoleOutput = [];
            mockLogger = noOpLogger;
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

            it('should display user-friendly message for authentication errors', () => {
                const technicalError = new Error('Token validation failed: 401 Unauthorized');

                handleUserFacingError(technicalError, {
                    logger: mockLogger,
                    category: 'authentication'
                });

                const output = consoleOutput.join('\n');
                expect(output).toContain('TWITCH CONNECTION PROBLEM');
                expect(output).toContain('reconnect your Twitch account');
                expectNoTechnicalArtifacts(output);
            });

            it('should not show console output when disabled', () => {
                const technicalError = 'Some error';
                
                handleUserFacingError(technicalError, { logger: mockLogger }, { 
                    showInConsole: false 
                });
                
                expect(consoleOutput).toHaveLength(0);
            });

            it('should display warning-level messages appropriately', () => {
                const warningError = 'YouTube API key missing';

                handleUserFacingError(warningError, {
                    logger: mockLogger,
                    category: 'configuration'
                });

                const output = consoleOutput.join('\n');
                expect(output).toContain('YOUTUBE SETUP REQUIRED');
                expect(output).toContain('WARNING');
            });
        });

        describe('when handling exit scenarios', () => {
            let mockProcessExit;

            beforeEach(() => {
                mockProcessExit = spyOn(process, 'exit').mockImplementation(() => {});
            });

            afterEach(() => {
        restoreAllMocks();
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
}, TEST_TIMEOUTS.FAST);
