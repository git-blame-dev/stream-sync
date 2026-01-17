const { logger: defaultLogger } = require('../core/logging');
const { getOBSConnectionManager: defaultGetOBSConnectionManager } = require('./connection');
const { getDefaultSourcesManager: defaultGetDefaultSourcesManager } = require('./sources');

async function clearStartupDisplays(config, runtimeConstants, deps = {}) {
    const {
        logger = defaultLogger,
        getOBSConnectionManager = defaultGetOBSConnectionManager,
        getDefaultSourcesManager = defaultGetDefaultSourcesManager
    } = deps;

    try {
        const resolvedRuntimeConstants = runtimeConstants
            || (process.env.NODE_ENV === 'test' ? global.__TEST_RUNTIME_CONSTANTS__ : null);
        if (!resolvedRuntimeConstants) {
            logger.warn('clearStartupDisplays requires runtimeConstants; skipping display clearing', 'OBSStartup');
            return;
        }
        if (!config || !config.general || !config.obs) {
            logger.warn('clearStartupDisplays requires general and obs config; skipping display clearing', 'OBSStartup');
            return;
        }

        const { hideAllDisplays } = getDefaultSourcesManager({ runtimeConstants: resolvedRuntimeConstants });
        const obsManager = getOBSConnectionManager({ runtimeConstants: resolvedRuntimeConstants });
        if (!obsManager || !obsManager.isConnected()) {
            logger.debug('OBS not connected, skipping display clearing', 'OBSStartup');
            return;
        }

        const chatSceneName = config.general.chatMsgScene;
        const notificationSceneName = config.obs.notificationScene;
        const chatPlatformLogos = resolvedRuntimeConstants.CHAT_PLATFORM_LOGOS;
        const notificationPlatformLogos = resolvedRuntimeConstants.NOTIFICATION_PLATFORM_LOGOS;
        const ttsSourceName = config.obs.ttsTxt;
        const notificationSourceName = config.obs.notificationTxt;

        if (!chatSceneName || !notificationSceneName || !ttsSourceName || !notificationSourceName) {
            logger.warn('Missing required OBS display configuration; skipping display clearing', 'OBSStartup');
            return;
        }

        await hideAllDisplays(
            chatSceneName,
            notificationSceneName,
            chatPlatformLogos,
            notificationPlatformLogos,
            ttsSourceName,
            notificationSourceName
        );

        logger.debug('Startup displays cleared successfully', 'OBSStartup');
    } catch (error) {
        logger.warn('Failed to clear startup displays', error, 'OBSStartup');
    }
}

module.exports = {
    clearStartupDisplays
};
