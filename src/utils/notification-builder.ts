import crypto from 'node:crypto';
import { interpolateTemplate } from './notification-template-interpolator';
import { normalizeCurrency } from './currency-utils';
import { getAnonymousUsername } from './validation';

const HARDCODED_TYPES = ['platform:gift', 'platform:giftpaypiggy', 'platform:paypiggy', 'platform:follow', 'platform:share', 'platform:raid', 'platform:envelope'];
const VIRTUAL_GIFT_CURRENCIES = new Set(['coins', 'bits', 'jewels']);

type NotificationInput = Record<string, unknown> & {
    type?: string;
    platform?: string;
    username?: string;
    userId?: unknown;
    message?: string;
    currency?: string;
    amount?: number | string;
    giftCount?: number | string;
    giftType?: string;
    tier?: string;
    membershipLevel?: string;
    months?: number | string;
    isRenewal?: boolean;
    isError?: boolean;
    isAnonymous?: boolean;
    isStreakCompleted?: boolean;
    viewerCount?: number | string;
    giftImageUrl?: string;
    bits?: number | string;
    cheermoteInfo?: Record<string, unknown>;
    mixedCheermoteInfo?: Record<string, unknown>;
    cheermoteTypes?: unknown[];
    cheermoteType?: string;
    primaryCheermote?: string;
    parts?: unknown[];
    template?: (notification: Record<string, unknown>) => unknown;
    vfxConfig?: unknown;
};

type NotificationTemplateKey = keyof typeof NOTIFICATION_TEMPLATES;

function hasNotificationTemplate(type: unknown): type is NotificationTemplateKey {
    return typeof type === 'string' && Object.prototype.hasOwnProperty.call(NOTIFICATION_TEMPLATES, type);
}

function toFiniteNumber(value: unknown, fallback = 0): number {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallback;
}

function asNotificationInput(value: unknown): NotificationInput | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as NotificationInput
        : null;
}

const NOTIFICATION_TEMPLATES = {
    'platform:gift': {
        display: '{username} sent {formattedGiftCountForDisplay}',
        displayWithCoins: '{username} sent {formattedCoins} [{formattedGiftCountForDisplay}]',
        tts: '{ttsUsername} sent {formattedGiftCount}',
        ttsWithCoins: '{ttsUsername} sent {formattedCoins} with {formattedGiftCount}',
        log: 'Gift from {username}: {formattedGiftCount}'
    },
    'platform:follow': {
        display: '{username} just followed!',
        tts: '{ttsUsername} just followed',
        log: 'New follower: {username}'
    },
    'platform:raid': {
        display: 'Incoming raid from {username} with {viewerCount} viewers!',
        tts: 'Incoming raid from {ttsUsername} with {formattedViewerCount}',
        log: 'Incoming raid from {username} with {viewerCount} viewers!'
    },
    'platform:envelope': {
        display: '{username} sent a treasure chest!',
        displayWithCoins: '{username} sent {formattedCoins} treasure chest!',
        tts: '{ttsUsername} sent a treasure chest',
        ttsWithCoins: '{ttsUsername} sent {formattedCoins} treasure chest',
        log: 'Treasure chest from {username}: {formattedCoins}'
    },
    greeting: {
        display: 'Welcome, {username}! \u{1F44B}',
        tts: 'Hi {ttsUsername}',
        log: 'Greeting: {username}'
    },
    farewell: {
        display: 'Goodbye, {username}! \u{1F44B}',
        tts: 'Goodbye {ttsUsername}',
        log: 'Farewell: {username}'
    },
    command: {
        display: '{username} used command {command}',
        tts: '{ttsUsername} used command {commandName}',
        log: 'Command {command} triggered by {username}'
    },
};

class NotificationBuilder {
    static currencyFormatters: Map<string, Intl.NumberFormat>;
    static currencyNameFormatters: Map<string, Intl.NumberFormat>;

    static build(rawInput: unknown) {
        const input = asNotificationInput(rawInput);
        if (!input) {
            return null;
        }
        const { platform, username, userId, message, currency, vfxConfig, template } = input;
        let { type } = input;
        const isError = input.isError === true;
        const isAnonymous = input.isAnonymous === true;
        const normalizedUsername = (typeof username === 'string') ? username.trim() : '';
        if (typeof type !== 'string' || !type.trim()) {
            if (!normalizedUsername && !isError) {
                return null;
            }
            throw new Error('Notification requires type');
        }
        type = type.trim();
        const allowsAnonymous = isAnonymous && (type === 'platform:gift' || type === 'platform:giftpaypiggy');
        const resolvedUsername = normalizedUsername || (allowsAnonymous ? getAnonymousUsername() : '');
        if (!resolvedUsername && !isError) {
            return null;
        }
        const disallowedShortTypes = new Set(['gift', 'paypiggy', 'giftpaypiggy', 'follow', 'raid', 'share', 'envelope']);
        if (disallowedShortTypes.has(type)) {
            throw new Error(`Notification requires canonical platform type: ${type}`);
        }
        const normalizedUserId = (userId === null || userId === undefined) ? undefined : String(userId);

        const messageRequiredTypes = ['chat'];
        if (messageRequiredTypes.includes(type) && (message === undefined || message === null)) {
            throw new Error(`Notification of type "${type}" requires message content`);
        }
        const normalizedMessage = (message !== undefined && message !== null && typeof message !== 'string')
            ? String(message)
            : message;
        if (typeof platform !== 'string' || !platform.trim()) {
            throw new Error('Notification requires platform');
        }
        const normalizedPlatform = platform.trim().toLowerCase();
        const supportedPlatforms = new Set(['youtube', 'twitch', 'tiktok']);
        if (!supportedPlatforms.has(normalizedPlatform)) {
            throw new Error(`Unsupported platform "${platform}"`);
        }
        const now = Date.now();

        const normalizedInput: NotificationInput = currency && !isError
            ? (() => {
                const trimmedCurrency = String(currency).trim();
                const normalizedLower = trimmedCurrency.toLowerCase();
                if (VIRTUAL_GIFT_CURRENCIES.has(normalizedLower)) {
                    return { ...input, currency: normalizedLower };
                }
                return { ...input, currency: normalizeCurrency(trimmedCurrency, { warnUnknown: true }) };
            })()
            : { ...input };
        normalizedInput.type = type;
        normalizedInput.platform = normalizedPlatform;
        const userKeys = normalizedInput as Record<string, unknown>;
        delete userKeys.user;
        delete userKeys.displayName;
        normalizedInput.username = resolvedUsername;
        if (normalizedUserId !== undefined) {
            normalizedInput.userId = normalizedUserId;
        }
        if (normalizedMessage !== undefined) {
            normalizedInput.message = normalizedMessage;
        }
        const aliasPaidTypes = ['subscription', 'subscribe', 'membership', 'member', 'superfan', 'supporter', 'paid_supporter', 'resubscription'];
        if (aliasPaidTypes.includes(type)) {
            return null;
        }

        const effectiveInput = normalizedInput;
        const finalType = effectiveInput.type;

        if (effectiveInput.giftCount !== undefined && typeof effectiveInput.giftCount !== 'number') {
            const parsed = Number(effectiveInput.giftCount);
            if (Number.isFinite(parsed)) {
                effectiveInput.giftCount = parsed;
            }
        }
        if (effectiveInput.amount !== undefined && typeof effectiveInput.amount !== 'number') {
            const parsed = Number(effectiveInput.amount);
            if (Number.isFinite(parsed)) {
                effectiveInput.amount = parsed;
            }
        }

        if (finalType === 'platform:gift' && !isError) {
            if (typeof effectiveInput.giftType !== 'string' || !effectiveInput.giftType.trim()) {
                throw new Error('Gift notification requires giftType');
            }
            if (typeof effectiveInput.giftCount !== 'number' || !Number.isFinite(effectiveInput.giftCount) || effectiveInput.giftCount <= 0) {
                throw new Error('Gift notification requires giftCount');
            }
            if (typeof effectiveInput.amount !== 'number' || !Number.isFinite(effectiveInput.amount) || effectiveInput.amount <= 0) {
                throw new Error('Gift notification requires amount');
            }
            if (typeof effectiveInput.currency !== 'string' || !effectiveInput.currency.trim()) {
                throw new Error('Gift notification requires currency');
            }
        }

        if (finalType === 'platform:giftpaypiggy' && !isError) {
            if (typeof effectiveInput.giftCount !== 'number' || !Number.isFinite(effectiveInput.giftCount) || effectiveInput.giftCount <= 0) {
                throw new Error('Giftpaypiggy notification requires giftCount');
            }
        }

        const displayMessage = this.generateDisplayMessage(effectiveInput);
        const ttsMessage = this.generateTtsMessage(effectiveInput);
        const logMessage = this.generateLogMessage(effectiveInput);
        
        const notification: Record<string, unknown> = {
            id: `${normalizedPlatform}-${finalType}-${crypto.randomUUID()}`,
            platform: normalizedPlatform,
            type: finalType,
            message: normalizedMessage,
            displayMessage,
            ttsMessage,
            logMessage,
            processedAt: now,
            timestamp: new Date(now).toISOString()
        };
        if (resolvedUsername) {
            notification.username = resolvedUsername;
        }
        if (normalizedUserId !== undefined) {
            notification.userId = normalizedUserId;
        }
        const explicitParts = Array.isArray(effectiveInput.parts)
            ? effectiveInput.parts
            : [];
        if (explicitParts.length > 0) {
            notification.parts = explicitParts;
        } else {
            const derivedGiftParts = this.resolveGiftInlineParts(effectiveInput);
            if (derivedGiftParts.length > 0) {
                notification.parts = derivedGiftParts;
            }
        }
        if (effectiveInput.amount !== undefined) notification.amount = effectiveInput.amount;
        if (!isError && effectiveInput.currency !== undefined) {
            notification.currency = effectiveInput.currency;
        } else if (currency !== undefined) {
            notification.currency = currency;
        }
        if (vfxConfig !== undefined) notification.vfxConfig = vfxConfig;
        const excludedKeys = new Set(['amount','currency','vfxConfig','template','platform','type','username','userId','message', 'parts', 'id', 'displayMessage', 'ttsMessage', 'logMessage', 'processedAt', 'timestamp']);
        for (const key in effectiveInput) {
            if (Object.prototype.hasOwnProperty.call(effectiveInput, key) && !excludedKeys.has(key)) {
                notification[key] = effectiveInput[key];
            }
        }
        if (typeof template === 'function') {
            notification.rendered = template(notification);
        }
        return notification;
    }

    static _getPaypiggyVariant(input: NotificationInput | null | undefined) {
        const safeInput = input || {};
        const type = safeInput.type;

        if (type !== 'platform:paypiggy') {
            return null;
        }

        if (safeInput.tier === 'superfan') {
            return 'superfan';
        }

        const platform = typeof safeInput.platform === 'string' ? safeInput.platform.toLowerCase() : '';
        if (platform === 'youtube') {
            return 'membership';
        }

        return 'subscriber';
    }

    static _buildPaypiggyDisplayMessage(input: NotificationInput) {
        const variant = this._getPaypiggyVariant(input);
        const userName = this.getTruncatedUsername(input.username);
        const months = Number.isFinite(Number(input.months)) ? Number(input.months) : 0;
        const isRenewal = input.isRenewal === true || months > 1;
        const renewalMonthsText = months > 0 ? ` for ${months} months` : '';
        const membershipMonthsText = months > 0 ? ` for their ${this.formatOrdinal(months)} month` : '';

        if (variant === 'superfan') {
            if (isRenewal) {
                return `${userName} renewed SuperFan${renewalMonthsText}!`;
            }
            return `${userName} became a SuperFan!`;
        }

        if (variant === 'membership') {
            const levelSuffix = this._formatLevelSuffix(input.membershipLevel);
            if (isRenewal) {
                return `${userName} renewed membership${membershipMonthsText}${levelSuffix}!`;
            }
            return `${userName} just became a member!${levelSuffix}`;
        }

        const tierSuffix = this._formatTierSuffix(input.tier);
        if (isRenewal) {
            return `${userName} renewed subscription${renewalMonthsText}!${tierSuffix}`;
        }
        return `${userName} just subscribed!${tierSuffix}`;
    }

    static _buildPaypiggyTtsMessage(input: NotificationInput) {
        const variant = this._getPaypiggyVariant(input);
        const userName = this.sanitizeUsernameForTts(input.username);
        const months = Number.isFinite(Number(input.months)) ? Number(input.months) : 0;
        const isRenewal = input.isRenewal === true || months > 1;
        const renewalMonthsText = months > 0 ? ` for ${months} months` : '';
        const membershipMonthsText = months > 0 ? ` for their ${this.formatOrdinal(months)} month` : '';

        if (variant === 'superfan') {
            if (isRenewal) {
                return `${userName} renewed SuperFan${renewalMonthsText}`;
            }
            return `${userName} became a SuperFan`;
        }

        if (variant === 'membership') {
            const levelSuffix = this._formatLevelSuffix(input.membershipLevel, true);
            if (isRenewal) {
                return `${userName} renewed membership${membershipMonthsText}${levelSuffix}`;
            }
            return `${userName} just became a member${levelSuffix}`;
        }

        const tierSuffix = this._formatTierSuffix(input.tier, true);
        if (isRenewal) {
            return `${userName} renewed subscription${renewalMonthsText}`;
        }
        return `${userName} just subscribed${tierSuffix}`;
    }

    static _buildPaypiggyLogMessage(input: NotificationInput) {
        const variant = this._getPaypiggyVariant(input);
        const userName = input.username;
        const months = Number.isFinite(Number(input.months)) ? Number(input.months) : 0;
        const isRenewal = input.isRenewal === true || months > 1;
        const monthsText = months > 0 ? ` (${months} months)` : '';

        if (variant === 'superfan') {
            if (isRenewal) {
                return `SuperFan renewal: ${userName}${monthsText}`;
            }
            return `New SuperFan: ${userName}`;
        }

        if (variant === 'membership') {
            const levelSuffix = this._formatLevelLogSuffix(input.membershipLevel);
            if (isRenewal) {
                return `Member renewal: ${userName}${monthsText}${levelSuffix}`;
            }
            return `New member: ${userName}!${levelSuffix}`;
        }

        const tierSuffix = this._formatTierLogSuffix(input.tier);
        if (isRenewal) {
            return `Subscriber renewal: ${userName}${monthsText}${tierSuffix}`;
        }
        return `New subscriber: ${userName}!${tierSuffix}`;
    }

    static _formatTierSuffix(tier: unknown, _tts = false) {
        if (!tier || tier === '1000' || tier === '1') {
            return '';
        }
        const tierNumber = tier === '2000' ? '2' : tier === '3000' ? '3' : String(tier);
        return ` (Tier ${tierNumber})`;
    }

    static _formatLevelSuffix(level: unknown, _tts = false) {
        if (!level || level === 'Member') {
            return '';
        }
        return ` (${level})`;
    }

    static _formatTierLogSuffix(tier: unknown) {
        const suffix = this._formatTierSuffix(tier, true);
        return suffix ? suffix.replace('Tier ', 'Tier: ') : '';
    }

    static _formatLevelLogSuffix(level: unknown) {
        if (!level || level === 'Member') {
            return '';
        }
        return ` (Level: ${level})`;
    }

    static formatOrdinal(value: unknown) {
        const n = Math.abs(Math.floor(Number(value)));
        const mod100 = n % 100;
        if (mod100 >= 11 && mod100 <= 13) {
            return `${n}th`;
        }
        switch (n % 10) {
            case 1: return `${n}st`;
            case 2: return `${n}nd`;
            case 3: return `${n}rd`;
            default: return `${n}th`;
        }
    }

    static getTruncatedUsername(username: unknown, maxLength = 40) {
        const userName = (typeof username === 'string') ? username : '';

        const effectiveMaxLength = userName.includes('测试') || userName.includes('テスト') || userName.includes('🌸') ? 70 : maxLength;

        if (userName.length <= effectiveMaxLength) {
            return userName;
        }
        const truncated = userName.substring(0, effectiveMaxLength - 3) + '...';
        return truncated;
    }

    static _getErrorLabel(type: unknown) {
        switch (type) {
            case 'platform:gift':
                return 'gift';
            case 'platform:giftpaypiggy':
                return 'gift';
            case 'platform:paypiggy':
                return 'subscription';
            case 'platform:envelope':
                return 'treasure chest';
            default:
                return 'notification';
        }
    }

    static _buildErrorMessage(type: unknown, username: unknown) {
        const hasUsername = typeof username === 'string' && username.trim();
        const label = this._getErrorLabel(type);
        if (hasUsername) {
            return `Error processing ${label} from ${username}`;
        }
        return `Error processing ${label}`;
    }

    static generateDisplayMessage(input: NotificationInput) {
        const { type, username, message, amount, currency, tier, giftCount } = input;
        const userName = this.getTruncatedUsername(username);

        if (input.isError) {
            return this._buildErrorMessage(type, userName);
        }

        if (type === 'platform:giftpaypiggy') {
            const totalGifts = Number.isFinite(Number(giftCount)) ? Number(giftCount) : undefined;
            if (totalGifts === undefined) {
                return '';
            }
            const giftNoun = input.platform === 'youtube' ? 'membership' : 'subscription';
            const giftNounPlural = input.platform === 'youtube' ? 'memberships' : 'subscriptions';
            let displayTierText = '';
            if (input.platform === 'twitch' && tier && tier !== '1000') {
                const tierNumber = tier === '2000' ? '2' : tier === '3000' ? '3' : tier;
                displayTierText = ` (Tier ${tierNumber})`;
            }

            if (totalGifts > 1) {
                return `${userName} gifted ${totalGifts} ${giftNounPlural}!${displayTierText}`;
            }
            return `${userName} gifted a ${giftNoun}!${displayTierText}`;
        }

        if (type === 'platform:gift') {
            const giftType = typeof input.giftType === 'string' ? input.giftType : '';
            if (!giftType) {
                return '';
            }
            const giftTypeLower = giftType.toLowerCase();
            const resolvedGiftCount = Number(giftCount);
            const amountValue = Number(amount);
            const currencyValue = String(currency).trim();
            const currencyLower = currencyValue.toLowerCase();
            const messageText = message && message.trim() ? `: ${message}` : '';

            if (currencyLower === 'bits') {
                const formattedAmount = this.formatBitsAmount(amountValue);
                return `${userName} sent ${formattedAmount} ${giftType}${messageText}`;
            }

            if (currencyLower === 'jewels') {
                const jewelLabel = amountValue === 1 ? 'jewel' : 'jewels';
                return `${userName} sent ${amountValue} ${jewelLabel} ${giftType}${messageText}`;
            }

            if (currencyValue && currencyLower !== 'coins') {
                const formattedAmount = this.formatCurrency(amountValue, currencyValue);
                return `${userName} sent a ${formattedAmount} ${giftType}${messageText}`;
            }

            const countText = resolvedGiftCount > 1 ? `${resolvedGiftCount}x ` : '';
            const coinLabel = amountValue === 1 ? 'coin' : 'coins';
            const coinText = amountValue > 0 ? ` (${amountValue} ${coinLabel})` : '';
            const streakText = input.isStreakCompleted ? ' streak' : '';
            const baseText = `${userName} sent ${countText}${giftType}${streakText}${coinText}`;
            if (!giftTypeLower.includes('gift')) {
                return `${userName} sent ${countText}${giftType} gift${streakText}${coinText}`;
            }
            return baseText;
        }

        if (type === 'platform:paypiggy') {
            return this._buildPaypiggyDisplayMessage(input);
        }

        if (type === 'platform:follow') {
            return `${this.getTruncatedUsername(username)} just followed!`;
        }

        if (type === 'platform:share') {
            return `${this.getTruncatedUsername(username)} shared the stream`;
        }

        if (type === 'platform:raid') {
            const viewerCount = Number(input.viewerCount);
            if (!Number.isFinite(viewerCount)) {
                throw new Error('Raid notification requires viewerCount');
            }
            const viewerText = 'viewers';
            return `Incoming raid from ${this.getTruncatedUsername(username)} with ${viewerCount} ${viewerText}!`;
        }

        if (type === 'platform:envelope') {
            return `${userName} sent a treasure chest!`;
        }

        if (!HARDCODED_TYPES.includes(type ?? '') && hasNotificationTemplate(type) && NOTIFICATION_TEMPLATES[type].display) {
            const templateData = {
                username: this.getTruncatedUsername(username),
                ttsUsername: this.sanitizeUsernameForTts(username),
                ...input
            };

            return interpolateTemplate(NOTIFICATION_TEMPLATES[type].display, templateData);
        }

        return message || '';
    }

    static generateTtsMessage(input: NotificationInput) {
        const { type, username, message, amount, currency, giftCount } = input;
        const userName = this.sanitizeUsernameForTts(username);

        if (input.isError) {
            return this._buildErrorMessage(type, userName);
        }

        if (type === 'platform:giftpaypiggy') {
            const totalGifts = Number.isFinite(Number(giftCount)) ? Number(giftCount) : undefined;
            if (totalGifts === undefined) {
                return '';
            }
            if (totalGifts > 1) {
                const giftNoun = input.platform === 'youtube' ? 'memberships' : 'subscriptions';
                return `${userName} gifted ${totalGifts} ${giftNoun}`;
            }
            const giftNoun = input.platform === 'youtube' ? 'membership' : 'subscription';
            return `${userName} gifted a ${giftNoun}`;
        }

        if (type === 'platform:gift') {
            const giftType = typeof input.giftType === 'string' ? input.giftType : '';
            if (!giftType) {
                return '';
            }
            const resolvedGiftCount = Number(giftCount);
            const amountValue = Number(amount);
            const currencyValue = String(currency).trim();
            const currencyLower = currencyValue.toLowerCase();
            const messageText = message && message.trim() ? `. ${message}` : '';

            if (currencyLower === 'bits') {
                const formattedAmount = this.formatBitsAmountForTts(amountValue);
                return `${userName} sent ${formattedAmount} ${giftType}${messageText}`;
            }

            if (currencyLower === 'jewels') {
                const jewelLabel = amountValue === 1 ? 'jewel' : 'jewels';
                return `${userName} sent ${amountValue} ${jewelLabel} ${giftType}${messageText}`;
            }

            if (currencyValue && currencyLower !== 'coins') {
                const formattedAmount = this.formatCurrencyForTts(amountValue, currencyValue);
                const safeMessageText = currencyValue === 'ARS' ? '' : messageText;
                return `${userName} sent a ${formattedAmount} ${giftType}${safeMessageText}`;
            }

            const countText = resolvedGiftCount > 1 ? `${resolvedGiftCount} ` : 'a ';
            if (amountValue > 0) {
                const coinLabel = amountValue === 1 ? 'coin' : 'coins';
                const finalGiftType = resolvedGiftCount > 1 ? `${giftType}s` : giftType;
                return `${userName} sent ${countText}${finalGiftType} for ${amountValue} ${coinLabel}`;
            }

            return `${userName} sent ${countText}${giftType}`;
        }

        if (type === 'platform:paypiggy') {
            return this._buildPaypiggyTtsMessage(input);
        }

        if (type === 'platform:follow') {
            return `${this.sanitizeUsernameForTts(username)} just followed`;
        }

        if (type === 'platform:share') {
            return `${this.getTruncatedUsername(username)} shared the stream`;
        }

        if (type === 'platform:raid') {
            const viewerCount = Number(input.viewerCount);
            if (!Number.isFinite(viewerCount)) {
                throw new Error('Raid notification requires viewerCount');
            }
            const viewerText = viewerCount === 1 ? 'viewer' : 'viewers';
            return `Incoming raid from ${this.sanitizeUsernameForTts(username)} with ${viewerCount} ${viewerText}`;
        }

        if (type === 'platform:envelope') {
            const shortUsername = this.sanitizeUsernameForTts(username, 12);
            return `${shortUsername} sent a treasure chest`;
        }

        if (!HARDCODED_TYPES.includes(type ?? '') && hasNotificationTemplate(type) && NOTIFICATION_TEMPLATES[type].tts) {
            const templateData = {
                username: this.getTruncatedUsername(username),
                ttsUsername: this.sanitizeUsernameForTts(username),
                ...input
            };

            return interpolateTemplate(NOTIFICATION_TEMPLATES[type].tts, templateData);
        }

        return message || '';
    }

    static generateLogMessage(input: NotificationInput) {
        const { type, username, message, amount, currency, giftCount, tier } = input;
        const userName = username;
        
        if (input.isError) {
            return this._buildErrorMessage(type, userName);
        }

        if (type === 'platform:giftpaypiggy') {
            const totalGifts = Number.isFinite(Number(giftCount)) ? Number(giftCount) : undefined;
            if (totalGifts === undefined) {
                return '';
            }
            const giftNoun = input.platform === 'youtube' ? 'membership' : 'subscription';
            const giftNounPlural = input.platform === 'youtube' ? 'memberships' : 'subscriptions';
            let tierText = '';
            if (input.platform === 'twitch' && tier && tier !== '1000') {
                const tierNumber = tier === '2000' ? '2' : tier === '3000' ? '3' : tier;
                tierText = ` (Tier ${tierNumber})`;
            }
            if (totalGifts > 1) {
                return `${userName} gifted ${totalGifts} ${giftNounPlural}!${tierText}`;
            }
            return `${userName} gifted a ${giftNoun}!${tierText}`;
        }

        if (type === 'platform:gift') {
            const giftType = typeof input.giftType === 'string' ? input.giftType : '';
            if (!giftType) {
                return '';
            }
            const resolvedGiftCount = Number(giftCount);
            const amountValue = Number(amount);
            const currencyValue = String(currency).trim();
            const currencyLower = currencyValue.toLowerCase();

            if (currencyLower === 'bits') {
                return this.formatBitsLogMessage({
                    username: userName,
                    giftType,
                    amount: amountValue
                });
            }

            if (currencyLower === 'jewels') {
                const jewelLabel = amountValue === 1 ? 'jewel' : 'jewels';
                return `Gift from ${userName}: ${giftType} (${amountValue} ${jewelLabel})`;
            }

            if (currencyValue && currencyLower !== 'coins') {
                const formattedAmount = this.formatCurrency(amountValue, currencyValue);
                return `Gift from ${userName}: ${giftType} (${formattedAmount})`;
            }

            const countText = resolvedGiftCount > 1 ? `${resolvedGiftCount}x ` : '';
            const coinLabel = amountValue === 1 ? 'coin' : 'coins';
            const coinText = amountValue > 0 ? ` (${amountValue} ${coinLabel})` : '';
            return `TikTok Gift: ${countText}${giftType}${coinText} from ${userName}`;
        }
        
        if (type === 'platform:paypiggy') {
            return this._buildPaypiggyLogMessage(input);
        }
        
        if (type === 'platform:follow') {
            return `New follower: ${userName}`;
        }
        
        if (type === 'platform:share') {
            return `Share from ${userName}`;
        }
        
        if (type === 'platform:raid') {
            const viewerCount = Number(input.viewerCount);
            if (!Number.isFinite(viewerCount)) {
                throw new Error('Raid notification requires viewerCount');
            }
            return `Incoming raid from ${userName} with ${viewerCount} viewers!`;
        }
        
        if (type === 'platform:envelope') {
            return `Treasure chest from ${userName}`;
        }
        
        if (!HARDCODED_TYPES.includes(type ?? '') && hasNotificationTemplate(type) && NOTIFICATION_TEMPLATES[type].log) {
            const templateData = {
                username: userName,
                ttsUsername: this.sanitizeUsernameForTts(username),
                ...input
            };
            
            return interpolateTemplate(NOTIFICATION_TEMPLATES[type].log, templateData);
        }
        
        return `${type}: ${message || ''}`;
    }

    static formatCurrency(amount: unknown, currency: unknown) {
        if (typeof amount !== 'number' || !Number.isFinite(amount)) {
            throw new Error('formatCurrency requires numeric amount');
        }
        if (!currency || typeof currency !== 'string') {
            throw new Error('formatCurrency requires currency');
        }

        try {
            const formatterKey = `${currency}:${currency === 'JPY' ? '0' : '2'}`;
            if (!this.currencyFormatters) {
                this.currencyFormatters = new Map();
            }

            if (!this.currencyFormatters.has(formatterKey)) {
                this.currencyFormatters.set(formatterKey, new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: currency,
                    minimumFractionDigits: currency === 'JPY' ? 0 : 2,
                    maximumFractionDigits: currency === 'JPY' ? 0 : 2
                }));
            }

            const formatter = this.currencyFormatters.get(formatterKey);
            if (!formatter) {
                throw new Error(`Missing currency formatter for ${formatterKey}`);
            }
            return formatter.format(amount);
        } catch {
            return `${amount.toFixed(2)} ${currency}`;
        }
    }

    static formatCurrencyForTts(amount: unknown, currency: unknown) {
        if (typeof amount !== 'number' || !Number.isFinite(amount)) {
            throw new Error('formatCurrencyForTts requires numeric amount');
        }
        if (!currency || typeof currency !== 'string') {
            throw new Error('formatCurrencyForTts requires currency');
        }

        const main = Math.floor(amount);
        const sub = Math.round((amount - main) * 100);

        let currencyName;
        try {
            const formatterKey = `${currency}:name`;
            if (!this.currencyNameFormatters) {
                this.currencyNameFormatters = new Map();
            }

            if (!this.currencyNameFormatters.has(formatterKey)) {
                this.currencyNameFormatters.set(formatterKey, new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: currency,
                    currencyDisplay: 'name'
                }));
            }

            const nameFormatter = this.currencyNameFormatters.get(formatterKey);
            if (!nameFormatter) {
                throw new Error(`Missing currency name formatter for ${formatterKey}`);
            }
            currencyName = nameFormatter
                .formatToParts(main === 1 && sub === 0 ? 1 : 2)
                .find((p) => p.type === 'currency')?.value;

            if (currencyName && main === 1 && sub === 0 && currencyName.endsWith('s') && !currencyName.endsWith('yen')) {
                currencyName = currencyName.slice(0, -1);
            }
        } catch {
            currencyName = currency;
        }

        if (!currencyName) {
            currencyName = currency;
        }

        if (sub === 0) {
            return `${main} ${currencyName}`;
        }
        return `${main} ${currencyName} ${sub}`;
    }

    static sanitizeUsernameForTts(username: unknown, maxLength?: number) {
        if (!username || typeof username !== 'string' || !username.trim()) {
            return '';
        }
        
        let sanitized = username
            .replace(/[\u{1F000}-\u{1F999}]/gu, '')
            .replace(/[\u{2000}-\u{2600}]/gu, '')
            .replace(/[\u{2700}-\u{3300}]/gu, '')
            .replace(/[🌸🌈✨🦄🎮💎🔥💯]/g, '')
            .replace(/\d+/g, match => match.substring(0, 1))
            .trim();
        
        if (maxLength && sanitized.length > maxLength) {
            sanitized = sanitized.substring(0, maxLength);
        } else if (sanitized.length > 50) {
            sanitized = sanitized.substring(0, 50);
        }
        
        return sanitized || username.trim();
    }

    static formatBitsAmount(amount: number) {
        if (!amount && amount !== 0) amount = 0;
        return amount.toLocaleString();
    }

    static resolveGiftInlineParts(input: unknown) {
        const safeInput = asNotificationInput(input);
        if (!safeInput) {
            return [];
        }

        if (safeInput.type !== 'platform:gift') {
            return [];
        }

        const platform = typeof safeInput.platform === 'string' ? safeInput.platform.trim().toLowerCase() : '';
        const giftImageUrl = typeof safeInput.giftImageUrl === 'string' ? safeInput.giftImageUrl.trim() : '';
        if (!giftImageUrl) {
            return [];
        }

        if (platform === 'twitch') {
            const currency = typeof safeInput.currency === 'string' ? safeInput.currency.trim().toLowerCase() : '';
            if (currency !== 'bits' || this.hasMixedCheermotes(safeInput)) {
                return [];
            }

            const bitsAmount = Number(this.resolveBitsAmount(safeInput));
            if (!Number.isFinite(bitsAmount) || bitsAmount <= 0) {
                return [];
            }
            const formattedBitsAmount = this.formatBitsAmount(bitsAmount);
            const cheermoteInfo = safeInput.cheermoteInfo && typeof safeInput.cheermoteInfo === 'object'
                ? safeInput.cheermoteInfo
                : {};
            const prefix = typeof cheermoteInfo.cleanPrefix === 'string' && cheermoteInfo.cleanPrefix.trim()
                ? cheermoteInfo.cleanPrefix.trim()
                : (typeof cheermoteInfo.prefix === 'string' ? cheermoteInfo.prefix.trim() : 'bits');
            const parsedTier = Number(cheermoteInfo.tier);
            const emoteId = Number.isFinite(parsedTier) && parsedTier > 0
                ? `${prefix}-${parsedTier}`
                : prefix;

            const parts: Array<Record<string, unknown>> = [
                { type: 'text', text: `sent ${formattedBitsAmount} ` },
                {
                    type: 'emote',
                    platform: 'twitch',
                    emoteId,
                    imageUrl: giftImageUrl
                }
            ];

            const messageText = typeof safeInput.message === 'string' ? safeInput.message.trim() : '';
            if (messageText) {
                parts.push({ type: 'text', text: `: ${messageText}` });
            }

            return parts;
        }

        if (platform === 'youtube') {
            const giftType = typeof safeInput.giftType === 'string' ? safeInput.giftType.trim().toLowerCase() : '';
            if (giftType !== 'super sticker') {
                return [];
            }

            const parts: Array<Record<string, unknown>> = [
                {
                    type: 'emote',
                    platform: 'youtube',
                    emoteId: 'supersticker',
                    imageUrl: giftImageUrl
                }
            ];

            const messageText = typeof safeInput.message === 'string' ? safeInput.message.trim() : '';
            if (messageText) {
                parts.push({ type: 'text', text: ` ${messageText}` });
            }

            return parts;
        }

        return [];
    }

    static resolveBitsAmount(input: unknown) {
        const safeInput = asNotificationInput(input);
        if (!safeInput) {
            return 0;
        }
        if (safeInput.bits !== undefined) return safeInput.bits;
        if (safeInput.amount !== undefined) return safeInput.amount;
        return 0;
    }

    static hasMixedCheermotes(input: unknown) {
        const safeInput = asNotificationInput(input);
        if (!safeInput) {
            return false;
        }
        if (safeInput.mixedCheermoteInfo?.hasMixedTypes) return true;
        if (safeInput.cheermoteInfo?.isMixed === true) return true;
        if (Array.isArray(safeInput.cheermoteInfo?.types) && safeInput.cheermoteInfo.types.length > 1) return true;
        if (Array.isArray(safeInput.cheermoteTypes) && safeInput.cheermoteTypes.length > 1) return true;
        if (Number.isFinite(Number(safeInput.otherTypesCount)) && Number(safeInput.otherTypesCount) > 0) return true;
        return false;
    }

    static formatBitsAmountForTts(amount: number) {
        if (!amount && amount !== 0) amount = 0;
        
        if (amount === 0) return 'zero';
        if (amount >= 1000) {
            const thousands = Math.floor(amount / 1000);
            const remainder = amount % 1000;
            if (remainder === 0) {
                return `${thousands} thousand`;
            }
            return `${thousands} thousand ${remainder}`;
        }
        
        return amount.toString();
    }

    static formatCheermoteDisplay(input: NotificationInput) {
        const { amount, cheermoteType, primaryCheermote } = input;
        
        if (this.hasMixedCheermotes(input)) {
            const formattedAmount = this.formatBitsAmount(toFiniteNumber(amount));
            return `${formattedAmount} mixed bits`;
        }
        
        const type = cheermoteType || primaryCheermote || 'Cheermote';
        const formattedAmount = this.formatBitsAmount(toFiniteNumber(amount));
        return `${type} x ${formattedAmount}`;
    }

    static formatCheermoteForTts(input: NotificationInput) {
        const { amount, cheermoteType, primaryCheermote } = input;
        
        if (this.hasMixedCheermotes(input)) {
            const formattedAmount = this.formatBitsAmountForTts(toFiniteNumber(amount));
            return `${formattedAmount} mixed bits`;
        }
        
        if (!cheermoteType && !primaryCheermote) {
            const formattedAmount = this.formatBitsAmountForTts(toFiniteNumber(amount));
            return `${formattedAmount} bits`;
        }
        
        const type = String(cheermoteType || primaryCheermote).toLowerCase();
        const formattedAmount = this.formatBitsAmountForTts(toFiniteNumber(amount));
        return `${formattedAmount} ${type} bits`;
    }

    static formatCheermoteForLog(input: NotificationInput) {
        const { amount, cheermoteType, primaryCheermote } = input;
        
        if (this.hasMixedCheermotes(input)) {
            const formattedAmount = this.formatBitsAmount(toFiniteNumber(amount));
            return `${formattedAmount} mixed bits`;
        }
        
        if (cheermoteType || primaryCheermote) {
            const type = cheermoteType || primaryCheermote;
            const formattedAmount = this.formatBitsAmount(toFiniteNumber(amount));
            return `${type} x ${formattedAmount}`;
        }
        
        const formattedAmount = this.formatBitsAmount(toFiniteNumber(amount));
        return formattedAmount;
    }

    static formatBitsLogMessage({ username, giftType, amount }: { username: unknown; giftType: unknown; amount: unknown }) {
        if (!username || typeof username !== 'string') {
            throw new Error('formatBitsLogMessage requires username');
        }
        if (typeof giftType !== 'string' || !giftType.trim()) {
            throw new Error('formatBitsLogMessage requires giftType');
        }
        const numericAmount = Number(amount);
        if (!Number.isFinite(numericAmount)) {
            throw new Error('formatBitsLogMessage requires numeric amount');
        }
        const formattedAmount = this.formatBitsAmount(numericAmount);
        if (giftType === 'mixed bits') {
            return `${username} sent ${formattedAmount} mixed bits`;
        }
        return `Bits: ${formattedAmount} from ${username}`;
    }

}

export { NotificationBuilder };
