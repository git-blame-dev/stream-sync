
const { extractAuthor } = require('./youtube-author-extractor');
const { extractMessageText } = require('./youtube-message-extractor');
const { YouTubeiCurrencyParser } = require('./youtubei-currency-parser');
const { validateLoggerInterface } = require('./dependency-validator');
const { createPlatformErrorHandler } = require('./platform-error-handler');
const { createMonetizationErrorPayload } = require('./monetization-error-utils');

class YouTubeNotificationDispatcher {
    constructor(dependencies = {}) {
        validateLoggerInterface(dependencies.logger);
        this.logger = dependencies.logger;
        this.platform = dependencies.platform;

        this.errorHandler = createPlatformErrorHandler(this.logger, 'youtube-notification-dispatcher');

        this.currencyParser = new YouTubeiCurrencyParser({
            logger: this.logger
        });
    }

    buildBasicNotification(chatItem, type, options = {}) {
        if (!chatItem || typeof chatItem !== 'object') {
            this.logger.warn(`Cannot build ${type} notification: invalid chatItem`);
            return null;
        }
        if (!chatItem.item || typeof chatItem.item !== 'object') {
            this.logger.warn(`Cannot build ${type} notification: missing chat item payload`);
            return null;
        }

        const author = options.author !== undefined ? options.author : extractAuthor(chatItem);
        if (!author) {
            this.logger.warn(`Cannot build ${type} notification: missing author`);
            return null;
        }
        const messageText = options.message !== undefined
            ? options.message
            : extractMessageText(chatItem.item.message);
        const notificationType = options.notificationType || type;
        const timestamp = this.extractTimestamp(chatItem);
        if (!timestamp) {
            this.logger.warn(`Cannot build ${type} notification: missing timestamp`);
            return null;
        }
        const id = this.extractNotificationId(chatItem);
        if (options.requireId && !id) {
            this.logger.warn(`Cannot build ${type} notification: missing id`);
            return null;
        }

        const notificationInput = {
            platform: 'youtube',
            type: notificationType,
            username: author.name,
            userId: author.id,
            message: messageText,
            timestamp,
            ...(id ? { id } : {}),
            ...(options.extraFields || {})
        };

        return notificationInput;
    }

    buildMonetizedNotification(chatItem, type, options = {}) {
        if (!chatItem || typeof chatItem !== 'object' || !chatItem.item || typeof chatItem.item !== 'object') {
            this.logger.warn(`Missing chat item payload for ${type} notification`);
            return null;
        }
        const purchaseAmount = chatItem.item.purchase_amount;

        if (!purchaseAmount || typeof purchaseAmount !== 'string') {
            this.logger.warn(`Missing purchase_amount in ${type} notification`);
            return null;
        }

        const currencyResult = this.currencyParser.parse(purchaseAmount);

        if (!currencyResult.success || !this.isValidAmount(currencyResult.amount)) {
            this.logger.warn('Invalid currency or amount', {
                purchaseAmount,
                parsed: currencyResult
            });
            return null;
        }

        return this.buildBasicNotification(chatItem, type, {
            ...options,
            extraFields: {
                ...(options.extraFields || {}),
                amount: currencyResult.amount,
                currency: currencyResult.currency
            }
        });
    }

    buildErrorNotification(chatItem, notificationType, overrides = {}) {
        const timestamp = this.extractTimestamp(chatItem);
        if (!timestamp) {
            this.logger.warn(`Cannot build ${notificationType} error notification: missing timestamp`);
            return null;
        }
        const id = this.extractNotificationId(chatItem);
        const author = extractAuthor(chatItem);
        const authorOverrides = author ? { username: author.name, userId: author.id } : {};
        return createMonetizationErrorPayload({
            notificationType,
            platform: 'youtube',
            timestamp,
            id: id || undefined,
            eventType: notificationType,
            ...authorOverrides,
            ...overrides
        });
    }

    async dispatchToHandler(notification, handler, handlerName) {
        if (!notification) {
            return false;
        }

        if (typeof handler === 'function') {
            await handler(notification);
            return true;
        }

        this.logger.warn(`Handler ${handlerName} not available for ${notification.type} notification`);
        return false;
    }

    async dispatchErrorNotification(chatItem, notificationType, handler, handlerName, overrides = {}) {
        const errorNotification = this.buildErrorNotification(chatItem, notificationType, overrides);
        if (this.platform && typeof this.platform._emitPlatformEvent === 'function') {
            this.platform._emitPlatformEvent(notificationType, errorNotification);
            return true;
        }
        return this.dispatchToHandler(errorNotification, handler, handlerName);
    }

    resolveHandler(handlers, handlerName) {
        if (!handlers || typeof handlers !== 'object') {
            return undefined;
        }
        return handlers[handlerName];
    }

    extractStructuredText(field) {
        if (!field) {
            return '';
        }

        if (Array.isArray(field.runs)) {
            return field.runs.map(run => run.text || '').join('').trim();
        }

        return (field.simpleText || field.text || '').trim();
    }

    parseGiftPurchaseHeader(headerText) {
        if (!headerText || typeof headerText !== 'string') {
            return { count: null };
        }

        const numberMatch = headerText.match(/(\d+)/);
        const count = numberMatch ? parseInt(numberMatch[1], 10) : null;
        return { count: Number.isFinite(count) ? count : null };
    }

    async dispatchSuperChat(chatItem, handlers) {
        try {
            const notification = this.buildMonetizedNotification(chatItem, 'platform:gift', {
                notificationType: 'platform:gift',
                requireId: true,
                extraFields: {
                    giftType: 'Super Chat',
                    giftCount: 1,
                    isSuperChat: true
                }
            });
            if (!notification) {
                const giftHandler = this.resolveHandler(handlers, 'onGift');
                return await this.dispatchErrorNotification(chatItem, 'platform:gift', giftHandler, 'onGift', {
                    giftType: 'Super Chat',
                    giftCount: 1
                });
            }
            const giftHandler = this.resolveHandler(handlers, 'onGift');
            return await this.dispatchToHandler(notification, giftHandler, 'onGift');

        } catch (error) {
            this.errorHandler.handleEventProcessingError(
                error,
                'dispatchSuperChat',
                chatItem,
                'Error dispatching SuperChat notification',
                'youtube-notification-dispatcher'
            );
            return false;
        }
    }

    async dispatchSuperSticker(chatItem, handlers) {
        try {
            if (!chatItem || typeof chatItem !== 'object' || !chatItem.item || typeof chatItem.item !== 'object') {
                this.logger.warn('Missing chat item payload for supersticker notification');
                return await this.dispatchErrorNotification(chatItem, 'platform:gift', undefined, 'onGift', {
                    giftType: 'Super Sticker',
                    giftCount: 1
                });
            }
            const sticker = chatItem.item.sticker;
            const stickerDescription = sticker
                ? (sticker.name || sticker.altText || this.extractStructuredText(sticker.label))
                : '';

            const notification = this.buildMonetizedNotification(chatItem, 'platform:gift', {
                message: stickerDescription || '',
                notificationType: 'platform:gift',
                requireId: true,
                extraFields: {
                    giftType: 'Super Sticker',
                    giftCount: 1,
                    ...(stickerDescription ? { sticker: stickerDescription } : {})
                }
            });

            if (!notification) {
                const giftHandler = this.resolveHandler(handlers, 'onGift');
                return await this.dispatchErrorNotification(chatItem, 'platform:gift', giftHandler, 'onGift', {
                    giftType: 'Super Sticker',
                    giftCount: 1
                });
            }
            const giftHandler = this.resolveHandler(handlers, 'onGift');
            return await this.dispatchToHandler(notification, giftHandler, 'onGift');
        } catch (error) {
            this.errorHandler.handleEventProcessingError(
                error,
                'dispatchSuperSticker',
                chatItem,
                'Error dispatching supersticker notification',
                'youtube-notification-dispatcher'
            );
            return false;
        }
    }

    async dispatchMembership(chatItem, handlers) {
        try {
            if (!chatItem || typeof chatItem !== 'object' || !chatItem.item || typeof chatItem.item !== 'object') {
                this.logger.warn('Missing chat item payload for membership notification');
                return await this.dispatchErrorNotification(chatItem, 'platform:paypiggy', undefined, 'onMembership');
            }
            const membershipLevel = this.extractStructuredText(chatItem.item.headerPrimaryText);
            const membershipMessage = this.extractStructuredText(chatItem.item.headerSubtext) ||
                extractMessageText(chatItem.item.message);

            const membershipMonths = chatItem.item.memberMilestoneDurationInMonths;

            const notification = this.buildBasicNotification(chatItem, 'platform:paypiggy', {
                message: membershipMessage,
                extraFields: {
                    membershipLevel: membershipLevel || undefined,
                    months: membershipMonths || undefined
                }
            });

            if (!notification) {
                const resolvedMonths = Number.isFinite(Number(membershipMonths)) ? membershipMonths : undefined;
                const membershipHandler = this.resolveHandler(handlers, 'onMembership');
                return await this.dispatchErrorNotification(chatItem, 'platform:paypiggy', membershipHandler, 'onMembership', {
                    months: resolvedMonths
                });
            }
            const membershipHandler = this.resolveHandler(handlers, 'onMembership');
            return await this.dispatchToHandler(notification, membershipHandler, 'onMembership');
        } catch (error) {
            this.errorHandler.handleEventProcessingError(
                error,
                'dispatchMembership',
                chatItem,
                'Error dispatching membership notification',
                'youtube-notification-dispatcher'
            );
            return false;
        }
    }

    async dispatchGiftMembership(chatItem, handlers) {
        try {
            if (!chatItem || typeof chatItem !== 'object' || !chatItem.item || typeof chatItem.item !== 'object') {
                this.logger.warn('Missing chat item payload for gift membership notification');
                return await this.dispatchErrorNotification(chatItem, 'platform:giftpaypiggy', undefined, 'onGiftPaypiggy');
            }
            const giftCount = chatItem.item.giftMembershipsCount;
            if (typeof giftCount !== 'number' || !Number.isFinite(giftCount)) {
                this.logger.warn('Missing giftMembershipsCount in gift membership notification');
                const giftHandler = this.resolveHandler(handlers, 'onGiftPaypiggy');
                return await this.dispatchErrorNotification(chatItem, 'platform:giftpaypiggy', giftHandler, 'onGiftPaypiggy');
            }
            const giftMessage = extractMessageText(chatItem.item.message);

            const notification = this.buildBasicNotification(chatItem, 'platform:giftpaypiggy', {
                message: giftMessage,
                extraFields: {
                    giftCount
                }
            });

            if (!notification) {
                const resolvedGiftCount = Number.isFinite(Number(giftCount)) ? giftCount : undefined;
                const giftHandler = this.resolveHandler(handlers, 'onGiftPaypiggy');
                return await this.dispatchErrorNotification(chatItem, 'platform:giftpaypiggy', giftHandler, 'onGiftPaypiggy', {
                    giftCount: resolvedGiftCount
                });
            }
            const giftHandler = this.resolveHandler(handlers, 'onGiftPaypiggy');
            return await this.dispatchToHandler(notification, giftHandler, 'onGiftPaypiggy');
        } catch (error) {
            this.errorHandler.handleEventProcessingError(
                error,
                'dispatchGiftMembership',
                chatItem,
                'Error dispatching gift membership notification',
                'youtube-notification-dispatcher'
            );
            return false;
        }
    }

    isValidAmount(amount) {
        return typeof amount === 'number' &&
               !isNaN(amount) &&
               isFinite(amount) &&
               amount > 0;
    }

    extractNotificationId(chatItem) {
        if (!chatItem || typeof chatItem !== 'object' || !chatItem.item || typeof chatItem.item !== 'object') {
            return null;
        }
        const rawId = chatItem.item.id;
        if (rawId === undefined || rawId === null) {
            return null;
        }
        const id = String(rawId).trim();
        return id ? id : null;
    }

    extractTimestamp(chatItem) {
        if (!chatItem || typeof chatItem !== 'object' || !chatItem.item || typeof chatItem.item !== 'object') {
            return null;
        }
        const rawTimestamp = chatItem.item.timestampUsec;
        if (rawTimestamp === undefined || rawTimestamp === null) {
            return null;
        }
        const numericTimestamp = typeof rawTimestamp === 'number' ? rawTimestamp : Number(rawTimestamp);
        if (!Number.isFinite(numericTimestamp)) {
            return null;
        }
        const adjustedTimestamp = numericTimestamp > 10000000000000
            ? Math.floor(numericTimestamp / 1000)
            : numericTimestamp;
        const parsed = new Date(adjustedTimestamp);
        if (Number.isNaN(parsed.getTime())) {
            return null;
        }
        return parsed.toISOString();
    }
}

module.exports = { YouTubeNotificationDispatcher };
