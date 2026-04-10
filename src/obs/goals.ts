import { createRequire } from 'node:module';
import { logger as defaultLogger } from '../core/logging';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { createGoalTracker } from '../utils/goal-tracker';
import { getOBSConnectionManager } from './connection';

const nodeRequire = createRequire(import.meta.url);
const { config: defaultConfig } = nodeRequire('../core/config') as {
    config: {
        goals: Record<string, unknown>;
    };
};
const getDefaultSourcesManager = () => {
    const { getDefaultSourcesManager: getter } = nodeRequire('./sources') as {
        getDefaultSourcesManager: () => {
            updateTextSource: (sourceName: string, text?: string) => Promise<void>;
        };
    };

    return getter();
};

type GoalsLogger = typeof defaultLogger;

type ObsManagerLike = {
    isConnected: () => boolean;
};

type GoalTrackerLike = {
    initializeGoalTracker: () => void | Promise<void>;
    addDonationToGoal: (platform: string, amount: number) => {
        success: boolean;
        formatted?: string;
        [key: string]: unknown;
    } | Promise<{
        success: boolean;
        formatted?: string;
        [key: string]: unknown;
    }>;
    addPaypiggyToGoal: (platform: string) => {
        success: boolean;
        formatted?: string;
        [key: string]: unknown;
    } | Promise<{
        success: boolean;
        formatted?: string;
        [key: string]: unknown;
    }>;
    getGoalState: (platform: string) => {
        formatted?: string;
        [key: string]: unknown;
    } | null;
    getAllGoalStates: () => Record<string, { formatted?: string; [key: string]: unknown } | null>;
};

type GoalsConfig = {
    goals: {
        enabled?: boolean;
        tiktokGoalEnabled?: boolean;
        youtubeGoalEnabled?: boolean;
        twitchGoalEnabled?: boolean;
        tiktokGoalSource?: string;
        youtubeGoalSource?: string;
        twitchGoalSource?: string;
        [key: string]: unknown;
    };
};

type GoalsDependencies = {
    logger?: GoalsLogger;
    config?: GoalsConfig;
    updateTextSource?: (sourceName: string, text?: string) => Promise<void>;
    goalTracker?: GoalTrackerLike;
    obsManager?: ObsManagerLike;
    sourcesManager?: {
        updateTextSource: (sourceName: string, text?: string) => Promise<void>;
    };
};

type GoalsManager = {
    initializeGoalDisplay: () => Promise<void>;
    updateAllGoalDisplays: () => Promise<void>;
    updateGoalDisplay: (platform: string, formattedText?: string) => Promise<void>;
    processDonationGoal: (platform: unknown, amount: number) => Promise<{ success: boolean; error?: string; [key: string]: unknown }>;
    processPaypiggyGoal: (platform: string) => Promise<{ success: boolean; error?: string; [key: string]: unknown }>;
    getCurrentGoalStatus: (platform: string) => Record<string, unknown> | null;
    getAllCurrentGoalStatuses: () => Record<string, unknown>;
};

function buildGoalsManager(obsManager: ObsManagerLike, dependencies: GoalsDependencies = {}): GoalsManager {
    if (!obsManager) {
        throw new Error('OBSGoalsManager requires OBSConnectionManager instance');
    }

    if (!dependencies.config) {
        throw new Error('createOBSGoalsManager requires config in dependencies');
    }

    const logger = dependencies.logger || defaultLogger;
    const config = dependencies.config;

    const updateTextSource = dependencies.updateTextSource || getDefaultSourcesManager().updateTextSource;
    const goalTracker = dependencies.goalTracker || createGoalTracker({ logger, config });
    const initializeGoalTracker = goalTracker.initializeGoalTracker.bind(goalTracker);
    const addDonationToGoal = goalTracker.addDonationToGoal.bind(goalTracker);
    const addPaypiggyToGoal = goalTracker.addPaypiggyToGoal.bind(goalTracker);
    const getGoalState = goalTracker.getGoalState.bind(goalTracker);
    const getAllGoalStates = goalTracker.getAllGoalStates.bind(goalTracker);

    let goalsErrorHandler = logger ? createPlatformErrorHandler(logger, 'obs-goals') : null;

    function handleGoalsError(message: string, error: unknown = null, payload: Record<string, unknown> | null = null) {
        if (!goalsErrorHandler && logger) {
            goalsErrorHandler = createPlatformErrorHandler(logger, 'obs-goals');
        }

        if (goalsErrorHandler && error instanceof Error) {
            goalsErrorHandler.handleEventProcessingError(error, 'obs-goals', payload, message, 'obs-goals');
            return;
        }

        if (goalsErrorHandler) {
            goalsErrorHandler.logOperationalError(message, 'obs-goals', payload);
        }
    }

    function isOBSConnected() {
        return obsManager && typeof obsManager.isConnected === 'function' && obsManager.isConnected();
    }

    async function initializeGoalDisplay() {
        try {
            if (!config.goals.enabled) {
                logger.debug('[Goals] Goal system disabled in configuration', 'goals');
                return;
            }

            logger.debug('[Goals] Initializing goal system...', 'goals');

            await initializeGoalTracker();

            if (isOBSConnected()) {
                await updateAllGoalDisplays();
            }

            logger.debug('[Goals] Goal system initialized', 'goals');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.debug(`[Goals] Error initializing goal display system: ${errorMessage}`, 'goals');
            if (errorMessage.includes('OBS not connected')) {
                logger.debug('[Goal Display] Goal display system initialized - waiting for OBS connection', 'goals');
            } else {
                handleGoalsError('[Goal Display] Error initializing goal display system', error);
                throw error;
            }
        }
    }

    async function updateAllGoalDisplays() {
        try {
            if (!isOBSConnected()) {
                logger.debug('[Goal Display] OBS not connected, skipping goal display updates', 'goals');
                return;
            }

            logger.debug('[Goal Display] Updating all goal displays...', 'goals');

            const allStates = getAllGoalStates();
            const promises: Array<Promise<void>> = [];

            if (config.goals.tiktokGoalEnabled && allStates.tiktok) {
                promises.push(updateGoalDisplay('tiktok', allStates.tiktok.formatted));
            }

            if (config.goals.youtubeGoalEnabled && allStates.youtube) {
                promises.push(updateGoalDisplay('youtube', allStates.youtube.formatted));
            }

            if (config.goals.twitchGoalEnabled && allStates.twitch) {
                promises.push(updateGoalDisplay('twitch', allStates.twitch.formatted));
            }

            await Promise.all(promises);

            logger.debug('[Goal Display] All goal displays updated successfully', 'goals');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('OBS not connected')) {
                logger.debug('[Goal Display] Goal display updates skipped - OBS not connected', 'goals');
            } else {
                handleGoalsError('[Goal Display] Error updating all goal displays', error);
                throw error;
            }
        }
    }

    async function updateGoalDisplay(platform: string, formattedText?: string) {
        try {
            if (!isOBSConnected()) {
                logger.debug(`[Goal Display] OBS not connected, skipping ${platform} goal display update`, 'goals');
                return;
            }

            let finalText = formattedText;
            if (!finalText) {
                const goalState = getGoalState(platform);
                finalText = typeof goalState?.formatted === 'string' ? goalState.formatted : undefined;
            }

            const platformKey = platform.toLowerCase();
            const platformCapitalized = platformKey === 'tiktok'
                ? 'TikTok'
                : platformKey === 'youtube'
                    ? 'YouTube'
                    : `${platform.charAt(0).toUpperCase()}${platform.slice(1)}`;
            const enabledKey = `${platformKey}GoalEnabled`;

            if (!config.goals[enabledKey]) {
                logger.debug(`[Goal Display] ${platformCapitalized} goal disabled, skipping goal display update`, 'goals');
                return;
            }

            let sourceName = '';
            switch (platformKey) {
                case 'tiktok':
                    sourceName = String(config.goals.tiktokGoalSource || '');
                    break;
                case 'youtube':
                    sourceName = String(config.goals.youtubeGoalSource || '');
                    break;
                case 'twitch':
                    sourceName = String(config.goals.twitchGoalSource || '');
                    break;
                default:
                    throw new Error(`Unknown platform: ${platform}`);
            }

            if (!sourceName) {
                handleGoalsError('[Goal Display] Missing goal source configuration', null, {
                    platform,
                    configKey: `${platformKey}GoalSource`
                });
                return;
            }

            logger.debug(`[Goal Display] Updating ${platformCapitalized} goal display: "${finalText}"`, 'goals');
            await updateTextSource(sourceName, finalText);
            logger.debug(`[Goal Display] Successfully updated ${platformCapitalized} goal display`, 'goals');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('OBS not connected')) {
                logger.debug(`[Goal Display] ${platform} goal display update skipped - OBS not connected`, 'goals');
            } else {
                handleGoalsError(`[Goal Display] Error updating ${platform} goal display`, error, { platform });
            }
        }
    }

    async function processDonationGoal(platform: unknown, amount: number) {
        if (!platform || typeof platform !== 'string') {
            handleGoalsError('[Goal Display] processDonationGoal called with invalid platform', null, { platform, amount });
            return {
                success: false,
                error: 'Invalid platform passed to processDonationGoal'
            };
        }

        try {
            if (!config.goals.enabled) {
                logger.debug('[Goal Display] Goal system disabled, skipping donation processing', 'goals');
                return {
                    success: false,
                    error: 'Goal system is disabled in configuration'
                };
            }

            const platformKey = platform.toLowerCase();
            if (!config.goals[`${platformKey}GoalEnabled`]) {
                logger.debug(`[Goal Display] ${platform} goal disabled, skipping donation processing`, 'goals');
                return {
                    success: false,
                    error: `${platform} goal tracking is disabled in configuration`
                };
            }

            logger.debug(`[Goal Display] Processing ${amount} ${platform} donation for goal`, 'goals');

            const updatedState = await addDonationToGoal(platform, amount);
            if (!updatedState.success) {
                return updatedState;
            }

            if (isOBSConnected()) {
                try {
                    await updateGoalDisplay(platform, updatedState.formatted);
                    logger.debug(`[Goal Display] ${platform} goal updated: ${updatedState.formatted}`, 'goals');
                } catch (obsError) {
                    const obsErrorMessage = obsError instanceof Error ? obsError.message : String(obsError);
                    if (obsErrorMessage.includes('OBS not connected')) {
                        logger.debug(`[Goal Display] ${platform} goal state updated - OBS display will update when OBS connects`, 'goals');
                    } else {
                        handleGoalsError(`[Goal Display] OBS update failed for ${platform} goal, but goal state was updated`, obsError, { platform });
                    }
                }
            } else {
                logger.debug(`[Goal Display] ${platform} goal state updated - OBS display will update when OBS connects`, 'goals');
            }

            return updatedState;
        } catch (error) {
            handleGoalsError(`[Goal Display] Error processing ${platform} donation goal`, error, { platform });
            return {
                success: false,
                error: `Failed to process donation goal: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    async function processPaypiggyGoal(platform: string) {
        try {
            if (!config.goals.enabled) {
                logger.debug('[Goal Display] Goal system disabled, skipping paypiggy processing', 'goals');
                return {
                    success: false,
                    error: 'Goal system is disabled in configuration'
                };
            }

            const platformKey = platform.toLowerCase();
            if (!config.goals[`${platformKey}GoalEnabled`]) {
                logger.debug(`[Goal Display] ${platform} goal disabled, skipping paypiggy processing`, 'goals');
                return {
                    success: false,
                    error: `${platform} goal tracking is disabled in configuration`
                };
            }

            logger.debug(`[Goal Display] Processing ${platform} paypiggy for goal`, 'goals');

            const updatedState = await addPaypiggyToGoal(platform);
            if (!updatedState.success) {
                return updatedState;
            }

            if (isOBSConnected()) {
                try {
                    await updateGoalDisplay(platform, updatedState.formatted);
                    logger.debug(`[Goal Display] ${platform} goal updated with paypiggy: ${updatedState.formatted}`, 'goals');
                } catch (obsError) {
                    const obsErrorMessage = obsError instanceof Error ? obsError.message : String(obsError);
                    if (obsErrorMessage.includes('OBS not connected')) {
                        logger.debug(`[Goal Display] ${platform} paypiggy goal state updated - OBS display will update when OBS connects`, 'goals');
                    } else {
                        handleGoalsError(`[Goal Display] OBS update failed for ${platform} paypiggy goal, but goal state was updated`, obsError, { platform });
                    }
                }
            } else {
                logger.debug(`[Goal Display] ${platform} paypiggy goal state updated - OBS display will update when OBS connects`, 'goals');
            }

            return updatedState;
        } catch (error) {
            handleGoalsError(`[Goal Display] Error processing ${platform} paypiggy goal`, error, { platform });
            return {
                success: false,
                error: `Failed to process paypiggy goal: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    function getCurrentGoalStatus(platform: string) {
        try {
            if (!config.goals.enabled) {
                return null;
            }

            const platformKey = platform.toLowerCase();
            if (!config.goals[`${platformKey}GoalEnabled`]) {
                return null;
            }

            return getGoalState(platform);
        } catch (error) {
            handleGoalsError(`[Goal Display] Error getting ${platform} goal status`, error, { platform });
            return null;
        }
    }

    function getAllCurrentGoalStatuses() {
        try {
            if (!config.goals.enabled) {
                return {};
            }

            const allStates = getAllGoalStates();
            const enabledStates: Record<string, unknown> = {};

            if (config.goals.tiktokGoalEnabled && allStates.tiktok) {
                enabledStates.tiktok = allStates.tiktok;
            }

            if (config.goals.youtubeGoalEnabled && allStates.youtube) {
                enabledStates.youtube = allStates.youtube;
            }

            if (config.goals.twitchGoalEnabled && allStates.twitch) {
                enabledStates.twitch = allStates.twitch;
            }

            return enabledStates;
        } catch (error) {
            handleGoalsError('[Goal Display] Error getting all goal statuses', error);
            return {};
        }
    }

    return {
        initializeGoalDisplay,
        updateAllGoalDisplays,
        updateGoalDisplay,
        processDonationGoal,
        processPaypiggyGoal,
        getCurrentGoalStatus,
        getAllCurrentGoalStatuses
    };
}

class OBSGoalsManager {
    constructor(obsManager: ObsManagerLike, dependencies: GoalsDependencies = {}) {
        const manager = buildGoalsManager(obsManager, dependencies);
        Object.assign(this, manager);
    }
}

let defaultInstance: GoalsManager | null = null;

function getDefaultGoalsManager(dependencies: GoalsDependencies = {}) {
    if (!defaultInstance) {
        const logger = dependencies.logger || defaultLogger;
        const config = dependencies.config || defaultConfig;
        const obsManager = dependencies.obsManager || getOBSConnectionManager() || {
            isConnected: () => false
        };

        const sourcesManager = dependencies.sourcesManager || getDefaultSourcesManager();
        defaultInstance = buildGoalsManager(obsManager, {
            logger,
            config,
            updateTextSource: sourcesManager.updateTextSource,
            goalTracker: createGoalTracker({ logger, config })
        });
    }
    return defaultInstance;
}

function createOBSGoalsManager(obsManager: ObsManagerLike, dependencies: GoalsDependencies = {}) {
    return buildGoalsManager(obsManager, dependencies);
}

export {
    OBSGoalsManager,
    createOBSGoalsManager,
    getDefaultGoalsManager
};
