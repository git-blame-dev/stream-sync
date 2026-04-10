import { createRequire } from 'node:module';
import { logger as defaultLogger } from '../core/logging';

type LoggerLike = {
    debug: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
};

type ObsManagerLike = {
    isConnected: () => boolean;
};

type SourcesManagerLike = {
    hideAllDisplays: (
        chatSceneName: string,
        notificationSceneName: string,
        chatPlatformLogos: Record<string, string>,
        notificationPlatformLogos: Record<string, string>,
        ttsSourceName: string,
        notificationSourceName: string
    ) => Promise<void>;
};

type StartupConfig = {
    obs: {
        chatMsgScene: string;
        notificationScene: string;
        chatPlatformLogos: Record<string, string>;
        notificationPlatformLogos: Record<string, string>;
        ttsTxt: string;
        notificationTxt: string;
    };
};

type StartupDeps = {
    logger?: LoggerLike;
    getOBSConnectionManager?: () => ObsManagerLike | null;
    getDefaultSourcesManager?: () => SourcesManagerLike;
};

const nodeRequire = createRequire(import.meta.url);
const { getOBSConnectionManager: defaultGetOBSConnectionManager } = nodeRequire('./connection') as {
    getOBSConnectionManager: () => ObsManagerLike | null;
};
const { getDefaultSourcesManager: defaultGetDefaultSourcesManager } = nodeRequire('./sources') as {
    getDefaultSourcesManager: () => SourcesManagerLike;
};

async function clearStartupDisplays(config: StartupConfig | null | undefined, deps: StartupDeps = {}) {
    const {
        logger = defaultLogger,
        getOBSConnectionManager = defaultGetOBSConnectionManager,
        getDefaultSourcesManager = defaultGetDefaultSourcesManager
    } = deps;

    try {
        if (!config) {
            logger.warn('clearStartupDisplays requires config; skipping display clearing', 'OBSStartup');
            return;
        }

        const { hideAllDisplays } = getDefaultSourcesManager();
        const obsManager = getOBSConnectionManager();
        if (!obsManager || !obsManager.isConnected()) {
            logger.debug('OBS not connected, skipping display clearing', 'OBSStartup');
            return;
        }

        const chatSceneName = config.obs.chatMsgScene;
        const notificationSceneName = config.obs.notificationScene;
        const chatPlatformLogos = config.obs.chatPlatformLogos;
        const notificationPlatformLogos = config.obs.notificationPlatformLogos;
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
        logger.warn('Failed to clear startup displays', 'OBSStartup', error);
    }
}

export {
    clearStartupDisplays
};
