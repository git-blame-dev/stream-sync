const PlatformLifecycleService = require('../../src/services/PlatformLifecycleService');

describe('PlatformLifecycleService platform contract validation (smoke)', () => {
    test('fails fast with actionable error when a platform instance is invalid', async () => {
        const logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        };

        const eventBus = {
            emit: jest.fn()
        };

        const lifecycle = new PlatformLifecycleService({
            config: { twitch: { enabled: true } },
            eventBus,
            logger
        });

        try {
            const InvalidPlatform = jest.fn().mockImplementation(() => ({}));
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
