import { NotificationBuilder } from './notification-builder';
import { normalizeTtsText } from './tts-text';

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
        paypiggy: 0,
        bits: 0,
        comment: 0
    } as const;

    static createTTSStages(notification: MessageTtsNotification): TtsStage[] {
        const stages: TtsStage[] = [];

        if (typeof notification?.ttsMessage === 'string' && notification.ttsMessage.trim().length > 0) {
            stages.push({
                text: normalizeTtsText(notification.ttsMessage),
                delay: 0,
                type: 'primary'
            });
        }

        if (this.supportsMessages(notification) && this.hasValidMessage(notification?.message)) {
            stages.push(this.createMessageStage(notification));
        }

        return stages.filter(stage => stage.text.length > 0);
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

        const ttsUsername = NotificationBuilder.sanitizeUsernameForTts(username);

        const sanitizedMessage = normalizeTtsText(cleanMessage);
        return `${ttsUsername} says ${sanitizedMessage}`;
    }

    static getMessageDelay(notification: MessageTtsNotification): number {
        if (this.isPaypiggyWithMessage(notification)) return this.MESSAGE_DELAYS.paypiggy;

        const currency = typeof notification?.currency === 'string' ? notification.currency.trim().toLowerCase() : '';
        if (currency === 'bits') return this.MESSAGE_DELAYS.bits;

        if (notification?.isComment === true) return this.MESSAGE_DELAYS.comment;

        return 0;
    }

    static isPaypiggyWithMessage(notification: MessageTtsNotification): boolean {
        return notification?.type === 'platform:paypiggy' && this.hasValidMessage(notification.message);
    }
}

export { MessageTTSHandler };
export default MessageTTSHandler;
