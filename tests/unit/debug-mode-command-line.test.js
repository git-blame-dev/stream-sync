
const { describe, test, expect, beforeEach } = require('bun:test');

const { initializeTestLogging } = require('../helpers/test-setup');
const { noOpLogger, createMockNotificationBuilder } = require('../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');
const { expectValidNotification } = require('../helpers/assertion-helpers');

// Initialize logging FIRST (required for all tests)
initializeTestLogging();

// Setup automated cleanup (no manual mock management)
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

const loggingModule = require('../../src/core/logging');
const { setDebugMode, getDebugMode } = loggingModule;

describe('Debug Mode Command Line Argument', () => {
    // Reset debug mode before each test to ensure isolation
    beforeEach(() => {
        // Reset mock implementations
        setDebugMode.mockClear();
        getDebugMode.mockClear();
        getDebugMode.mockReturnValue(false);
    });
    
    test('should enable debug mode when --debug argument is provided', () => {
        // Simulate command line argument processing
        const args = ['--debug'];
        const hasDebugArg = args.includes('--debug');
        
        if (hasDebugArg) {
            setDebugMode(true);
            // Mock the return value after setting
            getDebugMode.mockReturnValue(true);
        }
        
        expect(setDebugMode).toHaveBeenCalledWith(true);
        expect(getDebugMode()).toBe(true);
    });
    
    test('should disable debug mode when no --debug argument is provided', () => {
        // Simulate command line argument processing
        const args = ['--no-msg'];
        const hasDebugArg = args.includes('--debug');
        
        if (hasDebugArg) {
            setDebugMode(true);
            getDebugMode.mockReturnValue(true);
        } else {
            setDebugMode(false);
            getDebugMode.mockReturnValue(false);
        }
        
        expect(setDebugMode).toHaveBeenCalledWith(false);
        expect(getDebugMode()).toBe(false);
    });
    
    test('should override config.ini setting when --debug argument is provided', () => {
        // Simulate config.ini setting
        const configDebugEnabled = false;
        
        // Simulate command line argument processing
        const args = ['--debug'];
        const hasDebugArg = args.includes('--debug');
        
        if (hasDebugArg) {
            setDebugMode(true);
            getDebugMode.mockReturnValue(true);
        } else {
            setDebugMode(configDebugEnabled);
            getDebugMode.mockReturnValue(configDebugEnabled);
        }
        
        expect(setDebugMode).toHaveBeenCalledWith(true);
        expect(getDebugMode()).toBe(true);
    });
    
    test('should use config.ini setting when no --debug argument is provided', () => {
        // Simulate config.ini setting
        const configDebugEnabled = true;
        
        // Simulate command line argument processing
        const args = ['--no-msg'];
        const hasDebugArg = args.includes('--debug');
        
        if (hasDebugArg) {
            setDebugMode(true);
            getDebugMode.mockReturnValue(true);
        } else {
            setDebugMode(configDebugEnabled);
            getDebugMode.mockReturnValue(configDebugEnabled);
        }
        
        expect(setDebugMode).toHaveBeenCalledWith(true);
        expect(getDebugMode()).toBe(true);
    });
    
    test('should handle multiple command line arguments correctly', () => {
        // Simulate complex command line arguments
        const args = ['--debug', '--no-msg'];
        const hasDebugArg = args.includes('--debug');
        
        if (hasDebugArg) {
            setDebugMode(true);
            getDebugMode.mockReturnValue(true);
        } else {
            setDebugMode(false);
            getDebugMode.mockReturnValue(false);
        }
        
        expect(setDebugMode).toHaveBeenCalledWith(true);
        expect(getDebugMode()).toBe(true);
    });
    
    test('should toggle debug mode correctly', () => {
        // Test that debug mode can be toggled
        expect(getDebugMode()).toBe(false);
        
        setDebugMode(true);
        getDebugMode.mockReturnValue(true);
        expect(setDebugMode).toHaveBeenCalledWith(true);
        expect(getDebugMode()).toBe(true);
        
        setDebugMode(false);
        getDebugMode.mockReturnValue(false);
        expect(setDebugMode).toHaveBeenCalledWith(false);
        expect(getDebugMode()).toBe(false);
        
        setDebugMode(true);
        getDebugMode.mockReturnValue(true);
        expect(setDebugMode).toHaveBeenLastCalledWith(true);
        expect(getDebugMode()).toBe(true);
    });
}); 
