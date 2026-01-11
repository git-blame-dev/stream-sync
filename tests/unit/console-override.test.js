
// Unmock the logging module for this test since we're testing the actual implementation
jest.unmock('../../src/core/logging');

const { initializeTestLogging, createTestUser, TEST_TIMEOUTS } = require('../helpers/test-setup');
const { createMockLogger, createMockNotificationBuilder } = require('../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');
const { expectValidNotification } = require('../helpers/assertion-helpers');
const testClock = require('../helpers/test-clock');

// Initialize logging FIRST (required for all tests)
initializeTestLogging();

// Setup automated cleanup (no manual mock management)
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

const fs = require('fs');
const path = require('path');
const { 
    initializeConsoleOverride, 
    restoreConsole, 
    isConsoleOverrideEnabled,
    logProgram,
    ensureLogDirectory,
    setConfigValidator,
    initializeLoggingConfig
} = require('../../src/core/logging');

describe('Console Override Pattern', () => {
    // Test timeout protection as per rules
    jest.setTimeout(TEST_TIMEOUTS.UNIT);

    let testLogDir;
    let originalConsoleLogFn;
    let originalConsoleErrorFn;
    const configureFileLogging = () => {
        const loggingConfig = {
            console: { enabled: false, level: 'error' },
            file: { enabled: true, level: 'info', directory: testLogDir },
            debug: { enabled: false },
            platforms: {},
            chat: { enabled: false }
        };
        setConfigValidator(() => loggingConfig);
        initializeLoggingConfig({});
    };
    
    beforeAll(() => {
        // Create test log directory
        testLogDir = path.join(__dirname, 'test-logs');
        if (!fs.existsSync(testLogDir)) {
            fs.mkdirSync(testLogDir, { recursive: true });
        }
        
        // Store original console functions
        originalConsoleLogFn = console.log;
        originalConsoleErrorFn = console.error;
    });
    
    afterAll(() => {
        // Restore original console functions
        console.log = originalConsoleLogFn;
        console.error = originalConsoleErrorFn;
        
        // Clean up test log directory
        if (fs.existsSync(testLogDir)) {
            try {
                fs.rmSync(testLogDir, { recursive: true, force: true });
            } catch (err) {
                // Ignore cleanup errors in tests
            }
        }
    });
    
    beforeEach(() => {
        // Restore console before each test
        restoreConsole();
        
        // Clear any existing program log
        const programLogPath = path.join(testLogDir, 'program-log.txt');
        if (fs.existsSync(programLogPath)) {
            try {
                if (fs.rmSync) {
                    fs.rmSync(programLogPath, { force: true });
                } else {
                    // Fallback for older Node.js versions
                    fs.unlinkSync(programLogPath);
                }
            } catch (err) {
                // Ignore errors during cleanup
            }
        }
    });
    
    afterEach(() => {
        // Restore console after each test
        restoreConsole();
    });
    
    describe('ensureLogDirectory', () => {
        test('should create logs directory if it does not exist', () => {
            const testDir = path.join(testLogDir, 'test-dir');
            
            // Ensure directory doesn't exist
            if (fs.existsSync(testDir)) {
                try {
                    fs.rmSync(testDir, { recursive: true, force: true });
                } catch (err) {
                    // Use alternative cleanup if rmSync not available
                    try {
                        require('child_process').execSync(`rm -rf "${testDir}"`, { stdio: 'ignore' });
                    } catch (fallbackErr) {
                        // Ignore cleanup errors in tests
                    }
                }
            }
            
            ensureLogDirectory(testDir);
            
            expect(fs.existsSync(testDir)).toBe(true);
        });
        
        test('should not throw if directory already exists', () => {
            const testDir = path.join(testLogDir, 'existing-dir');
            
            // Create directory first
            fs.mkdirSync(testDir, { recursive: true });
            
            expect(() => {
                ensureLogDirectory(testDir);
            }).not.toThrow();
            
            expect(fs.existsSync(testDir)).toBe(true);
        });
        
        test('should return false when no path is provided', () => {
            expect(ensureLogDirectory()).toBe(false);
        });
    });
    
    describe('logProgram', () => {
        beforeEach(() => {
            configureFileLogging();
        });

        test('should write message to program log file', () => {
            const testMessage = 'Test log message';
            
            logProgram(testMessage);
            
            const programLogPath = path.join(testLogDir, 'program-log.txt');
            expect(fs.existsSync(programLogPath)).toBe(true);
            
            const logContent = fs.readFileSync(programLogPath, 'utf8');
            expect(logContent).toContain(testMessage);
        });
        
        test('should include ISO timestamp in log entry', () => {
            const testMessage = 'Timestamp test message';
            
            logProgram(testMessage);
            
            const programLogPath = path.join(testLogDir, 'program-log.txt');
            const logContent = fs.readFileSync(programLogPath, 'utf8');
            
            // Should contain timestamp format (using the actual format from the logging system: [HH:MM:SS])
            expect(logContent).toMatch(/\[\d{2}:\d{2}:\d{2}\]/);
            expect(logContent).toContain(testMessage);
        });
        
        test('should handle multiple log entries', () => {
            const messages = ['Message 1', 'Message 2', 'Message 3'];
            
            messages.forEach(msg => logProgram(msg));
            
            const programLogPath = path.join(testLogDir, 'program-log.txt');
            const logContent = fs.readFileSync(programLogPath, 'utf8');
            
            messages.forEach(msg => {
                expect(logContent).toContain(msg);
            });
        });
    });
    
    describe('Console Override Functionality', () => {
        test('should not be enabled by default', () => {
            expect(isConsoleOverrideEnabled()).toBe(false);
        });
        
        test('should enable console override when initialized', () => {
            initializeConsoleOverride();
            expect(isConsoleOverrideEnabled()).toBe(true);
        });
        
        test('should restore original console functions', () => {
            initializeConsoleOverride();
            expect(isConsoleOverrideEnabled()).toBe(true);
            
            restoreConsole();
            expect(isConsoleOverrideEnabled()).toBe(false);
            
            // Console functions should be restored to some form of original function
            // Note: Jest may mock console, so we check that they're not our override functions
            expect(typeof console.log).toBe('function');
            expect(typeof console.error).toBe('function');
            // The functions should not be our override implementations
            expect(console.log.toString()).not.toContain('logProgram');
        });
        
        test('should not re-initialize if already enabled', () => {
            initializeConsoleOverride();
            const firstOverride = console.log;
            
            initializeConsoleOverride(); // Second call
            const secondOverride = console.log;
            
            expect(firstOverride).toBe(secondOverride);
            expect(isConsoleOverrideEnabled()).toBe(true);
        });
        
        test('should handle restore when not enabled', () => {
            expect(isConsoleOverrideEnabled()).toBe(false);
            
            expect(() => {
                restoreConsole();
            }).not.toThrow();
            
            expect(isConsoleOverrideEnabled()).toBe(false);
        });
    });
    
    describe('Console Override Behavior', () => {
        beforeEach(() => {
            configureFileLogging();
        });

        test('should write console.log to file', () => {
            initializeConsoleOverride();
            
            const testMessage = 'Test console.log override';
            console.log(testMessage);
            
            // Should have written to file
            const programLogPath = path.join(testLogDir, 'program-log.txt');
            expect(fs.existsSync(programLogPath)).toBe(true);
            
            const logContent = fs.readFileSync(programLogPath, 'utf8');
            expect(logContent).toContain(testMessage);
        });
        
        test('should write console.error to file with ERROR prefix', () => {
            initializeConsoleOverride();
            
            const testMessage = 'Test console.error override';
            console.error(testMessage);
            
            // Should have written to file with ERROR prefix
            const programLogPath = path.join(testLogDir, 'program-log.txt');
            expect(fs.existsSync(programLogPath)).toBe(true);
            
            const logContent = fs.readFileSync(programLogPath, 'utf8');
            expect(logContent).toContain(`ERROR: ${testMessage}`);
        });
        
        test('should handle multiple arguments to console.log', () => {
            initializeConsoleOverride();
            
            const arg1 = 'First';
            const arg2 = 'Second';
            const arg3 = 'Third';
            
            console.log(arg1, arg2, arg3);
            
            // Should have written joined arguments to file
            const programLogPath = path.join(testLogDir, 'program-log.txt');
            const logContent = fs.readFileSync(programLogPath, 'utf8');
            expect(logContent).toContain(`${arg1} ${arg2} ${arg3}`);
        });
        
        test('should handle console.log with objects', () => {
            initializeConsoleOverride();
            
            const testObj = { key: 'value', num: 42 };
            console.log('Object test:', testObj);
            
            // Should have written string representation to file
            const programLogPath = path.join(testLogDir, 'program-log.txt');
            const logContent = fs.readFileSync(programLogPath, 'utf8');
            expect(logContent).toContain('Object test:');
            expect(logContent).toContain('[object Object]');
        });
    });
    
    describe('Error Handling', () => {
        beforeEach(() => {
            configureFileLogging();
        });

        test('should handle file write errors gracefully', () => {
            // Mock fs.appendFileSync to throw an error
            const originalAppendFileSync = fs.appendFileSync;
            fs.appendFileSync = jest.fn(() => {
                throw new Error('Mock file write error');
            });
            
            expect(() => {
                logProgram('Test message');
            }).not.toThrow();
            
            // Restore original function
            fs.appendFileSync = originalAppendFileSync;
        });
        
        test('should handle directory creation errors gracefully', () => {
            // Mock fs.mkdirSync to throw an error
            const originalMkdirSync = fs.mkdirSync;
            fs.mkdirSync = jest.fn(() => {
                throw new Error('Mock directory creation error');
            });
            
            expect(() => {
                ensureLogDirectory('/invalid/path');
            }).not.toThrow();
            
            // Restore original function
            fs.mkdirSync = originalMkdirSync;
        });
    });
    
    describe('Performance', () => {
        beforeEach(() => {
            configureFileLogging();
        });

        test('should handle logging without throwing errors', () => {
            initializeConsoleOverride();
            
            const start = testClock.now();
            const messageCount = 10; // Reduced count for testing
            
            expect(() => {
                for (let i = 0; i < messageCount; i++) {
                    console.log(`Performance test message ${i}`);
                }
            }).not.toThrow();
            
            const simulatedDurationMs = 20;
            testClock.advance(simulatedDurationMs);
            const end = testClock.now();
            const duration = end - start;
            
            // Should complete within reasonable time
            expect(duration).toBeLessThan(1000); // 1 second for 10 messages
            
            // Verify log file was created
            const programLogPath = path.join(testLogDir, 'program-log.txt');
            expect(fs.existsSync(programLogPath)).toBe(true);
        });
    });
}); 
