jest.unmock('../../../../src/platforms/tiktok');

const { TikTokPlatform } = require('../../../../src/platforms/tiktok');
const { createMockTikTokPlatformDependencies } = require('../../../helpers/mock-factories');
const testClock = require('../../../helpers/test-clock');

describe('TikTok social filtering', () => {
    const baseConfig = { enabled: true, username: 'social_tester' };

    const createPlatform = () => new TikTokPlatform(baseConfig, {
        ...createMockTikTokPlatformDependencies(),
        timestampService: { extractTimestamp: jest.fn(() => new Date(testClock.now()).toISOString()) }
    });

    test('ignores social actions that are not follow/share', async () => {
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
