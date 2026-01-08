
const StreamingAuthenticationSystem = require('../../src/auth/StreamingAuthenticationSystem');

function createRealAuthenticationSystem(options = {}) {
    const authSystem = new StreamingAuthenticationSystem({
        logger: options.logger || {
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {}
        }
    });
    
    return {
        timeoutConfiguration: options.timeoutConfiguration || 'responsive',
        performanceTarget: options.performanceTarget || 'streaming_optimized',
        userExperiencePriority: options.userExperiencePriority || 'immediate_feedback',
        
        // Real implementations that satisfy test requirements
        validateToken: authSystem.validateToken.bind(authSystem),
        refreshToken: authSystem.refreshToken.bind(authSystem),
        validateOAuth: authSystem.validateOAuth.bind(authSystem),
        getTimeoutConfiguration: authSystem.getTimeoutConfiguration.bind(authSystem),
        calculateTimeoutStrategies: authSystem.calculateTimeoutStrategies.bind(authSystem),
        calculateAdaptiveTimeout: authSystem.calculateAdaptiveTimeout.bind(authSystem),
        performBackgroundAuth: authSystem.performBackgroundAuth.bind(authSystem),
        executeWithProgressFeedback: authSystem.executeWithProgressFeedback.bind(authSystem),
        validateForStreamingContext: authSystem.validateForStreamingContext.bind(authSystem)
    };
}

function enableRealAuthenticationSystem() {
    // This will be used to override the mock factory in tests
    global.__useRealAuthenticationSystem = true;
    global.__createRealAuthenticationSystem = createRealAuthenticationSystem;
}

function disableRealAuthenticationSystem() {
    global.__useRealAuthenticationSystem = false;
    global.__createRealAuthenticationSystem = null;
}

module.exports = {
    createRealAuthenticationSystem,
    enableRealAuthenticationSystem,
    disableRealAuthenticationSystem,
    StreamingAuthenticationSystem
};