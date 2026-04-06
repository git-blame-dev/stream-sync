const { describe, it, expect, afterEach } = require('bun:test');
export {};
const { restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createStreamElementsConfigFixture } = require('../../helpers/config-fixture');
const { StreamElementsPlatform } = require('../../../src/platforms/streamelements');

type EventProcessingCall = [Error, string];

afterEach(() => {
    restoreAllMocks();
});

describe('StreamElementsPlatform message parsing', () => {
    it('routes invalid JSON messages through the error handler without throwing', () => {

        const platform = new StreamElementsPlatform(createStreamElementsConfigFixture(), { logger: noOpLogger });

        const errorHandlerCalls: EventProcessingCall[] = [];
        const errorHandler = {
            handleEventProcessingError: (...args: EventProcessingCall) => errorHandlerCalls.push(args)
        };
        platform.errorHandler = errorHandler;

        expect(() => platform.handleMessage(Buffer.from('not-json'))).not.toThrow();
        expect(errorHandlerCalls).toHaveLength(1);

        const [errorArg, eventType] = errorHandlerCalls[0];
        expect(errorArg).toBeInstanceOf(Error);
        expect(eventType).toBe('message');
    });
});
