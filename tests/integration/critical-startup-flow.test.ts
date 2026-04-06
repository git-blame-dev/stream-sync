const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
export {};
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_MODULE_PATH = require.resolve('../../src/core/config');

function resetConfigModule() {
    delete require.cache[CONFIG_MODULE_PATH];
}

function loadFreshConfig() {
    resetConfigModule();
    const { config } = require('../../src/core/config');
    return { config };
}

describe('Critical Startup Flow', () => {
    let tempDir;
    let originalEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-test-'));
    });

    afterEach(() => {
        Object.keys(process.env).forEach(key => {
            if (!(key in originalEnv)) delete process.env[key];
        });
        Object.assign(process.env, originalEnv);
        resetConfigModule();
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('startup fails fast when config file does not exist in production', () => {
        const originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            const nonExistentPath = path.join(tempDir, 'does-not-exist.ini');
            process.env.CHAT_BOT_CONFIG_PATH = nonExistentPath;

            expect(() => loadFreshConfig()).toThrow('Configuration file not found');
        } finally {
            process.env.NODE_ENV = originalNodeEnv;
        }
    });

    test('startup fails fast when required sections are missing', () => {
        const configPath = path.join(tempDir, 'incomplete.ini');
        fs.writeFileSync(configPath, '[minimal]\nkey=value\n');
        process.env.CHAT_BOT_CONFIG_PATH = configPath;

        expect(() => loadFreshConfig()).toThrow('Missing required configuration section: general');
    });

    test('config path override via environment variable takes precedence in production', () => {
        const originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            const overridePath = path.join(tempDir, 'override.ini');
            process.env.CHAT_BOT_CONFIG_PATH = overridePath;

            expect(() => loadFreshConfig()).toThrow(overridePath);
        } finally {
            process.env.NODE_ENV = originalNodeEnv;
        }
    });

    test('logging system exports required initialization functions', () => {
        const logging = require('../../src/core/logging');

        expect(typeof logging.setDebugMode).toBe('function');
        expect(typeof logging.initializeLoggingConfig).toBe('function');
        expect(typeof logging.getUnifiedLogger).toBe('function');
    });

    test('config-builders exports buildLoggingConfig', () => {
        const { buildLoggingConfig } = require('../../src/core/config-builders');

        expect(typeof buildLoggingConfig).toBe('function');
    });
});
