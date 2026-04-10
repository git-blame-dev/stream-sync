import { safeDelay } from '../utils/timeout-validator';
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

function getRequiredSceneName(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

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

        // Initialize event listeners
        this._setupEventListeners();
    }

    _setupEventListeners() {
        this.unsubscribeFns.push(
            this.eventBus.subscribe('scene:switch', async (data) => {
                await this._handleSceneSwitch(data);
            })
        );
    }

    async _handleSceneSwitch(data: Record<string, unknown>) {
        const { sceneName, transition, retry = true } = data;
        const resolvedSceneName = getRequiredSceneName(sceneName);

        if (!resolvedSceneName) {
            this._handleSceneManagerError('Scene switch requires a non-empty sceneName', null, {
                sceneName,
                transition,
                retry
            });
            return;
        }

        let attempt = 0;

        while (attempt <= (retry ? this.config.maxRetries : 0)) {
            try {
                if (attempt > 0) {
                    await safeDelay(this.config.retryDelay, this.config.retryDelay || 1000, 'Scene switch retry delay');
                }

                await this.obsConnection.call('SetCurrentProgramScene', {
                    sceneName: resolvedSceneName
                });

                // Update state
                this.state.previousScene = this.state.currentScene;
                this.state.currentScene = resolvedSceneName;
                this.state.switchCount++;

                // Add to history
                this._addToHistory({
                    sceneName: resolvedSceneName,
                    timestamp: Date.now(),
                    transition
                });

                return;
            } catch (error) {
                attempt++;

                if (attempt > (retry ? this.config.maxRetries : 0)) {
                    // All retries exhausted
                    this._handleSceneManagerError(`Failed to switch to scene ${sceneName}`, error, {
                        sceneName,
                        attempts: attempt
                    });

                }
            }
        }
    }

    _addToHistory(entry: { sceneName: string; timestamp: number; transition: unknown }) {
        this.state.history.push(entry);

        // Limit history size to prevent memory leaks
        if (this.state.history.length > this.config.maxHistorySize) {
            this.state.history.shift();
        }
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
