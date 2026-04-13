import { config as coreConfig } from '../core/config';
import { logger as coreLogger } from '../core/logging';
import { safeOBSOperation } from './safe-operations';
import { safeDelay } from '../utils/timeout-validator';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { sanitizeDisplayName as defaultSanitizeDisplayName } from '../utils/validation';
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
    chatGroupName?: string;
    notificationGroupName?: string;
    fadeDelay?: number;
    utils?: {
        delay?: (ms: number) => Promise<void>;
        sanitizeDisplayName?: (name: string, maxLength: number) => string;
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

type GroupSceneItem = {
    sourceName?: unknown;
    sceneItemId?: unknown;
};

type GroupSceneItemListResponse = {
    sceneItems?: GroupSceneItem[];
};

type SourceFilterResponse = {
    filterSettings?: Record<string, unknown>;
};

type PlatformLogos = Record<string, unknown>;

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

function isNonEmptySourceName(sourceName: unknown): sourceName is string {
    return typeof sourceName === 'string' && sourceName.trim().length > 0;
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

    const chatGroupName = dependencies.chatGroupName;
    const notificationGroupName = dependencies.notificationGroupName;
    const fadeDelay = dependencies.fadeDelay;

    if (!chatGroupName || !notificationGroupName || fadeDelay === undefined) {
        throw new Error('OBSSourcesManager requires chatGroupName, notificationGroupName, and fadeDelay');
    }

    const utils = dependencies.utils || {};
    const delay = utils.delay || ((ms: number) => safeDelay(ms, ms || 500, 'OBS sources delay'));
    const sanitizeDisplayName = utils.sanitizeDisplayName || defaultSanitizeDisplayName;

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

    // Use provided delay function (required dependency)
    const delayFunction = delay;

    // Scene Item ID Cache
    // Stores scene item IDs to avoid repeated OBS API calls
    const sceneItemCache = new Map<string, SceneItemCacheEntry>();
    
    // Scene detection removed - using direct source access only
    
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

    function validateGroupName(groupName: string | null | undefined, operationType = 'group operation'): groupName is string {
        if (!groupName || groupName === null || groupName === undefined || groupName === "") {
            logger.debug(`[OBS Group] Invalid group name (${groupName}) - skipping ${operationType}`, 'obs-sources');
            return false;
        }
        return true;
    }


    async function updateTextSource(sourceName: string, message?: string): Promise<void> {
    const obsManager = getOBSConnectionManager();
    await safeOBSOperation(
        obsManager,
        async () => {
            await ensureConnected();
            
            // Sanitize text to prevent Unicode corruption crashes
            const sanitizedMessage = sanitizeForOBS(message);
            
            logger.debug(`[OBS Source] Updating text source "${sourceName}" with: ${sanitizedMessage}`, 'obs-sources');
            
            // Log if sanitization changed the message
            if (sanitizedMessage !== message) {
                logger.debug(`[OBS Source] Text sanitized for OBS safety: "${message}" → "${sanitizedMessage}"`, 'obs-sources');
            }
            
            // Get current input settings to preserve other properties
            const { inputSettings } = await callOBS('GetInputSettings', { inputName: sourceName }) as InputSettingsResponse;
            const currentInputSettings = inputSettings && typeof inputSettings === 'object' ? inputSettings : {};
            
            // Update text while preserving other settings
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

    async function updateChatMsgText(sourceName: string, username: string, message: string): Promise<void> {
    try {
        const sanitizedUsername = sanitizeDisplayName(username, 15); // 15 char limit for OBS display
        const formattedMessage = `${sanitizedUsername}: ${message}`;
        
        logger.debug(`[OBS Source] Updating chat message text to: ${formattedMessage}`, 'obs-sources');
        
        await updateTextSource(sourceName, formattedMessage);
    } catch (err) { 
        handleSourcesError('[OBS Source] Error updating chat message text source', err, { sourceName, context: 'OBS' });
        throw err;
    }
    }


    async function getSceneItemId(sceneName: string, sourceName: string): Promise<SceneItemCacheEntry> {
    const cacheKey = getCacheKey(sceneName, sourceName);
    
    // Check cache first
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
                
                // Cache the result
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
            
            // Success - reduced verbosity
        },
        `Setting ${sourceName} visibility to ${visible} in scene ${sceneName}`
    );
    }


    async function getGroupSceneItemId(sourceName: string, groupName: string): Promise<SceneItemCacheEntry> {
    // DRY: Validate group name before any operations
    if (!validateGroupName(groupName, `getGroupSceneItemId for ${sourceName}`)) {
        throw new Error(`Invalid group name: ${groupName}`);
    }
    
    const cacheKey = getCacheKey(`group:${groupName}`, sourceName);
    
    // Check cache first
    if (sceneItemCache.has(cacheKey)) {
        const cachedResult = sceneItemCache.get(cacheKey);
        if (cachedResult) {
            return cachedResult;
        }
    }
    
    await ensureConnected();
    
    try {
        // Get the list of items inside the group using OBS WebSocket API
        const groupItemListResponse = await callOBS('GetGroupSceneItemList', { sceneName: groupName }) as GroupSceneItemListResponse;

        if (!groupItemListResponse || !Array.isArray(groupItemListResponse.sceneItems)) {
            throw new Error(`Could not retrieve a valid list of items from group '${groupName}'.`);
        }

        const sourceInGroup = groupItemListResponse.sceneItems.find((item) => item.sourceName === sourceName);
        
        if (!sourceInGroup) {
            throw new Error(`Source '${sourceName}' not found inside group '${groupName}'`);
        }
        
        if (typeof sourceInGroup.sceneItemId !== 'number') {
            throw new Error(`Source '${sourceName}' in group '${groupName}' has invalid scene item id`);
        }

        const result = { sceneItemId: sourceInGroup.sceneItemId };
        
        // Cache the result
        sceneItemCache.set(cacheKey, result);
        
        return result;
    } catch (error) {
        // Don't cache failed lookups
        handleSourcesError(
            `[OBS Group] Error finding source '${sourceName}' in group '${groupName}'`,
            error,
            { sourceName, groupName, context: 'OBS' }
        );
        throw error;
    }
    }

    async function setGroupSourceVisibility(sourceName: string, groupName: string | null | undefined, visible: boolean): Promise<void> {
    // DRY: Validate group name before any operations
    if (!validateGroupName(groupName, `setGroupSourceVisibility for ${sourceName}`)) {
        return;
    }
    const validGroupName = groupName;
    
    const obsManager = getOBSConnectionManager();
    await safeOBSOperation(
        obsManager,
        async () => {
            await ensureConnected();
            
            // Use groupName as the sceneName for visibility changes within a group
            const { sceneItemId } = await getGroupSceneItemId(sourceName, validGroupName);
            

            await callOBS('SetSceneItemEnabled', {
                sceneName: validGroupName,
                sceneItemId: sceneItemId,
                sceneItemEnabled: visible
            });
        },
        `Setting ${sourceName} visibility in group ${groupName} to ${visible}`
    );
    }


    async function setPlatformLogoVisibility(activePlatform: string, platformLogos: PlatformLogos): Promise<void> {
    for (const platform in platformLogos) {
        const logoSource = platformLogos[platform];
        if (!isNonEmptySourceName(logoSource)) {
            continue;
        }
        const isVisible = platform.toLowerCase() === activePlatform.toLowerCase();
        
        try {
            await setGroupSourceVisibility(logoSource, chatGroupName, isVisible);
        } catch (error) {
            handleSourcesError(
                `[Platform Logo] Failed to set ${platform} logo visibility in ${chatGroupName}: ${getErrorMessage(error)}`,
                error,
                { platform, groupName: chatGroupName, context: 'OBS' }
            );
        }
    }
    }

    async function setNotificationPlatformLogoVisibility(activePlatform: string, platformLogos: PlatformLogos): Promise<void> {
    for (const platform in platformLogos) {
        const logoSource = platformLogos[platform];
        if (!isNonEmptySourceName(logoSource)) {
            continue;
        }
        const isVisible = platform.toLowerCase() === activePlatform.toLowerCase();
        
        try {
            await setGroupSourceVisibility(logoSource, notificationGroupName, isVisible);
        } catch (error) {
            handleSourcesError(
                `[Notification Logo] Failed to set ${platform} logo visibility in ${notificationGroupName}: ${getErrorMessage(error)}`,
                error,
                { platform, groupName: notificationGroupName, context: 'OBS' }
            );
        }
    }
    }

    async function hideAllPlatformLogos(platformLogos: PlatformLogos): Promise<void> {
    for (const platform in platformLogos) {
        const logoSource = platformLogos[platform];
        if (!isNonEmptySourceName(logoSource)) {
            continue;
        }
        await setGroupSourceVisibility(logoSource, chatGroupName, false);
    }
    }

    async function hideAllNotificationPlatformLogos(platformLogos: PlatformLogos): Promise<void> {

        for (const platform in platformLogos) {
            const logoSource = platformLogos[platform];
            if (!isNonEmptySourceName(logoSource)) {
                continue;
            }
            await setGroupSourceVisibility(logoSource, notificationGroupName, false);
        }
    }


    async function setChatDisplayVisibility(visible: boolean, sceneName: string, platformLogos: PlatformLogos): Promise<void> {
        try {
            if (chatGroupName) {
                if (visible) {
                    logger.debug(`[Chat Display] Showing statusbar group`, 'obs-sources');
                    await setSourceVisibility(sceneName, chatGroupName, true);
                } else {
                    await setSourceVisibility(sceneName, chatGroupName, false);

                    await delayFunction(fadeDelay || 0);
                    
                    // Hide all platform logos within the group for cleanup
                    await hideAllPlatformLogos(platformLogos);
                }
            } else {
                logger.debug(`[Chat Display] Group operations disabled - using direct source access`, 'obs-sources');
            }
        } catch (err) {
            handleSourcesError('[Chat Display] Error setting visibility', err, { context: 'OBS', sceneName, visible });
            throw err;
        }
    }

    async function setNotificationDisplayVisibility(visible: boolean, sceneName: string, platformLogos: PlatformLogos): Promise<void> {
        try {
            if (notificationGroupName) {
                if (visible) {
                    logger.debug(`[Notification Display] Showing notification statusbar group`, 'obs-sources');
                    await setSourceVisibility(sceneName, notificationGroupName, true);
                } else {
                    await setSourceVisibility(sceneName, notificationGroupName, false);

                    await delayFunction(fadeDelay || 0);
                    
                    // Hide all platform logos within the group for cleanup
                    await hideAllNotificationPlatformLogos(platformLogos);
                }
            } else {
                logger.debug(`[Notification Display] Group operations disabled - using direct source access`, 'obs-sources');
            }
        } catch (err) {
            handleSourcesError('[Notification Display] Error setting visibility', err, { context: 'OBS', sceneName, visible });
            throw err;
        }
    }

    async function hideAllDisplays(
        chatSceneName: string,
        notificationSceneName: string,
        chatPlatformLogos: PlatformLogos,
        notificationPlatformLogos: PlatformLogos,
        ttsSourceName: string,
        notificationSourceName: string
    ): Promise<void> {
            try {
                // Hide both display systems
                await Promise.all([
                    setChatDisplayVisibility(false, chatSceneName, chatPlatformLogos),
                    setNotificationDisplayVisibility(false, notificationSceneName, notificationPlatformLogos)
                ]);
                
                // Clear text sources
                await Promise.all([
                    clearTextSource(ttsSourceName),
                    clearTextSource(notificationSourceName)
                ]);
                
                // Clean transition delay
                await delayFunction(200);
                
        } catch (err) {
            handleSourcesError('[Display Control] Error hiding displays', err, {
                chatSceneName,
                notificationSceneName,
                context: 'OBS'
            });
            throw err;
        }
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

    // Return all functions as an object
    return {
        // Text source management
        updateTextSource,
        clearTextSource,
        updateChatMsgText,
        
        // Source visibility management
        getSceneItemId,
        setSourceVisibility,
        
        // Group source management
        getGroupSceneItemId,
        setGroupSourceVisibility,
        
        // Platform logo management
        setPlatformLogoVisibility,
        setNotificationPlatformLogoVisibility,
        hideAllPlatformLogos,
        hideAllNotificationPlatformLogos,
        
        // Display system control
        setChatDisplayVisibility,
        setNotificationDisplayVisibility,
        hideAllDisplays,
        
        // Source filter management
        setSourceFilterEnabled,
        getSourceFilterSettings,
        setSourceFilterSettings,
        
        // Cache management
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

type DefaultSourcesConfig = {
    obs: {
        chatMsgGroup: string;
        notificationMsgGroup: string;
    };
    timing: {
        fadeDuration: number;
    };
};

type DefaultSourcesManagerDependencies = {
    logger?: SourcesLogger;
    config?: DefaultSourcesConfig;
    ensureOBSConnected?: () => Promise<void>;
    obsCall?: ObsCall;
    getOBSConnectionManager?: () => SourcesObsManager;
};

function getDefaultSourcesManager(dependencies: DefaultSourcesManagerDependencies = {}) {
    if (!defaultInstance) {
        const logger = dependencies.logger || coreLogger;
        const config: DefaultSourcesConfig = dependencies.config || (coreConfig as DefaultSourcesConfig);
        const ensureOBSConnected = dependencies.ensureOBSConnected || defaultEnsureOBSConnected;
        const obsCall = dependencies.obsCall || defaultObsCall;
        const getOBSConnectionManager = dependencies.getOBSConnectionManager || defaultGetOBSConnectionManager;

        const chatGroupName = config.obs.chatMsgGroup;
        const notificationGroupName = config.obs.notificationMsgGroup;
        const fadeDelay = config.timing.fadeDuration;

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
            chatGroupName,
            notificationGroupName,
            fadeDelay,
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
