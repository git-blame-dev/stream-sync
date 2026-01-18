const { describe, test, afterEach, expect } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');
const PlatformLifecycleService = require('../../src/services/PlatformLifecycleService');

describe('PlatformLifecycleService platform contract validation (smoke)', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    test('fails fast with actionable error when a platform instance is invalid', async () => {
        const eventBus = { emit: createMockFn() };

        const lifecycle = new PlatformLifecycleService({
            config: { twitch: { enabled: true } },
            eventBus,
            logger: noOpLogger
        });

        try {
            const InvalidPlatform = createMockFn().mockImplementation(() => ({}));
            await lifecycle.initializeAllPlatforms({ twitch: InvalidPlatform });

            expect(lifecycle.isPlatformAvailable('twitch')).toBe(false);
            expect(lifecycle.getAllPlatforms()).toEqual({});

            const status = lifecycle.getStatus();
            expect(status.failedPlatforms).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'twitch',
                        lastError: expect.stringContaining('missing required methods')
                    })
                ])
            );
            expect(status.failedPlatforms[0].lastError).toContain('initialize');
            expect(status.failedPlatforms[0].lastError).toContain('cleanup');
            expect(status.failedPlatforms[0].lastError).toContain('on');
        } finally {
            lifecycle.dispose();
        }
    });
});
