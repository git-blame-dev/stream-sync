
const originalEnv = process.env.NODE_ENV;

describe('YouTubeiCurrencyParser unknown currency handling', () => {
    afterEach(() => {
        jest.resetModules();
        process.env.NODE_ENV = originalEnv;
    });

    it('logs unknown currency and attempts file write in non-test env', () => {
        process.env.NODE_ENV = 'production';

        const fsMock = {
            existsSync: jest.fn(() => true),
            appendFileSync: jest.fn()
        };
        jest.doMock('fs', () => fsMock);
        const { YouTubeiCurrencyParser } = require('../../../src/utils/youtubei-currency-parser');
        const logger = { warn: jest.fn(), error: jest.fn() };
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
            existsSync: jest.fn(() => true),
            appendFileSync: jest.fn(() => { throw new Error('disk full'); }),
            mkdirSync: jest.fn()
        };
        jest.doMock('fs', () => fsMock);
        const { YouTubeiCurrencyParser } = require('../../../src/utils/youtubei-currency-parser');
        const logger = { warn: jest.fn(), error: jest.fn() };
        const parser = new YouTubeiCurrencyParser({
            logger,
            unknownCurrencyLoggingEnabled: true,
            logsDirectory: '/tmp/logs'
        });
        parser._handleCurrencyParserError = jest.fn();

        parser._logUnknownCurrency('@@@');

        expect(parser._handleCurrencyParserError).toHaveBeenCalled();
    });

    it('handles logs directory creation failures gracefully', () => {
        process.env.NODE_ENV = 'production';

        const fsMock = {
            existsSync: jest.fn(() => false),
            mkdirSync: jest.fn(() => { throw new Error('no perms'); }),
            appendFileSync: jest.fn()
        };
        jest.doMock('fs', () => fsMock);
        const { YouTubeiCurrencyParser } = require('../../../src/utils/youtubei-currency-parser');
        const logger = { warn: jest.fn(), error: jest.fn() };
        const parser = new YouTubeiCurrencyParser({
            logger,
            unknownCurrencyLoggingEnabled: true,
            logsDirectory: '/tmp/logs'
        });
        parser._handleCurrencyParserError = jest.fn();

        parser._logUnknownCurrency('@@@');

        expect(fsMock.mkdirSync).toHaveBeenCalled();
        expect(parser._handleCurrencyParserError).toHaveBeenCalled();
    });
});
