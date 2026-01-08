
// ================================================================================================
// CORE TWITCH EVENT BUILDERS
// ================================================================================================

const BASE_TIMESTAMP_MS = Date.parse('2024-01-01T00:00:00.000Z');
let sequence = 0;

const nextSequence = () => {
    sequence += 1;
    return sequence;
};

const nextTimestampMs = () => BASE_TIMESTAMP_MS + (nextSequence() * 1000);
const nextTimestampIso = () => new Date(nextTimestampMs()).toISOString();
const nextNumericId = () => 100000000 + nextSequence();
const isFlagSet = (seed, divisor) => seed % divisor === 0;
const formatUserId = (id) => `test-user-${id}`;
const formatBroadcasterId = (id) => `test-broadcaster-${id}`;

const createTwitchChatEvent = (messageText = 'Hello Twitch!', username = 'testuser', overrides = {}) => {
    const baseTimestamp = nextTimestampMs();
    const baseUserId = nextNumericId();
    
    const defaultEvent = {
        channel: '#testchannel',
        username: username.toLowerCase(),
        message: messageText,
        userInfo: {
            userId: formatUserId(baseUserId),
            displayName: username,
            color: generateRandomHexColor(baseUserId),
            badges: {
                subscriber: isFlagSet(baseUserId, 3) ? '12' : null,
                premium: isFlagSet(baseUserId, 5) ? '1' : null
            },
            mod: isFlagSet(baseUserId, 7),
            subscriber: isFlagSet(baseUserId, 3),
            turbo: isFlagSet(baseUserId, 11),
            'first-msg': isFlagSet(baseUserId, 13),
            'returning-chatter': isFlagSet(baseUserId, 17),
            emotes: {},
            'message-type': 'chat',
            'user-type': isFlagSet(baseUserId, 7) ? 'mod' : null
        },
        timestamp: baseTimestamp,
        id: `test-chat-${baseUserId}-${baseTimestamp}`,
        self: false
    };

    return mergeDeep(defaultEvent, overrides);
};

const createTwitchEventSubEvent = (eventType = 'channel.follow', overrides = {}) => {
    const baseTimestamp = nextTimestampIso();
    const messageId = generateUUID();
    const subscriptionId = generateUUID();
    
    const defaultEvent = {
        metadata: {
            message_id: messageId,
            message_type: 'notification',
            message_timestamp: baseTimestamp,
            subscription_type: eventType,
            subscription_version: '1'
        },
        subscription: {
            id: subscriptionId,
            type: eventType,
            version: '1',
            status: 'enabled',
            cost: 1,
            condition: {
                broadcaster_user_id: 'test-broadcaster-id'
            },
            transport: {
                method: 'websocket',
                session_id: generateUUID()
            },
            created_at: baseTimestamp
        },
        event: {} // Populated by specific event builders
    };

    return mergeDeep(defaultEvent, overrides);
};

const createTwitchFollowEvent = (overrides = {}) => {
    const baseUserId = nextNumericId();
    const broadcasterId = nextNumericId();
    const timestamp = nextTimestampIso();
    
    const followEvent = createTwitchEventSubEvent('channel.follow', {
        subscription: {
            condition: {
                broadcaster_user_id: formatBroadcasterId(broadcasterId),
                moderator_user_id: formatBroadcasterId(broadcasterId)
            }
        },
        event: {
            user_id: formatUserId(baseUserId),
            user_login: `follower${baseUserId}`,
            user_name: `Follower${baseUserId}`,
            broadcaster_user_id: formatBroadcasterId(broadcasterId),
            broadcaster_user_login: 'testchannel',
            broadcaster_user_name: 'TestChannel',
            followed_at: timestamp
        }
    });

    return mergeDeep(followEvent, overrides);
};

const createTwitchSubscriptionEvent = (tier = '1000', isGift = false, overrides = {}) => {
    const baseUserId = nextNumericId();
    const broadcasterId = nextNumericId();
    const gifterId = isGift ? nextNumericId() : null;
    
    const subscriptionEvent = createTwitchEventSubEvent('channel.subscribe', {
        event: {
            user_id: formatUserId(baseUserId),
            user_login: `subscriber${baseUserId}`,
            user_name: `Subscriber${baseUserId}`,
            broadcaster_user_id: formatBroadcasterId(broadcasterId),
            broadcaster_user_login: 'testchannel',
            broadcaster_user_name: 'TestChannel',
            tier: tier,
            is_gift: isGift,
            ...(isGift && {
                gifter_user_id: formatUserId(gifterId),
                gifter_user_login: `gifter${gifterId}`,
                gifter_user_name: `Gifter${gifterId}`
            })
        }
    });

    return mergeDeep(subscriptionEvent, overrides);
};

const createTwitchRaidEvent = (viewers = 100, overrides = {}) => {
    const fromBroadcasterId = nextNumericId();
    const toBroadcasterId = nextNumericId();
    
    const raidEvent = createTwitchEventSubEvent('channel.raid', {
        event: {
            from_broadcaster_user_id: formatBroadcasterId(fromBroadcasterId),
            from_broadcaster_user_login: `raider${fromBroadcasterId}`,
            from_broadcaster_user_name: `Raider${fromBroadcasterId}`,
            to_broadcaster_user_id: formatBroadcasterId(toBroadcasterId),
            to_broadcaster_user_login: 'testchannel',
            to_broadcaster_user_name: 'TestChannel',
            viewers: viewers
        }
    });

    return mergeDeep(raidEvent, overrides);
};

// ================================================================================================
// UTILITY FUNCTIONS
// ================================================================================================

const generateRandomHexColor = (seed) => {
    const value = typeof seed === 'number' ? seed : nextSequence();
    const hex = ((value * 2654435761) >>> 0).toString(16).padStart(6, '0').slice(-6).toUpperCase();
    return `#${hex}`;
};

const generateUUID = (seed) => {
    const value = typeof seed === 'number' ? seed : nextSequence();
    const hex = value.toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${hex}`;
};

const mergeDeep = (target, source) => {
    const output = Object.assign({}, target);
    if (isObject(target) && isObject(source)) {
        Object.keys(source).forEach(key => {
            if (isObject(source[key])) {
                if (!(key in target))
                    Object.assign(output, { [key]: source[key] });
                else
                    output[key] = mergeDeep(target[key], source[key]);
            } else {
                Object.assign(output, { [key]: source[key] });
            }
        });
    }
    return output;
};

const isObject = (item) => {
    return item && typeof item === 'object' && !Array.isArray(item);
};

// ================================================================================================
// EXPORTS
// ================================================================================================

module.exports = {
    // Core event builders
    createTwitchChatEvent,
    createTwitchEventSubEvent,
    createTwitchFollowEvent,
    createTwitchSubscriptionEvent,
    createTwitchRaidEvent,
    
    // Utilities
    generateRandomHexColor,
    generateUUID,
    mergeDeep
};
