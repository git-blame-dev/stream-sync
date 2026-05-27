import { NOTIFICATION_CONFIGS, PRIORITY_LEVELS } from '../../src/core/constants';
import NotificationManager from '../../src/notifications/NotificationManager';
import { AppRuntime } from '../../src/runtime/AppRuntime';
import { ChatNotificationRouter } from '../../src/services/ChatNotificationRouter';
import { PlatformEventRouter } from '../../src/services/PlatformEventRouter';
import { VFXCommandService } from '../../src/services/VFXCommandService';

import { createConfigFixture } from './config-fixture';
import { noOpLogger } from './mock-factories';

type ConfigFixtureOverrides = NonNullable<Parameters<typeof createConfigFixture>[0]>;
type ConfigFixture = ReturnType<typeof createConfigFixture>;
type ConfigSection = Record<string, unknown>;
type FarewellConfigSection = ConfigSection & {
    command?: string;
    timeout?: number;
};
type FarewellRoutingHarnessOverrides = ConfigSection & {
    general?: ConfigSection;
    commands?: Record<string, string>;
    farewell?: FarewellConfigSection;
    twitch?: ConfigSection;
    tiktok?: ConfigSection;
};
type QueuedNotification = ConfigSection & {
    type?: string;
    platform?: string;
    vfxConfig: ConfigSection & {
        command: string;
    };
};
type FilteredQueuedNotifications = [QueuedNotification, ...QueuedNotification[]];
type QueuedNotificationCollection = QueuedNotification[] & {
    filter(predicate: (value: QueuedNotification, index: number, array: QueuedNotification[]) => unknown): FilteredQueuedNotifications;
};
type NotificationManagerDependencies = NonNullable<ConstructorParameters<typeof NotificationManager>[0]>;
type DisplayQueue = NonNullable<NotificationManagerDependencies['displayQueue']>;
type NotificationVFXCommandService = NonNullable<NotificationManagerDependencies['vfxCommandService']>;
type FarewellFixtureOverride = NonNullable<ConfigFixtureOverrides['farewell']>;
type ChatRouterRuntime = ConstructorParameters<typeof ChatNotificationRouter>[0]['runtime'];
type PlatformRouterRuntime = ConstructorParameters<typeof PlatformEventRouter>[0]['runtime'];
type HarnessRuntime = ChatRouterRuntime & PlatformRouterRuntime & {
    config: ConfigFixture;
    notificationManager: NotificationManager;
    vfxCommandService: ChatRouterRuntime['vfxCommandService'];
    displayQueue: DisplayQueue;
    handleUnifiedNotification: AppRuntime['handleUnifiedNotification'];
    handleFarewellNotification: AppRuntime['handleFarewellNotification'];
    handleChatMessage: NonNullable<PlatformRouterRuntime['handleChatMessage']>;
    _handleAppRuntimeError: (error: unknown, context?: unknown) => void;
};

function createFarewellRoutingHarness(configOverrides: FarewellRoutingHarnessOverrides = {}): {
    platformEventRouter: PlatformEventRouter;
    queuedItems: QueuedNotificationCollection;
} {
    const farewellConfig = {
        command: '!bye|!bye2|!bye3, bye|goodbye|cya',
        timeout: 300,
        ...configOverrides.farewell
    } as unknown as FarewellFixtureOverride;
    const configFixtureOverrides = {
        general: {
            messagesEnabled: false,
            logChatMessages: false,
            ...configOverrides.general
        },
        commands: {
            'bye-bye-bye': '!bye, vfx bottom green',
            'bye-bye-bye2': '!bye2, vfx bottom green',
            'bye-bye-bye3': '!bye3, vfx bottom green',
            ...configOverrides.commands
        },
        farewell: farewellConfig,
        twitch: {
            messagesEnabled: false,
            farewellsEnabled: true,
            ...configOverrides.twitch
        },
        tiktok: {
            messagesEnabled: false,
            farewellsEnabled: true,
            ...configOverrides.tiktok
        },
        ...configOverrides
    } as ConfigFixtureOverrides;
    const config = createConfigFixture(configFixtureOverrides);

    const queuedItems = [] as unknown as QueuedNotificationCollection;
    const platformFarewellCooldowns = new Set<string>();
    const displayQueue: DisplayQueue = {
        addItem: (item: Record<string, unknown>) => {
            queuedItems.push(item as QueuedNotification);
        },
        getQueueLength: () => queuedItems.length
    };

    const vfxCommandService = new VFXCommandService(config, null);
    const notificationVFXCommandService: NotificationVFXCommandService = {
        getVFXConfig: (commandKey: string, message: string | null) => vfxCommandService.getVFXConfig(commandKey, message)
    };

    const notificationManager = new NotificationManager({
        displayQueue,
        eventBus: { emit: () => {} },
        config,
        vfxCommandService: notificationVFXCommandService,
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

    let chatRouter: ChatNotificationRouter | null = null;
    let runtime: HarnessRuntime;
    runtime = {
        config,
        notificationManager,
        vfxCommandService: {
            selectVFXCommand: (trigger: string, message: string) => vfxCommandService.selectVFXCommand(trigger, message),
            matchFarewell: (message: string, trigger: string) => vfxCommandService.matchFarewell(message, trigger),
            getVFXConfig: (commandKey: string, message: string | null) => vfxCommandService.getVFXConfig(commandKey, message)
        },
        displayQueue,
        platformLifecycleService: {
            getPlatformConnectionTime: (_platform: string) => null
        },
        commandCooldownService: {
            checkUserCooldown: () => true,
            checkGlobalCooldown: (key: string) => !platformFarewellCooldowns.has(key),
            updateUserCooldown: () => {},
            updateGlobalCooldown: (key: string) => {
                platformFarewellCooldowns.add(key);
            }
        },
        isFirstMessage: () => false,
        _handleAppRuntimeError: () => {},
        handleUnifiedNotification: (...args: Parameters<AppRuntime['handleUnifiedNotification']>) => (
            AppRuntime.prototype.handleUnifiedNotification.apply(runtime as unknown as AppRuntime, args)
        ),
        handleFarewellNotification: (...args: Parameters<AppRuntime['handleFarewellNotification']>) => (
            AppRuntime.prototype.handleFarewellNotification.apply(runtime as unknown as AppRuntime, args)
        ),
        handleChatMessage: async (platform: string, normalizedData: Record<string, unknown>) => {
            if (!chatRouter) {
                throw new Error('Farewell routing harness chat router was not initialized');
            }
            await chatRouter.handleChatMessage(platform, normalizedData);
        }
    };

    chatRouter = new ChatNotificationRouter({
        runtime,
        logger: noOpLogger,
        config
    });

    const platformEventRouter = new PlatformEventRouter({
        runtime,
        notificationManager,
        config,
        logger: noOpLogger,
        eventBus: {
            subscribe: () => () => {}
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
