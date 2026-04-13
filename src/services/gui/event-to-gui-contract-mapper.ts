import type { GuiBadgeImage, GuiMessagePart, GuiRowDto, GuiRowKind } from '../../../gui/src/shared/types';
import { DEFAULT_AVATAR_URL } from '../../constants/avatar';
import { getValidMessageParts, normalizeBadgeImages } from '../../utils/message-parts';

type MapperRecord = Record<string, unknown>;

type GuiToggleKey =
    | 'showMessages'
    | 'showCommands'
    | 'showGreetings'
    | 'showFarewells'
    | 'showFollows'
    | 'showShares'
    | 'showRaids'
    | 'showGifts'
    | 'showPaypiggies'
    | 'showGiftPaypiggies'
    | 'showEnvelopes';

type GuiMapperConfig = {
    messageCharacterLimit?: unknown;
} & Partial<Record<GuiToggleKey, unknown>>;

type EventRule = {
    kind: GuiRowKind;
    toggleKey: GuiToggleKey;
};

type MapperOptions = {
    config?: {
        gui?: GuiMapperConfig;
    };
    fallbackAvatarUrl?: unknown;
    avatarCacheMaxSize?: unknown;
};

type SourceRow = {
    type?: unknown;
    platform?: unknown;
    timestamp?: unknown;
    data?: unknown;
};

type RawPart = {
    type?: unknown;
    platform?: unknown;
    emoteId?: unknown;
    imageUrl?: unknown;
    text?: unknown;
};

const EVENT_RULES: Record<string, EventRule> = {
    chat: { kind: 'chat', toggleKey: 'showMessages' },
    command: { kind: 'command', toggleKey: 'showCommands' },
    greeting: { kind: 'greeting', toggleKey: 'showGreetings' },
    farewell: { kind: 'farewell', toggleKey: 'showFarewells' },
    'platform:chat-message': { kind: 'chat', toggleKey: 'showMessages' },
    'platform:follow': { kind: 'notification', toggleKey: 'showFollows' },
    'platform:share': { kind: 'notification', toggleKey: 'showShares' },
    'platform:raid': { kind: 'notification', toggleKey: 'showRaids' },
    'platform:gift': { kind: 'notification', toggleKey: 'showGifts' },
    'platform:paypiggy': { kind: 'notification', toggleKey: 'showPaypiggies' },
    'platform:giftpaypiggy': { kind: 'notification', toggleKey: 'showGiftPaypiggies' },
    'platform:envelope': { kind: 'notification', toggleKey: 'showEnvelopes' }
};

function toRecord(value: unknown): MapperRecord {
    return value && typeof value === 'object' ? (value as MapperRecord) : {};
}

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function avatarCacheKey(platform: unknown, userId: unknown): string {
    const normalizedPlatform = normalizeString(platform).toLowerCase();
    const normalizedUserId = normalizeString(userId);
    if (!normalizedPlatform || !normalizedUserId) {
        return '';
    }
    return `${normalizedPlatform}:${normalizedUserId}`;
}

function applyMessageLimit(text: string, limit: number): string {
    if (!Number.isFinite(limit) || limit <= 0) {
        return text;
    }
    return text.slice(0, limit);
}

function resolveText(type: string, data: MapperRecord): string {
    if (type === 'chat' || type === 'platform:chat-message') {
        const message = data.message;
        if (typeof message === 'string') {
            return normalizeString(message);
        }
        if (message && typeof message === 'object') {
            return normalizeString((message as MapperRecord).text);
        }
        return '';
    }

    return normalizeString(data.displayMessage || data.message);
}

function resolveMessageParts(type: string, platform: string, data: MapperRecord): GuiMessagePart[] {
    const message = toRecord(data.message);
    const canonicalMessageParts = Array.isArray(message.parts)
        ? message.parts
        : [];
    const notificationParts = Array.isArray(data.parts)
        ? data.parts
        : [];
    const sourceParts = canonicalMessageParts.length > 0
        ? canonicalMessageParts
        : notificationParts;

    if (sourceParts.length === 0 && type === 'platform:gift') {
        const normalizedPlatform = normalizeString(platform || data.platform).toLowerCase();
        const giftType = normalizeString(data.giftType);
        const giftImageUrl = normalizeString(data.giftImageUrl);
        const amount = Number(data.amount);
        const giftCount = Number(data.giftCount);
        const currency = normalizeString(data.currency).toLowerCase();

        if (normalizedPlatform === 'tiktok' && giftType && giftImageUrl && currency === 'coins') {
            const countText = giftCount > 1 ? `${giftCount}x ` : '';
            const coinLabel = amount === 1 ? 'coin' : 'coins';
            const coinText = amount > 0 ? ` (${amount} ${coinLabel})` : '';
            const derivedParts: GuiMessagePart[] = [
                { type: 'text', text: `sent ${countText}` },
                { type: 'emote', platform: 'tiktok', emoteId: giftType, imageUrl: giftImageUrl }
            ];

            if (coinText) {
                derivedParts.push({ type: 'text', text: coinText });
            }

            return derivedParts;
        }
    }

    const validParts = getValidMessageParts({ message: { parts: sourceParts } }, { allowWhitespaceText: true }) as RawPart[];
    return validParts.map((part): GuiMessagePart => {
        if (part.type === 'emote') {
            return {
                type: 'emote',
                platform: normalizeString(part.platform),
                emoteId: (part.emoteId as string).trim(),
                imageUrl: (part.imageUrl as string).trim()
            };
        }

        return {
            type: 'text',
            text: part.text as string
        };
    });
}

function createEventToGuiContractMapper(options: MapperOptions = {}) {
    const config = toRecord(options.config);
    const guiConfig = toRecord(config.gui) as GuiMapperConfig;
    const fallbackAvatarUrl = normalizeString(options.fallbackAvatarUrl) || DEFAULT_AVATAR_URL;
    const avatarCacheMaxSize = Number.isFinite(Number(options.avatarCacheMaxSize)) && Number(options.avatarCacheMaxSize) > 0
        ? Number(options.avatarCacheMaxSize)
        : 2000;
    const cache = new Map<string, string>();

    const setCachedAvatar = (key: string, avatarUrl: string): void => {
        if (!key || !avatarUrl) {
            return;
        }

        cache.set(key, avatarUrl);
        while (cache.size > avatarCacheMaxSize) {
            const oldestKey = cache.keys().next().value;
            if (!oldestKey) {
                break;
            }
            cache.delete(oldestKey);
        }
    };

    const getRule = (type: string): EventRule | null => EVENT_RULES[type] || null;

    const resolveAvatarUrl = async ({ platform, data }: { platform: string; data: MapperRecord }): Promise<string> => {
        const payloadAvatar = normalizeString(data.avatarUrl);
        const userId = normalizeString(data.userId);
        const key = avatarCacheKey(platform, userId);

        if (payloadAvatar) {
            setCachedAvatar(key, payloadAvatar);
            return payloadAvatar;
        }

        if (key && cache.has(key)) {
            return cache.get(key) as string;
        }

        return fallbackAvatarUrl;
    };

    const isEnabled = (toggleKey: GuiToggleKey): boolean => guiConfig[toggleKey] !== false;

    const mapDisplayRow = async (row: SourceRow = {}): Promise<GuiRowDto | null> => {
        const type = normalizeString(row.type);
        const rule = getRule(type);
        if (!rule) {
            return null;
        }

        if (!isEnabled(rule.toggleKey)) {
            return null;
        }

        const data = toRecord(row.data);
        const platform = normalizeString(row.platform || data.platform).toLowerCase();
        const username = normalizeString(data.username);
        const textSource = resolveText(type, data);
        const messageLimit = Number(guiConfig.messageCharacterLimit) || 0;
        const text = applyMessageLimit(textSource, messageLimit);
        const parts = resolveMessageParts(type, platform, data);
        const badgeImages = normalizeBadgeImages(data.badgeImages) as GuiBadgeImage[];
        const avatarUrl = await resolveAvatarUrl({ platform, data });

        const mapped: GuiRowDto = {
            type,
            kind: rule.kind,
            platform,
            username,
            text,
            avatarUrl,
            timestamp: (data.timestamp || row.timestamp || null) as string | null
        };

        if (rule.kind === 'chat') {
            mapped.isPaypiggy = data.isPaypiggy === true;
            if (badgeImages.length > 0) {
                mapped.badgeImages = badgeImages;
            }
        }

        if (parts.length > 0) {
            mapped.parts = parts;
        }

        return mapped;
    };

    return {
        mapDisplayRow,
        resolveAvatarUrl,
        avatarCacheKey,
        applyMessageLimit
    };
}

export { createEventToGuiContractMapper };
