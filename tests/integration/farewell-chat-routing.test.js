const { describe, it, expect } = require('bun:test');
const { createFarewellRoutingHarness } = require('../helpers/farewell-routing-harness');

describe('farewell chat routing integration', () => {
    it('routes farewell notification rows even when messages are disabled', async () => {
        const { platformEventRouter, queuedItems } = createFarewellRoutingHarness();

        await platformEventRouter.routeEvent({
            platform: 'twitch',
            type: 'platform:chat-message',
            data: {
                username: 'test-user',
                userId: 'test-user-id',
                message: { text: '!bye everyone' },
                timestamp: '2024-01-01T00:00:00.000Z'
            }
        });

        const queuedTypes = queuedItems.map((item) => item.type);
        expect(queuedTypes).toContain('farewell');
        expect(queuedTypes).not.toContain('chat');
    });

    it('suppresses repeated farewells per platform while allowing other platforms', async () => {
        const { platformEventRouter, queuedItems } = createFarewellRoutingHarness({
            general: {
                messagesEnabled: false,
                logChatMessages: false
            },
            farewell: {
                command: '!bye|!bye2|!bye3, bye|goodbye|cya',
                timeout: 300
            },
            twitch: {
                messagesEnabled: false,
                farewellsEnabled: true
            },
            tiktok: {
                messagesEnabled: false,
                farewellsEnabled: true
            }
        });

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
                message: { text: '!bye again' },
                timestamp: '2024-01-01T00:00:01.000Z'
            }
        });

        await platformEventRouter.routeEvent({
            platform: 'tiktok',
            type: 'platform:chat-message',
            data: {
                username: 'test-user-three',
                userId: 'test-user-three-id',
                message: { text: '!bye from tiktok' },
                timestamp: '2024-01-01T00:00:02.000Z'
            }
        });

        const farewellRows = queuedItems.filter((item) => item.type === 'farewell');
        expect(farewellRows.length).toBe(2);

        const farewellPlatforms = farewellRows.map((item) => item.platform);
        expect(farewellPlatforms).toContain('twitch');
        expect(farewellPlatforms).toContain('tiktok');
    });

    it('maps farewell trigger configuration through command-based VFX lookup', async () => {
        const { platformEventRouter, queuedItems } = createFarewellRoutingHarness({
            general: {
                messagesEnabled: false,
                logChatMessages: false
            },
            farewell: {
                command: '!bye|!bye2|!bye3, bye|goodbye|cya',
                timeout: 300
            },
            twitch: {
                messagesEnabled: false,
                farewellsEnabled: true
            }
        });

        await platformEventRouter.routeEvent({
            platform: 'twitch',
            type: 'platform:chat-message',
            data: {
                username: 'test-user-vfx',
                userId: 'test-user-vfx-id',
                message: { text: '!bye everyone' },
                timestamp: '2024-01-01T00:00:00.000Z'
            }
        });

        const farewellRows = queuedItems.filter((item) => item.type === 'farewell');
        expect(farewellRows.length).toBe(1);

        const farewellRow = farewellRows[0];
        expect(farewellRow.vfxConfig).toBeDefined();
        const selectedCommand = farewellRow.vfxConfig?.command;
        expect(typeof selectedCommand).toBe('string');
        expect(['!bye', '!bye2', '!bye3']).toContain(selectedCommand);
    });
});
