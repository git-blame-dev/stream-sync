const { describe, test, expect } = require('bun:test');
const path = require('path');
const fs = require('fs');
const { validateLoggingConfig } = require('../../src/core/config');
const { setConfigValidator } = require('../../src/core/logging');

describe('Startup wiring smoke', () => {
    test('core startup modules can be required and initialized', () => {
        expect(typeof validateLoggingConfig).toBe('function');
        expect(typeof setConfigValidator).toBe('function');

        setConfigValidator(validateLoggingConfig);
    });

    test('fixture config file exists and is readable', () => {
        const configPath = path.join(__dirname, '../fixtures/config.smoke.ini');

        expect(fs.existsSync(configPath)).toBe(true);

        const content = fs.readFileSync(configPath, 'utf-8');
        expect(content).toContain('[general]');
        expect(content).toContain('[obs]');
        expect(content).toContain('[commands]');
    });

    test('bootstrap file exists', () => {
        const bootstrapPath = path.join(__dirname, '../../src/bootstrap.js');

        expect(fs.existsSync(bootstrapPath)).toBe(true);
    });
});
