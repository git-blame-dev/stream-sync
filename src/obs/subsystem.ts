import { OBSEffectsManager } from './effects';
import { createOBSGoalsManager } from './goals';
import { createOBSSourcesManager } from './sources';
import { logger as defaultLogger } from '../core/logging';

type ObsManagerLike = {
    ensureConnected: () => Promise<void>;
    call: (requestType: string, payload?: Record<string, unknown>) => Promise<unknown>;
    isConnected: () => boolean;
    isReady?: () => Promise<boolean>;
    connect?: () => Promise<boolean>;
    disconnect?: () => Promise<void>;
    addEventListener?: (...args: unknown[]) => void;
    removeEventListener?: (...args: unknown[]) => void;
};

type LoggerLike = typeof defaultLogger;

type ObsSubsystemConfig = {
    obs: {
        chatMsgGroup: string;
        notificationMsgGroup: string;
    };
    timing: {
        fadeDuration: number;
    };
    goals?: Record<string, unknown>;
    [key: string]: unknown;
};

type ObsSubsystemDeps = {
    config: ObsSubsystemConfig;
    logger: LoggerLike;
    eventBus: unknown;
    getOBSConnectionManager: (deps?: { config?: Record<string, unknown> }) => ObsManagerLike;
    createOBSEventService: (deps: {
        eventBus: unknown;
        obsConnection: ObsManagerLike;
        obsSources: unknown;
        logger: LoggerLike;
    }) => unknown;
};

function createOBSSubsystem(deps: ObsSubsystemDeps) {
    const rawConnectionManager = deps.getOBSConnectionManager({ config: deps.config.obs });
    if (
        typeof rawConnectionManager.ensureConnected !== 'function' ||
        typeof rawConnectionManager.call !== 'function' ||
        typeof rawConnectionManager.isConnected !== 'function'
    ) {
        throw new Error('createOBSSubsystem requires OBS manager methods: ensureConnected, call, isConnected');
    }

    const connectionManager: ObsManagerLike = {
        ...rawConnectionManager,
        ensureConnected: rawConnectionManager.ensureConnected.bind(rawConnectionManager),
        call: rawConnectionManager.call.bind(rawConnectionManager),
        isConnected: rawConnectionManager.isConnected.bind(rawConnectionManager),
        isReady: typeof rawConnectionManager.isReady === 'function'
            ? rawConnectionManager.isReady.bind(rawConnectionManager)
            : undefined,
        connect: typeof rawConnectionManager.connect === 'function'
            ? rawConnectionManager.connect.bind(rawConnectionManager)
            : undefined,
        disconnect: typeof rawConnectionManager.disconnect === 'function'
            ? rawConnectionManager.disconnect.bind(rawConnectionManager)
            : undefined,
        addEventListener: typeof rawConnectionManager.addEventListener === 'function'
            ? rawConnectionManager.addEventListener.bind(rawConnectionManager)
            : undefined,
        removeEventListener: typeof rawConnectionManager.removeEventListener === 'function'
            ? rawConnectionManager.removeEventListener.bind(rawConnectionManager)
            : undefined
    };

    const sourcesManager = createOBSSourcesManager(connectionManager, {
        chatGroupName: deps.config.obs.chatMsgGroup,
        notificationGroupName: deps.config.obs.notificationMsgGroup,
        fadeDelay: deps.config.timing.fadeDuration,
        ensureOBSConnected: connectionManager.ensureConnected,
        obsCall: connectionManager.call,
        connection: {
            getOBSConnectionManager: () => connectionManager
        }
    });
    const effectsManager = new OBSEffectsManager(connectionManager, {
        logger: deps.logger,
        sourcesManager
    });

    if (!deps.config.goals || typeof deps.config.goals !== 'object') {
        throw new Error('createOBSSubsystem requires goals configuration');
    }

    const goalsConfig: ObsSubsystemConfig & { goals: Record<string, unknown> } = {
        ...deps.config,
        goals: deps.config.goals
    };

    const goalsManager = createOBSGoalsManager(connectionManager, {
        logger: deps.logger,
        config: goalsConfig,
        updateTextSource: async (sourceName: string, text?: string) => {
            await sourcesManager.updateTextSource(sourceName, text);
        }
    });
    const obsEventService = deps.createOBSEventService({
        eventBus: deps.eventBus,
        obsConnection: connectionManager,
        obsSources: sourcesManager,
        logger: deps.logger
    });
    return {
        connectionManager,
        sourcesManager,
        effectsManager,
        goalsManager,
        obsEventService
    };
}

export {
    createOBSSubsystem
};
