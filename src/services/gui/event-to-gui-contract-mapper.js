const { DEFAULT_AVATAR_URL } = require('../../constants/avatar');
const { getValidMessageParts, normalizeBadgeImages } = require('../../utils/message-parts');

const EVENT_RULES = {
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

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function avatarCacheKey(platform, userId) {
    const normalizedPlatform = normalizeString(platform).toLowerCase();
    const normalizedUserId = normalizeString(userId);
    if (!normalizedPlatform || !normalizedUserId) {
        return '';
    }
    return `${normalizedPlatform}:${normalizedUserId}`;
}

function applyMessageLimit(text, limit) {
    if (!Number.isFinite(limit) || limit <= 0) {
        return text;
    }
    return text.slice(0, limit);
}

function resolveText(type, data = {}) {
    if (type === 'chat' || type === 'platform:chat-message') {
        if (typeof data.message === 'string') {
            return normalizeString(data.message);
        }
        if (data.message && typeof data.message === 'object') {
            return normalizeString(data.message.text);
        }
        return '';
    }

    return normalizeString(data.displayMessage || data.message);
}

function resolveMessageParts(data = {}) {
    return getValidMessageParts({ message: data?.message }, { allowWhitespaceText: true })
        .map((part) => {
            if (part.type === 'emote') {
                return {
                    type: 'emote',
                    platform: normalizeString(part.platform),
                    emoteId: part.emoteId.trim(),
                    imageUrl: part.imageUrl.trim()
                };
            }

            return {
                type: 'text',
                text: part.text
            };
        });
}

function createEventToGuiContractMapper(options = {}) {
    const config = options.config || {};
    const guiConfig = config.gui || {};
    const fallbackAvatarUrl = normalizeString(options.fallbackAvatarUrl) || DEFAULT_AVATAR_URL;
    const avatarCacheMaxSize = Number.isFinite(Number(options.avatarCacheMaxSize)) && Number(options.avatarCacheMaxSize) > 0
        ? Number(options.avatarCacheMaxSize)
        : 2000;
    const cache = new Map();

    const setCachedAvatar = (key, avatarUrl) => {
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

    const getRule = (type) => EVENT_RULES[type] || null;

    const resolveAvatarUrl = async ({ platform, data }) => {
        const payloadAvatar = normalizeString(data.avatarUrl);
        const userId = normalizeString(data.userId);
        const key = avatarCacheKey(platform, userId);

        if (payloadAvatar) {
            setCachedAvatar(key, payloadAvatar);
            return payloadAvatar;
        }

        if (key && cache.has(key)) {
            return cache.get(key);
        }

        return fallbackAvatarUrl;
    };

    const isEnabled = (toggleKey) => {
        const value = guiConfig[toggleKey];
        return value !== false;
    };

    const mapDisplayRow = async (row = {}) => {
        const type = normalizeString(row.type);
        const rule = getRule(type);
        if (!rule) {
            return null;
        }

        if (!isEnabled(rule.toggleKey)) {
            return null;
        }

        const data = row.data && typeof row.data === 'object' ? row.data : {};
        const platform = normalizeString(row.platform || data.platform).toLowerCase();
        const username = normalizeString(data.username);
        const textSource = resolveText(type, data);
        const messageLimit = Number(guiConfig.messageCharacterLimit) || 0;
        const text = applyMessageLimit(textSource, messageLimit);
        const parts = resolveMessageParts(data);
        const badgeImages = normalizeBadgeImages(data.badgeImages);
        const avatarUrl = await resolveAvatarUrl({ platform, data });

        const mapped = {
            type,
            kind: rule.kind,
            platform,
            username,
            text,
            avatarUrl,
            timestamp: data.timestamp || row.timestamp || null
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

module.exports = {
    createEventToGuiContractMapper
};
