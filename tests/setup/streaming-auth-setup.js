
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
    // Store the original mock factory function
    const originalCreateMockAuthenticationSystem = global.createMockAuthenticationSystem;
    
    // Replace with real implementation
    global.createMockAuthenticationSystem = function(options = {}) {
        return {
            timeoutConfiguration: options.timeoutConfiguration || 'responsive',
            performanceTarget: options.performanceTarget || 'streaming_optimized',
            userExperiencePriority: options.userExperiencePriority || 'immediate_feedback',
            
            // Real implementations that satisfy test requirements
            validateToken: jest.fn().mockImplementation(async (authRequest, networkConditions) => {
                return await globalAuthSystem.validateToken(authRequest, networkConditions);
            }),
            refreshToken: jest.fn().mockImplementation(async (authRequest) => {
                return await globalAuthSystem.refreshToken(authRequest);
            }),
            validateOAuth: jest.fn().mockImplementation(async (authRequest) => {
                return await globalAuthSystem.validateOAuth(authRequest);
            }),
            getTimeoutConfiguration: jest.fn().mockImplementation(async (authRequest) => {
                return await globalAuthSystem.getTimeoutConfiguration(authRequest);
            }),
            calculateTimeoutStrategies: jest.fn().mockImplementation(async (operations) => {
                return await globalAuthSystem.calculateTimeoutStrategies(operations);
            }),
            calculateAdaptiveTimeout: jest.fn().mockImplementation(async (request) => {
                return await globalAuthSystem.calculateAdaptiveTimeout(request);
            }),
            performBackgroundAuth: jest.fn().mockImplementation(async (authRequest) => {
                return await globalAuthSystem.performBackgroundAuth(authRequest);
            }),
            executeWithProgressFeedback: jest.fn().mockImplementation(async (operation) => {
                return await globalAuthSystem.executeWithProgressFeedback(operation);
            }),
            validateForStreamingContext: jest.fn().mockImplementation(async (authRequest) => {
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