const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('Critical Startup Flow', () => {
    let tempDir;
    let originalEnv;
    let originalConfigPath;
    let originalIsLoaded;
    let configManager;

    beforeEach(() => {
        originalEnv = { ...process.env };
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-test-'));

        const configModule = require('../../src/core/config');
        configManager = configModule.configManager;
        originalConfigPath = configManager.configPath;
        originalIsLoaded = configManager.isLoaded;
    });

    afterEach(() => {
        process.env = originalEnv;
        if (configManager) {
            configManager.configPath = originalConfigPath;
            configManager.isLoaded = originalIsLoaded;
        }
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('startup fails fast when config file does not exist in production', () => {
        const originalNodeEnv = process.env.NODE_ENV;
        const originalStderrWrite = process.stderr.write;
        process.stderr.write = () => {};
        process.env.NODE_ENV = 'production';
        try {
            const nonExistentPath = path.join(tempDir, 'does-not-exist.ini');
            configManager.configPath = nonExistentPath;
            configManager.isLoaded = false;

            expect(() => configManager.load()).toThrow('Configuration file not found');
        } finally {
            process.env.NODE_ENV = originalNodeEnv;
            process.stderr.write = originalStderrWrite;
        }
    });

    test('startup fails fast when required sections are missing', () => {
        const originalStderrWrite = process.stderr.write;
        process.stderr.write = () => {};
        try {
            const configPath = path.join(tempDir, 'incomplete.ini');
            fs.writeFileSync(configPath, '[minimal]\nkey=value\n');
            configManager.configPath = configPath;
            configManager.isLoaded = false;

            expect(() => configManager.load()).toThrow('Missing required configuration sections');
        } finally {
            process.stderr.write = originalStderrWrite;
        }
    });

    test('config path override via environment variable takes precedence in production', () => {
        const originalNodeEnv = process.env.NODE_ENV;
        const originalStderrWrite = process.stderr.write;
        process.stderr.write = () => {};
        process.env.NODE_ENV = 'production';
        try {
            const overridePath = path.join(tempDir, 'override.ini');
            process.env.CHAT_BOT_CONFIG_PATH = overridePath;
            configManager.configPath = './default.ini';
            configManager.isLoaded = false;

            expect(() => configManager.load()).toThrow(overridePath);
        } finally {
            process.env.NODE_ENV = originalNodeEnv;
            process.stderr.write = originalStderrWrite;
        }
    });

    test('logging system exports required initialization functions', () => {
        const logging = require('../../src/core/logging');

        expect(typeof logging.setConfigValidator).toBe('function');
        expect(typeof logging.setDebugMode).toBe('function');
        expect(typeof logging.initializeLoggingConfig).toBe('function');
        expect(typeof logging.getLogger).toBe('function');
    });

    test('config module exports required validation function', () => {
        const config = require('../../src/core/config');

        expect(typeof config.validateLoggingConfig).toBe('function');
    });
});
