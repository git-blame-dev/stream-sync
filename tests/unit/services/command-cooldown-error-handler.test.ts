const { describe, it, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const CommandCooldownService = require('../../../src/services/CommandCooldownService.js');
const { createConfigFixture } = require('../../helpers/config-fixture');

describe('CommandCooldownService error handler integration', () => {
    let service;
    let mockLogger;
    let testConfig;

    beforeEach(() => {
        mockLogger = {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };
        testConfig = createConfigFixture();
        service = new CommandCooldownService({
            logger: mockLogger,
            config: testConfig
        });
    });

    afterEach(() => {
        if (service) {
            service.dispose();
        }
        restoreAllMocks();
    });

    it('routes invalid userId validation error through error handler', () => {
        service.checkUserCooldown(null, 60000, 300000);

        expect(mockLogger.error).toHaveBeenCalled();
        const errorCall = mockLogger.error.mock.calls[0];
        expect(errorCall[0]).toContain('Invalid userId');
    });

    it('routes negative cooldown validation error through error handler', () => {
        service.checkUserCooldown('test-user-1', -1, 300000);

        expect(mockLogger.error).toHaveBeenCalled();
        const errorCall = mockLogger.error.mock.calls[0];
        expect(errorCall[0]).toContain('Negative cooldown');
    });

    it('routes invalid userId in updateUserCooldown through error handler', () => {
        service.updateUserCooldown(null);

        expect(mockLogger.error).toHaveBeenCalled();
        const errorCall = mockLogger.error.mock.calls[0];
        expect(errorCall[0]).toContain('Invalid userId');
    });

    it('routes dispose unsubscribe error through error handler', () => {
        service.configSubscriptions = [() => { throw new Error('unsub failed'); }];

        service.dispose();

        expect(mockLogger.warn).toHaveBeenCalled();
        const warnCall = mockLogger.warn.mock.calls.find(
            call => call[0].includes('unsubscrib')
        );
        expect(warnCall).toBeTruthy();
    });
});
