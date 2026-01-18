
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');

function safeStringify(obj) {
    if (obj === null) return 'null';
    if (obj === undefined) return 'undefined';
    if (typeof obj === 'string') return obj;
    if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);

    try {
        return JSON.stringify(obj);
    } catch {
        return '[Object: stringify failed]';
    }
}

function buildGoalsManager(obsManager, dependencies = {}) {
    if (!obsManager) {
        throw new Error('OBSGoalsManager requires OBSConnectionManager instance');
    }

    const { logger } = dependencies.logger ? { logger: dependencies.logger } : require('../core/logging');
    const configManager = dependencies.configManager || require('../core/config').configManager;
    const config = dependencies.config || require('../core/config').config;
    const runtimeConstants = dependencies.runtimeConstants;
    const updateTextSource = dependencies.updateTextSource || (() => {
        if (!runtimeConstants) {
            throw new Error('OBSGoalsManager requires runtimeConstants when updateTextSource is not provided');
        }
        return require('./sources').getDefaultSourcesManager({ runtimeConstants }).updateTextSource;
    })();
    if (!runtimeConstants) {
        throw new Error('OBSGoalsManager requires runtimeConstants');
    }
    const { createGoalTracker } = require('../utils/goal-tracker');
    const goalTracker = dependencies.goalTracker || createGoalTracker({ logger, config });
    const initializeGoalTracker = goalTracker.initializeGoalTracker.bind(goalTracker);
    const addDonationToGoal = goalTracker.addDonationToGoal.bind(goalTracker);
    const addPaypiggyToGoal = goalTracker.addPaypiggyToGoal.bind(goalTracker);
    const getGoalState = goalTracker.getGoalState.bind(goalTracker);
    const getAllGoalStates = goalTracker.getAllGoalStates.bind(goalTracker);

    let goalsErrorHandler = logger ? createPlatformErrorHandler(logger, 'obs-goals') : null;

    function handleGoalsError(message, error = null, payload = null) {
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
            if (!configManager.getBoolean('goals', 'enabled', false)) {
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
            logger.debug(`[Goals] Error initializing goal display system: ${error.message}`, 'goals');
            if (error.message.includes('OBS not connected')) {
                logger.debug('[Goal Display] Goal display system initialized - waiting for OBS connection', 'goals');
            } else {
                handleGoalsError('[Goal Display] Error initializing goal display system', error);
                throw error;
            }
        }
    }

    async function updateAllGoalDisplays() {
        logger.debug('[GoalDisplay][DEBUG] Entering updateAllGoalDisplays');
        try {
            if (!isOBSConnected()) {
                logger.debug('[Goal Display] OBS not connected, skipping goal display updates', 'goals');
                return;
            }

            logger.debug('[Goal Display] Updating all goal displays...', 'goals');

            const allStates = getAllGoalStates();
            logger.debug('[GoalDisplay][DEBUG] updateAllGoalDisplays allStates=' + safeStringify(allStates));
            const promises = [];

            if (configManager.getBoolean('goals', 'tiktokGoalEnabled', true) && allStates.tiktok) {
                promises.push(updateGoalDisplay('tiktok', allStates.tiktok.formatted));
            }

            if (configManager.getBoolean('goals', 'youtubeGoalEnabled', true) && allStates.youtube) {
                promises.push(updateGoalDisplay('youtube', allStates.youtube.formatted));
            }

            if (configManager.getBoolean('goals', 'twitchGoalEnabled', true) && allStates.twitch) {
                promises.push(updateGoalDisplay('twitch', allStates.twitch.formatted));
            }

            await Promise.all(promises);

            logger.debug('[Goal Display] All goal displays updated successfully', 'goals');
        } catch (error) {
            if (error.message.includes('OBS not connected')) {
                logger.debug('[Goal Display] Goal display updates skipped - OBS not connected', 'goals');
            } else {
                handleGoalsError('[Goal Display] Error updating all goal displays', error);
                throw error;
            }
        }
    }

    async function updateGoalDisplay(platform, formattedText) {
        logger.debug('[GoalDisplay][DEBUG] Entering updateGoalDisplay platform=' + platform + ' formattedText=' + formattedText);
        try {
            if (!isOBSConnected()) {
                logger.debug(`[Goal Display] OBS not connected, skipping ${platform} goal display update`, 'goals');
                return;
            }

            let finalText = formattedText;
            if (!finalText) {
                const goalState = getGoalState(platform);
                finalText = goalState?.formatted;
            }

            const platformKey = platform.toLowerCase();
            const platformCapitalized = platformKey === 'tiktok' ? 'TikTok' :
                platformKey === 'youtube' ? 'YouTube' :
                    platform.charAt(0).toUpperCase() + platform.slice(1);
            const enabledKey = `${platformKey}GoalEnabled`;

            if (!configManager.getBoolean('goals', enabledKey, true)) {
                logger.debug(`[Goal Display] ${platformCapitalized} goal disabled, skipping goal display update`, 'goals');
                return;
            }

            logger.debug('[DEBUG][GoalDisplay] processDonationGoal called with:', 'GoalDisplay', { platform });
            let sourceName = '';

            switch (platformKey) {
                case 'tiktok':
                    sourceName = configManager.getString('goals', 'tiktokGoalSource');
                    break;
                case 'youtube':
                    sourceName = configManager.getString('goals', 'youtubeGoalSource');
                    break;
                case 'twitch':
                    sourceName = configManager.getString('goals', 'twitchGoalSource');
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
            if (error.message.includes('OBS not connected')) {
                logger.debug(`[Goal Display] ${platform} goal display update skipped - OBS not connected`, 'goals');
            } else {
                handleGoalsError(`[Goal Display] Error updating ${platform} goal display`, error, { platform });
            }
        }
    }

    async function processDonationGoal(platform, amount) {
        if (!platform || typeof platform !== 'string') {
            handleGoalsError('[Goal Display] processDonationGoal called with invalid platform', null, { platform, amount });
            return {
                success: false,
                error: 'Invalid platform passed to processDonationGoal'
            };
        }
        logger.debug('[GoalDisplay][DEBUG] Entering processDonationGoal platform=' + platform + ' amount=' + amount);
        try {
            if (!configManager.getBoolean('goals', 'enabled', false)) {
                logger.debug('[Goal Display] Goal system disabled, skipping donation processing', 'goals');
                return {
                    success: false,
                    error: 'Goal system is disabled in configuration'
                };
            }

            logger.debug('[DEBUG][GoalDisplay] processDonationGoal called with:', 'GoalDisplay', { platform });
            const platformKey = platform.toLowerCase();

            const isEnabled = {
                tiktok: configManager.getBoolean('goals', 'tiktokGoalEnabled', true),
                youtube: configManager.getBoolean('goals', 'youtubeGoalEnabled', true),
                twitch: configManager.getBoolean('goals', 'twitchGoalEnabled', true)
            }[platformKey];

            if (!isEnabled) {
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
                    if (obsError.message.includes('OBS not connected')) {
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
                error: `Failed to process donation goal: ${error.message}`
            };
        }
    }

    async function processPaypiggyGoal(platform) {
        try {
            if (!configManager.getBoolean('goals', 'enabled', false)) {
                logger.debug('[Goal Display] Goal system disabled, skipping paypiggy processing', 'goals');
                return {
                    success: false,
                    error: 'Goal system is disabled in configuration'
                };
            }

            logger.debug('[DEBUG][GoalDisplay] processDonationGoal called with:', 'GoalDisplay', { platform });
            const platformKey = platform.toLowerCase();

            const isEnabled = {
                tiktok: configManager.getBoolean('goals', 'tiktokGoalEnabled', true),
                youtube: configManager.getBoolean('goals', 'youtubeGoalEnabled', true),
                twitch: configManager.getBoolean('goals', 'twitchGoalEnabled', true)
            }[platformKey];

            if (!isEnabled) {
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
                    if (obsError.message.includes('OBS not connected')) {
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
                error: `Failed to process paypiggy goal: ${error.message}`
            };
        }
    }

    function getCurrentGoalStatus(platform) {
        try {
            if (!configManager.getBoolean('goals', 'enabled', false)) {
                return null;
            }

            logger.debug('[DEBUG][GoalDisplay] processDonationGoal called with:', 'GoalDisplay', { platform });
            const platformKey = platform.toLowerCase();

            const isEnabled = {
                tiktok: configManager.getBoolean('goals', 'tiktokGoalEnabled', true),
                youtube: configManager.getBoolean('goals', 'youtubeGoalEnabled', true),
                twitch: configManager.getBoolean('goals', 'twitchGoalEnabled', true)
            }[platformKey];

            if (!isEnabled) {
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
            if (!configManager.getBoolean('goals', 'enabled', false)) {
                return {};
            }

            const allStates = getAllGoalStates();
            logger.debug('[GoalDisplay][DEBUG] getAllCurrentGoalStatuses allStates=' + safeStringify(allStates));
            const enabledStates = {};

            if (configManager.getBoolean('goals', 'tiktokGoalEnabled', true) && allStates.tiktok) {
                enabledStates.tiktok = allStates.tiktok;
            }

            if (configManager.getBoolean('goals', 'youtubeGoalEnabled', true) && allStates.youtube) {
                enabledStates.youtube = allStates.youtube;
            }

            if (configManager.getBoolean('goals', 'twitchGoalEnabled', true) && allStates.twitch) {
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
    constructor(obsManager, dependencies = {}) {
        const manager = buildGoalsManager(obsManager, dependencies);
        Object.assign(this, manager);
    }
}

let defaultInstance = null;

function getDefaultGoalsManager(dependencies = {}) {
    if (!defaultInstance) {
        const { getOBSConnectionManager } = require('./connection');
        const { logger } = require('../core/logging');
        const { configManager, config } = require('../core/config');
        const { getDefaultSourcesManager } = require('./sources');
        const { createGoalTracker } = require('../utils/goal-tracker');
        const { runtimeConstants } = dependencies;
        if (!runtimeConstants) {
            throw new Error('getDefaultGoalsManager requires runtimeConstants');
        }

        const obsManager = dependencies.obsManager || getOBSConnectionManager({ runtimeConstants }) || {
            isConnected: () => false
        };

        const sourcesManager = dependencies.sourcesManager || getDefaultSourcesManager({ runtimeConstants });

        defaultInstance = buildGoalsManager(obsManager, {
            logger,
            config,
            configManager,
            updateTextSource: sourcesManager.updateTextSource,
            goalTracker: createGoalTracker({ logger, config }),
            runtimeConstants
        });
    }
    return defaultInstance;
}

function createOBSGoalsManager(obsManager, dependencies = {}) {
    return buildGoalsManager(obsManager, dependencies);
}

module.exports = {
    OBSGoalsManager,
    createOBSGoalsManager,
    getDefaultGoalsManager
};
