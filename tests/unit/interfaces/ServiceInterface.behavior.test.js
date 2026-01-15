const { describe, test, expect, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const ServiceInterface = require('../../../src/interfaces/ServiceInterface');

describe('ServiceInterface behavior', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    it('throws for required lifecycle methods when not implemented', async () => {
        const service = new ServiceInterface();

        await expect(service.initialize()).rejects.toThrow('initialize() must be implemented');
        await expect(service.start()).rejects.toThrow('start() must be implemented');
        await expect(service.stop()).rejects.toThrow('stop() must be implemented');
        expect(() => service.getStatus()).toThrow('getStatus() must be implemented');
    });

    it('provides default pause/resume logging and validation helpers', async () => {
        const logger = { debug: createMockFn() };
        class MockService extends ServiceInterface { constructor() { super(); this.logger = logger; } }
        const service = new MockService();

        await service.pause();
        await service.resume();

        expect(logger.debug).toHaveBeenCalledWith('Service paused');
        expect(logger.debug).toHaveBeenCalledWith('Service resumed');
        expect(service.validateConfiguration({ ok: true })).toBe(true);
        expect(service.validateConfiguration(null)).toBeFalsy();
    });

    it('returns basic metrics with uptime and service name', () => {
        class MetricsService extends ServiceInterface {}
        const service = new MetricsService();
        const metrics = service.getMetrics();

        expect(metrics.service).toBe('MetricsService');
        expect(metrics.status).toBe('running');
        expect(metrics.uptime).toBeGreaterThanOrEqual(0);
    });
});
