import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import { NotificationBuilder } from '../utils/notification-builder';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { getAnonymousUsername } from '../utils/validation';
import { hasNotificationPriorityMapping, resolvePriorityForType } from '../core/notification-priority';
import type { DisplayQueueDependency, DisplayQueueVfxConfig, NotificationQueueItem } from '../interfaces/DisplayQueue';
import { createSyntheticGiftFromAggregated } from './aggregated-donation-transformer';
import { NotificationGate } from './notification-gate';
import { NotificationInputValidator } from './notification-input-validator';
import { NotificationPayloadBuilder } from './notification-payload-builder';

type NotificationRecord = Record<string, unknown>;

type LoggerLike = {
    debug: (message: unknown, source?: string, data?: unknown) => void;
    info: (message: unknown, source?: string, data?: unknown) => void;
    warn: (message: unknown, source?: string, data?: unknown) => void;
    error?: (message: unknown, source?: string, data?: unknown) => void;
};

type NotificationConfig = {
    priority?: number;
    settingKey?: string;
    commandKey?: string;
    logTemplate?: string;
} & NotificationRecord;

type NotificationConstants = {
    PRIORITY_LEVELS: Record<string, number>;
    NOTIFICATION_CONFIGS: Record<string, NotificationConfig>;
};

type NotificationRuntimeConfig = Record<string, Record<string, unknown>> & {
    general?: { debugEnabled?: boolean };
};

type VFXCommandServiceLike = {
    getVFXConfig?: (commandKey: string, message: string | null) => Promise<unknown> | unknown;
    executeCommand?: (command: string, context: NotificationRecord) => Promise<unknown> | unknown;
};

type UserTrackingServiceLike = {
    isFirstMessage: (userId: unknown, context: NotificationRecord) => boolean | Promise<boolean>;
};

type DonationSpamDetectorLike = {
    handleDonationSpam: (
        userId: unknown,
        username: unknown,
        perGiftAmount: number,
        giftType: unknown,
        giftCount: number,
        platform: string,
    ) => { shouldShow: boolean };
};

type ObsGoalsLike = {
    processDonationGoal: (...args: unknown[]) => unknown;
};

type PlatformErrorHandlerLike = {
    handleEventProcessingError: (error: Error, eventType: string, payload: unknown, context: string) => void;
    logOperationalError: (message: string, context: string, payload: unknown) => void;
};

type NotificationManagerDependencies = {
    logger?: LoggerLike;
    constants?: NotificationConstants;
    obsGoals?: ObsGoalsLike;
    eventBus?: unknown;
    config?: NotificationRuntimeConfig;
    vfxCommandService?: VFXCommandServiceLike;
    userTrackingService?: UserTrackingServiceLike;
    displayQueue?: DisplayQueueDependency;
    donationSpamDetector?: DonationSpamDetectorLike;
};

type AggregatedDonationInput = {
    platform: string;
    userId: string;
    username: string;
    giftTypes: string[];
    totalGifts: number;
    totalCoins: number;
    message: string;
};

function isRecord(value: unknown): value is NotificationRecord {
    return !!value && typeof value === 'object';
}

function getErrorMessage(error: unknown) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

function trimNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function hasStableGiftSpamIdentity(data: NotificationRecord): boolean {
    return !!trimNonEmptyString(data.userId) && !!trimNonEmptyString(data.username);
}

class NotificationManager extends EventEmitter {
    logger: LoggerLike;
    log: LoggerLike;
    platformLogger: LoggerLike;
    constants: NotificationConstants;
    obsGoals: ObsGoalsLike;
    eventBus: unknown;
    config: NotificationRuntimeConfig;
    vfxCommandService: VFXCommandServiceLike | undefined;
    userTrackingService: UserTrackingServiceLike | undefined;
    displayQueue: DisplayQueueDependency;
    donationSpamDetector: DonationSpamDetectorLike | undefined;
    PRIORITY_LEVELS: Record<string, number>;
    NOTIFICATION_CONFIGS: Record<string, NotificationConfig>;
    NotificationBuilder: typeof NotificationBuilder;
    inputValidator: NotificationInputValidator;
    notificationGate: NotificationGate;
    payloadBuilder: NotificationPayloadBuilder;
    processDonationGoal: (...args: unknown[]) => unknown;
    errorHandler: PlatformErrorHandlerLike | null;

    constructor(dependencies: NotificationManagerDependencies = {}) {
        super();
        
        if (!dependencies.logger) {
            throw new Error('NotificationManager requires logger dependency');
        }

        this.logger = dependencies.logger;

        this.log = this.logger;
        this.platformLogger = this.logger;
        if (!dependencies.constants) {
            throw new Error('NotificationManager requires constants dependency');
        }

        this.constants = dependencies.constants;
        const goalsDependency = dependencies.obsGoals;
        if (goalsDependency && typeof goalsDependency.processDonationGoal === 'function') {
            this.obsGoals = goalsDependency;
        } else {
            throw new Error('NotificationManager requires obsGoals dependency');
        }
        
        this.vfxCommandService = dependencies.vfxCommandService;
        this.userTrackingService = dependencies.userTrackingService;

        if (!dependencies.displayQueue) {
            throw new Error('NotificationManager requires displayQueue dependency');
        }
        this.displayQueue = dependencies.displayQueue;
        if (!dependencies.config || typeof dependencies.config !== 'object') {
            throw new Error('NotificationManager requires config dependency');
        }
        this.config = dependencies.config;

        this.eventBus = dependencies.eventBus;

        this.logger.debug('[NotificationManager] Initialized', 'notification-manager');
        
        this.donationSpamDetector = dependencies.donationSpamDetector;

        if (!this.eventBus) {
            throw new Error('NotificationManager requires EventBus dependency');
        }
        
        const { PRIORITY_LEVELS, NOTIFICATION_CONFIGS } = this.constants;
        this.PRIORITY_LEVELS = PRIORITY_LEVELS;
        this.NOTIFICATION_CONFIGS = NOTIFICATION_CONFIGS;
        this.NotificationBuilder = NotificationBuilder;
        this.inputValidator = new NotificationInputValidator(this.NOTIFICATION_CONFIGS);
        this.notificationGate = new NotificationGate(this.config);
        this.payloadBuilder = new NotificationPayloadBuilder({
            build: (input: NotificationRecord) => {
                const built = NotificationBuilder.build(input);
                if (!isRecord(built)) {
                    throw new Error('NotificationBuilder.build returned null');
                }
                return built;
            }
        });

        const { processDonationGoal } = this.obsGoals;
        this.processDonationGoal = processDonationGoal;

        this.errorHandler = null;
    }


    build(input: NotificationRecord) {
        return NotificationBuilder.build(input);
    }

    getPriorityForType(notificationType: string, config?: NotificationConfig) {
        if (config && typeof config.priority === 'number') {
            return config.priority;
        }

        if (!hasNotificationPriorityMapping(notificationType)) {
            throw new Error(`Missing priority mapping for ${notificationType}`);
        }

        const priority = resolvePriorityForType(notificationType, this.PRIORITY_LEVELS);
        if (typeof priority !== 'number') {
            throw new Error(`Missing priority level for ${notificationType}`);
        }
        return priority;
    }


    async handleAggregatedDonation(aggregatedData: AggregatedDonationInput) {
        try {
            this.logger.info(`[Aggregated] Processing aggregated donation from ${aggregatedData.username} on ${aggregatedData.platform}: ${aggregatedData.message}`, 'notification-manager');

            const syntheticGiftData = createSyntheticGiftFromAggregated(aggregatedData);

            await this.handleNotificationInternal('platform:gift', aggregatedData.platform, syntheticGiftData, true);

        } catch (error) {
            this._handleNotificationError(`Error handling aggregated donation: ${getErrorMessage(error)}`, error, { aggregatedData }, { eventType: 'aggregated-donation' });
        }
    }

    async handleNotification(notificationType: string, platform: unknown, data: unknown) {
        return this.handleNotificationInternal(notificationType, platform, data, false);
    }

    async handleNotificationInternal(notificationType: string, platform: unknown, data: unknown, skipSpamDetection: boolean) {
        const platformValidation = this.inputValidator.validatePlatform(platform);
        if (!platformValidation.success) {
            this.logger.warn(`[NotificationManager] Invalid platform: ${String(platform)}`, 'notification-manager', { notificationType, platform });
            return { success: false, error: platformValidation.error, notificationType, platform };
        }
        const platformName = platformValidation.canonicalPlatform;

        if (!this.notificationGate.hasConfigAccess()) {
            this.logger.warn(`[NotificationManager] No configuration access available, cannot process notification`, platformName, { notificationType, data });
            return { success: false, error: 'Configuration unavailable', notificationType, platform: platformName };
        }

        const dataValidation = this.inputValidator.validateData(data);
        if (!dataValidation.success) {
            this.logger.warn(`[NotificationManager] handleNotification called with invalid data`, platformName, { notificationType, data });
            return { success: false, error: dataValidation.error, notificationType, platform: platformName };
        }

        const typeValidation = this.inputValidator.validateType(notificationType, data);
        if (!typeValidation.success) {
            if (typeValidation.errorType === 'incoming-type-mismatch') {
                this._handleNotificationError(
                    `[NotificationManager] Incoming type mismatch: ${typeValidation.incomingType} vs ${typeValidation.canonicalType}`,
                    null,
                    { notificationType, platform: platformName },
                    { eventType: 'unknown-notification-type' }
                );
                return { success: false, error: typeValidation.error, notificationType, platform: platformName };
            }

            this._handleNotificationError(
                `[NotificationManager] Unknown notification type: ${notificationType}`,
                null,
                { notificationType, platform: platformName },
                { eventType: 'unknown-notification-type' }
            );
            return { success: false, error: typeValidation.error, notificationType, platform: platformName };
        }

        const canonicalType = typeValidation.canonicalType;
        const config = typeValidation.config as NotificationConfig;
        const isMonetizationType = typeValidation.isMonetizationType;
        const originalType = notificationType;
        notificationType = canonicalType;

        const normalizedData = this.payloadBuilder.normalizeData(data as NotificationRecord, isMonetizationType);
        const isErrorPayload = normalizedData.isError === true;

        if (isMonetizationType) {
            const payloadValidation = this.inputValidator.validateNotificationPayload(data as NotificationRecord, {
                notificationType,
                platform: platformName,
                requireTimestamp: false,
                requireUserId: false,
                requireEventId: false
            });
            if (!payloadValidation.success) {
                const errorMessage = payloadValidation.errorType === 'missing-username'
                    ? 'Missing username'
                    : payloadValidation.error;
                this._handleNotificationError(
                    `[NotificationManager] Invalid ${notificationType} payload: ${errorMessage}`,
                    null,
                    { notificationType, platform: platformName, data: normalizedData },
                    { eventType: payloadValidation.errorType }
                );
                return { success: false, error: errorMessage, notificationType, platform: platformName };
            }
            const { metadata: _metadata, ...validatedPayload } = payloadValidation.payload;
            Object.assign(normalizedData, validatedPayload);
        }
        
        if (typeof config.settingKey !== 'string') {
            throw new Error(`Notification config missing settingKey for ${notificationType}`);
        }
        const isEnabled = this.notificationGate.isEnabled(config.settingKey, platformName);
        
        if (!isEnabled) {
            this.logger.debug(`[${platformName}] ${notificationType} notifications disabled, skipping for ${normalizedData.username}`, 'notification-manager');
            return { success: false, error: 'Notifications disabled', notificationType, platform: platformName, disabled: true };
        }

        if (!isErrorPayload && notificationType === 'platform:gift' &&
            typeof normalizedData.amount === 'number' &&
            normalizedData.amount <= 0) {
            const currency = typeof normalizedData.currency === 'string' ? normalizedData.currency.trim().toLowerCase() : '';
            if (currency && currency !== 'coins' && currency !== 'bits') {
                this.logger.debug(`[${platformName}] ${notificationType} with zero amount filtered out for ${normalizedData.username}`, 'notification-manager');
                return { success: false, filtered: true, reason: 'Zero amount not displayed', notificationType, platform: platformName };
            }
        }

        if (normalizedData.userId !== undefined && normalizedData.userId !== null) {
            normalizedData.userId = String(normalizedData.userId);
        }

        const isAnonymousGift = notificationType === 'platform:gift' && normalizedData.isAnonymous === true;
        if (isAnonymousGift && !trimNonEmptyString(normalizedData.username)) {
            normalizedData.username = getAnonymousUsername();
        }

        if (notificationType === 'platform:gift' && this.donationSpamDetector && !skipSpamDetection && !normalizedData.isAggregated && !isErrorPayload) {
            if (!isAnonymousGift && hasStableGiftSpamIdentity(normalizedData)) {
                try {
                    if (!normalizedData.giftType || normalizedData.giftCount === undefined || normalizedData.amount === undefined) {
                        throw new Error('Gift spam detection requires giftType, giftCount, and amount');
                    }
                    const giftCount = Number(normalizedData.giftCount);
                    const amount = Number(normalizedData.amount);
                    if (!Number.isFinite(giftCount) || giftCount <= 0) {
                        throw new Error('Gift spam detection requires valid giftCount');
                    }
                    if (!Number.isFinite(amount)) {
                        throw new Error('Gift spam detection requires valid amount');
                    }
                    const perGiftAmount = amount / giftCount;
                    const spamResult = this.donationSpamDetector.handleDonationSpam(
                        normalizedData.userId,
                        normalizedData.username,
                        perGiftAmount,
                        normalizedData.giftType,
                        giftCount,
                        platformName
                    );

                    if (!spamResult.shouldShow) {
                        this.platformLogger.debug(`Spam gift suppressed from ${normalizedData.username}.`, platformName);
                        return {
                            success: false,
                            suppressed: true,
                            reason: 'spam_detection',
                            notificationType,
                            platform: platformName
                        };
                    }
                } catch (error) {
                    this.platformLogger.warn(`Error in spam detection: ${getErrorMessage(error)}`, platformName);
                }
            } else {
                this.platformLogger.debug('Gift spam detection skipped: stable donor identity is unavailable.', platformName);
            }
        }

        const username = (typeof normalizedData.username === 'string') ? normalizedData.username.trim() : '';
        if (!username && !isErrorPayload) {
            this._handleNotificationError(
                `[NotificationManager] ${notificationType} notification missing username`,
                null,
                { notificationType, platform: platformName, data: normalizedData },
                { eventType: 'notification-missing-username' }
            );
            return { success: false, error: 'Missing username', notificationType, platform: platformName };
        }
        if (username) {
            normalizedData.username = username;
        }

        if (this._isDebugEnabled()) {
            try {
                const logMessage = this.generateLogMessage(notificationType, normalizedData);
                this.platformLogger.info(logMessage, platformName);
            } catch (logError) {
                this.logger.warn(`[NotificationManager] Debug log failed: ${getErrorMessage(logError)}`, 'notification-manager');
            }
        }

        let vfxConfig: DisplayQueueVfxConfig | null = null;
        try {
            const vfxMessage = typeof normalizedData.message === 'string' ? normalizedData.message : null;
            const resolvedVfxConfig = await this._getVFXConfigFromService(config.commandKey, vfxMessage);
            vfxConfig = isRecord(resolvedVfxConfig) ? resolvedVfxConfig : null;
        } catch (vfxError) {
            this._handleNotificationError(
                `[NotificationManager] VFX config failed: ${getErrorMessage(vfxError)}`,
                vfxError,
                { commandKey: config.commandKey },
                { eventType: 'vfx-config' }
            );
        }

        let notificationData;
        try {
            const payload = this.payloadBuilder.buildPayload({
                canonicalType,
                platform: platformName,
                data: normalizedData,
                originalType,
                isMonetizationType,
                normalizedData
            });
            notificationData = payload.notificationData;
            
            if (!notificationData || typeof notificationData !== 'object') {
                throw new Error('NotificationBuilder.build() returned invalid data structure');
            }
            
            if (typeof notificationData.displayMessage !== 'string' || notificationData.displayMessage.length === 0) {
                throw new Error(`Missing displayMessage in notification data for ${notificationType}`);
            }
            if (!notificationData.ttsMessage) {
                this.logger.warn(`Missing ttsMessage in notification data for ${notificationType}`, 'notification-manager', notificationData);
            }
            
        } catch (error) {
            this._handleNotificationError(
                `Error creating notification data for ${notificationType} from ${platformName}: ${getErrorMessage(error)}`,
                error,
                { notificationType, platform: platformName, data: normalizedData },
                { eventType: 'notification-data-build' }
            );
            return { success: false, error: 'Notification build failed', notificationType, platform: platformName };
        }
        
        const priorityType = canonicalType;
        const displayType = notificationType;
        const appliedPriority = this.getPriorityForType(priorityType, config);
        
        const item: NotificationQueueItem = {
            type: displayType,
            data: {
                ...notificationData,
                displayMessage: notificationData.displayMessage
            },
            platform: platformName,
            priority: appliedPriority,
            vfxConfig: vfxConfig
        };
        
        if (!item.data || typeof item.data !== 'object') {
            this._handleNotificationError(
                `Invalid item data structure for ${notificationType} from ${platformName}`,
                null,
                { notificationType, platform: platformName, item },
                { eventType: 'notification-structure' }
            );
            return { success: false, error: 'Invalid data structure', details: 'item.data is not a valid object' };
        }
        
        try {
            this.displayQueue.addItem(item);
        } catch (error) {
            this._handleNotificationError(
                `Error in notification processing for ${notificationType} from ${platformName}: ${getErrorMessage(error)}`,
                error,
                { notificationType, platform: platformName, item, data: normalizedData },
                { eventType: 'display-queue' }
            );
            return { success: false, error: 'Display queue error', details: getErrorMessage(error) };
        }

        return {
            success: true,
            notificationType,
            platform: platformName,
            notificationData,
            priority: appliedPriority,
            vfxConfig
        };
    }

    async getVFXConfig(commandKey: string, message: string | null) {
        if (arguments.length < 2) {
            throw new Error('getVFXConfig requires message (use null when none)');
        }
        return await this._getVFXConfigFromService(commandKey, message);
    }


    generateLogMessage(notificationType: string, data: NotificationRecord) {
        const config = this.NOTIFICATION_CONFIGS[notificationType];
        if (!config) {
            throw new Error(`Unsupported notification type for log message: ${notificationType}`);
        }
        
        if (config.logTemplate) {
            return this.interpolateTemplate(config.logTemplate, data);
        }

        switch (notificationType) {
            case 'platform:gift': {
                if (!data.giftType || data.giftCount === undefined || data.amount === undefined || !data.currency) {
                    throw new Error('Gift log message requires giftType, giftCount, amount, and currency');
                }
                const giftCount = Number(data.giftCount);
                const giftType = data.giftType;
                const amount = Number(data.amount);
                const currency = String(data.currency).toLowerCase();
                if (currency === 'bits') {
                    return this.NotificationBuilder.formatBitsLogMessage({
                        username: data.username,
                        giftType,
                        amount
                    });
                }
                if (currency === 'coins') {
                    return `Gift from ${data.username}: ${giftCount}x ${giftType} (${amount} coins)`;
                }
                const formattedAmount = this.NotificationBuilder
                    ? this.NotificationBuilder.formatCurrency(amount, data.currency)
                    : `${amount} ${data.currency}`;
                return `Gift from ${data.username}: ${giftType} (${formattedAmount})`;
            }
            case 'platform:raid':
                if (data.viewerCount === undefined) {
                    throw new Error('Raid log message requires viewerCount');
                }
                return `Incoming raid from ${data.username} with ${data.viewerCount} viewers!`;
            default:
                throw new Error(`Unsupported notification type for log message: ${notificationType}`);
        }
    }

    interpolateTemplate(template: string, data: NotificationRecord) {
        return template.replace(/\{(\w+)\}/g, (_match: string, key: string) => {
            if (data[key] === undefined) {
                throw new Error(`Missing template value for ${key}`);
            }
            return String(data[key]);
        });
    }

    getStats() {
        return {
            supportedNotificationTypes: Object.keys(this.NOTIFICATION_CONFIGS),
            displayQueueLength: this.displayQueue.getQueueLength(),
            priorityLevels: Object.keys(this.PRIORITY_LEVELS)
        };
    }

    async handleGiftNotification(platform: unknown, data: unknown) {
        return await this.handleNotification('platform:gift', platform, data);
    }

    _isDebugEnabled() {
        return this.config.general?.debugEnabled === true;
    }

    async _isFirstMessage(userId: unknown, context: NotificationRecord = {}) {
        try {
            if (!this.userTrackingService) {
                throw new Error('UserTrackingService not available for first message check');
            }

            return this.userTrackingService.isFirstMessage(userId, context);
        } catch (error) {
            this._handleNotificationError(
                `[NotificationManager] Error checking first message: ${getErrorMessage(error)}`,
                error,
                { userId, context },
                { eventType: 'first-message-check' }
            );
            throw error;
        }
    }

    async _getVFXConfigFromService(commandKey: string | undefined, message: string | null) {
        try {
            if (!commandKey || typeof commandKey !== 'string') {
                throw new Error('VFX config lookup requires commandKey');
            }
            if (message !== null && typeof message !== 'string') {
                throw new Error('VFX config lookup requires message string or null');
            }
            if (this.vfxCommandService && typeof this.vfxCommandService.getVFXConfig === 'function') {
                const vfxConfig = await this.vfxCommandService.getVFXConfig(commandKey, message);
                this.logger.debug('[NotificationManager] VFX config received from VFXCommandService', 'notification-manager', vfxConfig);
                return vfxConfig;
            }

            throw new Error(`VFXCommandService not available for config lookup: ${commandKey}`);
        } catch (error) {
            this._handleNotificationError(
                `[NotificationManager] Error getting VFX config: ${getErrorMessage(error)}`,
                error,
                { commandKey, message },
                { eventType: 'vfx-config' }
            );
            throw error;
        }
    }

    async processVFXForNotification(vfxNotification: NotificationRecord) {
        try {
            this.logger.debug(`[NotificationManager] Processing VFX for ${vfxNotification.type}`, 'notification-manager');

            if (this.vfxCommandService && typeof vfxNotification.vfxCommand === 'string') {
                const username = typeof vfxNotification.username === 'string' ? vfxNotification.username.trim() : '';
                const platform = typeof vfxNotification.platform === 'string' ? vfxNotification.platform.trim().toLowerCase() : '';
                const userId = (vfxNotification.userId !== undefined && vfxNotification.userId !== null)
                    ? String(vfxNotification.userId).trim()
                    : '';

                if (!username || !platform || !userId) {
                    this.logger.warn('[NotificationManager] Skipping VFX execution due to incomplete context', 'notification-manager', {
                        hasUsername: !!username,
                        hasPlatform: !!platform,
                        hasUserId: !!userId,
                        type: vfxNotification.type
                    });
                    return;
                }

                const context = {
                    username,
                    platform,
                    userId,
                    skipCooldown: true,
                    correlationId: typeof vfxNotification.correlationId === 'string' && vfxNotification.correlationId.trim()
                        ? vfxNotification.correlationId.trim()
                        : randomUUID(),
                    type: vfxNotification.type
                };

                try {
                    if (typeof this.vfxCommandService.executeCommand !== 'function') {
                        throw new Error('VFXCommandService missing executeCommand');
                    }
                    await this.vfxCommandService.executeCommand(vfxNotification.vfxCommand, context);
                    
                } catch (vfxError) {
                    throw vfxError;
                }
            } else if (vfxNotification.vfxCommand) {
                this.logger.warn('[NotificationManager] No VFXCommandService available - VFX execution disabled');
            }

        } catch (error) {
            this._handleNotificationError(
                `[NotificationManager] Error processing VFX: ${getErrorMessage(error)}`,
                error,
                { vfxNotification },
                { eventType: 'vfx-processing' }
            );
        }
    }

    async processNotification(notification: NotificationRecord) {
        try {
            this.logger.debug(`[NotificationManager] Processing ${notification.type} notification`, 'notification-manager');

            if (typeof notification.platform !== 'string') {
                throw new Error(`Invalid platform type: ${typeof notification.platform}`);
            }
            const platform = notification.platform.toLowerCase();

            if (typeof notification.type !== 'string') {
                throw new Error(`Invalid notification type: ${String(notification.type)}`);
            }
            const notificationType = notification.type;
            const settingKey = this.NOTIFICATION_CONFIGS[notificationType]?.settingKey;
            if (!settingKey) {
                throw new Error(`Unsupported notification type: ${notificationType}`);
            }
            const isEnabled = this.notificationGate.isEnabled(settingKey, platform);
            if (!isEnabled) {
                this.logger.debug(`[NotificationManager] ${notificationType} notifications disabled`, 'notification-manager');
                return;
            }

            try {
                if (!notification.data) {
                    throw new Error('Notification processing requires notification.data');
                }
                await this.handleNotification(notificationType, platform, notification.data);
            } catch (handleError) {
                this.logger.warn(`[NotificationManager] handleNotification failed: ${getErrorMessage(handleError)} - continuing with minimal processing`);
            }

        } catch (error) {
            this._handleNotificationError(
                `[NotificationManager] Error processing notification: ${getErrorMessage(error)}`,
                error,
                { notification },
                { eventType: 'notification-processing' }
            );
        }
    }

    _handleNotificationError(message: string, error: unknown = null, payload: unknown = null, options: { context?: string; eventType?: string } = {}) {
        const { context = 'notification-manager', eventType = 'notification' } = options;

        if (!this.errorHandler && this.logger) {
            this.errorHandler = createPlatformErrorHandler(this.logger, 'notification-manager');
        }

        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, eventType, payload, context);
            return;
        }

        if (this.errorHandler) {
            this.errorHandler.logOperationalError(message, context, payload);
        }
    }
}

export { NotificationManager };
export default NotificationManager;
