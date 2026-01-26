const { describe, it, expect, afterEach } = require('bun:test');
const { restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createStreamElementsConfigFixture } = require('../../helpers/config-fixture');
const { StreamElementsPlatform } = require('../../../src/platforms/streamelements');

afterEach(() => {
    restoreAllMocks();
});

describe('StreamElementsPlatform connection error handling', () => {
    it('routes connection errors through error handler and retry handler', () => {

        const platform = new StreamElementsPlatform(createStreamElementsConfigFixture(), { logger: noOpLogger });
        const errorHandlerCalls = [];
        const errorHandler = { handleConnectionError: (...args) => errorHandlerCalls.push(args) };
        platform.errorHandler = errorHandler;
        const retryCalls = [];
        platform.retryHandleConnectionError = (...args) => retryCalls.push(args);

        const error = new Error('connection lost');
        platform.handleConnectionError(error);

        expect(errorHandlerCalls).toHaveLength(1);
        const [errorArg, category, message] = errorHandlerCalls[0];
        expect(errorArg).toBe(error);
        expect(category).toBe('connection');
        expect(message).toMatch(/connection lost/i);

        expect(retryCalls).toHaveLength(1);
        const [platformName, retryError, reconnectFn, cleanupFn] = retryCalls[0];
        expect(platformName).toBe('StreamElements');
        expect(retryError).toBe(error);
        expect(typeof reconnectFn).toBe('function');
        expect(typeof cleanupFn).toBe('function');
    });
});
