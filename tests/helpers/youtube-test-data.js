
// ================================================================================================
// HELPER FUNCTIONS
// ================================================================================================

const BASE_TIMESTAMP_MS = Date.parse('2024-01-01T00:00:00.000Z');
let sequence = 0;
const nextSequence = () => {
    sequence += 1;
    return sequence;
};
const nextTimestampMs = () => BASE_TIMESTAMP_MS + (nextSequence() * 1000);
const nextMessageId = () => `LCC.TEST.${nextSequence().toString(36).padStart(8, '0')}`;
const generateYouTubeChannelId = () => `UC_TEST_CHANNEL_${nextSequence().toString(36).padStart(8, '0')}`;

// ================================================================================================
// CORE YOUTUBE EVENT BUILDERS
// ================================================================================================

const createYouTubeChatEvent = (messageTypeOrOverrides = 'text', overrides = {}) => {
    // Support both calling patterns:
    // createYouTubeChatEvent('text', {overrides}) - original pattern
    // createYouTubeChatEvent({overrides}) - new pattern used by tests
    let messageType = 'text';
    let actualOverrides = {};
    
    if (typeof messageTypeOrOverrides === 'object' && messageTypeOrOverrides !== null) {
        // First parameter is overrides object
        actualOverrides = messageTypeOrOverrides;
        messageType = actualOverrides.messageType || 'text';
    } else {
        // First parameter is messageType string
        messageType = messageTypeOrOverrides;
        actualOverrides = overrides;
    }
    
    const baseTimestamp = nextTimestampMs();
    const baseUserId = generateYouTubeChannelId();
    
    const defaultEvent = {
        item: {
            type: 'LiveChatTextMessage',
            id: nextMessageId(),
            timestamp_usec: (baseTimestamp * 1000).toString(),
            message: messageType === 'emoji' ? '🎉🔥 Great stream!' : 'Hello everyone!',
            authorDetails: {
                channelId: baseUserId,
                channelUrl: `https://www.youtube.example.invalid/channel/${baseUserId}`,
                displayName: 'TestViewer',
                profileImageUrl: 'https://yt3.ggpht.example.invalid/test-profile.jpg',
                isVerified: false,
                isChatOwner: false,
                isChatSponsor: false,
                isChatModerator: false
            },
            textMessageDetails: {
                messageText: messageType === 'emoji' ? '🎉🔥 Great stream!' : 'Hello everyone!'
            }
        }
    };

    const mergedEvent = mergeDeep(defaultEvent, actualOverrides);
    
    // Add flat properties for easier access by handlers
    if (actualOverrides.message) {
        mergedEvent.message = actualOverrides.message;
    } else {
        mergedEvent.message = messageType === 'emoji' ? '🎉🔥 Great stream!' : 'Hello everyone!';
    }
    
    if (actualOverrides.username) {
        mergedEvent.username = actualOverrides.username;
    } else {
        mergedEvent.username = 'TestViewer';
    }
    
    if (actualOverrides.userId) {
        mergedEvent.userId = actualOverrides.userId;
    } else {
        mergedEvent.userId = baseUserId;
    }
    
    // Add timestamp for message filtering
    mergedEvent.timestamp = actualOverrides.timestamp || nextTimestampMs();
    
    return mergedEvent;
};

const createYouTubeSuperChatEvent = (amountOrOverrides = 5.00, currency = 'USD', overrides = {}) => {
    // Support both calling patterns:
    // createYouTubeSuperChatEvent(5.00, 'USD', {overrides}) - original pattern
    // createYouTubeSuperChatEvent({amount: 5.00, currency: 'USD', ...}) - new pattern
    let amount = 5.00;
    let actualCurrency = 'USD';
    let actualOverrides = {};
    
    if (typeof amountOrOverrides === 'object' && amountOrOverrides !== null) {
        // First parameter is overrides object - handle zero amounts properly
        actualOverrides = amountOrOverrides;
        amount = (actualOverrides.amount !== null && actualOverrides.amount !== undefined) ? Number(actualOverrides.amount) : 5.00;
        actualCurrency = actualOverrides.currency || 'USD';
    } else {
        // Original pattern - handle zero values properly
        amount = (amountOrOverrides !== null && amountOrOverrides !== undefined) ? Number(amountOrOverrides) : 5.00;
        actualCurrency = currency;
        actualOverrides = overrides;
    }
    
    const baseTimestamp = nextTimestampMs();
    const baseUserId = generateYouTubeChannelId();
    
    const defaultEvent = {
        item: {
            type: 'LiveChatPaidMessage',
            id: nextMessageId(),
            timestamp_usec: (baseTimestamp * 1000).toString(),
            authorDetails: {
                channelId: baseUserId,
                channelUrl: `https://www.youtube.example.invalid/channel/${baseUserId}`,
                displayName: 'SuperChatUser',
                profileImageUrl: 'https://yt3.ggpht.example.invalid/superchat-profile.jpg',
                isVerified: false,
                isChatOwner: false,
                isChatSponsor: true,
                isChatModerator: false
            },
            author: {
                id: baseUserId,
                name: 'SuperChatUser',
                thumbnails: [
                    {
                        url: 'https://yt3.ggpht.example.invalid/superchat-profile.jpg',
                        width: 32,
                        height: 32
                    }
                ],
                is_verified: false,
                is_moderator: false
            },
            liveChatPaidMessageRenderer: {
                id: nextMessageId(),
                timestamp_usec: (baseTimestamp * 1000).toString(),
                authorName: {
                    simpleText: 'SuperChatUser'
                },
                purchaseAmountText: {
                    simpleText: `${actualCurrency === 'USD' ? '$' : actualCurrency}${amount.toFixed(2)}`
                },
                message: {
                    runs: [
                        { text: 'Thanks for the amazing content! Keep it up!' }
                    ]
                },
                headerBackgroundColor: 0xff1e88e5,
                headerTextColor: 0xffffffff,
                bodyBackgroundColor: 0xfff3f4f6,
                bodyTextColor: 0xff000000,
                authorPhoto: {
                    thumbnails: [
                        {
                            url: 'https://yt3.ggpht.example.invalid/superchat-profile.jpg',
                            width: 32,
                            height: 32
                        }
                    ]
                }
            },
            // Additional format fields
            purchase_amount: `${actualCurrency === 'USD' ? '$' : actualCurrency}${amount.toFixed(2)}`,
            message: {
                text: 'Thanks for the amazing content! Keep it up!',
                runs: [
                    { text: 'Thanks for the amazing content! Keep it up!' }
                ]
            }
        }
    };

    return mergeDeep(defaultEvent, actualOverrides);
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
    createYouTubeChatEvent,
    createYouTubeSuperChatEvent,
    
    // Utilities
    mergeDeep
};
