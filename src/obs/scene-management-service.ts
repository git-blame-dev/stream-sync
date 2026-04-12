import { createPlatformErrorHandler } from '../utils/platform-error-handler';

type SceneEventBus = {
    subscribe: (eventName: string, handler: (data: Record<string, unknown>) => Promise<void>) => () => void;
};

type SceneObsConnection = {
    call: (requestType: string, payload: Record<string, unknown>) => Promise<unknown>;
};

type SceneLogger = {
    warn?: (message: string, context?: string, payload?: unknown) => void;
};

class SceneManagementService {
    eventBus: SceneEventBus;
    obsConnection: SceneObsConnection;
    logger: SceneLogger;
    errorHandler: ReturnType<typeof createPlatformErrorHandler> | null;
    state: {
        currentScene: string;
        previousScene: string;
        switchCount: number;
        history: Array<{ sceneName: string; timestamp: number; transition: unknown }>;
        sceneListCache: Array<{ sceneName: string }> | null;
        cacheTimestamp: number | null;
    };
    config: {
        maxHistorySize: number;
        cacheExpiry: number;
        retryDelay: number;
        maxRetries: number;
    };
    unsubscribeFns: Array<() => void>;

    constructor(dependencies: {
        eventBus: SceneEventBus;
        obsConnection: SceneObsConnection;
        logger: SceneLogger;
    }) {
        const { eventBus, obsConnection, logger } = dependencies;

        this.eventBus = eventBus;
        this.obsConnection = obsConnection;
        this.logger = logger;
        this.errorHandler = logger ? createPlatformErrorHandler(logger, 'obs-scenes') : null;

        // Scene state tracking
        this.state = {
            currentScene: '',
            previousScene: '',
            switchCount: 0,
            history: [],
            sceneListCache: null,
            cacheTimestamp: null
        };

        // Configuration
        this.config = {
            maxHistorySize: 100,
            cacheExpiry: 60000, // 1 minute
            retryDelay: 100,
            maxRetries: 3
        };

        // Event unsubscribe functions for cleanup
        this.unsubscribeFns = [];

        // Scene management no longer subscribes to scene:switch because there is no runtime producer.
    }

    async validateScene(sceneName: string) {
        try {
            // Check cache first
            const now = Date.now();
            if (
                this.state.sceneListCache &&
                this.state.cacheTimestamp !== null &&
                (now - this.state.cacheTimestamp) < this.config.cacheExpiry
            ) {
                return this.state.sceneListCache.some(scene => scene.sceneName === sceneName);
            }

            // Fetch scene list from OBS
            const response = await this.obsConnection.call('GetSceneList', {});
            const scenes = (response && typeof response === 'object' && Array.isArray((response as { scenes?: unknown }).scenes))
                ? (response as { scenes: Array<{ sceneName: string }> }).scenes
                : [];
            this.state.sceneListCache = scenes;
            this.state.cacheTimestamp = now;

            return this.state.sceneListCache.some(scene => scene.sceneName === sceneName);
        } catch (error) {
            this._handleSceneManagerError(`Failed to validate scene ${sceneName}`, error, { sceneName });
            return false;
        }
    }

    getCurrentScene() {
        return this.state.currentScene;
    }

    getSceneState() {
        return {
            currentScene: this.state.currentScene,
            previousScene: this.state.previousScene,
            switchCount: this.state.switchCount
        };
    }

    getSceneHistory() {
        return [...this.state.history];
    }

    destroy() {
        this.unsubscribeFns.forEach(unsubscribe => unsubscribe());
        this.unsubscribeFns = [];
    }

    _handleSceneManagerError(message: string, error: unknown, payload: Record<string, unknown> | null = null) {
        if (!this.errorHandler && this.logger) {
            this.errorHandler = createPlatformErrorHandler(this.logger, 'obs-scenes');
        }

        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, 'scene-management', payload, message, 'obs-scenes');
            return;
        }

        if (this.errorHandler) {
            this.errorHandler.logOperationalError(message, 'obs-scenes', payload);
        }
    }
}

function createSceneManagementService(dependencies: {
    eventBus: SceneEventBus;
    obsConnection: SceneObsConnection;
    logger: SceneLogger;
}) {
    return new SceneManagementService(dependencies);
}

export {
    createSceneManagementService
};
