import { NOTIFICATION_CONFIGS, PRIORITY_LEVELS } from '../../src/core/constants';
import NotificationManager from '../../src/notifications/NotificationManager';
import { AppRuntime } from '../../src/runtime/AppRuntime';
import { ChatNotificationRouter } from '../../src/services/ChatNotificationRouter';
import { PlatformEventRouter } from '../../src/services/PlatformEventRouter';
import { VFXCommandService } from '../../src/services/VFXCommandService';

import { createConfigFixture } from './config-fixture';
import { noOpLogger } from './mock-factories';

function createFarewellRoutingHarness(configOverrides = {}) {
    const config = createConfigFixture({
        general: {
            messagesEnabled: false,
            logChatMessages: false
        },
        commands: {
            'bye-bye-bye': '!bye, vfx bottom green',
            'bye-bye-bye2': '!bye2, vfx bottom green',
            'bye-bye-bye3': '!bye3, vfx bottom green'
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
        },
        ...configOverrides
    });

    const queuedItems = [];
    const platformFarewellCooldowns = new Set();
    const displayQueue = {
        addItem: (item) => queuedItems.push(item)
    };

    const vfxCommandService = new VFXCommandService(config, null);

    const notificationManager = new NotificationManager({
        displayQueue,
        eventBus: { emit: () => {} },
        config,
        vfxCommandService,
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
        vfxCommandService,
        displayQueue,
        platformLifecycleService: {
            getPlatformConnectionTime: () => null
        },
        commandCooldownService: {
            checkUserCooldown: () => true,
            checkGlobalCooldown: (key) => !platformFarewellCooldowns.has(key),
            updateUserCooldown: () => {},
            updateGlobalCooldown: (key) => {
                platformFarewellCooldowns.add(key);
            }
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

export {
    createFarewellRoutingHarness
};
