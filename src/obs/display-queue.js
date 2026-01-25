
const crypto = require('crypto');
const { logger } = require('../core/logging');
const { ConfigValidator } = require('../utils/config-validator');
const { normalizeDisplayQueueConfig } = require('./display-queue-config');
const { validateDisplayConfig } = require('../utils/configuration-validator');
const { getDefaultSourcesManager } = require('./sources');
const { triggerHandcamGlow } = require('./handcam-glow');
const { getDefaultGoalsManager } = require('./goals');
const MessageTTSHandler = require('../utils/message-tts-handler');
const { isNotificationType, isChatType } = require('../utils/notification-types');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { safeSetTimeout, safeDelay } = require('../utils/timeout-validator');
const { PlatformEvents } = require('../interfaces/PlatformEvents');
const { PRIORITY_LEVELS } = require('../core/constants');

let displayQueueErrorHandler = logger ? createPlatformErrorHandler(logger, 'display-queue') : null;

function resolveRuntimeConstants(runtimeConstants, constants) {
    if (runtimeConstants) {
        return runtimeConstants;
    }
    if (constants && (
        constants.CHAT_TRANSITION_DELAY !== undefined ||
        constants.NOTIFICATION_CLEAR_DELAY !== undefined ||
        constants.CHAT_MESSAGE_DURATION !== undefined
    )) {
        return constants;
    }
    return null;
}

function handleDisplayQueueError(message, error = null, payload = null) {
    if (!displayQueueErrorHandler && logger) {
        displayQueueErrorHandler = createPlatformErrorHandler(logger, 'display-queue');
    }

    if (displayQueueErrorHandler && error instanceof Error) {
        displayQueueErrorHandler.handleEventProcessingError(error, 'display-queue', payload, message, 'display-queue');
        return;
    }

    if (displayQueueErrorHandler) {
        displayQueueErrorHandler.logOperationalError(message, 'display-queue', payload);
    }
}

// Check if we're in a test environment
const isTestEnv = process.env.NODE_ENV === 'test';

function delay(ms) {
    if (isTestEnv) {
        return Promise.resolve();
    }
    const numMs = Number(ms);
    return safeDelay(numMs, Number.isFinite(numMs) ? numMs : 5000, 'DisplayQueue delay');
}

class DisplayQueue {
    constructor(obsManager, config = {}, constants = {}, eventBus = null, runtimeConstants = null, dependencies = {}) {
        if (!obsManager) {
            throw new Error('DisplayQueue requires OBSConnectionManager instance');
        }
        try {

        this.queue = [];
        this.isProcessing = false;
        this.isRetryScheduled = false;
        this.currentDisplay = null;
        this.lastChatItem = null;
        this.obsManager = obsManager;
        this.constants = constants;
        this.runtimeConstants = resolveRuntimeConstants(runtimeConstants, constants);
        if (!this.runtimeConstants) {
            throw new Error('DisplayQueue requires runtimeConstants');
        }
        this.sourcesManager = dependencies.sourcesManager || getDefaultSourcesManager({ runtimeConstants: this.runtimeConstants });
        this.goalsManager = dependencies.goalsManager || getDefaultGoalsManager({
            runtimeConstants: this.runtimeConstants,
            obsManager: this.obsManager,
            sourcesManager: this.sourcesManager
        });
        this.eventBus = eventBus;

        this.config = normalizeDisplayQueueConfig(config);
        
        
        // Processing begins when items are added (constructor does not auto-start)
        // Processing starts automatically when items are added to the queue via addItem()
        
        } catch (error) {
            handleDisplayQueueError('[DisplayQueue] Error during construction', error);
            // Set up minimal defaults to prevent crashes
            this.queue = [];
            this.isProcessing = false;
            this.isRetryScheduled = false;
            this.currentDisplay = null;
            this.obsManager = obsManager;
            this.config = { autoProcess: false };
        }
    }
    
    isTTSEnabled() {
        // Check global TTS enabled setting - respect the actual config value
        // Use proper boolean parser to handle string values from INI
        // Default to false for safety (when ttsEnabled is undefined)
        return ConfigValidator.parseBoolean(this.config.ttsEnabled, false);
    }

    async setTTSText(text) {
        await this.sourcesManager.clearTextSource(this.config.obs.ttsTxt);
        await safeDelay(50);
        await this.sourcesManager.updateTextSource(this.config.obs.ttsTxt, text);
    }

    getTypePriority(type) {
        if (!this.constants || !this.constants.PRIORITY_LEVELS) {
            logger.warn('[Display Queue] PRIORITY_LEVELS not available, using default priority');
            return PRIORITY_LEVELS.CHAT;
        }

        const typeToPriorityMap = {
            'platform:paypiggy': this.constants.PRIORITY_LEVELS.MEMBER,
            'platform:gift': this.constants.PRIORITY_LEVELS.GIFT,
            'platform:follow': this.constants.PRIORITY_LEVELS.FOLLOW,
            'greeting': this.constants.PRIORITY_LEVELS.GREETING,
            'platform:raid': this.constants.PRIORITY_LEVELS.RAID,
            'platform:share': this.constants.PRIORITY_LEVELS.SHARE,
            'platform:envelope': this.constants.PRIORITY_LEVELS.ENVELOPE,
            'redemption': this.constants.PRIORITY_LEVELS.REDEMPTION,
            'platform:giftpaypiggy': this.constants.PRIORITY_LEVELS.GIFTPAYPIGGY,
            'chat': this.constants.PRIORITY_LEVELS.CHAT,
            'command': this.constants.PRIORITY_LEVELS.COMMAND
        };
        
        return typeToPriorityMap[type] || this.constants.PRIORITY_LEVELS.CHAT;
    }
    
    addItem(item) {
        if (!item || !item.type || !item.data) {
            throw new Error('Invalid display item: missing type or data');
        }
        if (!item.platform) {
            throw new Error('Invalid display item: missing platform');
        }

        if (this.config.maxQueueSize && this.queue.length >= this.config.maxQueueSize) {
            throw new Error(`Queue at capacity (${this.config.maxQueueSize})`);
        }

        if (item.priority === undefined) {
            item.priority = this.getTypePriority(item.type);
        }

        // Store the last chat item for the lingering display feature
        if (item.type === 'chat') {
            this.lastChatItem = { ...item };
            
            // Always drop older chat entries so the latest chat is shown
            const existingChatCount = this.queue.filter(queueItem => queueItem.type === 'chat').length;
            if (existingChatCount > 0) {
                logger.debug(`[Display Queue] Removing ${existingChatCount} stale chat messages to show latest`, 'display-queue');
                for (let i = this.queue.length - 1; i >= 0; i--) {
                    if (this.queue[i].type === 'chat') {
                        this.queue.splice(i, 1);
                    }
                }
            }
        }
        
        let insertIndex = this.queue.length;
        for (let i = 0; i < this.queue.length; i++) {
            if (this.queue[i].priority < item.priority) {
                insertIndex = i;
                break;
            }
        }
        
        this.queue.splice(insertIndex, 0, item);
        logger.debug(`[Display Queue] Added ${item.type} (priority ${item.priority}) at position ${insertIndex}. Queue length: ${this.queue.length}`, 'display-queue');
        
        // Start processing if not already running/scheduled and auto-processing is enabled
        if (!this.isProcessing && !this.isRetryScheduled && this.config.autoProcess) {
            this.processQueue();
        }
    }
    
    async processChatMessage(chatItem) {
        if (!chatItem || chatItem.type !== 'chat') {
            throw new Error('Invalid chat item: must be type "chat"');
        }

        this.addItem(chatItem);

        if (!this.isProcessing && !this.isRetryScheduled && this.config.autoProcess) {
            await this.processQueue();
        }
    }
    
    async processQueue() {
        // Prevent concurrent processing and retry loops
        if (this.isProcessing || this.isRetryScheduled || !this.obsManager) return;

        // Set retry scheduled flag immediately to prevent race conditions
        // This will be cleared if OBS is ready, or maintained for actual retry scheduling
        this.isRetryScheduled = true;

        // Check if OBS is ready for operations
        if (!await this.obsManager.isReady()) {
            logger.debug('[DisplayQueue] OBS not ready, pausing queue processing', 'display-queue');
            
            // Schedule retry if queue is not empty (flag already set above)
            if (this.queue.length > 0) {
                safeSetTimeout(() => {
                    this.isRetryScheduled = false;
                    this.processQueue();
                }, 1000);
            } else {
                // No items to retry, clear the flag
                this.isRetryScheduled = false;
            }
            return;
        }
        
        this.isProcessing = true;
        this.isRetryScheduled = false; // Clear retry flag when processing actually starts
        logger.debug('[Display Queue] Starting queue processing', 'display-queue');
        
        try {
            while (this.queue.length > 0) {
                const item = this.queue.shift();
                this.currentDisplay = item;
                logger.debug(`[Display Queue] Processing ${item.type} item. Remaining: ${this.queue.length}`, 'display-queue');
                
                try {
                    // 1. Display the item
                    await this.displayItem(item);
                    
                    // 2. Wait for its display window (TTS-driven)
                    await delay(this.getDuration(item));

                    // 3. Hide notifications after their display window, but preserve chat messages for lingering
                    if (item.type === 'chat') {
                        // Only hide chat if there are more items in queue or no lingering chat available
                        if (this.queue.length > 0 || !this.lastChatItem) {
                            await this.hideCurrentDisplay(item);
                        }
                    } else {
                        // Always hide notifications after their display window - they should not linger
                        await this.hideCurrentDisplay(item);
                    }
                    
                    // 4. Add a small delay for a smooth transition before the next item
                    await delay(this.runtimeConstants.CHAT_TRANSITION_DELAY);

                } catch (err) {
                    handleDisplayQueueError(`[Display Queue] Error processing ${item.type}`, err, { itemType: item.type });
                    // Attempt to hide the display on error to prevent it from getting stuck
                    if (this.currentDisplay) {
                        await this.hideCurrentDisplay(this.currentDisplay);
                    }
                }
            }
            
            // After the queue is empty, check if we should show a lingering message.
            if (this.lastChatItem) {
                logger.debug('[Display Queue] Queue empty, showing lingering chat.', 'display-queue');
                await this.displayLingeringChat();
                this.currentDisplay = { type: 'chat', data: this.lastChatItem.data }; // Set current display to lingering chat
            }
        } finally {
            // Always reset processing flag, even if an uncaught exception occurs
            this.isProcessing = false;
            logger.debug('[Display Queue] Queue processing complete', 'display-queue');
        }
    }
    
    async displayItem(item) {
        switch (item.type) {
            case 'chat':
                await this.displayChatItem(item);
                break;
            default: // Handles command, gift, follow, etc.
                await this.displayNotificationItem(item);
                break;
        }
    }
    
    async displayChatItem(item) {
        // Development-time validation for data structure debugging
        if (process.env.NODE_ENV !== 'production') {
            this.debugDataStructure(item.data, `chat item from ${item.platform}`);
        }

        // Extract username from notification data
        const username = this.extractUsername(item.data);
        const message = item.data.message;
        const platform = item.platform;
        if (!platform || !this.config[platform]) {
            throw new Error(`DisplayQueue requires configured platform for chat: ${platform || 'unknown'}`);
        }

        // Check if messages are enabled for the given platform
        if (!ConfigValidator.parseBoolean(this.config[platform].messagesEnabled, true)) {
            logger.debug(`[Display Queue] Chat for platform '${platform}' is disabled. Skipping message from '${username}'.`, 'display-queue');
            return; // Skip displaying the chat message
        }

        // Check if OBS is ready before attempting operations
        if (!this.obsManager || !await this.obsManager.isReady()) {
            logger.debug('[DisplayQueue] Skipping chat display - OBS not ready', 'display-queue');
            return;
        }

        const { sourceName, sceneName, groupName, platformLogos } = this.config.chat;

        // Validate required configuration values using centralized validator
        if (!validateDisplayConfig({ sourceName, sceneName, groupName }, 'chat')) {
            return;
        }

        // 1. Hide any active notification to prevent overlap
        await this.hideCurrentDisplay({ type: 'notification' });

        // 2. Hide the current chat display to create a fade-out effect
        await this.hideCurrentDisplay({ type: 'chat' });
        await delay(this.runtimeConstants.CHAT_TRANSITION_DELAY); // Wait for the fade-out

        // 3. Update the content while it's hidden
        try {
            await this.sourcesManager.updateChatMsgText(this.config.chat.sourceName, username, message);
        } catch (error) {
            handleDisplayQueueError('[DisplayQueue] Error updating chat text source', error, { platform, username });
            return;
        }
        
        // Set platform logo only if platform is specified
        if (platform) {
            await this.sourcesManager.setPlatformLogoVisibility(platform, this.config.chat.platformLogos);
        }
        
        // 4. Make the chat text source visible within the group
        await this.sourcesManager.setGroupSourceVisibility(sourceName, groupName, true);
        
        // 5. Make the group visible in the scene
        await this.sourcesManager.setChatDisplayVisibility(true, sceneName, platformLogos);
        
        // 5. Handle TTS processing for chat message
        await this.handleChatMessageTTS(item);
    }
    
    async handleChatMessageTTS(item) {
        try {
            // Extract username from notification data
            const username = this.extractUsername(item.data);
            const message = item.data.message;
            const platform = item.platform;
            
            // Check for monetization deduplication flag
            if (item.data.skipChatTTS) {
                logger.debug(`[DisplayQueue] Chat TTS skipped due to monetization deduplication for ${username} on ${platform}`, 'display-queue');
                return;
            }
            
            // DISABLED: Chat messages should not have TTS - only notifications
            logger.debug(`[DisplayQueue] Chat TTS disabled - skipping TTS for ${username} on ${platform}`, 'display-queue');
            return;
            
        } catch (error) {
            handleDisplayQueueError('[DisplayQueue] Error processing chat TTS', error);
            // Don't throw - continue with chat display even if TTS fails
        }
    }

    async displayNotificationItem(item) {
        
        // Development-time validation for data structure debugging
        if (process.env.NODE_ENV !== 'production') {
            this.debugDataStructure(item.data, `${item.type} notification from ${item.platform}`);
        }

        // Extract username from notification data
        const username = this.extractUsername(item.data);
        const platform = item.platform;
        if (!platform || !this.config[platform]) {
            throw new Error(`DisplayQueue requires configured platform for notification: ${platform || 'unknown'}`);
        }

        // Check if notifications are enabled for the given platform
        if (!ConfigValidator.parseBoolean(this.config[platform].notificationsEnabled, true)) {
            logger.debug(`[Display Queue] Notifications for platform '${platform}' is disabled. Skipping notification for '${username}'.`, 'display-queue');
            return; // Skip displaying the notification
        }

        // Check if OBS is ready before attempting operations
        if (!this.obsManager || !await this.obsManager.isReady()) {
            logger.debug('[DisplayQueue] Skipping notification display - OBS not ready', 'display-queue');
            return;
        }

        const { sourceName, sceneName, groupName, platformLogos } = this.config.notification;

        // Validate required configuration values using centralized validator
        if (!validateDisplayConfig({ sourceName, sceneName, groupName }, 'notification')) {
            return;
        }

        // --- Exact notification display sequence ---
        
        // Process goal tracking when notification starts displaying (moved from NotificationManager)
        if (item.type === 'platform:gift' && item.data && !item.data.isError) {
            // Prevent double goal processing by checking if this gift has already been processed
            if (item.data.goalProcessed) {
                logger.debug(`[Display Queue] Goal already processed for ${username}, skipping`, 'display-queue');
            } else {
                const amountValue = Number(item.data.amount);
                const currencyValue = typeof item.data.currency === 'string' ? item.data.currency.trim().toLowerCase() : '';
                const totalGiftValue = Number.isFinite(amountValue) ? amountValue : 0;
                
                if (totalGiftValue > 0) {
                    try {
                        if (!currencyValue) {
                            throw new Error('Gift goal tracking requires currency');
                        }
                        const giftCount = Number(item.data.giftCount);
                        if (currencyValue === 'coins') {
                            if (!Number.isFinite(giftCount) || giftCount <= 0) {
                                throw new Error('Gift goal tracking requires giftCount');
                            }
                        }
                        await this.goalsManager.processDonationGoal(platform, totalGiftValue);
                        if (currencyValue === 'bits') {
                            logger.debug(`[Display Queue] Goal tracking processed for ${platform}: ${totalGiftValue} bits`, 'display-queue');
                        } else if (currencyValue === 'coins') {
                            const perGift = giftCount > 0 ? (totalGiftValue / giftCount) : totalGiftValue;
                            logger.debug(`[Display Queue] Goal tracking processed for ${platform}: ${totalGiftValue} coins (${perGift} × ${giftCount})`, 'display-queue');
                        } else {
                            const currencyLabel = currencyValue;
                            logger.debug(`[Display Queue] Goal tracking processed for ${platform}: ${totalGiftValue} ${currencyLabel}`, 'display-queue');
                        }
                        
                        // Mark this gift as processed to prevent double counting
                        item.data.goalProcessed = true;
                    } catch (error) {
                        handleDisplayQueueError(`[Display Queue] Goal tracking failed for ${platform}`, error, { platform, totalGiftValue });
                    }
                }
            }
        }

        // 1. Hide chat display (including any lingering chat)
        await this.sourcesManager.setChatDisplayVisibility(false, this.config.chat.sceneName, this.config.chat.platformLogos);
        await delay(this.runtimeConstants.NOTIFICATION_CLEAR_DELAY); // Default fade delay

        // 2. Update notification text
        try {
            if (!item.data.displayMessage) {
                throw new Error('Notification display requires displayMessage');
            }
            await this.sourcesManager.updateTextSource(sourceName, item.data.displayMessage);
        } catch (error) {
            handleDisplayQueueError('[DisplayQueue] Error updating notification text source', error, { platform, itemType: item.type });
            return;
        }

        // 3. Set platform logo for notifications
        if (platform && platformLogos && platformLogos[platform]) {
            await this.sourcesManager.setNotificationPlatformLogoVisibility(platform, this.config.notification.platformLogos);
        }

        // 4. Make the notification text source visible within the group
        const { sourceName: notificationSourceName, groupName: notificationGroupName } = this.config.notification;
        await this.sourcesManager.setGroupSourceVisibility(notificationSourceName, notificationGroupName, true);

        // 5. Show notification display
        await this.sourcesManager.setNotificationDisplayVisibility(true, this.config.notification.sceneName, this.config.notification.platformLogos);

        // 5. Handle TTS and VFX using configured timing
        await this.handleNotificationEffects(item);
    }

    async handleNotificationEffects(item) {
        try {
            // Extract username from notification data
            const username = this.extractUsername(item.data);
            logger.debug(`[Display Queue] Processing notification effects for ${item.type} from ${username}`, 'display-queue');
            
            // Generate TTS stages using MessageTTSHandler (DRY approach)
            const ttsStages = MessageTTSHandler.createTTSStages(item.data);
            logger.debug(`[Display Queue] Generated ${ttsStages.length} TTS stages`, 'display-queue', { stages: ttsStages });
            
            if (item.type === 'platform:gift') {
                await this.handleGiftEffects(item, ttsStages);
            } else {
                await this.handleSequentialEffects(item, ttsStages);
            }
            
        } catch (error) {
            handleDisplayQueueError(`[Display Queue] Error handling notification effects for ${item.type}`, error, { itemType: item.type });
        }
    }

    buildVfxMatch(config) {
        if (!config || typeof config !== 'object') {
            throw new Error('VFX match requires config object');
        }
        const { commandKey, filename, mediaSource, command } = config;
        if (!commandKey || !filename || !mediaSource || !command) {
            throw new Error('VFX match requires commandKey, filename, mediaSource, and command');
        }
        return {
            commandKey,
            filename,
            mediaSource,
            command
        };
    }

    async waitForVfxCompletion(match = {}, options = {}) {
        const noEventBus = !this.eventBus || (!this.eventBus.subscribe && !this.eventBus.on);
        if (noEventBus) {
            logger.debug('[DisplayQueue] EventBus not available for VFX completion wait', 'display-queue', { match });
            return { reason: 'no-eventbus' };
        }

        const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 10000;
        const eventNames = [PlatformEvents.VFX_EFFECT_COMPLETED, PlatformEvents.VFX_COMMAND_EXECUTED];
        const subscribe = (eventName, handler) => {
            if (typeof this.eventBus.subscribe === 'function') {
                return this.eventBus.subscribe(eventName, handler);
            }
            if (typeof this.eventBus.on === 'function') {
                this.eventBus.on(eventName, handler);
                return () => this.eventBus.off(eventName, handler);
            }
            return () => {};
        };

        return new Promise((resolve) => {
            let resolved = false;
            const unsubscribeFns = [];

            const cleanup = () => {
                unsubscribeFns.forEach(unsub => {
                    try {
                        unsub();
                    } catch (err) {
                        logger.debug('[DisplayQueue] Error cleaning up VFX completion subscription', 'display-queue', err);
                    }
                });
            };

            const matches = (payload = {}) => {
                if (match.correlationId && payload.correlationId && match.correlationId === payload.correlationId) {
                    return true;
                }

                const payloadKey = payload.commandKey;
                const payloadCommand = payload.command;
                const payloadFile = payload.filename;
                const payloadSource = payload.mediaSource;

                const byKey = match.commandKey && payloadKey && match.commandKey === payloadKey;
                const byCommand = match.command && payloadCommand && match.command === payloadCommand;
                const byFile = match.filename && payloadFile && match.filename === payloadFile;
                const bySource = match.mediaSource && payloadSource && match.mediaSource === payloadSource;

                return byKey || byCommand || byFile || bySource;
            };

            const handler = (payload) => {
                if (resolved) {
                    return;
                }

                if (!matches(payload || {})) {
                    return;
                }

                resolved = true;
                cleanup();
                resolve({ reason: 'completed', payload });
            };

            eventNames.forEach(name => {
                unsubscribeFns.push(subscribe(name, handler));
            });

            safeDelay(timeoutMs, timeoutMs, 'vfx-completion-wait').then(() => {
                if (resolved) return;
                resolved = true;
                cleanup();
                resolve({ reason: 'timeout' });
            });
        });
    }
    
    async emitVfxFromConfig(item, username) {
        const vfxConfig = item && item.vfxConfig ? item.vfxConfig : null;
        if (!this.eventBus || !vfxConfig) {
            return { emitted: false, match: null };
        }

        let payload;
        try {
            const { command, commandKey, filename, mediaSource, vfxFilePath } = vfxConfig;
            if (!command || !commandKey || !filename || !mediaSource || !vfxFilePath) {
                throw new Error('VFX config requires command, commandKey, filename, mediaSource, and vfxFilePath');
            }
            if (!username || !item.platform || !item.data?.userId) {
                throw new Error('VFX emit requires username, platform, and userId');
            }

            const correlationId = crypto.randomUUID();
            const match = this.buildVfxMatch(vfxConfig);
            match.correlationId = correlationId;

            payload = {
                command,
                commandKey,
                filename,
                mediaSource,
                username,
                platform: item.platform,
                userId: item.data.userId,
                correlationId,
                context: { source: 'display-queue', notificationType: item.type || null, correlationId, skipCooldown: true },
                source: 'display-queue',
                vfxConfig
            };

            this.eventBus.emit(PlatformEvents.VFX_COMMAND_RECEIVED, payload);
            return { emitted: true, match };
        } catch (error) {
            handleDisplayQueueError('[DisplayQueue] Error emitting VFX command', error, payload);
            return { emitted: false, match: null, error };
        }
    }

    async handleGiftEffects(item, ttsStages) {
        const username = this.extractUsername(item.data);
        logger.debug(`[Display Queue] Gift notification - concurrent execution for ${username}`, 'display-queue');
        const allPromises = [];
        const vfxConfig = item.vfxConfig;
        const hasVfx = !!(this.eventBus && vfxConfig);
        const vfxCommand = vfxConfig?.command || null;
        const vfxMatch = hasVfx ? this.buildVfxMatch(vfxConfig) : null;
        const vfxCompletionPromise = hasVfx ? this.waitForVfxCompletion(vfxMatch) : Promise.resolve({ reason: 'no-vfx' });

        // Step 1: Add gift video and audio
        logger.debug('[Gift] Adding gift video and audio', 'display-queue');
        allPromises.push(this.playGiftVideoAndAudio());

        // Step 2: Add handcam glow if enabled
        if (this.config.handcam?.enabled) {
            logger.debug('[Gift] Adding handcam glow', 'display-queue');
            allPromises.push(Promise.resolve().then(() => {
                triggerHandcamGlow(this.obsManager, this.config.handcam, this.runtimeConstants);
            }).catch(err => {
                handleDisplayQueueError('[Gift] Error activating handcam glow', err);
            }));
        }

        // Step 3: Add TTS stages with proper delays (do not gate on VFX completion)
        if (this.isTTSEnabled()) {
            for (const stage of ttsStages) {
                logger.debug(`[Gift] Adding ${stage.type} TTS with ${stage.delay}ms delay: ${stage.text}`, 'display-queue');

                const ttsPromise = (async () => {
                    if (stage.delay > 0) {
                        await delay(stage.delay);
                    }
                    await this.setTTSText(stage.text);
                })();

                allPromises.push(ttsPromise);
            }
        } else {
            logger.debug(`[Gift] TTS disabled - skipping gift TTS stages`, 'display-queue');
        }

        // Step 4: Add VFX with standard gift delay through EventBus (only when config present)
        if (hasVfx) {
            logger.debug('[Gift] Scheduling VFX emission with 2.0s delay', 'display-queue');
            const vfxPromise = delay(2000).then(() => {
                let payload;
                try {
                    const { command, commandKey, filename, mediaSource, vfxFilePath } = vfxConfig;
                    if (!command || !commandKey || !filename || !mediaSource || !vfxFilePath) {
                        throw new Error('Gift VFX config requires command, commandKey, filename, mediaSource, and vfxFilePath');
                    }
                    if (!username || !item.platform || !item.data?.userId) {
                        throw new Error('Gift VFX emit requires username, platform, and userId');
                    }
                    const correlationId = crypto.randomUUID();
                    payload = {
                        command,
                        commandKey,
                        filename,
                        mediaSource,
                        username,
                        platform: item.platform,
                        userId: item.data.userId,
                        notificationType: item.type,
                        delayApplied: 2000,
                        correlationId,
                        source: 'display-queue',
                        context: { source: 'display-queue', notificationType: item.type, delayApplied: 2000, skipCooldown: true, correlationId },
                        vfxConfig
                    };

                    this.eventBus.emit(PlatformEvents.VFX_COMMAND_RECEIVED, payload);
                } catch (error) {
                    handleDisplayQueueError('[Gift] Error emitting VFX command', error, payload);
                }
            });
            allPromises.push(vfxPromise);
        } else {
            logger.warn('[Gift] VFX config missing; skipping VFX emit for gift', 'display-queue');
        }

        await Promise.all(allPromises);
    }
    
    async handleSequentialEffects(item, ttsStages) {
        const username = this.extractUsername(item.data);
        logger.debug(`[Display Queue] Sequential notification - VFX-first execution for ${username}`, 'display-queue');

        let completionResult = null;
        const vfxConfig = item.vfxConfig;
        const hasVfx = !!(this.eventBus && vfxConfig);

        let match = null;
        if (hasVfx) {
            try {
                match = this.buildVfxMatch(vfxConfig);
            } catch {
                match = null;
            }
            if (match) {
                const emitResult = await this.emitVfxFromConfig(item, username);
                if (emitResult.emitted && emitResult.match?.correlationId) {
                    match.correlationId = emitResult.match.correlationId;
                }
                completionResult = emitResult.error
                    ? Promise.resolve(null)
                    : await this.waitForVfxCompletion(match);
            }
        } else {
            logger.debug('[DisplayQueue] No VFX config provided; skipping VFX emit', 'display-queue');
        }

        if (this.isTTSEnabled()) {
            for (const stage of ttsStages) {
                logger.debug(`[Sequential] Playing ${stage.type} TTS: ${stage.text}`, 'display-queue');

                if (stage.delay > 0) {
                    await delay(stage.delay);
                }

                await this.setTTSText(stage.text);
            }
        } else {
            logger.debug(`[Sequential] TTS disabled - skipping TTS stages`, 'display-queue');
        }

        return completionResult;
    }

    async playGiftVideoAndAudio() {
        try {
            logger.debug('[Gift] Starting gift video and audio playback', 'display-queue');

            const giftsConfig = this.config.gifts || {};
            const { giftVideoSource, giftAudioSource } = giftsConfig;
            if (!giftVideoSource || !giftAudioSource) {
                handleDisplayQueueError('[Gift] Gift media sources not configured; skipping gift media');
                return false;
            }

            logger.debug(`[Gift] Configuration: videoSource="${giftVideoSource}", audioSource="${giftAudioSource}"`, 'display-queue');

            const promises = [];

            // Start gift video
            promises.push(this.obsManager.call("TriggerMediaInputAction", {
                inputName: giftVideoSource,
                mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART"
            }).then(() => {
                logger.debug(`[Gift] Gift video source "${giftVideoSource}" started successfully`, 'display-queue');
            }).catch(err => {
                handleDisplayQueueError(`[Gift] Error starting gift video source "${giftVideoSource}"`, err);
                throw err;
            }));

            // Start gift audio
            promises.push(this.obsManager.call("TriggerMediaInputAction", {
                inputName: giftAudioSource,
                mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART"
            }).then(() => {
                logger.debug(`[Gift] Gift audio source "${giftAudioSource}" started successfully`, 'display-queue');
            }).catch(err => {
                handleDisplayQueueError(`[Gift] Error starting gift audio source "${giftAudioSource}"`, err);
                throw err;
            }));

            // Execute both simultaneously
            await Promise.all(promises);
            logger.debug('[Gift] Gift video and audio playback completed successfully', 'display-queue');
            return true;

        } catch (error) {
            handleDisplayQueueError('[Display Queue] Error playing gift video/audio', error);
            // Don't throw - continue with the rest of the gift notification
            return false;
        }
    }
    
    async displayLingeringChat() {
        if (!this.lastChatItem) {
            logger.debug('[Lingering Chat] No chat message available for lingering display', 'display-queue');
            return;
        }

        // Check if OBS is ready before attempting operations
        if (!this.obsManager || !await this.obsManager.isReady()) {
            logger.debug('[DisplayQueue] Skipping lingering chat display - OBS not ready', 'display-queue');
            return;
        }

        // Extract username from notification data
        const username = this.extractUsername(this.lastChatItem.data);
        logger.debug(`[Lingering Chat] Displaying lingering chat: ${username} - ${this.lastChatItem.data.message}`, 'display-queue');
        
        const { sourceName, sceneName, groupName, platformLogos } = this.config.chat;
        
        // Validate required configuration values using centralized validator
        if (!validateDisplayConfig({ sourceName, sceneName, groupName }, 'chat')) {
            return;
        }
        
        // Hide notifications but keep chat visible (or show chat if hidden)
        await this.hideCurrentDisplay({ type: 'notification' });
        await delay(200); // Small delay to avoid flicker
        
        // Update chat message text (in case it's not currently displayed)
        // Extract username from notification data
        const chatUsername = this.extractUsername(this.lastChatItem.data);
        await this.sourcesManager.updateChatMsgText(this.config.chat.sourceName, chatUsername, this.lastChatItem.data.message);
        
        // Set platform logo for the chat display
        if (this.lastChatItem.platform && platformLogos) {
            await this.sourcesManager.setPlatformLogoVisibility(this.lastChatItem.platform, this.config.chat.platformLogos);
        }
        
        // Make the chat text source visible within the group
        await this.sourcesManager.setGroupSourceVisibility(sourceName, groupName, true);
        
        // Show chat display
        await this.sourcesManager.setChatDisplayVisibility(true, sceneName, platformLogos);
    }
    
    async hideCurrentDisplay(item) {
        if (!item || !item.type) return; // Nothing to hide

        // Check if OBS is ready before attempting operations
        if (!this.obsManager || !await this.obsManager.isReady()) {
            logger.debug('[DisplayQueue] Skipping hide display - OBS not ready', 'display-queue');
            return;
        }

        if (isChatType(item.type)) {
            const { sceneName, platformLogos } = this.config.chat;
            if (sceneName) {
                // Group-based architecture: Hide the entire chat display group
                await this.sourcesManager.setChatDisplayVisibility(false, sceneName, platformLogos);
            }
        } else if (isNotificationType(item.type)) {
            // Now properly handles ALL notification types including envelope!
            const { sceneName, platformLogos } = this.config.notification;
            if (sceneName) {
                // Group-based architecture: Hide the entire notification display group
                await this.sourcesManager.setNotificationDisplayVisibility(false, sceneName, platformLogos);
            }
        }
    }
    
    clearQueue() {
        this.queue = [];
        this.lastChatItem = null;
        this.isRetryScheduled = false; // Clear any pending retry when queue is cleared
        this.isProcessing = false; // Reset processing flag to allow fresh processing cycles
        this.currentDisplay = null;
        logger.debug('[Display Queue] Queue cleared', 'display-queue');
    }
    
    async stop() {
        this.isProcessing = false;
        this.isRetryScheduled = false;
        if (this.currentDisplay) {
            await this.hideCurrentDisplay(this.currentDisplay);
        }
        this.clearQueue();
        logger.info('[Display Queue] Processing stopped and queue cleared.');
    }

    getDuration(item) {
        if (!item?.data) {
            return 0;
        }

        let ttsStages;
        try {
            ttsStages = MessageTTSHandler.createTTSStages(item.data) || [];
        } catch {
            return 0;
        }
        if (ttsStages.length === 0) {
            return 0;
        }

        const estimateSpeechMs = (text) => {
            if (!text || typeof text !== 'string') return 0;
            const words = text.trim().split(/\s+/).filter(Boolean).length;
            return 400 + (words * 170);
        };

        let maxStageMs = 0;
        for (const stage of ttsStages) {
            const stageDelay = Number(stage?.delay) || 0;
            const stageMs = stageDelay + estimateSpeechMs(stage?.text);
            if (stageMs > maxStageMs) {
                maxStageMs = stageMs;
            }
        }

        const tailBufferMs = 1000;
        const minWindow = 2000;
        const maxWindow = 20000;

        return Math.min(maxWindow, Math.max(minWindow, maxStageMs + tailBufferMs));
    }








    extractUsername(data) {
        if (!data || typeof data !== 'object') {
            logger.warn('[DisplayQueue] extractUsername: Invalid data object; missing username field.', 'display-queue', {
                callerMethod: 'extractUsername',
                inputType: typeof data
            });
            return null;
        }

        const username = data.username;
        if (data.isError === true && (typeof username !== 'string' || !username.trim())) {
            return null;
        }
        if (typeof username !== 'string' || !username.trim()) {
            logger.warn('[DisplayQueue] extractUsername: Missing username field in notification data.', 'display-queue', {
                callerMethod: 'extractUsername',
                dataKeys: Object.keys(data)
            });
            return null;
        }

        return username.trim();
    }

    validateDataStructure(data, context = 'unknown') {
        const result = {
            isValid: true,
            warnings: [],
            errors: [],
            structure: {
                format: 'unknown',
                hasUsername: false,
                extractableUsername: null,
                confidence: 0
            },
            suggestions: []
        };

        // Basic existence check
        if (!data) {
            result.isValid = false;
            result.errors.push('Data object is null or undefined');
            result.suggestions.push('Ensure notification data is properly created before processing');
            return result;
        }

        if (typeof data !== 'object') {
            result.isValid = false;
            result.errors.push(`Expected object but received ${typeof data}`);
            result.suggestions.push('Check data source - may need JSON parsing or object conversion');
            return result;
        }

        const username = data.username;
        if (typeof username === 'string' && username.trim()) {
            result.structure.hasUsername = true;
            result.structure.format = 'flat';
            result.structure.extractableUsername = username.trim();
            result.structure.confidence += 80;
        }

        // Final validation
        if (!result.structure.hasUsername) {
            result.isValid = false;
            result.errors.push('No extractable username found in data structure');
            result.suggestions.push('Use NotificationBuilder.build() with { username } fields');
        }

        // Context-specific validation
        if (context.includes('chat') && !data.message) {
            result.warnings.push('Chat context but no message field found');
        }

        if ((context.includes('gift') || context.includes('platform:gift')) && data.amount === undefined) {
            result.warnings.push('Gift context but no monetary amount field found');
        }

        // Structure confidence assessment
        if (result.structure.confidence >= 70) {
            result.structure.confidence = 'high';
        } else if (result.structure.confidence >= 40) {
            result.structure.confidence = 'medium';
        } else {
            result.structure.confidence = 'low';
            result.warnings.push('Low confidence in data structure format');
        }

        return result;
    }

    logDataStructureValidation(data, validation, context = 'unknown', logLevel = 'debug') {
        const logData = {
            context,
            validation: {
                isValid: validation.isValid,
                format: validation.structure.format,
                confidence: validation.structure.confidence,
                extractableUsername: validation.structure.extractableUsername
            },
            dataKeys: data ? Object.keys(data) : null
        };

        if (validation.isValid) {
            logger[logLevel](`[DisplayQueue] Data structure validation PASSED for ${context}`, 'display-queue', logData);
        } else {
            logger.warn(`[DisplayQueue] Data structure validation FAILED for ${context}`, 'display-queue', {
                ...logData,
                errors: validation.errors,
                warnings: validation.warnings,
                suggestions: validation.suggestions
            });
        }

        // Log suggestions for improvement
        if (validation.suggestions.length > 0) {
            logger.info(`[DisplayQueue] Data structure suggestions for ${context}:`, 'display-queue', {
                suggestions: validation.suggestions
            });
        }
    }

    debugDataStructure(data, context) {
        // Only run in development/test environments
        if (process.env.NODE_ENV === 'production') {
            return true; // Skip validation in production for performance
        }

        const validation = this.validateDataStructure(data, context);
        this.logDataStructureValidation(data, validation, context, 'debug');
        
        return validation.isValid;
    }

    // ============================================================================
    // Behavior-focused query methods for test standards
    // ============================================================================
    
    isItemDisplayedToUser(type) {
        try {
            // Handle chat type checking (includes lingering chat when no current display)
            if (isChatType(type)) {
                // Chat is displayed if current display is chat OR if there's lingering chat when queue is empty
                const isChatCurrentlyDisplayed = this.currentDisplay && isChatType(this.currentDisplay.type);
                const hasLingeringChat = !this.currentDisplay && this.queue.length === 0 && !!this.lastChatItem;
                const isChatDisplayed = isChatCurrentlyDisplayed || hasLingeringChat;
                
                logger.debug(`[DisplayQueue] Chat display check: ${isChatDisplayed} (current: ${this.currentDisplay?.type || 'none'}, hasLingering: ${hasLingeringChat})`, 'display-queue');
                return isChatDisplayed;
            }

            // For non-chat types, require an active current display
            if (!this.currentDisplay) {
                logger.debug(`[DisplayQueue] No current display - ${type} not visible to user`, 'display-queue');
                return false;
            }

            // Handle notification type checking
            if (isNotificationType(type)) {
                const isNotificationDisplayed = isNotificationType(this.currentDisplay.type);
                logger.debug(`[DisplayQueue] Notification display check: ${isNotificationDisplayed} (current: ${this.currentDisplay.type})`, 'display-queue');
                return isNotificationDisplayed;
            }

            // Check for exact type match
            const isExactMatch = this.currentDisplay.type === type;
            logger.debug(`[DisplayQueue] Exact type display check: ${isExactMatch} (current: ${this.currentDisplay.type}, requested: ${type})`, 'display-queue');
            return isExactMatch;

        } catch (error) {
            handleDisplayQueueError(`[DisplayQueue] Error checking if ${type} is displayed to user`, error, { type });
            return false;
        }
    }

    getCurrentDisplayContent() {
        try {
            // No display active
            if (!this.currentDisplay) {
                // Check for lingering chat when queue is empty
                if (this.queue.length === 0 && this.lastChatItem) {
                    return this._formatLingeringChatContent();
                }
                
                logger.debug('[DisplayQueue] No current display content - nothing visible to user', 'display-queue');
                return null;
            }

            // Format content based on display type
            if (isChatType(this.currentDisplay.type)) {
                return this._formatChatContent(this.currentDisplay);
            }

            if (isNotificationType(this.currentDisplay.type)) {
                return this._formatNotificationContent(this.currentDisplay);
            }

            // Generic content formatting
            return this._formatGenericContent(this.currentDisplay);

        } catch (error) {
            handleDisplayQueueError('[DisplayQueue] Error getting current display content', error);
            return null;
        }
    }

    // ============================================================================
    // PRIVATE HELPER METHODS FOR BEHAVIOR QUERY METHODS
    // ============================================================================

    _formatLingeringChatContent() {
        if (!this.lastChatItem) return null;

        const username = this.extractUsername(this.lastChatItem.data);
        const content = `${username}: ${this.lastChatItem.data.message}`;

        return {
            type: 'chat',
            content: content,
            username: username,
            platform: this.lastChatItem.platform || 'unknown',
            isTechnicalArtifactFree: this._isContentClean(content),
            isLingering: true
        };
    }

    _formatChatContent(displayItem) {
        const username = this.extractUsername(displayItem.data);
        const content = `${username}: ${displayItem.data.message}`;

        return {
            type: 'chat',
            content: content,
            username: username,
            platform: displayItem.platform || 'unknown',
            isTechnicalArtifactFree: this._isContentClean(content),
            isLingering: false
        };
    }

    _formatNotificationContent(displayItem) {
        const username = this.extractUsername(displayItem.data);
        const content = displayItem.data.displayMessage || `${username} ${displayItem.type}`;

        return {
            type: displayItem.type,
            content: content,
            username: username,
            platform: displayItem.platform || 'unknown',
            isTechnicalArtifactFree: this._isContentClean(content),
            notificationDetails: this._extractNotificationDetails(displayItem.data)
        };
    }

    _formatGenericContent(displayItem) {
        const username = this.extractUsername(displayItem.data);
        const content = displayItem.data.displayMessage || 
                       displayItem.data.message || 
                       `${username} ${displayItem.type}`;

        return {
            type: displayItem.type,
            content: content,
            username: username,
            platform: displayItem.platform || 'unknown',
            isTechnicalArtifactFree: this._isContentClean(content)
        };
    }

    _isContentClean(content) {
        if (!content || typeof content !== 'string') return false;

        // Check for common technical artifacts that users shouldn't see
        const technicalArtifacts = [
            'undefined',
            'null',
            '[object Object]',
            'NaN',
            'function',
            '{}',
            '[]',
            'Error:',
            'Exception:',
            'TypeError:',
            'ReferenceError:'
        ];

        const lowerContent = content.toLowerCase();
        return !technicalArtifacts.some(artifact => lowerContent.includes(artifact.toLowerCase()));
    }

    _extractNotificationDetails(data) {
        const details = {};

        // Extract monetary information
        if (data.amount !== undefined) details.amount = data.amount;
        if (data.currency) details.currency = data.currency;

        // Extract gift information
        if (data.giftType) details.giftType = data.giftType;
        if (data.giftCount) details.giftCount = data.giftCount;
        if (data.repeatCount) details.repeatCount = data.repeatCount;

        // Extract paid supporter information
        if (data.tier) details.tier = data.tier;
        if (data.months) details.months = data.months;

        return details;
    }

}

let displayQueueInstance = null;

function createDisplayQueue(obsManager, config = {}, constants = {}, eventBus = null, runtimeConstants = null) {
    return new DisplayQueue(obsManager, config, constants, eventBus, runtimeConstants);
}

function initializeDisplayQueue(obsManager, config = {}, constants = {}, eventBus = null, runtimeConstants = null) {
    if (!obsManager) {
        throw new Error('DisplayQueue requires OBSConnectionManager instance');
    }

    // In test environment, always create a new instance to ensure test isolation
    if (process.env.NODE_ENV === 'test') {
        displayQueueInstance = createDisplayQueue(obsManager, config, constants, eventBus, runtimeConstants);
        return displayQueueInstance;
    }

    if (!displayQueueInstance) {
        displayQueueInstance = createDisplayQueue(obsManager, config, constants, eventBus, runtimeConstants);
        logger.debug('Display Queue system initialized.');
    }
    return displayQueueInstance;
}

module.exports = {
    initializeDisplayQueue,
    DisplayQueue // Export class for testing
}; 
