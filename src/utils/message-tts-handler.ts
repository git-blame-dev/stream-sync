const { NotificationBuilder } = require('./notification-builder') as {
    NotificationBuilder: {
        sanitizeUsernameForTts: (username: string, maxLength?: number | null) => string;
    };
};

type MessageTtsNotification = {
    ttsMessage?: unknown;
    message?: unknown;
    username?: unknown;
    type?: unknown;
    currency?: unknown;
    isSuperChat?: unknown;
    isComment?: unknown;
    cheermoteInfo?: {
        textContent?: unknown;
    } | null;
};

type TtsStage = {
    text: string;
    delay: number;
    type: 'primary' | 'message';
};

class MessageTTSHandler {
    static MESSAGE_DELAYS = {
        paypiggy: 4000,
        bits: 3000,
        comment: 0
    } as const;

    static createTTSStages(notification: MessageTtsNotification): TtsStage[] {
        const stages: TtsStage[] = [];

        if (typeof notification?.ttsMessage === 'string' && notification.ttsMessage.trim().length > 0) {
            stages.push({
                text: notification.ttsMessage,
                delay: 0,
                type: 'primary'
            });
        }

        if (this.supportsMessages(notification) && this.hasValidMessage(notification?.message)) {
            stages.push(this.createMessageStage(notification));
        }

        return stages;
    }

    static createMessageStage(notification: MessageTtsNotification): TtsStage {
        const delay = this.getMessageDelay(notification);
        const username = typeof notification?.username === 'string' ? notification.username : '';
        const message = typeof notification?.message === 'string' ? notification.message : '';
        const messageTTS = this.createMessageTTS(username, message, notification);

        return {
            text: messageTTS,
            delay,
            type: 'message'
        };
    }

    static supportsMessages(notification: MessageTtsNotification): boolean {
        if (!notification || typeof notification !== 'object') {
            return false;
        }

        if (notification.isSuperChat === true) return true;
        if (this.isPaypiggyWithMessage(notification)) return true;
        if (notification.isComment === true) return true;

        return false;
    }

    static hasValidMessage(message: unknown): message is string {
        if (typeof message !== 'string') {
            return false;
        }

        return message.trim().length > 0;
    }

    static createMessageTTS(username: string, message: string, notification: MessageTtsNotification | null = null): string {
        let cleanMessage = message;
        if (notification?.cheermoteInfo && typeof notification.cheermoteInfo.textContent === 'string') {
            cleanMessage = notification.cheermoteInfo.textContent;
        }

        const messageNeedsTrimming = cleanMessage !== cleanMessage.trim();
        const needsTruncation = this.needsUsernameTruncation(username, messageNeedsTrimming);
        const maxLength = needsTruncation ? 12 : null;
        const ttsUsername = NotificationBuilder.sanitizeUsernameForTts(username, maxLength);

        const sanitizedMessage = cleanMessage.trim();
        return `${ttsUsername} says ${sanitizedMessage}`;
    }

    static needsUsernameTruncation(username: unknown, messageNeedsTrimming = false): boolean {
        if (typeof username !== 'string' || username.length === 0) {
            return false;
        }

        const hasEmojis = /[\u{1F000}-\u{1F999}]|[🌸🌈✨🦄🎮💎🔥💯]/gu.test(username);
        const isVeryLong = username.length > 15;
        const shouldOptimize = messageNeedsTrimming;

        return hasEmojis || isVeryLong || shouldOptimize;
    }

    static getMessageDelay(notification: MessageTtsNotification): number {
        if (this.isPaypiggyWithMessage(notification)) return this.MESSAGE_DELAYS.paypiggy;

        const currency = typeof notification?.currency === 'string' ? notification.currency.trim().toLowerCase() : '';
        if (currency === 'bits') return this.MESSAGE_DELAYS.bits;

        if (notification?.isComment === true) return this.MESSAGE_DELAYS.comment;

        return 4000;
    }

    static isPaypiggyWithMessage(notification: MessageTtsNotification): boolean {
        return notification?.type === 'platform:paypiggy' && this.hasValidMessage(notification.message);
    }
}

module.exports = MessageTTSHandler;
module.exports.MessageTTSHandler = MessageTTSHandler;
