const { safeDelay, safeSetTimeout } = require('../utils/timeout-validator');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');

class SceneManagementService {
    constructor(dependencies) {
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

    async _handleSceneSwitch(data) {
        const { sceneName, transition, retry = true } = data;

        // Emit transition started if transition is specified
        if (transition) {
            this.eventBus.emit('scene:transition-started', {
                sceneName,
                transition,
                timestamp: Date.now()
            });
        }

        let attempt = 0;
        let lastError = null;

        while (attempt <= (retry ? this.config.maxRetries : 0)) {
            try {
                if (attempt > 0) {
                    await safeDelay(this.config.retryDelay, this.config.retryDelay || 1000, 'Scene switch retry delay');
                }

                await this.obsConnection.call('SetCurrentProgramScene', {
                    sceneName
                });

                // Update state
                this.state.previousScene = this.state.currentScene;
                this.state.currentScene = sceneName;
                this.state.switchCount++;

                // Add to history
                this._addToHistory({
                    sceneName,
                    timestamp: Date.now(),
                    transition
                });

                // Emit success events
                this.eventBus.emit('scene:switched', {
                    sceneName,
                    previousScene: this.state.previousScene,
                    success: true,
                    timestamp: Date.now()
                });

                // Handle transition completion
                if (transition) {
                    safeSetTimeout(() => {
                        this.eventBus.emit('scene:transition-completed', {
                            sceneName,
                            success: true,
                            timestamp: Date.now()
                        });
                    }, transition.duration || 0);
                }

                return; // Success, exit retry loop
            } catch (error) {
                lastError = error;
                attempt++;

                if (attempt > (retry ? this.config.maxRetries : 0)) {
                    // All retries exhausted
                    this._handleSceneManagerError(`Failed to switch to scene ${sceneName}`, error, {
                        sceneName,
                        attempts: attempt
                    });

                    this.eventBus.emit('scene:switch-failed', {
                        sceneName,
                        error,
                        attempts: attempt,
                        timestamp: Date.now()
                    });
                }
            }
        }
    }

    _addToHistory(entry) {
        this.state.history.push(entry);

        // Limit history size to prevent memory leaks
        if (this.state.history.length > this.config.maxHistorySize) {
            this.state.history.shift();
        }
    }

    async validateScene(sceneName) {
        try {
            // Check cache first
            const now = Date.now();
            if (
                this.state.sceneListCache &&
                this.state.cacheTimestamp &&
                (now - this.state.cacheTimestamp) < this.config.cacheExpiry
            ) {
                return this.state.sceneListCache.some(scene => scene.sceneName === sceneName);
            }

            // Fetch scene list from OBS
            const response = await this.obsConnection.call('GetSceneList', {});
            this.state.sceneListCache = response.scenes || [];
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

    _handleSceneManagerError(message, error, payload = null) {
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

function createSceneManagementService(dependencies) {
    return new SceneManagementService(dependencies);
}

module.exports = {
    createSceneManagementService
};
