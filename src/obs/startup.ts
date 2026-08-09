import { logger as defaultLogger } from '../core/logging';
import { getOBSConnectionManager as defaultGetOBSConnectionManager } from './connection';
import { getDefaultSourcesManager as defaultGetDefaultSourcesManager } from './sources';

type LoggerLike = {
    debug: (message: string, scope?: string, payload?: unknown) => void;
    warn: (message: string, scope?: string, payload?: unknown) => void;
};

type ObsManagerLike = {
    isConnected: () => boolean;
};

type SourcesManagerLike = {
    clearTextSource: (sourceName: string) => Promise<void>;
};

type StartupConfig = {
    obs: {
        ttsTxt: string;
    };
};

type StartupDeps = {
    logger?: LoggerLike;
    obsManager?: ObsManagerLike | null;
    sourcesManager?: SourcesManagerLike;
    getOBSConnectionManager?: () => ObsManagerLike | null;
    getDefaultSourcesManager?: () => SourcesManagerLike;
};

async function clearStartupTTS(config: StartupConfig | null | undefined, deps: StartupDeps = {}) {
    const {
        logger = defaultLogger,
        obsManager: providedObsManager,
        sourcesManager: providedSourcesManager,
        getOBSConnectionManager = defaultGetOBSConnectionManager,
        getDefaultSourcesManager = defaultGetDefaultSourcesManager
    } = deps;

    try {
        if (!config) {
            logger.warn('clearStartupTTS requires config; skipping TTS clearing', 'OBSStartup');
            return;
        }

        const sourcesManager = providedSourcesManager || getDefaultSourcesManager();
        const obsManager = providedObsManager || getOBSConnectionManager();
        if (!obsManager || !obsManager.isConnected()) {
            logger.debug('OBS not connected, skipping TTS clearing', 'OBSStartup');
            return;
        }

        const ttsSourceName = config.obs.ttsTxt;

        if (!ttsSourceName) {
            logger.warn('Missing OBS TTS source configuration; skipping TTS clearing', 'OBSStartup');
            return;
        }

        await sourcesManager.clearTextSource(ttsSourceName);

        logger.debug('Startup TTS cleared successfully', 'OBSStartup');
    } catch (error) {
        logger.warn('Failed to clear startup TTS', 'OBSStartup', error);
    }
}

export {
    clearStartupTTS
};
