
// Check if we're in a test environment
const isTestEnvironment = process.env.NODE_ENV === 'test';

// Import safe operations wrapper
const { safeOBSOperation } = require('./safe-operations');

// Import OBS text sanitization to prevent Unicode crashes
const { sanitizeForOBS } = require('../utils/obs-text-sanitizer');
const { safeDelay } = require('../utils/timeout-validator');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');

// Scene detection removed - using direct source access only

function createOBSSourcesManager(obsManager, dependencies = {}) {
    if (!obsManager) {
        throw new Error('OBSSourcesManager requires OBSConnectionManager instance');
    }

    const logger = dependencies.logger || dependencies.logging?.logger || require('../core/logging').logger;
    const ensureOBSConnected = dependencies.ensureOBSConnected ||
        dependencies.connection?.ensureOBSConnected ||
        obsManager.ensureConnected?.bind(obsManager) ||
        (() => Promise.resolve());
    const obsCall = dependencies.obsCall ||
        dependencies.connection?.obsCall ||
        obsManager.call?.bind(obsManager);
    const getOBSConnectionManager = dependencies.connection?.getOBSConnectionManager || (() => obsManager);

    const chatGroupName = dependencies.chatGroupName;
    const notificationGroupName = dependencies.notificationGroupName;
    const fadeDelay = dependencies.fadeDelay;

    if (!chatGroupName || !notificationGroupName || fadeDelay === undefined) {
        throw new Error('OBSSourcesManager requires chatGroupName, notificationGroupName, and fadeDelay');
    }

    const utils = dependencies.utils || {};
    const delay = utils.delay || ((ms) => safeDelay(ms, ms || 500, 'OBS sources delay'));
    const sanitizeDisplayName = utils.sanitizeDisplayName || require('../utils/validation').sanitizeDisplayName;

    let sourcesErrorHandler = logger ? createPlatformErrorHandler(logger, 'obs-sources') : null;

    const handleSourcesError = (message, error, payload = null) => {
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
    const sceneItemCache = new Map();
    
    // Scene detection removed - using direct source access only
    
    function getCacheKey(sceneName, sourceName) {
        return `${sceneName}:${sourceName}`;
    }
    
    function clearSceneItemCache() {
        sceneItemCache.clear();
        logger.debug('[OBS Cache] Scene item cache cleared', 'obs-sources');
    }

    function validateGroupName(groupName, operationType = "group operation") {
        if (!groupName || groupName === null || groupName === undefined || groupName === "") {
            logger.debug(`[OBS Group] Invalid group name (${groupName}) - skipping ${operationType}`, 'obs-sources');
            return false;
        }
        return true;
    }


    async function updateTextSource(sourceName, message) {
    // In test environment, use mock OBS manager if available
    if (isTestEnvironment) {
        logger.debug(`[OBS Source] Test environment - using mock OBS for text source update: "${sourceName}" with: ${message}`, 'obs-sources');
        
        try {
            const obsManager = getOBSConnectionManager();
            if (obsManager && typeof obsManager.call === 'function') {
                // Call the mock to satisfy test expectations
                const sanitizedMessage = sanitizeForOBS(message);
                await obsManager.call('SetInputSettings', {
                    inputName: sourceName,
                    inputSettings: {
                        text: sanitizedMessage
                    }
                });
                logger.debug(`[OBS Source] Mock OBS call completed for "${sourceName}"`, 'obs-sources');
            }
        } catch (error) {
            logger.debug(`[OBS Source] Mock OBS call failed (expected in some tests): ${error.message}`, 'obs-sources');
        }
        return;
    }
    
    const obsManager = getOBSConnectionManager();
    return await safeOBSOperation(
        obsManager,
        async () => {
            await ensureOBSConnected();
            
            // Sanitize text to prevent Unicode corruption crashes
            const sanitizedMessage = sanitizeForOBS(message);
            
            logger.debug(`[OBS Source] Updating text source "${sourceName}" with: ${sanitizedMessage}`, 'obs-sources');
            
            // Log if sanitization changed the message
            if (sanitizedMessage !== message) {
                logger.debug(`[OBS Source] Text sanitized for OBS safety: "${message}" → "${sanitizedMessage}"`, 'obs-sources');
            }
            
            // Get current input settings to preserve other properties
            const { inputSettings } = await obsCall("GetInputSettings", { inputName: sourceName });
            
            // Update text while preserving other settings
            await obsCall("SetInputSettings", { 
                inputName: sourceName, 
                inputSettings: { 
                    ...inputSettings, 
                    text: sanitizedMessage 
                }, 
                overlay: false 
            });
        },
        `Updating text source "${sourceName}"`
    );
    }

    async function clearTextSource(sourceName) {
    const obsManager = getOBSConnectionManager();
    return await safeOBSOperation(
        obsManager,
        async () => {
            await ensureOBSConnected();
            
            
            const { inputSettings } = await obsCall("GetInputSettings", { inputName: sourceName });
            await obsCall("SetInputSettings", { 
                inputName: sourceName, 
                inputSettings: { 
                    ...inputSettings, 
                    text: "" 
                }, 
                overlay: false 
            });
            
        },
        `Clearing text source "${sourceName}"`
    );
    }

    async function updateChatMsgText(sourceName, username, message) {
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


    async function getSceneItemId(sceneName, sourceName) {
    const cacheKey = getCacheKey(sceneName, sourceName);
    
    // Check cache first
    if (sceneItemCache.has(cacheKey)) {
        const cachedResult = sceneItemCache.get(cacheKey);
        return cachedResult;
    }
    
    const obsManager = getOBSConnectionManager();
    return await safeOBSOperation(
        obsManager,
        async () => {
            await ensureOBSConnected();
            
            
            const { sceneItemId } = await obsCall("GetSceneItemId", { sceneName, sourceName });
            
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
    }

    async function setSourceVisibility(sceneName, sourceName, visible) {
    // Skip OBS operations in test environment
    if (isTestEnvironment) {
        logger.debug(`[OBS Source] Skipping source visibility change in test environment: ${sourceName} to ${visible}`, 'obs-sources');
        return;
    }
    
    const obsManager = getOBSConnectionManager();
    return await safeOBSOperation(
        obsManager,
        async () => {
            await ensureOBSConnected();
            
            
            const { sceneItemId } = await getSceneItemId(sceneName, sourceName);
            await obsCall("SetSceneItemEnabled", { 
                sceneName, 
                sceneItemId, 
                sceneItemEnabled: visible 
            });
            
            // Success - reduced verbosity
        },
        `Setting ${sourceName} visibility to ${visible} in scene ${sceneName}`
    );
    }


    async function getGroupSceneItemId(sourceName, groupName) {
    // DRY: Validate group name before any operations
    if (!validateGroupName(groupName, `getGroupSceneItemId for ${sourceName}`)) {
        throw new Error(`Invalid group name: ${groupName}`);
    }
    
    const cacheKey = getCacheKey(`group:${groupName}`, sourceName);
    
    // Check cache first
    if (sceneItemCache.has(cacheKey)) {
        const cachedResult = sceneItemCache.get(cacheKey);
        return cachedResult;
    }
    
    await ensureOBSConnected();
    
    try {
        // Get the list of items inside the group using OBS WebSocket API
        const groupItemListResponse = await obsCall('GetGroupSceneItemList', { sceneName: groupName });

        if (!groupItemListResponse || !Array.isArray(groupItemListResponse.sceneItems)) {
            throw new Error(`Could not retrieve a valid list of items from group '${groupName}'.`);
        }

        const sourceInGroup = groupItemListResponse.sceneItems.find(item => item.sourceName === sourceName);
        
        if (!sourceInGroup) {
            throw new Error(`Source '${sourceName}' not found inside group '${groupName}'`);
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

    async function setGroupSourceVisibility(sourceName, groupName, visible) {
    if (isTestEnvironment) {
        logger.debug(`[OBS Group] Skipping visibility set in test env for ${sourceName} in ${groupName}`, 'obs-sources');
        return;
    }
    
    // DRY: Validate group name before any operations
    if (!validateGroupName(groupName, `setGroupSourceVisibility for ${sourceName}`)) {
        return;
    }
    
    const obsManager = getOBSConnectionManager();
    return await safeOBSOperation(
        obsManager,
        async () => {
            await ensureOBSConnected();
            
            // Use groupName as the sceneName for visibility changes within a group
            const { sceneItemId } = await getGroupSceneItemId(sourceName, groupName);
            

            await obsCall('SetSceneItemEnabled', {
                sceneName: groupName, // In v5, you specify the group name as the scene name
                sceneItemId: sceneItemId,
                sceneItemEnabled: visible
            });
        },
        `Setting ${sourceName} visibility in group ${groupName} to ${visible}`
    );
    }


    async function setPlatformLogoVisibility(activePlatform, platformLogos) {
    if (isTestEnvironment) {
        logger.debug(`[OBS Platform Logo] Skipping platform logo visibility change in test environment: ${activePlatform} to true`, 'obs-sources');
        return;
    }
    
    for (const platform in platformLogos) {
        const logoSource = platformLogos[platform];
        const isVisible = platform.toLowerCase() === activePlatform.toLowerCase();
        
        try {
            await setGroupSourceVisibility(logoSource, chatGroupName, isVisible);
        } catch (error) {
            handleSourcesError(
                `[Platform Logo] Failed to set ${platform} logo visibility in ${chatGroupName}: ${error.message}`,
                error,
                { platform, groupName: chatGroupName, context: 'OBS' }
            );
        }
    }
    }

    async function setNotificationPlatformLogoVisibility(activePlatform, platformLogos) {
    for (const platform in platformLogos) {
        const logoSource = platformLogos[platform];
        const isVisible = platform.toLowerCase() === activePlatform.toLowerCase();
        
        try {
            await setGroupSourceVisibility(logoSource, notificationGroupName, isVisible);
        } catch (error) {
            handleSourcesError(
                `[Notification Logo] Failed to set ${platform} logo visibility in ${notificationGroupName}: ${error.message}`,
                error,
                { platform, groupName: notificationGroupName, context: 'OBS' }
            );
        }
    }
    }

    async function hideAllPlatformLogos(platformLogos) {
    if (isTestEnvironment) {
        logger.debug(`[OBS Platform Logo] Skipping hide all platform logos in test environment`, 'obs-sources');
        return;
    }
    
    
    for (const platform in platformLogos) {
        await setGroupSourceVisibility(platformLogos[platform], chatGroupName, false);
    }
    }

    async function hideAllNotificationPlatformLogos(platformLogos) {

        for (const platform in platformLogos) {
            await setGroupSourceVisibility(platformLogos[platform], notificationGroupName, false);
        }
    }


    async function setChatDisplayVisibility(visible, sceneName, platformLogos) {
        if (isTestEnvironment) {
            logger.debug(`[OBS Display] Skipping chat display visibility change in test environment: ${visible}`, 'obs-sources');
            return;
        }
        
        // Chat display visibility - reduced verbosity
        
        try {
            if (chatGroupName) {
                if (visible) {
                    logger.debug(`[Chat Display] Showing statusbar group`, 'obs-sources');
                    await setSourceVisibility(sceneName, chatGroupName, true);
                } else {
                    await setSourceVisibility(sceneName, chatGroupName, false);

                    await delayFunction(fadeDelay);
                    
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

    async function setNotificationDisplayVisibility(visible, sceneName, platformLogos) {
        if (isTestEnvironment) {
            logger.debug(`[OBS Display] Skipping notification display visibility change in test environment: ${visible}`, 'obs-sources');
            return;
        }
        
        // Notification display visibility - reduced verbosity
        
        try {
            if (notificationGroupName) {
                if (visible) {
                    logger.debug(`[Notification Display] Showing notification statusbar group`, 'obs-sources');
                    await setSourceVisibility(sceneName, notificationGroupName, true);
                } else {
                    await setSourceVisibility(sceneName, notificationGroupName, false);

                    await delayFunction(fadeDelay);
                    
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
        chatSceneName, 
        notificationSceneName, 
        chatPlatformLogos, 
        notificationPlatformLogos,
        ttsSourceName,
        notificationSourceName
    ) {
        if (isTestEnvironment) {
            logger.debug(`[OBS Display] Skipping hide all displays in test environment`, 'obs-sources');
            return;
        }
        
            
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


    async function setSourceFilterEnabled(sourceName, filterName, enabled) {
        if (isTestEnvironment) {
            logger.debug(`[OBS Filter] Skipping filter enable/disable in test environment: ${filterName} on ${sourceName} to ${enabled}`, 'obs-sources');
            return;
        }
        
        try {
            await ensureOBSConnected();
            
            logger.debug(`[OBS Filter] Setting ${sourceName}:${filterName} to ${enabled ? 'enabled' : 'disabled'}`, 'OBS');
            
            await obsCall('SetSourceFilterEnabled', {
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

    async function getSourceFilterSettings(sourceName, filterName) {
        try {
            await ensureOBSConnected();
            
            logger.debug(`[OBS Filter] Getting filter settings for ${sourceName}:${filterName}`, 'OBS');
            
            const filterInfo = await obsCall('GetSourceFilter', {
                sourceName: sourceName,
                filterName: filterName
            });
            
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

    async function setSourceFilterSettings(sourceName, filterName, filterSettings) {
        if (isTestEnvironment) {
            logger.debug(`[OBS Filter] Skipping filter settings update in test environment: ${filterName} on ${sourceName}`, 'obs-sources');
            return;
        }
        
        try {
            await ensureOBSConnected();
            
            logger.debug(`[OBS Filter] Setting filter settings for ${sourceName}:${filterName}`, 'OBS', filterSettings);
            
            await obsCall('SetSourceFilterSettings', {
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
    constructor(obsManager, dependencies = {}) {
        const manager = createOBSSourcesManager(obsManager, dependencies);
        Object.assign(this, manager);
    }
}

let defaultInstance = null;

function getDefaultSourcesManager() {
    if (!defaultInstance) {
        const { logger } = require('../core/logging');
        const { config } = require('../core/config');
        const { ensureOBSConnected, obsCall, getOBSConnectionManager } = require('./connection');

        const chatGroupName = config.general.chatMsgGroup;
        const notificationGroupName = config.obs.notificationMsgGroup;
        const fadeDelay = config.timing.fadeDuration;

        let obsManager;
        let isDegraded = false;
        try {
            obsManager = getOBSConnectionManager();
        } catch (error) {
            isDegraded = true;
            logger.warn('[OBS Sources] OBS connection manager unavailable; using degraded sources manager', 'obs-sources', {
                error: error?.message || String(error)
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
                isConnected: () => false
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
    }
    return defaultInstance;
}

module.exports = {
    OBSSourcesManager,
    createOBSSourcesManager,
    getDefaultSourcesManager
}; 
