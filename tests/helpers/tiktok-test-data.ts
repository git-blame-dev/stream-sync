
// ================================================================================================
// CORE TIKTOK EVENT BUILDERS
// ================================================================================================

const BASE_TIMESTAMP_MS = 1700000000000;
const BASE_USER_ID = 7000000000000000;
const BASE_ROOM_ID = 7500000000000000;
let sequence = 0;

const nextSequence = () => {
    sequence += 1;
    return sequence;
};

const timestampFromSeed = (seed) => BASE_TIMESTAMP_MS + (seed * 1000);
const userIdFromSeed = (seed) => BASE_USER_ID + seed;
const roomIdFromSeed = (seed) => BASE_ROOM_ID + seed;
const userSeedFromId = (baseUserId) => Number(String(baseUserId).slice(-4));

const buildTikTokUser = (baseUserId, overrides = {}) => {
    const userSeed = userSeedFromId(baseUserId);

    return {
        userId: baseUserId.toString(),
        uniqueId: `testuser_${userSeed}`,
        nickname: `TikTokUser${userSeed}`,
        profilePictureUrl: `https://example.invalid/tiktok/avatar/${baseUserId}.jpeg`,
        isFollowing: userSeed % 2 === 0,
        isModerator: userSeed % 5 === 0,
        isNewGifter: userSeed % 3 === 0,
        isSubscriber: userSeed % 4 === 0,
        topGifterRank: null,
        gifterLevel: (userSeed % 50) + 1,
        teamMemberLevel: 0,
        badges: [],
        ...overrides
    };
};

const createTikTokGiftEvent = (giftName = 'Rose', giftCount = 1, overrides = {}) => {
    const seed = nextSequence();
    const baseTimestamp = timestampFromSeed(seed);
    const baseUserId = userIdFromSeed(seed);
    
    // Gift type configurations
    const giftConfigs = {
        'Rose': { id: 5655, type: 1, diamonds: 1, picture: 'rose.webp' },
        'Perfume': { id: 5658, type: 1, diamonds: 20, picture: 'perfume.webp' },
        'Swan': { id: 5659, type: 1, diamonds: 25, picture: 'swan.webp' },
        'Heart Me': { id: 5487, type: 1, diamonds: 25, picture: 'heart_me.webp' },
        'Sunglasses': { id: 5510, type: 1, diamonds: 50, picture: 'sunglasses.webp' },
        'TikTok Universe': { id: 5655359, type: 1, diamonds: 34999, picture: 'tiktok_universe.webp' },
        'Lion': { id: 5662, type: 1, diamonds: 29999, picture: 'lion.webp' },
        'Falcon': { id: 5663, type: 1, diamonds: 10999, picture: 'falcon.webp' }
    };
    
    const giftConfig = giftConfigs[giftName] || giftConfigs['Rose'];
    
    const defaultEvent = {
        gift: {
            giftName: giftName,
            giftId: giftConfig.id,
            giftType: giftConfig.type,
            diamondCount: giftConfig.diamonds,
            giftPictureUrl: `https://example.invalid/tiktok/gifts/${giftConfig.picture}`,
            describe: `Send ${giftName}`,
            repeatCount: giftCount,
            repeatEnd: giftCount === 1
        },
        user: buildTikTokUser(baseUserId),
        giftCount: giftCount,
        repeatCount: giftCount,
        groupId: `gift_${seed}`,
        createTime: baseTimestamp,
        msgId: baseTimestamp.toString()
    };

    return mergeDeep(defaultEvent, overrides);
};

const createTikTokFollowEvent = (overrides = {}) => {
    const seed = nextSequence();
    const baseTimestamp = timestampFromSeed(seed);
    const baseUserId = userIdFromSeed(seed);
    
    const defaultEvent = {
        user: buildTikTokUser(baseUserId, {
            uniqueId: `newfollower_${seed}`,
            nickname: `NewFollower${seed}`,
            profilePictureUrl: `https://example.invalid/tiktok/avatar/${baseUserId}.jpeg`,
            isFollowing: true,
            isModerator: false,
            isNewGifter: true,
            isSubscriber: false,
            followRole: 1,
            followInfo: {
                followerCount: 100 + seed,
                followingCount: 50 + seed
            },
            badges: []
        }),
        createTime: baseTimestamp,
        msgId: baseTimestamp.toString(),
        displayType: 'pm_main_follow_message_viewer_2',
        label: '{0:user} followed you'
    };

    return mergeDeep(defaultEvent, overrides);
};

const createTikTokChatEvent = (messageText = 'Hello from TikTok!', overrides = {}) => {
    const seed = nextSequence();
    const baseTimestamp = timestampFromSeed(seed);
    const baseUserId = userIdFromSeed(seed);
    
    const defaultEvent = {
        comment: messageText,
        user: buildTikTokUser(baseUserId, {
            uniqueId: `chatter_${seed}`,
            nickname: `ChatUser${seed}`,
            profilePictureUrl: `https://example.invalid/tiktok/avatar/${baseUserId}.jpeg`
        }),
        createTime: baseTimestamp,
        msgId: baseTimestamp.toString()
    };

    return mergeDeep(defaultEvent, overrides);
};

const createTikTokShareEvent = (overrides = {}) => {
    const seed = nextSequence();
    const baseTimestamp = timestampFromSeed(seed);
    const baseUserId = userIdFromSeed(seed);
    
    const defaultEvent = {
        user: buildTikTokUser(baseUserId, {
            uniqueId: `sharer_${seed}`,
            nickname: `ShareUser${seed}`,
            profilePictureUrl: `https://example.invalid/tiktok/avatar/${baseUserId}.jpeg`,
            isModerator: false,
            badges: []
        }),
        createTime: baseTimestamp,
        msgId: baseTimestamp.toString(),
        displayType: 'pm_mt_guidance_share',
        label: '{0:user} shared the LIVE'
    };

    return mergeDeep(defaultEvent, overrides);
};

const createTikTokViewerCountEvent = (viewerCount = null, overrides = {}) => {
    const seed = nextSequence();
    const baseTimestamp = timestampFromSeed(seed);
    const actualViewerCount = viewerCount !== null ? viewerCount : 100 + (seed % 450);
    
    const defaultEvent = {
        viewerCount: actualViewerCount,
        timestamp: baseTimestamp,
        isLive: true,
        roomStats: {
            totalUser: actualViewerCount,
            userCountShowStr: actualViewerCount.toString(),
            audienceCount: actualViewerCount,
            giftUnauthLimit: false,
            giftAuthLimit: false,
            chatUnauthLimit: false,
            chatAuthLimit: false
        }
    };

    return mergeDeep(defaultEvent, overrides);
};

const createTikTokConnectionEvent = (connectionState = 'connected', overrides = {}) => {
    const seed = nextSequence();
    const baseTimestamp = timestampFromSeed(seed);
    const roomId = roomIdFromSeed(seed);
    
    const baseEvent = {
        state: connectionState,
        timestamp: baseTimestamp,
        msgId: baseTimestamp.toString()
    };

    if (connectionState === 'connected') {
        baseEvent.roomInfo = {
            ownerUserId: roomId.toString(),
            roomId: roomId.toString(),
            title: 'Test TikTok Live Stream',
            userCount: 50 + (seed % 500),
            totalUser: 100 + (seed % 1000),
            liveTypeAudio: false,
            liveTypeVideo: true,
            liveTypeLinkMic: false,
            liveTypeThirdParty: false
        };
    }

    return mergeDeep(baseEvent, overrides);
};

// ================================================================================================
// BATCH EVENT BUILDERS
// ================================================================================================

const createTikTokGiftEventBatch = (count = 5, baseConfig = {}) => {
    const events = [];
    const giftTypes = ['Rose', 'Perfume', 'Swan', 'Heart Me', 'Sunglasses'];
    const usernames = ['GiftUser1', 'GiftUser2', 'GiftUser3', 'GenerousViewer', 'TikTokFan'];

    for (let i = 0; i < count; i++) {
        const giftType = giftTypes[i % giftTypes.length];
        const eventUser = {
            uniqueId: usernames[i % usernames.length],
            nickname: usernames[i % usernames.length]
        };
        if (baseConfig.userId !== undefined && baseConfig.userId !== null) {
            eventUser.userId = baseConfig.userId;
        }
        const eventConfig = {
            user: eventUser,
            ...baseConfig
        };

        events.push(createTikTokGiftEvent(giftType, 1, eventConfig));
    }

    return events;
};

const createTikTokSpamGiftScenario = (giftCount = 5, giftType = 'Rose', timeWindow = 2000) => {
    const seed = nextSequence();
    const baseUserId = userIdFromSeed(seed);
    const startTime = timestampFromSeed(seed);
    const username = `SpamUser${seed}`;
    
    const events = [];
    const timeInterval = timeWindow / giftCount;

    for (let i = 0; i < giftCount; i++) {
        const eventTime = startTime + (i * timeInterval);
        const event = createTikTokGiftEvent(giftType, 1, {
            user: {
                userId: baseUserId.toString(),
                uniqueId: username,
                nickname: username
            },
            createTime: eventTime,
            msgId: eventTime.toString()
        });
        
        events.push(event);
    }

    return {
        events: events,
        metadata: {
            giftType: giftType,
            giftCount: giftCount,
            timeWindow: timeWindow,
            userId: baseUserId.toString(),
            username: username,
            startTime: startTime,
            endTime: startTime + timeWindow,
            averageInterval: timeInterval
        }
    };
};

const createTikTokChatConversation = (messages, usernames = ['User1', 'User2']) => {
    const events = [];
    const baseTime = timestampFromSeed(nextSequence());

    messages.forEach((message, index) => {
        const username = usernames[index % usernames.length];
        const eventTime = baseTime + (index * 1000); // 1 second apart
        
        const event = createTikTokChatEvent(message, {
            user: {
                userId: `chat-user-${index + 1}`,
                uniqueId: username,
                nickname: username
            },
            createTime: eventTime,
            msgId: eventTime.toString()
        });
        
        events.push(event);
    });

    return events;
};

// ================================================================================================
// UTILITY FUNCTIONS
// ================================================================================================

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
    createTikTokGiftEvent,
    createTikTokFollowEvent,
    createTikTokChatEvent,
    createTikTokShareEvent,
    createTikTokViewerCountEvent,
    createTikTokConnectionEvent,
    
    // Batch builders
    createTikTokGiftEventBatch,
    createTikTokSpamGiftScenario,
    createTikTokChatConversation,
    
    // Utilities
    mergeDeep
};
