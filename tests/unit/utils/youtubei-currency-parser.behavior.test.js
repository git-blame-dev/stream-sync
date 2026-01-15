
const { describe, test, expect, afterEach, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

const originalEnv = process.env.NODE_ENV;

describe('YouTubeiCurrencyParser unknown currency handling', () => {
    afterEach(() => {
        restoreAllMocks();
process.env.NODE_ENV = originalEnv;
    
        restoreAllModuleMocks();});

    it('logs unknown currency and attempts file write in non-test env', () => {
        process.env.NODE_ENV = 'production';

        const fsMock = {
            existsSync: createMockFn(() => true),
            appendFileSync: createMockFn()
        };
        mockModule('fs', () => fsMock);
        const { YouTubeiCurrencyParser } = require('../../../src/utils/youtubei-currency-parser');
        const logger = { warn: createMockFn(), error: createMockFn() };
        const parser = new YouTubeiCurrencyParser({
            logger,
            unknownCurrencyLoggingEnabled: true,
            logsDirectory: '/tmp/logs'
        });

        parser._logUnknownCurrency('@@@');

        expect(logger.warn).toHaveBeenCalled();
        expect(fsMock.appendFileSync).toHaveBeenCalled();
    });

    it('routes file logging errors through error handler', () => {
        process.env.NODE_ENV = 'production';

        const fsMock = {
            existsSync: createMockFn(() => true),
            appendFileSync: createMockFn(() => { throw new Error('disk full'); }),
            mkdirSync: createMockFn()
        };
        mockModule('fs', () => fsMock);
        const { YouTubeiCurrencyParser } = require('../../../src/utils/youtubei-currency-parser');
        const logger = { warn: createMockFn(), error: createMockFn() };
        const parser = new YouTubeiCurrencyParser({
            logger,
            unknownCurrencyLoggingEnabled: true,
            logsDirectory: '/tmp/logs'
        });
        parser._handleCurrencyParserError = createMockFn();

        parser._logUnknownCurrency('@@@');

        expect(parser._handleCurrencyParserError).toHaveBeenCalled();
    });

    it('handles logs directory creation failures gracefully', () => {
        process.env.NODE_ENV = 'production';

        const fsMock = {
            existsSync: createMockFn(() => false),
            mkdirSync: createMockFn(() => { throw new Error('no perms'); }),
            appendFileSync: createMockFn()
        };
        mockModule('fs', () => fsMock);
        const { YouTubeiCurrencyParser } = require('../../../src/utils/youtubei-currency-parser');
        const logger = { warn: createMockFn(), error: createMockFn() };
        const parser = new YouTubeiCurrencyParser({
            logger,
            unknownCurrencyLoggingEnabled: true,
            logsDirectory: '/tmp/logs'
        });
        parser._handleCurrencyParserError = createMockFn();

        parser._logUnknownCurrency('@@@');

        expect(fsMock.mkdirSync).toHaveBeenCalled();
        expect(parser._handleCurrencyParserError).toHaveBeenCalled();
    });
});
