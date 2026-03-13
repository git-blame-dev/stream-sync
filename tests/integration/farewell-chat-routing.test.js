const { describe, it, expect } = require('bun:test');
const { createConfigFixture } = require('../helpers/config-fixture');
const { noOpLogger } = require('../helpers/mock-factories');
const NotificationManager = require('../../src/notifications/NotificationManager');
const PlatformEventRouter = require('../../src/services/PlatformEventRouter');
const ChatNotificationRouter = require('../../src/services/ChatNotificationRouter');
const { AppRuntime } = require('../../src/runtime/AppRuntime');
const { PRIORITY_LEVELS, NOTIFICATION_CONFIGS } = require('../../src/core/constants');

function createHarness(configOverrides = {}) {
    const config = createConfigFixture({
        general: {
            messagesEnabled: false,
            logChatMessages: false
        },
        twitch: {
            messagesEnabled: false,
            farewellsEnabled: true
        },
        farewell: {
            command: '!bye'
        },
        ...configOverrides
    });

    const queuedItems = [];
    const displayQueue = {
        addItem: (item) => queuedItems.push(item)
    };

    const notificationManager = new NotificationManager({
        displayQueue,
        eventBus: { emit: () => {} },
        config,
        vfxCommandService: {
            getVFXConfig: async () => null,
            selectVFXCommand: async () => null,
            matchFarewell: () => '!bye'
        },
        userTrackingService: { isFirstMessage: () => false },
        logger: noOpLogger,
        constants: {
            PRIORITY_LEVELS,
            NOTIFICATION_CONFIGS
        },
        obsGoals: {
            processDonationGoal: async () => {}
        }
    });

    const runtime = {
        config,
        notificationManager,
        vfxCommandService: {
            getVFXConfig: async () => null,
            selectVFXCommand: async () => null,
            matchFarewell: () => '!bye'
        },
        displayQueue,
        platformLifecycleService: {
            getPlatformConnectionTime: () => null
        },
        commandCooldownService: {
            checkUserCooldown: () => true,
            checkGlobalCooldown: () => true,
            updateUserCooldown: () => {},
            updateGlobalCooldown: () => {}
        },
        isFirstMessage: () => false,
        _handleAppRuntimeError: () => {}
    };

    runtime.handleUnifiedNotification = AppRuntime.prototype.handleUnifiedNotification.bind(runtime);
    runtime.handleFarewellNotification = AppRuntime.prototype.handleFarewellNotification.bind(runtime);

    const chatRouter = new ChatNotificationRouter({
        runtime,
        logger: noOpLogger,
        config
    });

    runtime.handleChatMessage = async (platform, normalizedData) => {
        await chatRouter.handleChatMessage(platform, normalizedData);
    };

    const platformEventRouter = new PlatformEventRouter({
        runtime,
        notificationManager,
        config,
        logger: noOpLogger,
        eventBus: {
            subscribe: () => () => {},
            emit: () => {}
        }
    });

    return {
        platformEventRouter,
        queuedItems
    };
}

describe('farewell chat routing integration', () => {
    it('routes farewell notification rows even when messages are disabled', async () => {
        const { platformEventRouter, queuedItems } = createHarness();

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
});
