const { describe, test, expect, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../../helpers/bun-mock-utils');
const { restoreAllModuleMocks, resetModules } = require('../../../helpers/bun-module-mocks');
const { initializeTestLogging } = require('../../../helpers/test-setup');

// Initialize logging before requiring TikTokPlatform (which depends on logging)
initializeTestLogging();

// Note: This test requires the real TikTokPlatform, not the mock from bun.setup.js.
// Run standalone with: bun test tests/unit/platforms/tiktok/tiktok-social-filtering.test.js
// Skip in main suite since global mock intercepts the require.
const { TikTokPlatform } = require('../../../../src/platforms/tiktok');
const isPreloadMocked = !TikTokPlatform || !TikTokPlatform.prototype || !TikTokPlatform.prototype.handleTikTokSocial;
const { createMockTikTokPlatformDependencies, createMockLogger } = require('../../../helpers/mock-factories');
const testClock = require('../../../helpers/test-clock');

describe('TikTok social filtering', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
        resetModules();
    });

    const baseConfig = { enabled: true, username: 'social_tester' };

    const createPlatform = () => new TikTokPlatform(baseConfig, {
        ...createMockTikTokPlatformDependencies(),
        logger: createMockLogger(),
        connectionFactory: { createConnection: createMockFn() },
        timestampService: { extractTimestamp: createMockFn(() => new Date(testClock.now()).toISOString()) }
    });

    test.skipIf(isPreloadMocked)('ignores social actions that are not follow/share', async () => {
        const platform = createPlatform();
        const interactions = [];
        platform.handlers = {
            ...platform.handlers,
            onInteraction: (data) => interactions.push(data)
        };

        await platform.handleTikTokSocial({
            user: { userId: 'tt-user-1', uniqueId: 'social_user' },
            displayType: 'poke',
            actionType: 'poke',
            createTime: testClock.now()
        });

        expect(interactions).toHaveLength(0);
    });
});
