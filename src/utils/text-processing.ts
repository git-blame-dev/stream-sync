import { formatUsername12 } from './validation';
import { resolveLogger } from './logger-resolver';

class TextProcessingManager {
    logger: ReturnType<typeof resolveLogger>;

    constructor(dependencies: { logger?: unknown } = {}) {
        this.logger = resolveLogger(dependencies.logger, 'TextProcessingManager');
    }

    sanitizeUsername(username: unknown): string {
        if (typeof username !== 'string' || username.length === 0) {
            return '';
        }

        return username
            .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
            .replace(/&amp;/g, '&')
            .replace(/%20/g, ' ')
            .replace(/["\n\r\t]/g, '')
            .replace(/<[^>]*>/g, '')
            .replace(/javascript:/gi, '')
            .trim();
    }

    smartTruncateUsername(username: string, maxLength = 40): string {
        if (username.length <= maxLength) {
            return username;
        }

        const uniqueChars = new Set(username).size;
        const isRepetitive = uniqueChars <= 3 && username.length > maxLength;
        const hasInternationalChars = /[\u0080-\uFFFF]/.test(username);

        if (isRepetitive) {
            return username.substring(0, maxLength);
        }

        if (hasInternationalChars && username.length <= 60) {
            return username;
        }

        if (username.length > 60) {
            return username.substring(0, maxLength);
        }

        return username.substring(0, maxLength);
    }

    extractMessageText(messageParts: unknown, platform = 'unknown', context: Record<string, unknown> = {}): string {
        if (platform.toLowerCase() === 'youtube') {
            if (Array.isArray(messageParts)) {
                return messageParts.map((part) => {
                    if (typeof part === 'string') {
                        return part;
                    }
                    if (part && typeof part === 'object' && 'text' in part) {
                        const textValue = (part as { text?: unknown }).text;
                        return typeof textValue === 'string' ? textValue : '';
                    }
                    return '';
                }).join('');
            }

            return typeof messageParts === 'string' ? messageParts.trim() : '';
        }

        if (!messageParts) {
            this.logger.debug(`Empty messageParts for ${platform}`, 'text-processing', context);
            return '';
        }

        if (typeof messageParts === 'string') {
            this.logger.debug(`String message for ${platform}: "${messageParts}"`, 'text-processing', context);
            return messageParts.trim();
        }

        if (Array.isArray(messageParts)) {
            if (messageParts.length === 0) {
                this.logger.debug(`Empty messageParts array for ${platform}`, 'text-processing', context);
                return '';
            }

            this.logger.debug(`Processing array message for ${platform}`, 'text-processing', {
                messageParts,
                length: messageParts.length,
                context
            });

            const extractedText = messageParts.map((part) => {
                if (typeof part === 'string') {
                    this.logger.debug(`String part: "${part}"`, 'text-processing', context);
                    return part;
                }

                if (part && typeof part === 'object') {
                    const objectPart = part as { text?: unknown; message?: unknown };
                    const textCandidate = typeof objectPart.text === 'string'
                        ? objectPart.text
                        : (typeof objectPart.message === 'string' ? objectPart.message : '');

                    this.logger.debug('Object part', 'text-processing', {
                        part,
                        extractedText: textCandidate,
                        context
                    });
                    return textCandidate;
                }

                this.logger.debug('Unknown part type', 'text-processing', {
                    part,
                    partType: typeof part,
                    context
                });
                return '';
            }).join('');

            if (!extractedText && messageParts.length > 0) {
                this.logger.debug(`Empty result from non-empty messageParts for ${platform}`, 'text-processing', {
                    messageParts,
                    context
                });
            } else {
                this.logger.debug(`Final extracted text for ${platform}: "${extractedText}"`, 'text-processing', context);
            }

            return extractedText;
        }

        this.logger.debug(`Unexpected messageParts type for ${platform}`, 'text-processing', {
            type: typeof messageParts,
            value: messageParts,
            context
        });
        return String(messageParts).trim();
    }

    formatCoinAmount(amount: unknown, currency = 'coins'): string {
        const numericAmount = Number(amount);
        if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
            return '';
        }

        const label = typeof currency === 'string' && currency.length > 0 ? currency : 'coins';
        if (label !== 'coins') {
            return `${numericAmount} ${label}`;
        }

        const coinText = numericAmount === 1 ? 'coin' : 'coins';
        return `${numericAmount} ${coinText}`;
    }

    determineGiftName(data: Record<string, unknown>, platform: string, type: string): string {
        if (typeof data.giftType === 'string' && data.giftType.length > 0) {
            return data.giftType;
        }

        if (platform === 'tiktok' && type === 'platform:gift') {
            return 'gift';
        }

        if (type === 'platform:gift') {
            return 'gift';
        }

        return 'unknown';
    }

    formatChatMessage(
        type: string,
        username: unknown,
        message: unknown,
        options: { maxLength?: number } = {},
        truncateUsername = true
    ): string | null {
        const trimmedUsername = typeof username === 'string' ? username.trim() : '';
        if (!trimmedUsername) {
            return null;
        }

        const processedUsername = truncateUsername
            ? formatUsername12(trimmedUsername, false)
            : trimmedUsername;

        const maxMessageLength = options.maxLength || 200;
        const truncatedMessage = this.truncateText(typeof message === 'string' ? message : '', maxMessageLength, true);

        switch (type) {
            case 'chat':
                return `${processedUsername}: ${truncatedMessage}`;
            case 'system':
                return `[SYSTEM] ${truncatedMessage}`;
            case 'notification':
                return `[${processedUsername}] ${truncatedMessage}`;
            default:
                return `${processedUsername}: ${truncatedMessage}`;
        }
    }

    formatDuration(milliseconds: unknown): string {
        const numericValue = Number(milliseconds);
        if (!Number.isFinite(numericValue) || numericValue <= 0) {
            return '0s';
        }

        if (numericValue < 1000) {
            return `${numericValue}ms`;
        }

        const totalSeconds = numericValue / 1000;
        if (totalSeconds < 60) {
            return Number.isInteger(totalSeconds) ? `${Math.floor(totalSeconds)}s` : `${totalSeconds}s`;
        }

        let remaining = Math.floor(totalSeconds);
        const parts: string[] = [];

        if (remaining >= 3600) {
            const hours = Math.floor(remaining / 3600);
            parts.push(`${hours}h`);
            remaining %= 3600;
        }

        if (remaining >= 60) {
            const minutes = Math.floor(remaining / 60);
            parts.push(`${minutes}m`);
            remaining %= 60;
        }

        if (remaining > 0 || parts.length === 0) {
            parts.push(`${remaining}s`);
        }

        return parts.join(' ');
    }

    formatNumber(value: unknown, decimals = 1): string {
        const numericValue = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(numericValue)) {
            return decimals > 0 ? '0.0' : '0';
        }

        return numericValue.toLocaleString('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    }

    truncateText(text: unknown, maxLength: number, preserveWords = false): string {
        if (typeof text !== 'string' || text.length === 0) {
            return '';
        }

        if (text.length <= maxLength) {
            return text;
        }

        if (preserveWords) {
            const words = text.split(' ');
            let result = '';

            for (const word of words) {
                if ((result + word).length > maxLength - 3) {
                    break;
                }
                result += (result ? ' ' : '') + word;
            }

            return result + (result.length < text.length ? '...' : '');
        }

        return `${text.substring(0, maxLength - 3)}...`;
    }

    toTitleCase(text: unknown): string {
        if (typeof text !== 'string' || text.length === 0) {
            return '';
        }

        return text
            .split(/([_\-\s]+)/)
            .map((part) => {
                if (/[a-zA-Z0-9]/.test(part)) {
                    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
                }
                return part;
            })
            .join('');
    }

    cleanText(text: unknown): string {
        if (typeof text !== 'string' || text.length === 0) {
            return '';
        }

        const decoded = text
            .replace(/&amp;/g, '&')
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');

        return decoded
            .replace(/<[^>]*>/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    extractHashtags(text: unknown): string[] {
        if (typeof text !== 'string' || text.length === 0) {
            return [];
        }

        const withoutUrls = text
            .replace(/\b\w+:\/\/\S+/gi, ' ')
            .replace(/\bjavascript:[^\s]+/gi, ' ');
        const withoutTags = withoutUrls.replace(/<[^>]*>/g, ' ');
        const matches = withoutTags.match(/#\w+/g);
        return matches || [];
    }

    extractMentions(text: unknown): string[] {
        if (typeof text !== 'string' || text.length === 0) {
            return [];
        }

        const matches: string[] = [];
        const mentionPattern = /(^|[^A-Za-z0-9_@])(@[A-Za-z0-9_]+)/g;
        let match: RegExpExecArray | null;
        while ((match = mentionPattern.exec(text)) !== null) {
            matches.push(match[2]);
        }

        return matches;
    }

    toSlug(text: unknown): string {
        if (typeof text !== 'string' || text.length === 0) {
            return '';
        }

        return text
            .toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    }

    wrapText(text: unknown, lineLength = 80): string {
        if (typeof text !== 'string' || text.length === 0) {
            return '';
        }

        const words = text.split(' ');
        const lines: string[] = [];
        let currentLine = '';

        for (const word of words) {
            if (currentLine.length + word.length + 1 <= lineLength) {
                currentLine += `${currentLine ? ' ' : ''}${word}`;
            } else {
                if (currentLine) {
                    lines.push(currentLine);
                }
                currentLine = word;
            }
        }

        if (currentLine) {
            lines.push(currentLine);
        }

        return lines.join('\n');
    }

    generateLogFilename(platform: string, username: unknown): string | null {
        if (typeof username !== 'string' || username.trim().length === 0) {
            return null;
        }

        const safeUsername = username.replace(/[^a-zA-Z0-9]/g, '');
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');

        return `${platform.toLowerCase()}-${safeUsername}-${year}-${month}-${day}.txt`;
    }

    formatViewerCount(count: unknown): string {
        if (count === null || count === undefined || Number.isNaN(Number(count))) {
            return '0';
        }

        const numericCount = Math.max(0, Math.floor(Number(count)));

        if (numericCount >= 1_000_000_000) {
            const billions = numericCount / 1_000_000_000;
            return billions >= 10 ? `${Math.round(billions)}B` : `${billions.toFixed(1).replace('.0', '')}B`;
        }

        if (numericCount >= 1_000_000) {
            const millions = numericCount / 1_000_000;
            return millions >= 10 ? `${Math.round(millions)}M` : `${millions.toFixed(1).replace('.0', '')}M`;
        }

        if (numericCount >= 1_000) {
            const thousands = numericCount / 1_000;
            return thousands >= 10 ? `${Math.round(thousands)}K` : `${thousands.toFixed(1).replace('.0', '')}K`;
        }

        return String(numericCount);
    }

    formatLogEntry(timestamp: unknown, username: string, message: string, platform: string): string {
        let formattedTimestamp = String(timestamp);
        if (timestamp instanceof Date) {
            formattedTimestamp = timestamp.toISOString().split('T')[0];
        }

        return `[${formattedTimestamp}] [${platform}] ${username}: ${message}`;
    }
}

function createTextProcessingManager(dependencies?: { logger?: unknown }): TextProcessingManager {
    return new TextProcessingManager(dependencies);
}

function formatTimestampCompact(ts: Date | string | number): string {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) {
        return '00:00:00';
    }

    const pad = (value: number) => value.toString().padStart(2, '0');
    const hours = pad(date.getUTCHours());
    const minutes = pad(date.getUTCMinutes());
    const seconds = pad(date.getUTCSeconds());
    return `${hours}:${minutes}:${seconds}`;
}

export {
    TextProcessingManager,
    createTextProcessingManager,
    formatTimestampCompact
};
