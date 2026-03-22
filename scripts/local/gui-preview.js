const EventEmitter = require('events');
const configModule = require('../../src/core/config');
const { logger: defaultLogger } = require('../../src/core/logging');
const { createEventBus } = require('../../src/core/EventBus');
const { PlatformEvents } = require('../../src/interfaces/PlatformEvents');
const { PRIORITY_LEVELS, NOTIFICATION_CONFIGS } = require('../../src/core/constants');
const { createPlatformErrorHandler } = require('../../src/utils/platform-error-handler');
const { safeSetInterval, safeSetTimeout } = require('../../src/utils/timeout-validator');
const { createGuiTransportService } = require('../../src/services/gui/gui-transport-service');
const PlatformEventRouter = require('../../src/services/PlatformEventRouter');
const ChatNotificationRouter = require('../../src/services/ChatNotificationRouter');
const { createVFXCommandService } = require('../../src/services/VFXCommandService');
const CommandCooldownService = require('../../src/services/CommandCooldownService');
const { createUserTrackingService } = require('../../src/services/UserTrackingService');
const NotificationManager = require('../../src/notifications/NotificationManager');
const { DisplayQueue } = require('../../src/obs/display-queue');
const { createTwitchEventSubEventRouter } = require('../../src/platforms/twitch/events/event-router');
const { createYouTubeEventRouter } = require('../../src/platforms/youtube/events/event-router');
const { setupTikTokEventListeners } = require('../../src/platforms/tiktok/events/event-router');
const { DEFAULT_AVATAR_URL } = require('../../src/constants/avatar');

const PREVIEW_DURATION_MS = 32000;
const PREVIEW_INTERVAL_MS = 2000;

const PREVIEW_AVATAR_URL = DEFAULT_AVATAR_URL;
const PREVIEW_MESSAGE_TEXT = 'test message hello world this is a message to everyone how are we today?';
const PREVIEW_MEDIA_CATALOG = {
    twitch: {
        avatarUrl: PREVIEW_AVATAR_URL,
        badges: [
            {
                imageUrl: 'https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/3',
                source: 'twitch',
                label: 'Moderator'
            },
            {
                imageUrl: 'https://static-cdn.jtvnw.net/badges/v1/511b78a9-ab37-472f-9569-457753bbe7d3/3',
                source: 'twitch',
                label: 'Founder'
            },
            {
                imageUrl: 'https://static-cdn.jtvnw.net/badges/v1/bbbe0db0-a598-423e-86d0-f9fb98ca1933/3',
                source: 'twitch',
                label: 'Prime Gaming'
            }
        ],
        emote: {
            id: 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7',
            imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7/animated/dark/3.0'
        }
    },
    youtube: {
        avatarUrl: PREVIEW_AVATAR_URL,
        badges: [
            {
                imageUrl: 'https://yt3.ggpht.com/qh4HyXNMbx5x0_HtQ53rpdtMdEv7OTq6hsebWwybYRlKtdYH5m6bq8kviuVZMvxAbGHWH86FV15Opfs=s32-c-k',
                source: 'youtube',
                label: 'Member'
            }
        ],
        emote: {
            id: 'UCkszU2WH9gy1mb0dV-11UJg/G8AfY6yWGuKuhL0PlbiA2AE',
            imageUrl: 'https://yt3.ggpht.com/KOxdr_z3A5h1Gb7kqnxqOCnbZrBmxI2B_tRQ453BhTWUhYAlpg5ZP8IKEBkcvRoY8grY91Q=w48-h48-c-k-nd'
        }
    },
    tiktok: {
        avatarUrl: PREVIEW_AVATAR_URL,
        badges: [
            {
                imageUrl: 'https://p16-webcast.tiktokcdn.com/webcast-sg/webcast_admin_badge_tiktok.png~tplv-obj.image',
                source: 'tiktok',
                label: 'Moderator'
            },
            {
                imageUrl: 'https://p16-webcast.tiktokcdn.com/webcast-va/grade_badge_icon_lite_lv20_v1.png~tplv-obj.image',
                source: 'tiktok',
                label: 'Level'
            }
        ],
        emote: {
            id: '0123456789012345678',
            imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7/animated/dark/3.0'
        },
        gift: {
            imageUrl: 'https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/eba3a9bb85c33e017f3648eaf88d7189~tplv-obj.webp'
        }
    }
};

const PREVIEW_SCENARIO_TEMPLATE = [
    { type: 'chat-hi', adapter: 'twitch' },
    { type: 'chat-hello', adapter: 'youtube' },
    { type: 'chat', adapter: 'twitch' },
    { type: 'chat', adapter: 'youtube' },
    { type: 'chat', adapter: 'tiktok' },
    { type: 'chat-no', adapter: 'tiktok' },
    { type: 'follow', adapter: 'tiktok' },
    { type: 'chat-command', adapter: 'youtube' },
    { type: 'chat-farewell', adapter: 'twitch' },
    { type: 'gift', adapter: 'tiktok' },
    { type: 'raid', adapter: 'twitch' },
    { type: 'chat-member-hi', adapter: 'youtube' },
    { type: 'share', adapter: 'tiktok' },
    { type: 'paypiggy', adapter: 'youtube' },
    { type: 'giftpaypiggy', adapter: 'youtube' },
    { type: 'envelope', adapter: 'tiktok' }
];

const PREVIEW_PLATFORM_ACCOUNTS = [
    {
        platform: 'twitch',
        username: 'test-twitch-account',
        userId: 'test-twitch-account-id'
    },
    {
        platform: 'youtube',
        username: 'test-youtube-account',
        userId: 'test-youtube-account-id'
    },
    {
        platform: 'tiktok',
        username: 'test-tiktok-account',
        userId: 'test-tiktok-account-id'
    }
];

const NOOP_LOGGER = {
    debug: () => {},
    console: () => {},
    info: () => {},
    warn: () => {},
    error: () => {}
};

function createGuiPreviewErrorHandler(logger) {
    return createPlatformErrorHandler(logger, 'gui-preview');
}

function resolveLogger(logger) {
    const source = (logger && typeof logger.error === 'function')
        ? logger
        : ((defaultLogger && typeof defaultLogger.error === 'function') ? defaultLogger : NOOP_LOGGER);

    return {
        debug: typeof source.debug === 'function' ? source.debug.bind(source) : NOOP_LOGGER.debug,
        console: typeof source.console === 'function'
            ? source.console.bind(source)
            : (typeof source.info === 'function' ? source.info.bind(source) : NOOP_LOGGER.console),
        info: typeof source.info === 'function' ? source.info.bind(source) : NOOP_LOGGER.info,
        warn: typeof source.warn === 'function' ? source.warn.bind(source) : NOOP_LOGGER.warn,
        error: typeof source.error === 'function' ? source.error.bind(source) : NOOP_LOGGER.error
    };
}

function mergeSection(baseSection, overrideSection, forcedSection) {
    return {
        ...(baseSection || {}),
        ...(overrideSection || {}),
        ...(forcedSection || {})
    };
}

function buildPreviewConfig(baseConfig) {
    const sourceConfig = configModule.config || {};
    const overrideConfig = baseConfig || {};

    const merged = {
        ...sourceConfig,
        ...overrideConfig
    };

    const resolveNonEmptyString = (preferredValue, fallbackValue) => {
        if (typeof preferredValue === 'string' && preferredValue.trim().length > 0) {
            return preferredValue;
        }
        if (typeof fallbackValue === 'string' && fallbackValue.trim().length > 0) {
            return fallbackValue;
        }
        return '';
    };

    merged.general = mergeSection(sourceConfig.general, overrideConfig.general, {
        messagesEnabled: true,
        commandsEnabled: true,
        greetingsEnabled: true,
        farewellsEnabled: true,
        followsEnabled: true,
        giftsEnabled: true,
        raidsEnabled: true,
        sharesEnabled: true,
        paypiggiesEnabled: true,
        filterOldMessages: false
    });

    const platformFlags = {
        messagesEnabled: true,
        commandsEnabled: true,
        greetingsEnabled: true,
        farewellsEnabled: true,
        followsEnabled: true,
        giftsEnabled: true,
        raidsEnabled: true,
        sharesEnabled: true,
        paypiggiesEnabled: true
    };

    merged.twitch = mergeSection(sourceConfig.twitch, overrideConfig.twitch, platformFlags);
    merged.youtube = mergeSection(sourceConfig.youtube, overrideConfig.youtube, platformFlags);
    merged.tiktok = mergeSection(sourceConfig.tiktok, overrideConfig.tiktok, {
        ...platformFlags,
        sharesEnabled: true
    });

    merged.gui = mergeSection(sourceConfig.gui, overrideConfig.gui, {
        enableDock: true,
        enableOverlay: true,
        uiCompareMode: true,
        showMessages: true,
        showCommands: true,
        showGreetings: true,
        showFarewells: true,
        showFollows: true,
        showShares: true,
        showRaids: true,
        showGifts: true,
        showPaypiggies: true,
        showGiftPaypiggies: true,
        showEnvelopes: true
    });

    const sourceCooldowns = sourceConfig.cooldowns || {};
    const overrideCooldowns = overrideConfig.cooldowns || {};
    merged.cooldowns = {
        ...sourceCooldowns,
        ...overrideCooldowns,
        cmdCooldown: 0,
        cmdCooldownMs: 0,
        globalCmdCooldown: 0,
        globalCmdCooldownMs: 0,
        heavyCommandCooldown: 0,
        heavyCommandCooldownMs: 0,
        heavyCommandWindow: overrideCooldowns.heavyCommandWindow ?? sourceCooldowns.heavyCommandWindow ?? 1,
        heavyCommandWindowMs: overrideCooldowns.heavyCommandWindowMs ?? sourceCooldowns.heavyCommandWindowMs ?? 1000,
        heavyCommandThreshold: overrideCooldowns.heavyCommandThreshold ?? sourceCooldowns.heavyCommandThreshold ?? 999,
        maxEntries: overrideCooldowns.maxEntries ?? sourceCooldowns.maxEntries ?? 1000
    };

    merged.farewell = mergeSection(sourceConfig.farewell, overrideConfig.farewell, {
        timeout: overrideConfig?.farewell?.timeout ?? sourceConfig?.farewell?.timeout ?? 1,
        command: resolveNonEmptyString(overrideConfig?.farewell?.command, sourceConfig?.farewell?.command) || '!bye'
    });

    merged.displayQueue = mergeSection(sourceConfig.displayQueue, overrideConfig.displayQueue, {
        autoProcess: false
    });

    merged.commands = {
        ...(sourceConfig.commands || {}),
        ...(overrideConfig.commands || {}),
        preview: resolveNonEmptyString(overrideConfig?.commands?.preview, sourceConfig?.commands?.preview)
            || '!preview,Preview Media,1000'
    };

    return merged;
}

function buildPreviewScenarioEvents(durationMs = PREVIEW_DURATION_MS, intervalMs = PREVIEW_INTERVAL_MS) {
    const eventCount = Math.floor(durationMs / intervalMs);
    const events = [];

    const getAccount = (platform) => PREVIEW_PLATFORM_ACCOUNTS.find((entry) => entry.platform === platform) || PREVIEW_PLATFORM_ACCOUNTS[0];
    const firstPrimaryChatByPlatform = new Set();

    for (let index = 0; index < eventCount; index += 1) {
        const scenarioStep = PREVIEW_SCENARIO_TEMPLATE[index % PREVIEW_SCENARIO_TEMPLATE.length];
        const scenarioType = scenarioStep.type;
        const adapter = scenarioStep.adapter;
        const account = getAccount(adapter);
        const media = PREVIEW_MEDIA_CATALOG[adapter] || { avatarUrl: PREVIEW_AVATAR_URL, emote: null };
        const timestamp = new Date(Date.UTC(2024, 0, 1, 0, 0, index)).toISOString();
        const username = `${account.username}-${index}`;
        const userId = `${account.userId}-${index}`;
        const base = {
            username,
            userId,
            timestamp
        };
        const isPrimaryChatStep = scenarioType === 'chat';
        const includePreviewBadges = isPrimaryChatStep && !firstPrimaryChatByPlatform.has(adapter);
        if (includePreviewBadges) {
            firstPrimaryChatByPlatform.add(adapter);
        }

        if (adapter === 'twitch') {
            if (scenarioType === 'chat' || scenarioType === 'chat-hi' || scenarioType === 'chat-hello' || scenarioType === 'chat-command' || scenarioType === 'chat-farewell') {
                const text = scenarioType === 'chat-command'
                    ? '!preview'
                    : (scenarioType === 'chat-hi'
                        ? 'hi'
                        : (scenarioType === 'chat-hello'
                            ? 'hello'
                            : (scenarioType === 'chat-farewell' ? '!bye' : PREVIEW_MESSAGE_TEXT)));
                events.push({
                    platform: 'twitch',
                    adapter: 'twitch',
                    rawEvent: {
                        subscriptionType: 'channel.chat.message',
                        metadata: {
                            message_timestamp: timestamp,
                            previewPaypiggy: scenarioType === 'chat'
                        },
                        event: {
                            ...base,
                            user_name: username,
                            user_login: userId,
                            isPaypiggy: scenarioType === 'chat',
                            badgeImages: includePreviewBadges ? media.badges : undefined,
                            is_mod: false,
                            is_broadcaster: false,
                            message: {
                                text,
                                fragments: scenarioType === 'chat'
                                    ? [
                                        {
                                            type: 'emote',
                                            text: ':preview1:',
                                            emote: {
                                                id: media.emote?.id || 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7',
                                                emote_set_id: 'preview'
                                            }
                                        },
                                        { type: 'text', text: ' test message ' },
                                        {
                                            type: 'emote',
                                            text: ':preview2:',
                                            emote: {
                                                id: media.emote?.id || 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7',
                                                emote_set_id: 'preview'
                                            }
                                        },
                                        { type: 'text', text: ' hello world this is a message to everyone ' },
                                        {
                                            type: 'emote',
                                            text: ':preview3:',
                                            emote: {
                                                id: media.emote?.id || 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7',
                                                emote_set_id: 'preview'
                                            }
                                        },
                                        { type: 'text', text: ' how are we today?' }
                                    ]
                                    : [{ type: 'text', text }]
                            }
                        }
                    }
                });
                continue;
            }

            const twitchMap = {
                follow: 'channel.follow',
                gift: 'channel.bits.use',
                raid: 'channel.raid',
                paypiggy: 'channel.subscribe',
                giftpaypiggy: 'channel.subscription.gift'
            };
            const subscriptionType = twitchMap[scenarioType] || 'channel.follow';
            events.push({
                platform: 'twitch',
                adapter: 'twitch',
                rawEvent: {
                    subscriptionType,
                    metadata: {
                        message_timestamp: timestamp
                    },
                    event: {
                        ...base,
                        id: `test-${scenarioType}-${index}`,
                        user_name: username,
                        user_login: userId,
                        followed_at: timestamp,
                        from_broadcaster_user_name: username,
                        from_broadcaster_user_login: userId,
                        viewers: 42,
                        tier: '1000',
                        total: 2,
                        bits: 100,
                        is_anonymous: false,
                        is_gift: false
                    }
                }
            });
            continue;
        }

        if (adapter === 'youtube') {
            const isMemberHiChat = scenarioType === 'chat-member-hi';
            const isPreviewPaypiggyChat = scenarioType === 'chat';
            const eventType = scenarioType === 'giftpaypiggy'
                ? 'LiveChatSponsorshipsGiftPurchaseAnnouncement'
                : (scenarioType === 'gift' ? 'LiveChatPaidSticker' : (scenarioType === 'paypiggy' ? 'LiveChatMembershipItem' : 'LiveChatTextMessage'));
            const text = isMemberHiChat
                ? 'Hi!'
                : (scenarioType === 'chat-command'
                ? '!preview'
                : (scenarioType === 'chat-hi'
                    ? 'hi'
                    : (scenarioType === 'chat-hello'
                        ? 'hello'
                        : (scenarioType === 'chat-farewell' ? '!bye' : `preview message ${index}`))));
            events.push({
                platform: 'youtube',
                adapter: 'youtube',
                rawEvent: {
                    eventType,
                    chatItem: {
                        testData: {
                            ...base,
                            username,
                            userId,
                            message: text,
                            isPaypiggy: isPreviewPaypiggyChat || isMemberHiChat,
                            badgeImages: includePreviewBadges ? media.badges : undefined,
                            avatarUrl: media.avatarUrl,
                            messageParts: isPreviewPaypiggyChat
                                ? [
                                    {
                                        type: 'emote',
                                        imageUrl: media.emote?.imageUrl,
                                        emoteId: `${media.emote?.id || 'yt-preview-emote'}-1`
                                    },
                                    {
                                        type: 'text',
                                        text: ' test message '
                                    },
                                    {
                                        type: 'emote',
                                        imageUrl: media.emote?.imageUrl,
                                        emoteId: `${media.emote?.id || 'yt-preview-emote'}-2`
                                    },
                                    {
                                        type: 'text',
                                        text: ' hello world this is a message to everyone '
                                    },
                                    {
                                        type: 'emote',
                                        imageUrl: media.emote?.imageUrl,
                                        emoteId: `${media.emote?.id || 'yt-preview-emote'}-3`
                                    },
                                    {
                                        type: 'text',
                                        text: ' how are we today?'
                                    }
                                ]
                                : undefined,
                            amount: 5,
                            currency: 'USD',
                            giftCount: 3,
                            tier: '1'
                        }
                    }
                }
            });
            continue;
        }

        const tiktokEventType = scenarioType === 'gift'
            ? 'GIFT'
            : (scenarioType === 'follow' ? 'FOLLOW' : (scenarioType === 'share' ? 'SOCIAL' : (scenarioType === 'envelope' ? 'ENVELOPE' : 'CHAT')));
        const comment = scenarioType === 'chat-command'
            ? '!preview'
            : (scenarioType === 'chat-hi'
                ? 'hi'
                : (scenarioType === 'chat-hello'
                    ? 'hello'
                    : (scenarioType === 'chat-farewell'
                        ? '!bye'
                        : (scenarioType === 'chat-no'
                            ? 'test no no no no no no no no no no no no no no no no no no on no no no no no no no no no no no no no no no no no . no no no no no no no no no no on no no no no no'
                            : PREVIEW_MESSAGE_TEXT))));
        const tiktokEmotes = scenarioType === 'chat'
            ? [
                {
                    placeInComment: 5,
                    emote: {
                        emoteId: media.emote?.id || '0123456789012345678',
                        image: {
                            imageUrl: media.emote?.imageUrl
                        }
                    }
                },
                {
                    placeInComment: 17,
                    emote: {
                        emoteId: media.emote?.id || '0123456789012345678',
                        image: {
                            imageUrl: media.emote?.imageUrl
                        }
                    }
                },
                {
                    placeInComment: 33,
                    emote: {
                        emoteId: media.emote?.id || '0123456789012345678',
                        image: {
                            imageUrl: media.emote?.imageUrl
                        }
                    }
                }
            ]
            : undefined;
        events.push({
            platform: 'tiktok',
            adapter: 'tiktok',
            rawEvent: {
                eventType: tiktokEventType,
                data: {
                    ...base,
                    user: {
                        uniqueId: userId,
                        nickname: username,
                        profilePictureUrl: media.avatarUrl,
                        userId,
                        followRole: 0,
                        userBadges: []
                    },
                    badgeImages: includePreviewBadges ? media.badges : undefined,
                    comment,
                    isModerator: false,
                    isOwner: false,
                    userIdentity: {
                        isSubscriberOfAnchor: scenarioType === 'chat' || scenarioType === 'chat-no'
                    },
                    emotes: tiktokEmotes,
                    displayType: scenarioType === 'share' ? 'share' : undefined,
                    giftName: 'Rose',
                    repeatCount: 5,
                    diamondCount: 10,
                    ...(scenarioType === 'gift' && media?.gift?.imageUrl
                        ? {
                            gift: {
                                giftPictureUrl: media.gift.imageUrl
                            }
                        }
                        : {}),
                    msgId: `test-${scenarioType}-${index}`,
                    createTime: Math.floor(Date.parse(timestamp) / 1000)
                }
            }
        });
    }

    return events;
}

function createPreviewIngestAdapters(options = {}) {
    const { config, logger, emitPlatformEvent } = options;

    const emitChatEvent = (platform, payload) => {
        emitPlatformEvent({
            type: PlatformEvents.CHAT_MESSAGE,
            platform,
            data: {
                username: payload.username,
                userId: payload.userId,
                timestamp: payload.timestamp,
                avatarUrl: payload.avatarUrl || PREVIEW_AVATAR_URL,
                isPaypiggy: payload.isPaypiggy === true,
                isMod: payload.isMod === true,
                isBroadcaster: payload.isBroadcaster === true,
                metadata: payload.metadata || {},
                badgeImages: Array.isArray(payload.badgeImages) ? payload.badgeImages : [],
                message: payload.message
            }
        });
    };

    const twitchRouter = createTwitchEventSubEventRouter({
        config,
        logger,
        emit(eventName, payload) {
            if (eventName === 'chatMessage') {
                const messageText = payload?.message?.text || payload?.message || '';
                const messageParts = Array.isArray(payload?.message?.fragments)
                    ? payload.message.fragments
                        .map((fragment) => {
                            if (!fragment || typeof fragment !== 'object') {
                                return null;
                            }
                            if (fragment.type === 'emote' && fragment?.emote?.id) {
                                return {
                                    type: 'emote',
                                    platform: 'twitch',
                                    emoteId: fragment.emote.id,
                                    imageUrl: `https://static-cdn.jtvnw.net/emoticons/v2/${fragment.emote.id}/animated/dark/3.0`
                                };
                            }
                            if (fragment.type === 'text' && typeof fragment.text === 'string') {
                                return {
                                    type: 'text',
                                    text: fragment.text
                                };
                            }
                            return null;
                        })
                        .filter(Boolean)
                    : [];
                emitChatEvent('twitch', {
                    username: payload?.username || payload?.user_name,
                    userId: payload?.userId || payload?.user_login,
                    timestamp: payload?.timestamp,
                    isPaypiggy: payload?.isPaypiggy === true || payload?.metadata?.previewPaypiggy === true,
                    isMod: payload?.isMod === true || payload?.is_mod === true,
                    isBroadcaster: payload?.isBroadcaster === true || payload?.is_broadcaster === true,
                    metadata: payload?.metadata || {},
                    badgeImages: Array.isArray(payload?.badgeImages) ? payload.badgeImages : [],
                    message: messageParts.length > 0
                        ? {
                            text: messageText,
                            parts: messageParts
                        }
                        : { text: messageText }
                });
                return;
            }

            const map = {
                follow: PlatformEvents.FOLLOW,
                gift: PlatformEvents.GIFT,
                raid: PlatformEvents.RAID,
                paypiggy: PlatformEvents.PAYPIGGY,
                paypiggyGift: PlatformEvents.GIFTPAYPIGGY
            };
            const mappedType = map[eventName];
            if (!mappedType) {
                return;
            }
            emitPlatformEvent({ type: mappedType, platform: 'twitch', data: payload });
        }
    });

    const youtubePlatform = {
        logger,
        handleLowPriorityEvent() {},
        handleChatTextMessage(chatItem) {
            const source = chatItem?.testData || {};
            const messageParts = Array.isArray(source.messageParts)
                ? source.messageParts.filter((part) => part && typeof part === 'object')
                : [];
            emitChatEvent('youtube', {
                username: source.username,
                userId: source.userId,
                timestamp: source.timestamp,
                isPaypiggy: source.isPaypiggy === true,
                badgeImages: Array.isArray(source.badgeImages) ? source.badgeImages : [],
                message: messageParts.length > 0
                    ? {
                        text: source.message || '',
                        parts: messageParts
                    }
                    : { text: source.message || '' }
            });
        },
        handleSuperChat(chatItem) {
            const source = chatItem?.testData || {};
            emitPlatformEvent({ type: PlatformEvents.PAYPIGGY, platform: 'youtube', data: source });
        },
        handleSuperSticker(chatItem) {
            const source = chatItem?.testData || {};
            emitPlatformEvent({
                type: PlatformEvents.GIFT,
                platform: 'youtube',
                data: {
                    ...source,
                    id: source.id || `yt-gift-${source.timestamp}`,
                    giftType: 'SuperSticker',
                    giftCount: 1,
                    amount: source.amount || 5,
                    currency: source.currency || 'USD'
                }
            });
        },
        handleMembership(chatItem) {
            const source = chatItem?.testData || {};
            emitPlatformEvent({ type: PlatformEvents.PAYPIGGY, platform: 'youtube', data: source });
        },
        handleGiftMembershipPurchase(chatItem) {
            const source = chatItem?.testData || {};
            emitPlatformEvent({
                type: PlatformEvents.GIFTPAYPIGGY,
                platform: 'youtube',
                data: {
                    ...source,
                    giftCount: source.giftCount || 1,
                    tier: source.tier || '1'
                }
            });
        }
    };
    const youtubeRouter = createYouTubeEventRouter({ platform: youtubePlatform });

    const tiktokConnection = new EventEmitter();
    const tiktokPlatform = {
        logger,
        config,
        platformName: 'tiktok',
        connection: tiktokConnection,
        listenersConfigured: false,
        connectionTime: 0,
        WebcastEvent: {
            CHAT: 'CHAT',
            GIFT: 'GIFT',
            FOLLOW: 'FOLLOW',
            ROOM_USER: 'ROOM_USER',
            ENVELOPE: 'ENVELOPE',
            SUBSCRIBE: 'SUBSCRIBE',
            SUPER_FAN: 'SUPER_FAN',
            SOCIAL: 'SOCIAL',
            ERROR: 'ERROR',
            DISCONNECT: 'DISCONNECT',
            STREAM_END: 'STREAM_END'
        },
        ControlEvent: {
            DISCONNECTED: 'disconnected',
            ERROR: 'error'
        },
        errorHandler: createGuiPreviewErrorHandler(logger),
        _logIncomingEvent: async () => {},
        _getTimestamp(data) {
            return data.timestamp;
        },
        _getPlatformMessageId(data) {
            return data.msgId || null;
        },
        _handleChatMessage(_raw, normalizedData) {
            const payload = {
                ...normalizedData,
                badgeImages: Array.isArray(normalizedData?.badgeImages)
                    ? normalizedData.badgeImages
                    : (Array.isArray(_raw?.badgeImages) ? _raw.badgeImages : [])
            };
            emitChatEvent('tiktok', payload);
        },
        handleTikTokGift(data) {
            const sourceUser = data?.user || {};
            const giftImageUrl = typeof data?.gift?.giftPictureUrl === 'string'
                ? data.gift.giftPictureUrl
                : '';
            emitPlatformEvent({
                type: PlatformEvents.GIFT,
                platform: 'tiktok',
                data: {
                    username: sourceUser.nickname || sourceUser.uniqueId,
                    userId: sourceUser.uniqueId || sourceUser.userId,
                    timestamp: data.timestamp,
                    id: data.msgId,
                    giftType: data.giftName || 'Rose',
                    ...(giftImageUrl ? { giftImageUrl } : {}),
                    giftCount: Number(data.repeatCount) || 1,
                    amount: Number(data.diamondCount) || 10,
                    currency: 'coins'
                }
            });
        },
        handleTikTokFollow(data) {
            const sourceUser = data?.user || {};
            emitPlatformEvent({
                type: PlatformEvents.FOLLOW,
                platform: 'tiktok',
                data: {
                    username: sourceUser.nickname || sourceUser.uniqueId,
                    userId: sourceUser.uniqueId || sourceUser.userId,
                    timestamp: data.timestamp
                }
            });
        },
        handleTikTokSocial(data) {
            if (String(data.displayType || '').toLowerCase() !== 'share') {
                return;
            }
            const sourceUser = data?.user || {};
            emitPlatformEvent({
                type: PlatformEvents.SHARE,
                platform: 'tiktok',
                data: {
                    username: sourceUser.nickname || sourceUser.uniqueId,
                    userId: sourceUser.uniqueId || sourceUser.userId,
                    timestamp: data.timestamp
                }
            });
        },
        _handleStandardEvent(_eventType, data, options) {
            const sourceUser = data?.user || {};
            emitPlatformEvent({
                type: options.emitType,
                platform: 'tiktok',
                data: {
                    username: sourceUser.nickname || sourceUser.uniqueId,
                    userId: sourceUser.uniqueId || sourceUser.userId,
                    timestamp: data.timestamp,
                    id: data.msgId,
                    giftType: data.giftName || 'Rose',
                    giftCount: Number(data.repeatCount) || 1,
                    amount: Number(data.diamondCount) || 10,
                    currency: 'coins'
                }
            });
        }
    };
    setupTikTokEventListeners(tiktokPlatform);

    return {
        twitch: {
            async ingest(rawEvent) {
                const metadata = rawEvent.metadata || (rawEvent?.event?.timestamp
                    ? { message_timestamp: rawEvent.event.timestamp }
                    : {});
                twitchRouter.handleNotificationEvent(rawEvent.subscriptionType, rawEvent.event, metadata);
            }
        },
        youtube: {
            async ingest(rawEvent) {
                await youtubeRouter.routeEvent(rawEvent.chatItem, rawEvent.eventType);
            }
        },
        tiktok: {
            async ingest(rawEvent) {
                tiktokConnection.emit(rawEvent.eventType, rawEvent.data);
            }
        }
    };
}

function createPreviewRuntime(options) {
    const {
        config,
        logger,
        displayQueue,
        notificationManager,
        commandCooldownService,
        userTrackingService,
        vfxCommandService,
        platformLifecycleService
    } = options;

    const runtime = {
        config,
        logger,
        displayQueue,
        notificationManager,
        commandCooldownService,
        userTrackingService,
        vfxCommandService,
        platformLifecycleService,
        gracefulExitService: null,
        isFirstMessage: (userId, context) => userTrackingService.isFirstMessage(userId, context)
    };

    const forwardNotification = (notificationType) => async (platform, username, payload = {}) => {
        const response = await notificationManager.handleNotification(notificationType, platform, {
            ...payload,
            username,
            type: notificationType
        });
        return response;
    };

    runtime.handleFollowNotification = forwardNotification(PlatformEvents.FOLLOW);
    runtime.handleShareNotification = forwardNotification(PlatformEvents.SHARE);
    runtime.handleRaidNotification = forwardNotification(PlatformEvents.RAID);
    runtime.handleGiftNotification = forwardNotification(PlatformEvents.GIFT);
    runtime.handlePaypiggyNotification = forwardNotification(PlatformEvents.PAYPIGGY);
    runtime.handleGiftPaypiggyNotification = forwardNotification(PlatformEvents.GIFTPAYPIGGY);
    runtime.handleFarewellNotification = forwardNotification('farewell');
    runtime.handleEnvelopeNotification = async (platform, payload = {}) => {
        return notificationManager.handleNotification(PlatformEvents.ENVELOPE, platform, {
            ...payload,
            type: PlatformEvents.ENVELOPE
        });
    };

    const chatNotificationRouter = new ChatNotificationRouter({
        runtime,
        logger,
        config
    });

    runtime.handleChatMessage = async (platform, normalizedData = {}) => {
        return chatNotificationRouter.handleChatMessage(platform, normalizedData);
    };

    return {
        runtime,
        chatNotificationRouter
    };
}

function createPreviewPipeline(options = {}) {
    const config = options.config;
    const logger = resolveLogger(options.logger);
    const errorHandler = createGuiPreviewErrorHandler(logger);
    const eventBus = options.eventBus || createEventBus();

    const obsManager = options.obsManager || {
        isReady: async () => false
    };

    const displayQueue = options.displayQueue || new DisplayQueue(
        obsManager,
        {
            ...(config.displayQueue || {}),
            autoProcess: false,
            timing: config.timing,
            obs: config.obs
        },
        {
            PRIORITY_LEVELS,
            NOTIFICATION_CONFIGS
        },
        eventBus
    );

    const commandCooldownService = options.commandCooldownService || new CommandCooldownService({
        config,
        eventBus,
        logger
    });

    const userTrackingService = options.userTrackingService || createUserTrackingService();
    const vfxCommandService = options.vfxCommandService || createVFXCommandService(config, eventBus);

    const notificationManager = options.notificationManager || new NotificationManager({
        logger,
        constants: {
            PRIORITY_LEVELS,
            NOTIFICATION_CONFIGS
        },
        obsGoals: {
            processDonationGoal: () => {}
        },
        eventBus,
        config,
        vfxCommandService,
        userTrackingService,
        displayQueue
    });

    const platformLifecycleService = options.platformLifecycleService || {
        getPlatformConnectionTime: () => null
    };

    const { runtime } = createPreviewRuntime({
        config,
        logger,
        displayQueue,
        notificationManager,
        commandCooldownService,
        userTrackingService,
        vfxCommandService,
        platformLifecycleService
    });

    const platformEventRouter = new PlatformEventRouter({
        eventBus,
        runtime,
        notificationManager,
        config,
        logger
    });

    return {
        eventBus,
        emitIngestEvent(event) {
            eventBus.emit('platform:event', event);
        },
        async dispose() {
            try {
                platformEventRouter.dispose();
            } catch (error) {
                errorHandler.handleEventProcessingError(error, 'pipeline-dispose', null, 'Failed disposing platform router');
            }

            if (commandCooldownService && typeof commandCooldownService.dispose === 'function') {
                try {
                    commandCooldownService.dispose();
                } catch (error) {
                    errorHandler.handleEventProcessingError(error, 'pipeline-dispose', null, 'Failed disposing command cooldown service');
                }
            }
        }
    };
}

async function runPreviewScenario(options = {}) {
    const {
        pipeline,
        adapters,
        scenarioEvents,
        intervalMs,
        durationMs,
        safeSetIntervalImpl,
        safeSetTimeoutImpl,
        errorHandler
    } = options;

    let eventIndex = 0;
    const dispatchNextEvent = () => {
        if (eventIndex >= scenarioEvents.length) {
            return;
        }

        const event = scenarioEvents[eventIndex];
        const adapter = adapters[event.adapter];
        if (adapter && typeof adapter.ingest === 'function') {
            Promise.resolve(adapter.ingest(event.rawEvent)).catch((error) => {
                errorHandler.handleEventProcessingError(error, 'preview-ingest', event.rawEvent, 'Failed processing preview ingest event');
            });
        }
        eventIndex += 1;
    };

    dispatchNextEvent();

    const intervalHandle = safeSetIntervalImpl(() => {
        dispatchNextEvent();
    }, intervalMs);

    await new Promise((resolve) => {
        safeSetTimeoutImpl(resolve, durationMs);
    });

    return intervalHandle;
}

async function disposePreviewPipeline(options = {}) {
    const {
        intervalHandle,
        service,
        pipeline,
        errorHandler
    } = options;

    if (intervalHandle) {
        clearInterval(intervalHandle);
    }

    if (service && typeof service.stop === 'function') {
        try {
            await service.stop();
        } catch (error) {
            errorHandler.handleEventProcessingError(error, 'preview-cleanup', null, 'Failed stopping GUI preview transport');
        }
    }

    if (pipeline && typeof pipeline.dispose === 'function') {
        try {
            await pipeline.dispose();
        } catch (error) {
            errorHandler.handleEventProcessingError(error, 'preview-cleanup', null, 'Failed disposing GUI preview pipeline');
        }
    }
}

async function runGuiPreview(options = {}) {
    const config = buildPreviewConfig(options.baseConfig);
    const durationMs = Number.isInteger(options.durationMs) && options.durationMs > 0
        ? options.durationMs
        : PREVIEW_DURATION_MS;
    const intervalMs = Number.isInteger(options.intervalMs) && options.intervalMs > 0
        ? options.intervalMs
        : PREVIEW_INTERVAL_MS;

    const logger = resolveLogger(options.logger);
    const errorHandler = createGuiPreviewErrorHandler(logger);
    const createPreviewPipelineImpl = options.createPreviewPipelineImpl || createPreviewPipeline;
    const createPreviewIngestAdaptersImpl = options.createPreviewIngestAdaptersImpl || createPreviewIngestAdapters;
    const createGuiTransportServiceImpl = options.createGuiTransportServiceImpl || createGuiTransportService;
    const safeSetIntervalImpl = options.safeSetIntervalImpl || safeSetInterval;
    const safeSetTimeoutImpl = options.safeSetTimeoutImpl || safeSetTimeout;
    const stdout = options.stdout || process.stdout;

    let pipeline = null;
    let service = null;
    let intervalHandle = null;

    try {
        pipeline = createPreviewPipelineImpl({
            config,
            logger,
            eventBus: options.eventBus
        });

        if (!pipeline || typeof pipeline.emitIngestEvent !== 'function' || !pipeline.eventBus) {
            throw new Error('Preview pipeline requires eventBus and emitIngestEvent');
        }

        service = createGuiTransportServiceImpl({
            config,
            eventBus: pipeline.eventBus,
            logger
        });

        await service.start();

        const host = config.gui.host;
        const port = config.gui.port;
        stdout.write(`GUI preview running for ${Math.floor(durationMs / 1000)}s\n`);
        stdout.write(`Dock URL: http://${host}:${port}/dock\n`);
        stdout.write(`Overlay URL: http://${host}:${port}/overlay\n`);

        const scenarioEvents = buildPreviewScenarioEvents(durationMs, intervalMs);
        const adapters = createPreviewIngestAdaptersImpl({
            config,
            logger,
            emitPlatformEvent: (event) => pipeline.emitIngestEvent(event)
        });
        intervalHandle = await runPreviewScenario({
            pipeline,
            adapters,
            scenarioEvents,
            intervalMs,
            durationMs,
            safeSetIntervalImpl,
            safeSetTimeoutImpl,
            errorHandler
        });

        stdout.write('GUI preview finished\n');
    } catch (error) {
        errorHandler.handleEventProcessingError(error, 'preview-run', null, 'GUI preview failed');
        throw error;
    } finally {
        await disposePreviewPipeline({
            intervalHandle,
            service,
            pipeline,
            errorHandler
        });
    }
}

if (require.main === module) {
    runGuiPreview().catch((error) => {
        process.stderr.write(`GUI preview failed: ${error && error.message ? error.message : error}\n`);
        process.exit(1);
    });
}

module.exports = {
    PREVIEW_DURATION_MS,
    PREVIEW_INTERVAL_MS,
    PREVIEW_MEDIA_CATALOG,
    buildPreviewConfig,
    buildPreviewScenarioEvents,
    createPreviewPipeline,
    createPreviewIngestAdapters,
    runPreviewScenario,
    disposePreviewPipeline,
    runGuiPreview
};
