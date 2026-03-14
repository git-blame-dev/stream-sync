const { describe, test, expect } = require('bun:test');
const { createFarewellRoutingHarness } = require('../helpers/farewell-routing-harness');

describe('farewell routing smoke E2E', () => {
    test('suppresses repeated same-platform farewell and keeps cross-platform farewell + VFX mapping', async () => {
        const { platformEventRouter, queuedItems } = createFarewellRoutingHarness();

        await platformEventRouter.routeEvent({
            platform: 'twitch',
            type: 'platform:chat-message',
            data: {
                username: 'test-user-one',
                userId: 'test-user-one-id',
                message: { text: '!bye everyone' },
                timestamp: '2024-01-01T00:00:00.000Z'
            }
        });

        await platformEventRouter.routeEvent({
            platform: 'twitch',
            type: 'platform:chat-message',
            data: {
                username: 'test-user-two',
                userId: 'test-user-two-id',
                message: { text: '!bye2 everyone' },
                timestamp: '2024-01-01T00:00:01.000Z'
            }
        });

        await platformEventRouter.routeEvent({
            platform: 'tiktok',
            type: 'platform:chat-message',
            data: {
                username: 'test-user-three',
                userId: 'test-user-three-id',
                message: { text: '!bye3 everyone' },
                timestamp: '2024-01-01T00:00:02.000Z'
            }
        });

        const queuedTypes = queuedItems.map((item) => item.type);
        expect(queuedTypes).not.toContain('chat');

        const farewellRows = queuedItems.filter((item) => item.type === 'farewell');
        expect(farewellRows.length).toBe(2);

        const farewellPlatforms = farewellRows.map((item) => item.platform);
        expect(farewellPlatforms).toContain('twitch');
        expect(farewellPlatforms).toContain('tiktok');

        farewellRows.forEach((row) => {
            expect(row.vfxConfig).toBeDefined();
            expect(['!bye', '!bye2', '!bye3']).toContain(row.vfxConfig?.command);
        });
    });
});
