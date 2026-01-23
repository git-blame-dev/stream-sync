const { describe, it, expect, afterEach } = require('bun:test');
const { restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { StreamElementsPlatform } = require('../../../src/platforms/streamelements');

afterEach(() => {
    restoreAllMocks();
});

describe('StreamElementsPlatform message parsing', () => {
    it('routes invalid JSON messages through the error handler without throwing', () => {

        const platform = new StreamElementsPlatform({ enabled: true }, { logger: noOpLogger });

        const errorHandlerCalls = [];
        const errorHandler = {
            handleEventProcessingError: (...args) => errorHandlerCalls.push(args)
        };
        platform.errorHandler = errorHandler;

        expect(() => platform.handleMessage(Buffer.from('not-json'))).not.toThrow();
        expect(errorHandlerCalls).toHaveLength(1);

        const [errorArg, eventType] = errorHandlerCalls[0];
        expect(errorArg).toBeInstanceOf(Error);
        expect(eventType).toBe('message');
    });
});

