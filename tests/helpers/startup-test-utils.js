
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { scheduleTimeout } = require('./time-utils');
const testClock = require('./test-clock');

const STARTUP_TEST_CONFIGS = {
    // Fast startup configuration - skips external dependencies
    fast: {
        skipExternalDependencies: true,
        mockOBS: true,
        mockPlatforms: true,
        timeout: 5000,
        memoryLimit: '50MB',
        cleanupOnExit: true,
        args: ['--debug', '--skip-external']
    },
    
    // Full startup configuration - includes all dependencies
    full: {
        skipExternalDependencies: false,
        mockOBS: false,
        mockPlatforms: false,
        timeout: 15000,
        memoryLimit: '100MB',
        cleanupOnExit: true,
        args: ['--debug']
    },
    
    // Minimal startup configuration - core functionality only
    minimal: {
        skipExternalDependencies: true,
        mockOBS: true,
        mockPlatforms: true,
        timeout: 3000,
        memoryLimit: '25MB',
        cleanupOnExit: true,
        args: ['--debug', '--minimal']
    }
};

function startApplication(config = 'fast', customArgs = [], options = {}) {
    const testConfig = typeof config === 'string' ? STARTUP_TEST_CONFIGS[config] : config;
    const finalArgs = [...(testConfig.args || []), ...customArgs];
    const timeout = options.timeout || testConfig.timeout || 5000;
    const successPattern = options.successPattern || null;
    
    return new Promise((resolve) => {
        const child = spawn('node', [path.join(__dirname, '../../src/bootstrap.js'), ...finalArgs], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: path.join(__dirname, '../..'),
            env: {
                ...process.env,
                NODE_ENV: 'test',
                ...options.env
            }
        });
        
        let stdout = '';
        let stderr = '';
        let success = false;
        let startTime = testClock.now();
        let resolved = false;
        let timeoutId = null;
        let terminationScheduled = false;

        const matchesSuccessPattern = (logs) => {
            if (!successPattern) {
                return false;
            }
            if (successPattern instanceof RegExp) {
                successPattern.lastIndex = 0;
                return successPattern.test(logs);
            }
            return logs.includes(String(successPattern));
        };

        const finalize = (result) => {
            if (resolved) {
                return;
            }
            resolved = true;
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            resolve(result);
        };

        const terminateChild = () => {
            if (terminationScheduled) {
                return;
            }
            terminationScheduled = true;
            child.kill('SIGTERM');
            scheduleTimeout(() => {
                try {
                    child.kill('SIGKILL');
                } catch {
                    // Process already terminated
                }
            }, 2000);
        };

        const checkForSuccess = () => {
            if (!matchesSuccessPattern(stdout + stderr)) {
                return;
            }

            const endTime = testClock.now();
            success = true;
            terminateChild();

            finalize({
                success: true,
                code: 0,
                stdout,
                stderr,
                logs: stdout + stderr,
                duration: endTime - startTime,
                config: testConfig,
                terminatedEarly: true
            });
        };
        
        // Collect output with timestamps
        child.stdout.on('data', (data) => {
            stdout += data.toString();
            checkForSuccess();
        });
        
        child.stderr.on('data', (data) => {
            stderr += data.toString();
            checkForSuccess();
        });
        
        // Handle process completion
        child.on('close', (code) => {
            const endTime = testClock.now();
            const duration = endTime - startTime;
            
            success = code === 0;
            finalize({
                success,
                code,
                stdout,
                stderr,
                logs: stdout + stderr,
                duration,
                config: testConfig
            });
        });
        
        // Handle process errors
        child.on('error', (error) => {
            const endTime = testClock.now();
            const duration = endTime - startTime;
            
            finalize({
                success: false,
                error: error.message,
                stdout,
                stderr,
                logs: stdout + stderr,
                duration,
                config: testConfig
            });
        });
        
        // Robust timeout handling with cleanup
        timeoutId = scheduleTimeout(() => {
            child.kill('SIGTERM');
            
            // Force kill after 2 seconds if still running
            scheduleTimeout(() => {
                try {
                    child.kill('SIGKILL');
                } catch {
                    // Process already terminated
                }
            }, 2000);

            finalize({
                success: false,
                error: 'Timeout',
                stdout,
                stderr,
                logs: stdout + stderr,
                duration: timeout,
                config: testConfig
            });
        }, timeout);
        
        // Clean up timeout on normal completion
        child.on('close', () => clearTimeout(timeoutId));
        child.on('error', () => clearTimeout(timeoutId));
    });
}

async function measureStartupPerformance(args = [], options = {}) {
    const startMemory = process.memoryUsage();
    const startTime = testClock.now();
    
    const result = await startApplication('fast', args, options);
    
    const endTime = testClock.now();
    const endMemory = process.memoryUsage();
    
    return {
        ...result,
        performance: {
            totalTime: endTime - startTime,
            memoryPeak: endMemory.heapUsed - startMemory.heapUsed,
            memoryPeakMB: (endMemory.heapUsed - startMemory.heapUsed) / (1024 * 1024),
            startMemory: startMemory,
            endMemory: endMemory
        }
    };
}

const logValidators = {
    validateStartupSequence(logs, expectedSequence) {
        const logLines = logs.split('\n');
        const sequence = expectedSequence.map(event => {
            const index = logLines.findIndex(line => line.includes(event));
            return { event, index, found: index !== -1 };
        });
        
        // Check all events are found
        const missingEvents = sequence.filter(s => !s.found);
        if (missingEvents.length > 0) {
            return {
                valid: false,
                missing: missingEvents.map(s => s.event),
                message: `Missing startup events: ${missingEvents.map(s => s.event).join(', ')}`
            };
        }
        
        // Check order is correct
        for (let i = 1; i < sequence.length; i++) {
            if (sequence[i].index < sequence[i-1].index) {
                return {
                    valid: false,
                    outOfOrder: `${sequence[i].event} appears before ${sequence[i-1].event}`,
                    message: `Startup sequence out of order: ${sequence[i].event} should come after ${sequence[i-1].event}`
                };
            }
        }
        
        return { valid: true };
    },
    
    validateNoErrors(logs) {
        const errorPatterns = [
            'Cannot access \'logger\' before initialization',
            'ReferenceError: Cannot access',
            'logger is not defined',
            'FATAL',
            'Uncaught Exception',
            'JavaScript heap out of memory',
            'ENOMEM'
        ];
        
        const foundErrors = errorPatterns.filter(pattern => logs.includes(pattern));
        
        return {
            valid: foundErrors.length === 0,
            errors: foundErrors,
            message: foundErrors.length > 0 ? `Found errors: ${foundErrors.join(', ')}` : 'No errors found'
        };
    },
    
    validateRequiredMessages(logs, requiredMessages) {
        const missing = requiredMessages.filter(msg => !logs.includes(msg));
        
        return {
            valid: missing.length === 0,
            missing,
            message: missing.length > 0 ? `Missing required messages: ${missing.join(', ')}` : 'All required messages found'
        };
    }
};

const environmentHelpers = {
    createTestEnvironment(env = 'test') {
        const envConfigs = {
            development: {
                NODE_ENV: 'development',
                DEBUG: 'true',
                LOG_LEVEL: 'debug'
            },
            test: {
                NODE_ENV: 'test',
                DEBUG: 'true',
                LOG_LEVEL: 'debug'
            },
            production: {
                NODE_ENV: 'production',
                DEBUG: 'false',
                LOG_LEVEL: 'info'
            }
        };
        
        return envConfigs[env] || envConfigs.test;
    },
    
    async withConfigBackup(testFn) {
        const configPath = path.join(__dirname, '../../config.ini');
        const backupPath = path.join(__dirname, '../../config.ini.backup');
        
        // Backup existing config
        if (fs.existsSync(configPath)) {
            fs.copyFileSync(configPath, backupPath);
        }
        
        try {
            await testFn();
        } finally {
            // Restore config
            if (fs.existsSync(backupPath)) {
                fs.copyFileSync(backupPath, configPath);
                fs.unlinkSync(backupPath);
            }
        }
    }
};

module.exports = {
    startApplication,
    measureStartupPerformance,
    logValidators,
    environmentHelpers,
    STARTUP_TEST_CONFIGS
}; 
