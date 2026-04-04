const { describe, it, expect } = require('bun:test');
const { createMockFn } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');
const PlatformLifecycleService = require('../../src/services/PlatformLifecycleService');

describe('Platform lifecycle startup smoke E2E', () => {
    it('initializes and disconnects an enabled platform without stream detection', async () => {
        const service = new PlatformLifecycleService({
            config: { twitch: { enabled: true } },
            logger: noOpLogger
        });

        const initialize = createMockFn().mockResolvedValue(true);
        const cleanup = createMockFn().mockResolvedValue();
        const MockPlatform = createMockFn().mockImplementation(() => ({
            initialize,
            cleanup,
            on: createMockFn()
        }));

        await service.initializeAllPlatforms({ twitch: MockPlatform });

        expect(service.isPlatformAvailable('twitch')).toBe(true);

        await service.disconnectAll();

        expect(service.isPlatformAvailable('twitch')).toBe(false);
    });
});
