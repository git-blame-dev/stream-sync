import type { GuiBadgeImage, GuiMessagePart, GuiRowDto, GuiRowKind, RowPresentationOverride } from '../../contracts/gui';
import { DEFAULT_AVATAR_URL } from '../../constants/avatar';
import { utf16BudgetPrefix } from '../../utils/utf16-budget-prefix';
import { normalizeRowEffects, normalizeRowSpriteUrl, normalizeRowTheme } from '../../core/row-presentation';
import { getValidMessageParts, normalizeBadgeImages } from '../../utils/message-parts';

type MapperRecord = Record<string, unknown>;

type GuiToggleKey =
    | 'showMessages'
    | 'showCommands'
    | 'showGreetings'
    | 'showFarewells'
    | 'showFollows'
    | 'showShares'
    | 'showReposts'
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
    presentationRole?: 'monetization';
};

type MapperOptions = {
    config?: {
        gui?: GuiMapperConfig;
    };
    fallbackAvatarUrl?: unknown;
    avatarCacheMaxSize?: unknown;
};

type SourceRow = {
    eventId?: unknown;
    type?: unknown;
    platform?: unknown;
    timestamp?: unknown;
    data?: unknown;
};

type EventToGuiContractMapper = {
mapDisplayRow: (row?: SourceRow) => Promise<GuiRowDto | null>;
resolveAvatarUrl: (args: { platform: string; data: MapperRecord }) => Promise<string>;
avatarCacheKey: (platform: unknown, userId: unknown) => string;
applyMessageLimit: (text: string, limit: number) => string;
};

type RawPart = {
    type?: unknown;
    platform?: unknown;
    emoteId?: unknown;
    imageUrl?: unknown;
    text?: unknown;
};

function toRawParts(parts: unknown): RawPart[] {
    return Array.isArray(parts) ? (parts as RawPart[]) : [];
}

const EVENT_RULES: Record<string, EventRule> = {
    chat: { kind: 'chat', toggleKey: 'showMessages' },
    command: { kind: 'command', toggleKey: 'showCommands' },
    greeting: { kind: 'greeting', toggleKey: 'showGreetings' },
    farewell: { kind: 'farewell', toggleKey: 'showFarewells' },
    'platform:chat-message': { kind: 'chat', toggleKey: 'showMessages' },
    'platform:follow': { kind: 'notification', toggleKey: 'showFollows' },
    'platform:share': { kind: 'notification', toggleKey: 'showShares' },
    'platform:repost': { kind: 'notification', toggleKey: 'showReposts' },
    'platform:raid': { kind: 'notification', toggleKey: 'showRaids' },
    'platform:gift': { kind: 'notification', toggleKey: 'showGifts', presentationRole: 'monetization' },
    'platform:paypiggy': { kind: 'notification', toggleKey: 'showPaypiggies', presentationRole: 'monetization' },
    'platform:giftpaypiggy': { kind: 'notification', toggleKey: 'showGiftPaypiggies', presentationRole: 'monetization' },
    'platform:envelope': { kind: 'notification', toggleKey: 'showEnvelopes', presentationRole: 'monetization' }
};

function toRecord(value: unknown): MapperRecord {
    return value && typeof value === 'object' ? (value as MapperRecord) : {};
}

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizePresentationOverride(value: unknown): RowPresentationOverride | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const candidate = value as MapperRecord;
    const theme = normalizeRowTheme(candidate.theme);
    const effects = normalizeRowEffects(candidate.effects);
    const spriteUrl = normalizeRowSpriteUrl(candidate.spriteUrl);
    if (!theme && !effects && !spriteUrl) return undefined;
    return { ...(theme ? { theme } : {}), ...(effects ? { effects } : {}), ...(spriteUrl ? { spriteUrl } : {}) };
}

function resolvePresentationRole(rule: EventRule, data: MapperRecord): NonNullable<GuiRowDto['presentationRole']> {
    if (rule.kind === 'chat') {
        if (data.isPaypiggy === true) return 'member';
        if (data.isStreamSupporter === true) return 'supporter';
    }
    return rule.presentationRole ?? 'ordinary';
}

function toFiniteNumber(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
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
    return utf16BudgetPrefix(text, limit);
}

function normalizeTimestamp(value: unknown): string | null {
const normalized = normalizeString(value);
return normalized || null;
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

    const validParts = toRawParts(getValidMessageParts({ message: { parts: sourceParts } }, { allowWhitespaceText: true }));
    return validParts.map((part): GuiMessagePart => {
if (part.type === 'emote') {
const emoteId = typeof part.emoteId === 'string' ? part.emoteId.trim() : '';
const imageUrl = typeof part.imageUrl === 'string' ? part.imageUrl.trim() : '';
return {
type: 'emote',
platform: normalizeString(part.platform),
emoteId,
imageUrl
};
}

const text = typeof part.text === 'string' ? part.text : '';
return {
type: 'text',
text
};
});
}

function createEventToGuiContractMapper(options: MapperOptions = {}): EventToGuiContractMapper {
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
if (payloadAvatar === fallbackAvatarUrl) {
if (key && cache.has(key)) {
const cachedAvatar = cache.get(key);
if (cachedAvatar) {
return cachedAvatar;
}
}
return fallbackAvatarUrl;
}

            setCachedAvatar(key, payloadAvatar);
            return payloadAvatar;
        }

if (key && cache.has(key)) {
const cachedAvatar = cache.get(key);
if (cachedAvatar) {
return cachedAvatar;
}
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
        const eventId = normalizeString(row.eventId) || normalizeString(data.eventId);
        const platform = normalizeString(row.platform || data.platform).toLowerCase();
        const username = normalizeString(data.username);
        const textSource = resolveText(type, data);
        const messageLimit = toFiniteNumber(guiConfig.messageCharacterLimit, 0);
        const text = applyMessageLimit(textSource, messageLimit);
        const parts = resolveMessageParts(type, platform, data);
        const badgeImages = normalizeBadgeImages(data.badgeImages) as GuiBadgeImage[];
        const avatarUrl = await resolveAvatarUrl({ platform, data });

        const presentationRole = resolvePresentationRole(rule, data);
        const mapped: GuiRowDto = {
            ...(eventId ? { eventId } : {}),
            type,
            kind: rule.kind,
            platform,
            username,
            text,
            presentationRole,
            avatarUrl,
            timestamp: normalizeTimestamp(data.timestamp || row.timestamp)
        };

        if (rule.kind === 'chat') {
            mapped.isPaypiggy = data.isPaypiggy === true;
            mapped.isStreamSupporter = data.isStreamSupporter === true;
            const override = presentationRole === 'member'
                ? normalizePresentationOverride(data.presentationOverride)
                : undefined;
            if (override) mapped.presentationOverride = override;
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
