
const { createMockFn } = require('../helpers/bun-mock-utils');
const StreamingAuthenticationSystem = require('../../src/auth/StreamingAuthenticationSystem');

// Create a global instance of the streaming authentication system
const globalAuthSystem = new StreamingAuthenticationSystem({
    logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {}
    }
});

beforeAll(() => {
    // Replace with real implementation
    global.createMockAuthenticationSystem = function(options = {}) {
        return {
            timeoutConfiguration: options.timeoutConfiguration || 'responsive',
            performanceTarget: options.performanceTarget || 'streaming_optimized',
            userExperiencePriority: options.userExperiencePriority || 'immediate_feedback',
            
            // Real implementations that satisfy test requirements
            validateToken: createMockFn().mockImplementation(async (authRequest, networkConditions) => {
                return await globalAuthSystem.validateToken(authRequest, networkConditions);
            }),
            refreshToken: createMockFn().mockImplementation(async (authRequest) => {
                return await globalAuthSystem.refreshToken(authRequest);
            }),
            validateOAuth: createMockFn().mockImplementation(async (authRequest) => {
                return await globalAuthSystem.validateOAuth(authRequest);
            }),
            getTimeoutConfiguration: createMockFn().mockImplementation(async (authRequest) => {
                return await globalAuthSystem.getTimeoutConfiguration(authRequest);
            }),
            calculateTimeoutStrategies: createMockFn().mockImplementation(async (operations) => {
                return await globalAuthSystem.calculateTimeoutStrategies(operations);
            }),
            calculateAdaptiveTimeout: createMockFn().mockImplementation(async (request) => {
                return await globalAuthSystem.calculateAdaptiveTimeout(request);
            }),
            performBackgroundAuth: createMockFn().mockImplementation(async (authRequest) => {
                return await globalAuthSystem.performBackgroundAuth(authRequest);
            }),
            executeWithProgressFeedback: createMockFn().mockImplementation(async (operation) => {
                return await globalAuthSystem.executeWithProgressFeedback(operation);
            }),
            validateForStreamingContext: createMockFn().mockImplementation(async (authRequest) => {
                return await globalAuthSystem.validateForStreamingContext(authRequest);
            })
        };
    };
});

afterAll(() => {
    // Clean up global overrides
    delete global.createMockAuthenticationSystem;
});

module.exports = {
    globalAuthSystem
};