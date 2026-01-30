const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_MODULE_PATH = require.resolve('../../src/core/config');

function resetConfigModule() {
    delete require.cache[CONFIG_MODULE_PATH];
}

function loadFreshConfig() {
    resetConfigModule();
    return require('../../src/core/config');
}

describe('Critical Startup Flow', () => {
    let tempDir;
    let originalEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-test-'));
    });

    afterEach(() => {
        process.env = originalEnv;
        delete process.env.CHAT_BOT_CONFIG_PATH;
        resetConfigModule();
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
            process.env.CHAT_BOT_CONFIG_PATH = nonExistentPath;

            expect(() => loadFreshConfig()).toThrow('Configuration file not found');
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
            process.env.CHAT_BOT_CONFIG_PATH = configPath;

            expect(() => loadFreshConfig()).toThrow('Missing required configuration section: general');
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

            expect(() => loadFreshConfig()).toThrow(overridePath);
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
