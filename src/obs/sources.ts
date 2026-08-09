import { logger as coreLogger } from '../core/logging';
import { safeOBSOperation } from './safe-operations';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import {
    ensureOBSConnected as defaultEnsureOBSConnected,
    getOBSConnectionManager as defaultGetOBSConnectionManager,
    obsCall as defaultObsCall
} from './connection';

type SourcesLogger = {
    debug: (message: unknown, source?: string, data?: unknown) => void;
    warn: (message: unknown, source?: string, data?: unknown) => void;
};

type ObsCall = (requestType: string, payload?: Record<string, unknown>) => Promise<unknown>;

type SourcesObsManager = {
    ensureConnected: () => Promise<void>;
    call: ObsCall;
    addEventListener?: (eventName: string, handler: (data?: { reason?: unknown; code?: unknown }) => void) => void;
    removeEventListener?: (eventName: string, handler: (data?: { reason?: unknown; code?: unknown }) => void) => void;
    isConnected: () => boolean;
    isReady: () => Promise<boolean>;
    setSourcesCacheInvalidator?: (invalidator: (() => void) | null) => void;
};

type SourcesDependencies = {
    logger?: SourcesLogger;
    logging?: { logger?: SourcesLogger };
    ensureOBSConnected?: () => Promise<void>;
    obsCall?: ObsCall;
    connection?: {
        ensureOBSConnected?: () => Promise<void>;
        obsCall?: ObsCall;
        getOBSConnectionManager?: () => SourcesObsManager;
    };
};

type SceneItemCacheEntry = {
    sceneItemId: number;
    sceneName?: string;
};

type InputSettingsResponse = {
    inputSettings?: Record<string, unknown>;
};

type SceneItemIdResponse = {
    sceneItemId?: unknown;
};

type SourceFilterResponse = {
    filterSettings?: Record<string, unknown>;
};

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

function sanitizeForOBS(text: unknown): string {
    if (!text || typeof text !== 'string') {
        return '';
    }
    
    return text.replace(/[^\x20-\x7E]/g, '');
}

function createOBSSourcesManager(obsManager: SourcesObsManager, dependencies: SourcesDependencies = {}) {
    if (!obsManager) {
        throw new Error('OBSSourcesManager requires OBSConnectionManager instance');
    }

    const logger = dependencies.logger || dependencies.logging?.logger || coreLogger;
    const managerEnsureConnected = typeof obsManager.ensureConnected === 'function'
        ? obsManager.ensureConnected.bind(obsManager)
        : undefined;
    const managerObsCall = typeof obsManager.call === 'function'
        ? obsManager.call.bind(obsManager)
        : undefined;

    const ensureOBSConnected = dependencies.ensureOBSConnected ||
        dependencies.connection?.ensureOBSConnected ||
        managerEnsureConnected;
    const obsCall = dependencies.obsCall ||
        dependencies.connection?.obsCall ||
        managerObsCall;
    const getOBSConnectionManager = dependencies.connection?.getOBSConnectionManager || (() => obsManager);

    if (typeof ensureOBSConnected !== 'function') {
        throw new Error('OBSSourcesManager requires ensureOBSConnected function');
    }

    if (typeof obsCall !== 'function') {
        throw new Error('OBSSourcesManager requires obsCall function');
    }

    const ensureConnected = ensureOBSConnected;
    const callOBS = obsCall;

    let sourcesErrorHandler = logger ? createPlatformErrorHandler(logger, 'obs-sources') : null;

    const handleSourcesError = (message: string, error: unknown, payload: Record<string, unknown> | null = null) => {
        if (!sourcesErrorHandler && logger) {
            sourcesErrorHandler = createPlatformErrorHandler(logger, 'obs-sources');
        }

        if (sourcesErrorHandler && error instanceof Error) {
            sourcesErrorHandler.handleEventProcessingError(error, 'obs-sources', payload, message, 'obs-sources');
            return;
        }

        if (sourcesErrorHandler) {
            sourcesErrorHandler.logOperationalError(message, 'obs-sources', payload);
        }
    };

    const sceneItemCache = new Map<string, SceneItemCacheEntry>();
    
    function getCacheKey(sceneName: string, sourceName: string) {
        return `${sceneName}:${sourceName}`;
    }
    
    function clearSceneItemCache() {
        sceneItemCache.clear();
        logger.debug('[OBS Cache] Scene item cache cleared', 'obs-sources');
    }

    const activeConnectionManager = getOBSConnectionManager();
    if (activeConnectionManager && typeof activeConnectionManager.setSourcesCacheInvalidator === 'function') {
        activeConnectionManager.setSourcesCacheInvalidator(clearSceneItemCache);
    }

    async function updateTextSource(sourceName: string, message?: string): Promise<void> {
    const obsManager = getOBSConnectionManager();
    await safeOBSOperation(
        obsManager,
        async () => {
            await ensureConnected();
            
            const sanitizedMessage = sanitizeForOBS(message);
            
            logger.debug(`[OBS Source] Updating text source "${sourceName}" with: ${sanitizedMessage}`, 'obs-sources');
            
            if (sanitizedMessage !== message) {
                logger.debug(`[OBS Source] Text sanitized for OBS safety: "${message}" → "${sanitizedMessage}"`, 'obs-sources');
            }
            
            const { inputSettings } = await callOBS('GetInputSettings', { inputName: sourceName }) as InputSettingsResponse;
            const currentInputSettings = inputSettings && typeof inputSettings === 'object' ? inputSettings : {};
            
            await callOBS('SetInputSettings', {
                inputName: sourceName, 
                inputSettings: { 
                    ...currentInputSettings,
                    text: sanitizedMessage 
                }, 
                overlay: false 
            });
        },
        `Updating text source "${sourceName}"`
    );
    }

    async function clearTextSource(sourceName: string): Promise<void> {
    const obsManager = getOBSConnectionManager();
    await safeOBSOperation(
        obsManager,
        async () => {
            await ensureConnected();
            
            
            const { inputSettings } = await callOBS('GetInputSettings', { inputName: sourceName }) as InputSettingsResponse;
            const currentInputSettings = inputSettings && typeof inputSettings === 'object' ? inputSettings : {};
            await callOBS('SetInputSettings', {
                inputName: sourceName, 
                inputSettings: { 
                    ...currentInputSettings,
                    text: ''
                }, 
                overlay: false 
            });
            
        },
        `Clearing text source "${sourceName}"`
    );
    }

    async function getSceneItemId(sceneName: string, sourceName: string): Promise<SceneItemCacheEntry> {
    const cacheKey = getCacheKey(sceneName, sourceName);
    
    if (sceneItemCache.has(cacheKey)) {
        const cachedResult = sceneItemCache.get(cacheKey);
        if (cachedResult) {
            return cachedResult;
        }
    }
    
    const obsManager = getOBSConnectionManager();
    const result = await safeOBSOperation(
        obsManager,
        async () => {
            await ensureConnected();
            
            
            const { sceneItemId } = await callOBS('GetSceneItemId', { sceneName, sourceName }) as SceneItemIdResponse;
            
            if (typeof sceneItemId === 'number') {
                const result = { sceneItemId, sceneName };
                
                sceneItemCache.set(cacheKey, result);
                
                return result;
            }
            
            throw new Error(`Scene item ID for source "${sourceName}" in scene "${sceneName}" not found.`);
        },
        `Getting scene item ID for "${sourceName}" in scene "${sceneName}"`
    );

    if (!result || typeof result !== 'object' || typeof (result as SceneItemCacheEntry).sceneItemId !== 'number') {
        throw new Error(`Scene item ID for source "${sourceName}" in scene "${sceneName}" not found.`);
    }

    return result as SceneItemCacheEntry;
    }

    async function setSourceVisibility(sceneName: string, sourceName: string, visible: boolean): Promise<void> {
    const obsManager = getOBSConnectionManager();
    await safeOBSOperation(
        obsManager,
        async () => {
            await ensureConnected();
            
            
            const { sceneItemId } = await getSceneItemId(sceneName, sourceName);
            await callOBS('SetSceneItemEnabled', {
                sceneName, 
                sceneItemId, 
                sceneItemEnabled: visible 
            });
            
        },
        `Setting ${sourceName} visibility to ${visible} in scene ${sceneName}`
    );
    }


    async function setSourceFilterEnabled(sourceName: string, filterName: string, enabled: boolean): Promise<void> {
        try {
            await ensureConnected();
            
            logger.debug(`[OBS Filter] Setting ${sourceName}:${filterName} to ${enabled ? 'enabled' : 'disabled'}`, 'OBS');
            
            await callOBS('SetSourceFilterEnabled', {
                sourceName: sourceName,
                filterName: filterName,
                filterEnabled: enabled
            });
            
            logger.debug(`[OBS Filter] Successfully set ${sourceName}:${filterName} to ${enabled ? 'enabled' : 'disabled'}`, 'OBS');
        } catch (err) {
            handleSourcesError(`[OBS Filter] Error setting ${sourceName}:${filterName}`, err, {
                sourceName,
                filterName,
                context: 'OBS'
            });
            throw err;
        }
    }

    async function getSourceFilterSettings(sourceName: string, filterName: string): Promise<Record<string, unknown> | undefined> {
        try {
            await ensureConnected();
            
            logger.debug(`[OBS Filter] Getting filter settings for ${sourceName}:${filterName}`, 'OBS');
            
            const filterInfo = await callOBS('GetSourceFilter', {
                sourceName: sourceName,
                filterName: filterName
            }) as SourceFilterResponse;
            
            logger.debug(`[OBS Filter] Retrieved filter settings for ${sourceName}:${filterName}`, 'OBS');
            return filterInfo.filterSettings;
        } catch (err) {
            handleSourcesError(`[OBS Filter] Error getting filter settings for ${sourceName}:${filterName}`, err, {
                sourceName,
                filterName,
                context: 'OBS'
            });
            throw err;
        }
    }

    async function setSourceFilterSettings(sourceName: string, filterName: string, filterSettings: Record<string, unknown>): Promise<void> {
        try {
            await ensureConnected();
            
            logger.debug(`[OBS Filter] Setting filter settings for ${sourceName}:${filterName}`, 'OBS', filterSettings);
            
            await callOBS('SetSourceFilterSettings', {
                sourceName: sourceName,
                filterName: filterName,
                filterSettings: filterSettings
            });
            
            logger.debug(`[OBS Filter] Successfully updated filter settings for ${sourceName}:${filterName}`, 'OBS');
        } catch (err) {
            handleSourcesError(`[OBS Filter] Error setting filter settings for ${sourceName}:${filterName}`, err, {
                sourceName,
                filterName,
                context: 'OBS'
            });
            throw err;
        }
    }

    return {
        updateTextSource,
        clearTextSource,
        
        getSceneItemId,
        setSourceVisibility,
        
        setSourceFilterEnabled,
        getSourceFilterSettings,
        setSourceFilterSettings,
        
        clearSceneItemCache
    };
}

class OBSSourcesManager {
    constructor(obsManager: SourcesObsManager, dependencies: SourcesDependencies = {}) {
        const manager = createOBSSourcesManager(obsManager, dependencies);
        Object.assign(this, manager);
    }
}

type SourcesManagerApi = ReturnType<typeof createOBSSourcesManager> & {
    isDegraded?: boolean;
};

let defaultInstance: SourcesManagerApi | null = null;
let defaultConnectionManagerForCacheInvalidation: SourcesObsManager | null = null;

type DefaultSourcesManagerDependencies = {
    logger?: SourcesLogger;
    ensureOBSConnected?: () => Promise<void>;
    obsCall?: ObsCall;
    getOBSConnectionManager?: () => SourcesObsManager;
};

function getDefaultSourcesManager(dependencies: DefaultSourcesManagerDependencies = {}) {
    if (!defaultInstance) {
        const logger = dependencies.logger || coreLogger;
        const ensureOBSConnected = dependencies.ensureOBSConnected || defaultEnsureOBSConnected;
        const obsCall = dependencies.obsCall || defaultObsCall;
        const getOBSConnectionManager = dependencies.getOBSConnectionManager || defaultGetOBSConnectionManager;

        let obsManager: SourcesObsManager | null;
        let isDegraded = false;
        try {
            obsManager = getOBSConnectionManager();
        } catch (error) {
            isDegraded = true;
            logger.warn('[OBS Sources] OBS connection manager unavailable; using degraded sources manager', 'obs-sources', {
                error: getErrorMessage(error)
            });
            obsManager = null;
        }
        if (!obsManager) {
            if (!isDegraded) {
                logger.warn('[OBS Sources] OBS connection manager missing; using degraded sources manager', 'obs-sources');
            }
            isDegraded = true;
            obsManager = {
                ensureConnected: () => Promise.resolve(),
                call: () => Promise.resolve({}),
                addEventListener: () => {},
                removeEventListener: () => {},
                isConnected: () => false,
                isReady: () => Promise.resolve(false)
            };
        }

        defaultInstance = createOBSSourcesManager(obsManager, {
            logger,
            ensureOBSConnected,
            obsCall
        });
        defaultInstance.isDegraded = isDegraded;
        defaultConnectionManagerForCacheInvalidation = obsManager;
    }
    return defaultInstance;
}

function resetDefaultSourcesManager() {
    if (
        defaultConnectionManagerForCacheInvalidation
        && typeof defaultConnectionManagerForCacheInvalidation.setSourcesCacheInvalidator === 'function'
    ) {
        defaultConnectionManagerForCacheInvalidation.setSourcesCacheInvalidator(null);
    }

    defaultInstance = null;
    defaultConnectionManagerForCacheInvalidation = null;
}

export {
    OBSSourcesManager,
    createOBSSourcesManager,
    getDefaultSourcesManager,
    resetDefaultSourcesManager,
    sanitizeForOBS
};
