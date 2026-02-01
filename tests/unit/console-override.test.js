const { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');

const fs = require('fs');

let initializeConsoleOverride;
let restoreConsole;
let isConsoleOverrideEnabled;
let logProgram;
let ensureLogDirectory;
let setConfigValidator;
let initializeLoggingConfig;

describe('Console Override Pattern', () => {
    let originalConsoleLog;
    let originalConsoleError;
    let originalFsExistsSync;
    let originalFsAppendFileSync;
    let originalFsMkdirSync;
    let mockAppendFileSync;
    let mockMkdirSync;
    let mockExistsSync;
    let writtenContent;
    let createdDirectories;
    const testLogDir = '/mock/test-logs';

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
        const logging = require('../../src/core/logging');
        initializeConsoleOverride = logging.initializeConsoleOverride;
        restoreConsole = logging.restoreConsole;
        isConsoleOverrideEnabled = logging.isConsoleOverrideEnabled;
        logProgram = logging.logProgram;
        ensureLogDirectory = logging.ensureLogDirectory;
        setConfigValidator = logging.setConfigValidator;
        initializeLoggingConfig = logging.initializeLoggingConfig;

        originalConsoleLog = console.log;
        originalConsoleError = console.error;
        originalFsExistsSync = fs.existsSync;
        originalFsAppendFileSync = fs.appendFileSync;
        originalFsMkdirSync = fs.mkdirSync;
    });

    afterAll(() => {
        console.log = originalConsoleLog;
        console.error = originalConsoleError;
        fs.existsSync = originalFsExistsSync;
        fs.appendFileSync = originalFsAppendFileSync;
        fs.mkdirSync = originalFsMkdirSync;
    });

    beforeEach(() => {
        restoreConsole();
        writtenContent = [];
        createdDirectories = [];

        mockAppendFileSync = createMockFn((filePath, content) => {
            writtenContent.push({ filePath, content });
        });

        mockMkdirSync = createMockFn((dirPath) => {
            createdDirectories.push(dirPath);
        });

        mockExistsSync = createMockFn(() => true);

        fs.appendFileSync = mockAppendFileSync;
        fs.mkdirSync = mockMkdirSync;
        fs.existsSync = mockExistsSync;
    });

    afterEach(() => {
        restoreAllMocks();
        restoreConsole();
        setConfigValidator(() => ({
            console: { enabled: false },
            file: { enabled: false, directory: './logs' },
            debug: { enabled: false },
            platforms: {},
            chat: { enabled: false }
        }));
    });

    describe('ensureLogDirectory', () => {
        test('should create directory when it does not exist', () => {
            fs.existsSync = createMockFn(() => false);
            const testDir = '/mock/new-dir';

            ensureLogDirectory(testDir);

            expect(fs.mkdirSync).toHaveBeenCalled();
        });

        test('should not create directory when it already exists', () => {
            fs.existsSync = createMockFn(() => true);
            const testDir = '/mock/existing-dir';

            ensureLogDirectory(testDir);

            expect(fs.mkdirSync).not.toHaveBeenCalled();
        });

        test('should return false when no path is provided', () => {
            expect(ensureLogDirectory()).toBe(false);
        });

        test('should handle mkdir errors gracefully', () => {
            fs.existsSync = createMockFn(() => false);
            fs.mkdirSync = createMockFn(() => {
                throw new Error('Permission denied');
            });

            expect(() => ensureLogDirectory('/invalid/path')).not.toThrow();
        });
    });

    describe('logProgram', () => {
        beforeEach(() => {
            configureFileLogging();
        });

        test('should write message to log file', () => {
            const testMessage = 'Test log message';

            logProgram(testMessage);

            expect(writtenContent.length).toBeGreaterThan(0);
            const lastWrite = writtenContent[writtenContent.length - 1];
            expect(lastWrite.content).toContain(testMessage);
        });

        test('should include timestamp in log entry', () => {
            const testMessage = 'Timestamp test';

            logProgram(testMessage);

            const lastWrite = writtenContent[writtenContent.length - 1];
            expect(lastWrite.content).toMatch(/\[\d{2}:\d{2}:\d{2}\]/);
        });

        test('should handle multiple log entries', () => {
            const messages = ['Message 1', 'Message 2', 'Message 3'];

            messages.forEach(msg => logProgram(msg));

            expect(writtenContent.length).toBe(messages.length);
            messages.forEach((msg, i) => {
                expect(writtenContent[i].content).toContain(msg);
            });
        });

        test('should handle write errors gracefully', () => {
            fs.appendFileSync = createMockFn(() => {
                throw new Error('Disk full');
            });

            expect(() => logProgram('Test message')).not.toThrow();
        });
    });

    describe('Console Override Functionality', () => {
        test('should not be enabled by default', () => {
            expect(isConsoleOverrideEnabled()).toBe(false);
        });

        test('should enable when initialized', () => {
            initializeConsoleOverride();

            expect(isConsoleOverrideEnabled()).toBe(true);
        });

        test('should restore original console functions', () => {
            initializeConsoleOverride();
            expect(isConsoleOverrideEnabled()).toBe(true);

            restoreConsole();

            expect(isConsoleOverrideEnabled()).toBe(false);
            expect(typeof console.log).toBe('function');
            expect(typeof console.error).toBe('function');
        });

        test('should not re-initialize if already enabled', () => {
            initializeConsoleOverride();
            const firstOverride = console.log;

            initializeConsoleOverride();
            const secondOverride = console.log;

            expect(firstOverride).toBe(secondOverride);
        });

        test('should handle restore when not enabled', () => {
            expect(isConsoleOverrideEnabled()).toBe(false);

            expect(() => restoreConsole()).not.toThrow();

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

            const hasMessage = writtenContent.some(w => w.content.includes(testMessage));
            expect(hasMessage).toBe(true);
        });

        test('should write console.error with ERROR prefix', () => {
            initializeConsoleOverride();
            const testMessage = 'Test error message';

            console.error(testMessage);

            const hasError = writtenContent.some(w =>
                w.content.includes('ERROR:') && w.content.includes(testMessage)
            );
            expect(hasError).toBe(true);
        });

        test('should handle multiple arguments', () => {
            initializeConsoleOverride();

            console.log('First', 'Second', 'Third');

            const hasAllArgs = writtenContent.some(w =>
                w.content.includes('First') &&
                w.content.includes('Second') &&
                w.content.includes('Third')
            );
            expect(hasAllArgs).toBe(true);
        });

        test('should handle objects in arguments', () => {
            initializeConsoleOverride();
            const testObj = { key: 'value' };

            console.log('Object:', testObj);

            const hasOutput = writtenContent.some(w => w.content.includes('Object:'));
            expect(hasOutput).toBe(true);
        });
    });

    describe('Performance', () => {
        beforeEach(() => {
            configureFileLogging();
        });

        test('should handle rapid logging without errors', () => {
            initializeConsoleOverride();

            expect(() => {
                for (let i = 0; i < 100; i++) {
                    console.log(`Message ${i}`);
                }
            }).not.toThrow();

            expect(writtenContent.length).toBe(100);
        });
    });
});
