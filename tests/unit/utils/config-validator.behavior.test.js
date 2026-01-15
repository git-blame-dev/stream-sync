const { describe, test, expect, beforeEach, it } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { ConfigValidator, ConfigValidatorStatic } = require('../../../src/utils/config-validator');

describe('config-validator (utility) behavior', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const logger = { warn: createMockFn(), debug: createMockFn() };
    let validator;

    beforeEach(() => {
        validator = new ConfigValidator(logger);
        });

    it('parses booleans, strings, and numbers with defaults and bounds', () => {
        expect(validator.parseBoolean('true', false)).toBe(true);
        expect(validator.parseBoolean('invalid', true)).toBe(true);
        expect(validator.parseString(null, 'default')).toBe('default');
        expect(validator.parseNumber('5', 0, { min: 1, max: 10 })).toBe(5);
        expect(validator.parseNumber('bad', 3)).toBe(3);
    });

    it('rejects non-finite numeric values', () => {
        expect(validator.parseNumber(Infinity, 7)).toBe(7);
        expect(validator.parseNumber(-Infinity, 7)).toBe(7);
        expect(validator.parseNumber('Infinity', 7)).toBe(7);
        expect(ConfigValidatorStatic.parseNumber(Infinity, 7)).toBe(7);
        expect(ConfigValidatorStatic.parseNumber(-Infinity, 7)).toBe(7);
        expect(ConfigValidatorStatic.parseNumber('Infinity', 7)).toBe(7);
    });

    it('validates retry config with bounds', () => {
        const retry = validator.validateRetryConfig({ maxRetries: 50, baseDelay: 50, maxDelay: 999999, enableRetry: 'false' });

        expect(retry.maxRetries).toBe(3);
        expect(retry.baseDelay).toBe(1000);
        expect(retry.maxDelay).toBe(30000);
        expect(retry.enableRetry).toBe(false);
    });

    it('warns when API enabled without key and leaves apiKey undefined', () => {
        const apiConfig = validator.validateApiConfig({ enabled: true, useAPI: true }, 'youtube');

        expect(apiConfig.enabled).toBe(true);
        expect(apiConfig.apiKey).toBeUndefined();
        expect(logger.warn).toHaveBeenCalled();
        expect(logger.warn.mock.calls[0][0]).toContain('no API key');
    });
});
