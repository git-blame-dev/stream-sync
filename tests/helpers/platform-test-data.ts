
// Import platform-specific builders
const { createYouTubeSuperChatEvent, createYouTubeChatEvent } = require('./youtube-test-data');
const { createTikTokGiftEvent, createTikTokChatEvent } = require('./tiktok-test-data');
const { createTwitchChatEvent, createTwitchSubscriptionEvent, createTwitchRaidEvent } = require('./twitch-test-data');

const BASE_TIMESTAMP_MS = 1700000000000;
const BASE_USER_ID = 7000000000000000;
let sequence = 0;

const nextSequence = () => {
    sequence += 1;
    return sequence;
};

const timestampFromSeed = (seed, offsetMs = 0) => BASE_TIMESTAMP_MS + (seed * 1000) + offsetMs;
const pickByIndex = (values, index) => values[index % values.length];

// ================================================================================================
// INTERNATIONAL TEST DATA
// ================================================================================================

const INTERNATIONAL_USERNAMES = {
    // East Asian Scripts
    chinese: '用户名中文测试',
    chineseTraditional: '用戶名繁體測試',
    japanese: 'ユーザー名テスト',
    korean: '사용자이름테스트',
    
    // Arabic and RTL Scripts
    arabic: 'اسم المستخدم العربي',
    hebrew: 'שם משתמש עברי',
    persian: 'نام کاربری فارسی',
    
    // European Scripts
    russian: 'имя пользователя',
    greek: 'όνομα χρήστη',
    german: 'benutzernämeäöüß',
    french: 'nomutilisateuràéè',
    polish: 'nazwauserzażółć',
    
    // South Asian Scripts
    hindi: 'उपयोगकर्ता नाम',
    bengali: 'ব্যবহারকারীর নাম',
    tamil: 'பயனர் பெயர்',
    thai: 'ชื่อผู้ใช้ไทย',
    
    // African Scripts
    amharic: 'የተጠቃሚ ስም',
    swahili: 'jina la mtumiaji',
    
    // Emoji-heavy usernames
    emoji: '🌸DemoUser🌸',
    emojiMixed: '🎮Gamer用户123🎯',
    emojiOnly: '🔥💎⭐🎊💯',
    
    // Mixed script combinations
    mixed: '用户🎮Gamer123',
    mixedRtl: 'User用户اسم123',
    
    // Special cases
    longUnicode: '🌟非常长的用户名包含多种语言العربية和Русский以及🎮',
    mathematical: '𝕌𝕤𝕖𝕣𝔸𝕝𝕡𝕙𝔞',
    zalgo: 'U̸̢̻̺̫̺̬̪̬̯̤̲̤̟̯̻̝̅̈́̇̈́̊̌̈́̐̈̚ͅs̶̛̗̗̬̳̗̫̖̫̏̂̓͂̉̌̕e̴̢̧̨̛̗̙̱̼̰̳̘̞̮̥̱̯̰̎̐̇̄́̋̎̂̕ŕ̵̡̧̲̟̻̝̗̫̜̰̈́̂̊̍̊̾̉̀'
};

const PHASE_5B_INTERNATIONAL_TEST_DATA = {
    emoji: {
        username: "🎮GamerKing",
        language: "emoji",
        containsEmoji: true,
        testMessage: "Thanks for the gift! 🎉✨",
        currency: { symbol: "$", code: "USD" }
    },
    arabic: {
        username: "محمد_أحمد",
        language: "arabic",
        originalUsername: "محمد_أحمد",
        testMessage: "شكرا للهدية الرائعة!",
        currency: { symbol: "ر.س", code: "SAR" }
    },
    chinese: {
        username: "李小明",
        language: "chinese", 
        originalUsername: "李小明",
        testMessage: "谢谢你的礼物！",
        currency: { symbol: "¥", code: "CNY" }
    },
    spanish: {
        username: "Example_Usuario",
        language: "spanish",
        originalUsername: "Example_Usuario", 
        testMessage: "¡Gracias por el regalo!",
        currency: { symbol: "€", code: "EUR" }
    },
    cyrillic: {
        username: "Владимир",
        language: "cyrillic",
        originalUsername: "Владимир",
        testMessage: "Спасибо за подарок!",
        currency: { symbol: "₽", code: "RUB" }
    },
    japanese: {
        username: "田中太郎",
        language: "japanese",
        originalUsername: "田中太郎",
        testMessage: "ギフトをありがとう！",
        currency: { symbol: "¥", code: "JPY" }
    },
    korean: {
        username: "김철수",
        language: "korean", 
        originalUsername: "김철수",
        testMessage: "선물 고마워요!",
        currency: { symbol: "₩", code: "KRW" }
    },
    mixed: {
        username: "User_🌟_李明",
        language: "mixed",
        originalUsername: "User_🌟_李明",
        containsEmoji: true,
        testMessage: "Great stream! 很棒的直播! 🎉",
        currency: { symbol: "$", code: "USD" }
    },
    rtl_arabic: {
        username: "عبدالله_محمد",
        language: "arabic",
        originalUsername: "عبدالله_محمد",
        testMessage: "بث رائع! شكراً للدعم المستمر",
        currency: { symbol: "د.إ", code: "AED" },
        isRTL: true
    },
    hebrew: {
        username: "יוסף_כהן",
        language: "hebrew",
        originalUsername: "יוסף_כהן", 
        testMessage: "תודה על המתנה הנפלאה!",
        currency: { symbol: "₪", code: "ILS" },
        isRTL: true
    }
};

// ================================================================================================
// EDGE CASE AMOUNTS AND VALUES
// ================================================================================================

const EDGE_CASE_AMOUNTS = {
    // Boundary values
    zero: 0.00,
    minimal: 0.01,
    small: 0.99,
    medium: 5.00,
    large: 999.99,
    maximum: 50000.00,
    
    // Precision edge cases
    precision: 123.456789, // Will be rounded
    precisionLow: 0.001,    // Below minimum
    precisionHigh: 999.999,  // High precision
    
    // Special values
    negative: -5.00,        // Invalid but possible input
    infinity: Infinity,     // Mathematical edge case
    nan: NaN,              // Invalid numeric
    
    // Currency-specific
    japaneseYen: 1000,     // No decimal places
    bitcoinSatoshi: 0.00000001, // 8 decimal places
    
    // Large numbers
    millionaire: 1000000.00,
    billionaire: 1000000000.00,
    
    // Common payment amounts
    commonAmounts: [0.99, 1.99, 4.99, 9.99, 19.99, 49.99, 99.99]
};

// ================================================================================================
// BOUNDARY CONDITIONS
// ================================================================================================

const BOUNDARY_CONDITIONS = {
    // Length boundaries
    emptyString: '',
    singleChar: 'a',
    maxUsername: 'A'.repeat(255),     // Maximum typical username length
    maxMessage: 'A'.repeat(2000),     // Maximum typical message length
    longText: 'A'.repeat(10000),      // Extremely long text
    
    // Null and undefined
    nullValue: null,
    undefinedValue: undefined,
    emptyObject: {},
    emptyArray: [],
    
    // Whitespace variations
    singleSpace: ' ',
    multipleSpaces: '     ',
    tabCharacters: '\t\t\t',
    newlines: '\n\n\n',
    mixedWhitespace: ' \t\n\r ',
    
    // Special characters
    specialChars: '!@#$%^&*()_+-=[]{}|;:,.<>?',
    htmlTags: '<script>alert("test")</script>',
    sqlInjection: "'; DROP TABLE users; --",
    pathTraversal: '../../../etc/passwd',
    
    // Number boundaries
    maxInt32: 2147483647,
    minInt32: -2147483648,
    maxFloat: Number.MAX_VALUE,
    minFloat: Number.MIN_VALUE,
    
    // Date boundaries
    epochZero: new Date(0),
    dateMax: new Date(8640000000000000),  // Maximum JS date
    dateMin: new Date(-8640000000000000), // Minimum JS date
    
    // Platform-specific limits
    youtubeMaxChatLength: 200,
    twitchMaxChatLength: 500,
    tiktokMaxUsernameLength: 24,
    
    // Network simulation
    verySlowResponse: 30000,    // 30 seconds
    timeoutResponse: 60000,     // 1 minute
    
    // Memory pressure
    largeDataArray: new Array(100000).fill('test'),
    deepNesting: createDeepObject(100)
};

function createDeepObject(depth) {
    if (depth <= 0) return { value: 'bottom' };
    return { level: depth, nested: createDeepObject(depth - 1) };
}

// ================================================================================================
// SPECIAL CHARACTER SETS
// ================================================================================================

const SPECIAL_CHARACTERS = {
    // Basic symbols
    symbols: '!@#$%^&*()_+-=[]{}|\\:";\'<>?,./',
    
    // Punctuation
    punctuation: '.,;:!?"\'()[]{}',
    
    // Mathematical
    mathematical: '±×÷=≠≤≥∑∏∫√∞∂∆∇',
    
    // Currency symbols
    currency: '$€£¥₹₽₩₪₫₴₦₡₵',
    
    // Arrows and directions
    arrows: '←↑→↓↔↕↖↗↘↙⇐⇑⇒⇓⇔',
    
    // Dangerous characters (potential injection)
    dangerous: '<>"\'&;`|$(){}[]\\',
    
    // Zero-width characters
    zeroWidth: '\u200B\u200C\u200D\u2060\uFEFF',
    
    // Control characters
    control: '\x00\x01\x02\x03\x04\x05\x06\x07\x08\x0E\x0F',
    
    // Box drawing
    boxDrawing: '┌┐└┘├┤┬┴┼─│╔╗╚╝╠╣╦╩╬═║',
    
    // Braille patterns
    braille: '⠀⠁⠂⠃⠄⠅⠆⠇⠈⠉⠊⠋⠌⠍⠎⠏'
};

// ================================================================================================
// EMOJI COLLECTIONS
// ================================================================================================

const EMOJI_SETS = {
    // Basic faces
    faces: '😀😁😂🤣😃😄😅😆😉😊😋😎😍🥰😘',
    
    // Gaming and streaming
    gaming: '🎮🕹️🎯🎲🎪🎨🎭🎪🎨🎵🎶🎤🎧🎬🎥',
    
    // Celebration
    celebration: '🎉🎊🥳🎈🎁🎀🎂🍰🥂🍾✨💫⭐🌟💥',
    
    // Hearts and love
    hearts: '❤️🧡💛💚💙💜🖤🤍🤎💕💖💗💘💝💟💌',
    
    // Animals
    animals: '🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵',
    
    // Food and drinks
    food: '🍎🍕🍔🍟🌭🥪🌮🌯🥙🥗🍜🍲🍛🍣🍱',
    
    // Activities
    activities: '⚽🏀🏈⚾🎾🏐🏉🎱🏓🏸🥅🏒🏑🏏⛳',
    
    // Flags (country codes)
    flags: '🇺🇸🇬🇧🇨🇦🇦🇺🇩🇪🇫🇷🇯🇵🇰🇷🇨🇳🇮🇳🇧🇷',
    
    // Hand gestures
    hands: '👋🤚🖐️✋🖖👌🤌🤏✌️🤞🤟🤘🤙👈👉👆🖕👇☝️',
    
    // Recent additions (may not display on all systems)
    modern: '🥺👉👈💅✨😌🔥💯📈📉🚀🌙⚡💎🎭🎪'
};

// ================================================================================================
// SCENARIO BUILDERS
// ================================================================================================

const createMultiPlatformEventScenario = (platforms = ['youtube', 'twitch', 'tiktok'], eventCount = 10) => {
    const events = [];
    const timeline = [];
    const baseTime = timestampFromSeed(nextSequence());
    
    for (let i = 0; i < eventCount; i++) {
        const platform = platforms[i % platforms.length];
        const eventTime = baseTime + (i * 2000); // 2 seconds apart
        let event;
        
        switch (platform) {
            case 'youtube':
                event = createYouTubeSuperChatEvent(
                    EDGE_CASE_AMOUNTS.commonAmounts[i % EDGE_CASE_AMOUNTS.commonAmounts.length],
                    'USD',
                    {
                        item: {
                            timestamp_usec: (eventTime * 1000).toString(),
                            authorDetails: {
                                displayName: Object.values(INTERNATIONAL_USERNAMES)[i % Object.values(INTERNATIONAL_USERNAMES).length]
                            }
                        }
                    }
                );
                event.platform = 'youtube';
                break;
                
            case 'tiktok':
                const giftTypes = ['Rose', 'Perfume', 'Swan', 'TikTok Universe'];
                event = createTikTokGiftEvent(
                    giftTypes[i % giftTypes.length],
                    (i % 5) + 1,
                    {
                        timestamp: eventTime,
                        user: {
                            userId: `${1000 + i}`,
                            uniqueId: Object.values(INTERNATIONAL_USERNAMES)[i % Object.values(INTERNATIONAL_USERNAMES).length]
                        }
                    }
                );
                event.platform = 'tiktok';
                break;
                
            case 'twitch':
                if (i % 3 === 0) {
                    // Subscription event
                    event = createTwitchSubscriptionEvent('1000', false, {
                        metadata: {
                            message_timestamp: new Date(eventTime).toISOString()
                        }
                    });
                } else {
                    // Chat event
                    event = createTwitchChatEvent(
                        `Hello from ${platform}! ${EMOJI_SETS.celebration}`,
                        Object.values(INTERNATIONAL_USERNAMES)[i % Object.values(INTERNATIONAL_USERNAMES).length],
                        {
                            timestamp: eventTime
                        }
                    );
                }
                event.platform = 'twitch';
                break;
        }
        
        events.push(event);
        timeline.push({
            timestamp: eventTime,
            platform: platform,
            eventType: event.subscription?.type || event.item?.type || 'chat',
            index: i
        });
    }
    
    return {
        platforms: platforms,
        events: events,
        timeline: timeline,
        metadata: {
            totalEvents: eventCount,
            platformDistribution: platforms.reduce((acc, platform) => {
                acc[platform] = events.filter(e => e.platform === platform).length;
                return acc;
            }, {}),
            timeSpan: timeline[timeline.length - 1].timestamp - timeline[0].timestamp,
            startTime: baseTime,
            endTime: baseTime + ((eventCount - 1) * 2000)
        }
    };
};

const createGiftSpamScenario = (giftCount = 10, giftType = 'Rose', timeWindow = 2000) => {
    const events = [];
    const seed = nextSequence();
    const baseUserId = BASE_USER_ID + seed;
    const startTime = timestampFromSeed(seed);
    const timeInterval = timeWindow / giftCount;
    const username = pickByIndex(Object.values(INTERNATIONAL_USERNAMES), seed);
    
    for (let i = 0; i < giftCount; i++) {
        const eventTime = startTime + (i * timeInterval);
        const event = createTikTokGiftEvent(giftType, 1, {
            user: {
                userId: baseUserId.toString(),
                uniqueId: username,
                nickname: username
            },
            timestamp: eventTime,
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
            averageInterval: timeInterval,
            userId: baseUserId.toString(),
            username: username,
            startTime: startTime,
            endTime: startTime + timeWindow,
            detectionTrigger: giftCount >= 5 && timeWindow <= 5000, // Spam threshold
            spamScore: Math.min(giftCount / timeWindow * 1000, 1.0) // Events per second normalized
        }
    };
};

const createRaidScenario = (maxViewers = 500, targetChannel = 'testchannel') => {
    const events = [];
    const viewerProgression = [
        Math.floor(maxViewers * 0.1),  // Initial announcement
        Math.floor(maxViewers * 0.3),  // Early joiners
        Math.floor(maxViewers * 0.6),  // Mid raid
        Math.floor(maxViewers * 0.9),  // Near peak
        maxViewers                      // Peak raid
    ];
    
    const baseTime = timestampFromSeed(nextSequence());
    
    viewerProgression.forEach((viewers, index) => {
        const eventTime = baseTime + (index * 5000); // 5 seconds apart
        const event = createTwitchRaidEvent(viewers, {
            metadata: {
                message_timestamp: new Date(eventTime).toISOString()
            },
            event: {
                to_broadcaster_user_login: targetChannel,
                to_broadcaster_user_name: targetChannel,
                from_broadcaster_user_login: `raider${index + 1}`,
                from_broadcaster_user_name: `Raider${index + 1}`
            }
        });
        
        events.push(event);
    });
    
    return {
        events: events,
        metadata: {
            maxViewers: maxViewers,
            targetChannel: targetChannel,
            progression: viewerProgression,
            duration: 20000, // 20 seconds total
            raidEffectiveness: maxViewers / 100, // Arbitrary effectiveness score
            peakTime: baseTime + 20000
        }
    };
};

const createErrorScenario = (errorType = 'network', platform = 'youtube') => {
    const seed = nextSequence();
    const baseTime = timestampFromSeed(seed);
    const errorConfigs = {
        network: {
            trigger: 'Connection timeout after 30 seconds',
            expectedBehavior: 'Retry with exponential backoff',
            testData: null,
            simulatedDelay: 30000
        },
        api_limit: {
            trigger: 'API rate limit exceeded (429 status)',
            expectedBehavior: 'Pause requests and retry after reset',
            testData: { remainingRequests: 0, resetTime: baseTime + 900000 },
            simulatedDelay: 900000
        },
        malformed_data: {
            trigger: 'Invalid JSON or missing required fields',
            expectedBehavior: 'Log error and skip malformed event',
            testData: { 
                youtube: '{"item":{"type":"LiveChat", "invalid": true}}',
                twitch: '{"subscription":{"type":"channel.", "status":"}}',
                tiktok: '{"user":null,"gift":{"giftName":""}}'
            }[platform],
            simulatedDelay: 0
        },
        authentication: {
            trigger: 'Invalid or expired authentication token',
            expectedBehavior: 'Attempt token refresh, then disconnect',
            testData: { token: 'expired_token_12345', expiresAt: baseTime - 3600000 },
            simulatedDelay: 5000
        },
        websocket_close: {
            trigger: 'WebSocket connection closed unexpectedly',
            expectedBehavior: 'Attempt reconnection with backoff',
            testData: { closeCode: 1006, closeReason: 'Connection lost' },
            simulatedDelay: 0
        },
        overflow: {
            trigger: 'Memory or buffer overflow conditions',
            expectedBehavior: 'Clear buffers and continue processing',
            testData: { bufferSize: BOUNDARY_CONDITIONS.largeDataArray.length },
            simulatedDelay: 1000
        }
    };
    
    const config = errorConfigs[errorType] || errorConfigs.network;
    
    return {
        errorType: errorType,
        platform: platform,
        trigger: config.trigger,
        expectedBehavior: config.expectedBehavior,
        testData: config.testData,
        simulatedDelay: config.simulatedDelay,
        timestamp: baseTime,
        recoveryExpected: errorType !== 'authentication',
        retryCount: 0,
        maxRetries: 3
    };
};

const createInternationalUserScenario = (userCount = 10) => {
    const users = [];
    const events = [];
    const usernames = Object.values(INTERNATIONAL_USERNAMES);
    
    // Create diverse user profiles
    for (let i = 0; i < userCount; i++) {
        const username = usernames[i % usernames.length];
        const user = {
            username: username,
            platform: ['youtube', 'twitch', 'tiktok'][i % 3],
            language: detectLanguage(username),
            script: detectScript(username),
            isRTL: isRightToLeft(username),
            hasEmoji: /[\u{1f000}-\u{1f9ff}]/u.test(username)
        };
        users.push(user);
        
        // Create platform-specific events for each user
        const baseTime = timestampFromSeed(nextSequence(), i * 3000);
        
        switch (user.platform) {
            case 'youtube':
                events.push(createYouTubeChatEvent('text', {
                    item: {
                        textMessageDetails: {
                            messageText: `${EMOJI_SETS.faces} Hello from ${user.language}!`
                        },
                        authorDetails: {
                            displayName: username
                        },
                        timestamp_usec: (baseTime * 1000).toString()
                    }
                }));
                break;
                
            case 'tiktok':
                events.push(createTikTokChatEvent(
                    `${EMOJI_SETS.celebration} Great stream!`,
                    {
                        user: {
                            userId: `${1000 + i}`,
                            uniqueId: username,
                            nickname: username
                        },
                        timestamp: baseTime
                    }
                ));
                break;
                
            case 'twitch':
                events.push(createTwitchChatEvent(
                    `${EMOJI_SETS.gaming} Love this content!`,
                    username,
                    {
                        timestamp: baseTime
                    }
                ));
                break;
        }
    }
    
    return {
        users: users,
        events: events,
        metadata: {
            totalUsers: userCount,
            languageDistribution: users.reduce((acc, user) => {
                acc[user.language] = (acc[user.language] || 0) + 1;
                return acc;
            }, {}),
            scriptDistribution: users.reduce((acc, user) => {
                acc[user.script] = (acc[user.script] || 0) + 1;
                return acc;
            }, {}),
            rtlUserCount: users.filter(u => u.isRTL).length,
            emojiUserCount: users.filter(u => u.hasEmoji).length
        }
    };
};

const createBoundaryTestSuite = (platform = 'youtube') => {
    const testCases = [];
    
    // Max length tests
    testCases.push({
        type: 'max_length',
        description: 'Username at maximum length',
        testData: { username: BOUNDARY_CONDITIONS.maxUsername },
        expectedResult: 'truncate_or_reject'
    });
    
    testCases.push({
        type: 'max_length',
        description: 'Message at maximum length',
        testData: { message: BOUNDARY_CONDITIONS.maxMessage },
        expectedResult: 'truncate_or_reject'
    });
    
    // Empty value tests
    testCases.push({
        type: 'empty_value',
        description: 'Empty username',
        testData: { username: BOUNDARY_CONDITIONS.emptyString },
        expectedResult: 'reject_or_default'
    });
    
    testCases.push({
        type: 'empty_value',
        description: 'Null username',
        testData: { username: BOUNDARY_CONDITIONS.nullValue },
        expectedResult: 'reject_or_default'
    });
    
    // Special character tests
    testCases.push({
        type: 'special_chars',
        description: 'Username with special characters',
        testData: { username: `user${SPECIAL_CHARACTERS.symbols}123` },
        expectedResult: 'sanitize_or_reject'
    });
    
    testCases.push({
        type: 'special_chars',
        description: 'Message with dangerous characters',
        testData: { message: SPECIAL_CHARACTERS.dangerous },
        expectedResult: 'sanitize'
    });
    
    // Unicode tests
    testCases.push({
        type: 'unicode',
        description: 'International username',
        testData: { username: INTERNATIONAL_USERNAMES.mixed },
        expectedResult: 'preserve'
    });
    
    testCases.push({
        type: 'unicode',
        description: 'Emoji-heavy content',
        testData: { message: EMOJI_SETS.modern },
        expectedResult: 'preserve'
    });
    
    // Numeric boundary tests
    testCases.push({
        type: 'numeric_boundary',
        description: 'Zero amount',
        testData: { amount: EDGE_CASE_AMOUNTS.zero },
        expectedResult: 'handle_gracefully'
    });
    
    testCases.push({
        type: 'numeric_boundary',
        description: 'Maximum amount',
        testData: { amount: EDGE_CASE_AMOUNTS.maximum },
        expectedResult: 'validate_within_limits'
    });
    
    // Performance tests
    testCases.push({
        type: 'performance',
        description: 'Large data processing',
        testData: { largeArray: BOUNDARY_CONDITIONS.largeDataArray },
        expectedResult: 'process_efficiently'
    });
    
    return {
        platform: platform,
        testCases: testCases,
        metadata: {
            totalTests: testCases.length,
            testTypes: [...new Set(testCases.map(tc => tc.type))],
            createdAt: timestampFromSeed(nextSequence()),
            version: '1.0.0'
        }
    };
};

// ================================================================================================
// UTILITY FUNCTIONS
// ================================================================================================

const detectLanguage = (username) => {
    if (/[\u4e00-\u9fff]/.test(username)) return 'zh';
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(username)) return 'ja';
    if (/[\uac00-\ud7af]/.test(username)) return 'ko';
    if (/[\u0600-\u06ff]/.test(username)) return 'ar';
    if (/[\u0590-\u05ff]/.test(username)) return 'he';
    if (/[\u0400-\u04ff]/.test(username)) return 'ru';
    if (/[\u0370-\u03ff]/.test(username)) return 'el';
    if (/[\u0900-\u097f]/.test(username)) return 'hi';
    if (/[\u0e00-\u0e7f]/.test(username)) return 'th';
    return 'en'; // Default to English
};

const detectScript = (username) => {
    if (/[\u4e00-\u9fff]/.test(username)) return 'Han';
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(username)) return 'Hiragana/Katakana';
    if (/[\uac00-\ud7af]/.test(username)) return 'Hangul';
    if (/[\u0600-\u06ff]/.test(username)) return 'Arabic';
    if (/[\u0590-\u05ff]/.test(username)) return 'Hebrew';
    if (/[\u0400-\u04ff]/.test(username)) return 'Cyrillic';
    if (/[\u{1f000}-\u{1f9ff}]/u.test(username)) return 'Emoji';
    return 'Latin';
};

const isRightToLeft = (text) => {
    return /[\u0590-\u05ff\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/.test(text);
};

// ================================================================================================
// FIXTURE LOADING UTILITIES
// ================================================================================================

const FIXED_TIMESTAMP_MS = BASE_TIMESTAMP_MS;
const FIXED_TIMESTAMP_USEC = '1700000000000000';
const FIXED_TIMESTAMP_ISO = '2024-01-01T00:00:00.000Z';
const YOUTUBE_CHANNEL_ID_PRIMARY = 'UC1234567890ABCDE1234567';
const YOUTUBE_CHANNEL_ID_SECONDARY = 'UC7654321098ZYXWVUTSRQ10';
const TIKTOK_GIFT_BASE = {
    common: {
        method: 'WebcastGiftMessage',
        msgId: '7500000000000000004',
        roomId: '7500000000000000000',
        createTime: `${FIXED_TIMESTAMP_MS}`,
        clientSendTime: `${FIXED_TIMESTAMP_MS}`
    },
    user: {
        userId: '7000000000000000003',
        uniqueId: 'test_gifter',
        nickname: 'TestGifter',
        profilePicture: {
            url: ['https://example.invalid/tiktok-gift-avatar.webp']
        },
        userBadges: [],
        badges: [],
        verified: false
    },
    giftDetails: {
        id: 5655,
        giftName: 'Rose',
        diamondCount: 1,
        giftType: 1
    },
    repeatCount: 1,
    repeatEnd: true,
    groupId: `${FIXED_TIMESTAMP_MS}`,
    logId: 'gift-log-0001'
};

const createTikTokGiftFixture = ({ user = {}, giftDetails = {}, ...overrides } = {}) => ({
    ...TIKTOK_GIFT_BASE,
    ...overrides,
    user: {
        ...TIKTOK_GIFT_BASE.user,
        ...user
    },
    giftDetails: {
        ...TIKTOK_GIFT_BASE.giftDetails,
        ...giftDetails
    }
});

const SYNTHETIC_FIXTURES = Object.freeze({
    tiktok: {
        'chat-message': {
            common: {
                method: 'WebcastChatMessage',
                msgId: '7500000000000000001',
                roomId: '7500000000000000000',
                createTime: `${FIXED_TIMESTAMP_MS}`,
                clientSendTime: `${FIXED_TIMESTAMP_MS}`
            },
            user: {
                userId: '7000000000000000000',
                uniqueId: 'test_chatter',
                nickname: 'TestChatter',
                profilePicture: {
                    url: ['https://example.invalid/tiktok-avatar.webp']
                },
                followInfo: {
                    followingCount: '10',
                    followerCount: '20',
                    followStatus: '1',
                    pushStatus: '0'
                },
                userBadges: [],
                badges: [],
                verified: false,
                followRole: 1
            },
            comment: 'Test chat message',
            emotes: [],
            contentLanguage: 'en',
            userIdentity: {
                isSubscriberOfAnchor: false,
                isFollowerOfAnchor: true
            }
        },
        'follow-event': {
            common: {
                method: 'WebcastSocialMessage',
                msgId: '7500000000000000002',
                roomId: '7500000000000000000',
                createTime: `${FIXED_TIMESTAMP_MS}`,
                clientSendTime: `${FIXED_TIMESTAMP_MS}`
            },
            user: {
                userId: '7000000000000000001',
                uniqueId: 'test_follower',
                nickname: 'TestFollower',
                profilePicture: {
                    url: ['https://example.invalid/tiktok-follower.webp']
                },
                userBadges: [],
                badges: [],
                verified: false,
                followRole: 1
            },
            displayType: 'follow',
            label: '{0:user} followed'
        },
        'gift-event': createTikTokGiftFixture(),
        'gift-event-paper-crane': createTikTokGiftFixture({
            giftDetails: {
                giftName: 'Paper Crane',
                diamondCount: 99,
                giftType: 1
            },
            logId: 'gift-log-paper-crane'
        }),
        'gift-event-money-gun': createTikTokGiftFixture({
            user: {
                uniqueId: 'high_value_gifter',
                nickname: 'HighValueGifter'
            },
            giftDetails: {
                giftName: 'Money Gun',
                diamondCount: 500,
                giftType: 2
            },
            logId: 'gift-log-money-gun'
        }),
        'gift-event-dragon-crown': createTikTokGiftFixture({
            user: {
                uniqueId: 'premium_gifter',
                nickname: 'PremiumGifter'
            },
            giftDetails: {
                giftName: 'Dragon Crown',
                diamondCount: 500,
                giftType: 4
            },
            logId: 'gift-log-dragon-crown'
        }),
        'gift-event-emoji-username': createTikTokGiftFixture({
            user: {
                uniqueId: 'emoji_user',
                nickname: '🔥'
            },
            logId: 'gift-log-emoji'
        })
    },
    twitch: {
        'eventsub-chat-message': {
            broadcaster_user_id: '0000000001',
            broadcaster_user_login: 'hero_stream',
            broadcaster_user_name: 'HeroStream',
            source_broadcaster_user_id: null,
            source_broadcaster_user_login: null,
            source_broadcaster_user_name: null,
            chatter_user_id: '0000000002',
            chatter_user_login: 'twitch_chatter',
            chatter_user_name: 'TwitchChatter',
            message_id: '00000000-0000-0000-0000-000000000001',
            source_message_id: null,
            is_source_only: null,
            message: {
                text: 'Test Twitch chat message',
                fragments: [
                    {
                        type: 'text',
                        text: 'Test Twitch chat message',
                        cheermote: null,
                        emote: null,
                        mention: null
                    }
                ]
            },
            color: '#0000FF',
            badges: [
                {
                    set_id: 'subscriber',
                    id: '0',
                    info: '1'
                }
            ],
            source_badges: null,
            message_type: 'text',
            cheer: null,
            reply: null,
            channel_points_custom_reward_id: null,
            channel_points_animation_id: null
        },
        'eventsub-follow': {
            user_id: '1234567890',
            user_login: 'twitch_follower',
            user_name: 'TwitchFollower',
            broadcaster_user_id: '999000111',
            broadcaster_user_login: 'hero_stream',
            broadcaster_user_name: 'HeroStream',
            followed_at: '2025-08-22T12:15:30.123Z'
        },
        'eventsub-raid': {
            from_broadcaster_user_id: '555111999',
            from_broadcaster_user_login: 'twitch_raider',
            from_broadcaster_user_name: 'TwitchRaider',
            to_broadcaster_user_id: '999000111',
            to_broadcaster_user_login: 'hero_stream',
            to_broadcaster_user_name: 'HeroStream',
            viewers: 42
        },
        'eventsub-bits': {
            user_id: '0000000002',
            user_login: 'twitch_cheerer',
            user_name: 'TwitchCheerer',
            broadcaster_user_id: '999000111',
            broadcaster_user_login: 'hero_stream',
            broadcaster_user_name: 'HeroStream',
            is_anonymous: false,
            bits: 100,
            message: {
                text: 'Cheer100 Great stream!',
                fragments: [
                    {
                        type: 'cheermote',
                        text: 'Cheer100',
                        cheermote: {
                            prefix: 'Cheer',
                            bits: 100,
                            tier: 3
                        },
                        emote: null,
                        mention: null
                    },
                    {
                        type: 'text',
                        text: ' Great stream!',
                        cheermote: null,
                        emote: null,
                        mention: null
                    }
                ]
            }
        },
        'eventsub-gift-subscription': {
            metadata: {
                message_id: 'befa7b53-d79d-478f-86b9-120f112b044e',
                message_type: 'notification',
                message_timestamp: FIXED_TIMESTAMP_ISO,
                subscription_type: 'channel.subscription.gift',
                subscription_version: '1'
            },
            payload: {
                subscription: {
                    id: '00000000-0000-0000-0000-000000000002',
                    status: 'enabled',
                    type: 'channel.subscription.gift',
                    version: '1',
                    condition: {
                        broadcaster_user_id: '123456789'
                    },
                    transport: {
                        method: 'websocket',
                        session_id: 'session_test_0001'
                    },
                    created_at: FIXED_TIMESTAMP_ISO,
                    cost: 1
                },
                event: {
                    user_id: '987654321',
                    user_login: 'gift_sender',
                    user_name: 'GiftSender',
                    broadcaster_user_id: '123456789',
                    broadcaster_user_login: 'test_broadcaster',
                    broadcaster_user_name: 'TestBroadcaster',
                    total: 5,
                    tier: '1000',
                    cumulative_total: null,
                    is_anonymous: false
                }
            }
        },
        'subscription-gift': {
            metadata: {
                message_id: 'befa7b53-d79d-478f-86b9-120f112b044e',
                message_type: 'notification',
                message_timestamp: FIXED_TIMESTAMP_ISO,
                subscription_type: 'channel.subscription.gift',
                subscription_version: '1'
            },
            payload: {
                subscription: {
                    id: '00000000-0000-0000-0000-000000000002',
                    status: 'enabled',
                    type: 'channel.subscription.gift',
                    version: '1',
                    condition: {
                        broadcaster_user_id: '1337'
                    },
                    transport: {
                        method: 'websocket',
                        session_id: 'session_test_0001'
                    },
                    created_at: FIXED_TIMESTAMP_ISO,
                    cost: 1
                },
                event: {
                    user_id: '1234',
                    user_login: 'gift_sender_alt',
                    user_name: 'GiftSenderAlt',
                    broadcaster_user_id: '1337',
                    broadcaster_user_login: 'testchannel',
                    broadcaster_user_name: 'TestChannel',
                    total: 5,
                    tier: '1000',
                    cumulative_total: 284,
                    is_anonymous: false
                }
            }
        }
    },
    youtube: {
        'chat-message': {
            type: 'AddChatItemAction',
            item: {
                type: 'LiveChatTextMessage',
                id: 'LCC.test-chat-001',
                message: {
                    text: 'Test chat message',
                    runs: [
                        {
                            text: 'Test chat message',
                            bold: false,
                            bracket: false,
                            deemphasize: false,
                            italics: false,
                            strikethrough: false,
                            error_underline: false,
                            underline: false
                        }
                    ],
                    rtl: false
                },
                inline_action_buttons: [],
                timestamp: FIXED_TIMESTAMP_MS,
                timestamp_usec: FIXED_TIMESTAMP_USEC,
                author: {
                    id: YOUTUBE_CHANNEL_ID_PRIMARY,
                    name: '@TestUser',
                    thumbnails: [
                        {
                            url: 'https://example.com/yt-user-64.jpg',
                            width: 64,
                            height: 64
                        },
                        {
                            url: 'https://example.com/yt-user-32.jpg',
                            width: 32,
                            height: 32
                        }
                    ],
                    badges: [],
                    is_moderator: false,
                    is_verified: false,
                    is_verified_artist: false,
                    url: 'https://www.youtube.example.invalid/u/undefined'
                },
                menu_endpoint: {
                    type: 'NavigationEndpoint',
                    name: 'liveChatItemContextMenuEndpoint',
                    payload: {
                        params: 'test-params'
                    },
                    metadata: {
                        api_url: '/live_chat/get_item_context_menu'
                    },
                    command: {
                        type: 'LiveChatItemContextMenuEndpoint'
                    }
                },
                context_menu_accessibility_label: 'Chat actions',
                before_content_buttons: []
            },
            client_id: 'test-client-id-yt-001'
        },
        'chat-no-at-prefix': {
            type: 'AddChatItemAction',
            item: {
                type: 'LiveChatTextMessage',
                id: 'LCC.test-chat-002',
                message: {
                    text: 'Test message without @ prefix',
                    runs: [
                        {
                            text: 'Test message without @ prefix',
                            bold: false,
                            bracket: false,
                            deemphasize: false,
                            italics: false,
                            strikethrough: false,
                            error_underline: false,
                            underline: false
                        }
                    ],
                    rtl: false
                },
                inline_action_buttons: [],
                timestamp: FIXED_TIMESTAMP_MS,
                timestamp_usec: FIXED_TIMESTAMP_USEC,
                author: {
                    id: YOUTUBE_CHANNEL_ID_SECONDARY,
                    name: 'UserWithoutAtPrefix',
                    thumbnails: [
                        {
                            url: 'https://example.com/yt-user-no-at-64.jpg',
                            width: 64,
                            height: 64
                        },
                        {
                            url: 'https://example.com/yt-user-no-at-32.jpg',
                            width: 32,
                            height: 32
                        }
                    ],
                    badges: [],
                    url: 'https://www.youtube.example.invalid/u/undefined'
                },
                menu_endpoint: {
                    type: 'NavigationEndpoint',
                    name: 'liveChatItemContextMenuEndpoint',
                    payload: {
                        params: 'test-params'
                    },
                    metadata: {
                        api_url: '/live_chat/get_item_context_menu'
                    },
                    command: {
                        type: 'LiveChatItemContextMenuEndpoint'
                    }
                },
                context_menu_accessibility_label: 'Chat actions',
                before_content_buttons: []
            },
            client_id: 'test-client-id-yt-002'
        },
        'superchat': {
            type: 'AddChatItemAction',
            item: {
                type: 'LiveChatPaidMessage',
                id: 'LCC.test-superchat-001',
                author: {
                    id: YOUTUBE_CHANNEL_ID_PRIMARY,
                    name: 'SuperChatDonor',
                    thumbnails: [
                        {
                            url: 'https://example.com/yt-donor-64.jpg',
                            width: 64,
                            height: 64
                        },
                        {
                            url: 'https://example.com/yt-donor-32.jpg',
                            width: 32,
                            height: 32
                        }
                    ],
                    badges: [],
                    is_moderator: false,
                    is_verified: false,
                    is_verified_artist: false,
                    url: 'https://www.youtube.example.invalid/u/undefined'
                },
                message: {
                    text: 'Thanks for the stream!',
                    runs: [
                        {
                            text: 'Thanks for the stream!',
                            bold: false,
                            bracket: false,
                            deemphasize: false,
                            italics: false,
                            strikethrough: false,
                            error_underline: false,
                            underline: false
                        }
                    ],
                    rtl: false
                },
                purchase_amount: '$25.00',
                money_chip_background_color: 4278239141,
                money_chip_text_color: 4294967295,
                background_color: 4278239141,
                author_name_text_color: 4294967295,
                timestamp: FIXED_TIMESTAMP_MS,
                timestamp_usec: FIXED_TIMESTAMP_USEC,
                menu_endpoint: {
                    type: 'NavigationEndpoint',
                    name: 'liveChatItemContextMenuEndpoint',
                    payload: {
                        params: 'test-params'
                    },
                    metadata: {
                        api_url: '/live_chat/get_item_context_menu'
                    },
                    command: {
                        type: 'LiveChatItemContextMenuEndpoint'
                    }
                },
                context_menu_accessibility_label: 'Chat actions'
            },
            client_id: 'test-client-id-yt-003'
        },
        'superchat-international': {
            type: 'AddChatItemAction',
            item: {
                type: 'LiveChatPaidMessage',
                id: 'LCC.test-superchat-002',
                author: {
                    id: YOUTUBE_CHANNEL_ID_SECONDARY,
                    name: `@${INTERNATIONAL_USERNAMES.chinese}`,
                    thumbnails: [
                        {
                            url: 'https://example.com/yt-intl-64.jpg',
                            width: 64,
                            height: 64
                        },
                        {
                            url: 'https://example.com/yt-intl-32.jpg',
                            width: 32,
                            height: 32
                        }
                    ],
                    badges: [],
                    is_moderator: false,
                    is_verified: false,
                    is_verified_artist: false,
                    url: 'https://www.youtube.example.invalid/u/undefined'
                },
                message: {
                    text: '感谢精彩的直播 🎉',
                    runs: [
                        {
                            text: '感谢精彩的直播 🎉',
                            bold: false,
                            bracket: false,
                            deemphasize: false,
                            italics: false,
                            strikethrough: false,
                            error_underline: false,
                            underline: false
                        }
                    ],
                    rtl: false
                },
                purchase_amount: '₹199',
                money_chip_background_color: 4278239141,
                money_chip_text_color: 4294967295,
                background_color: 4278239141,
                author_name_text_color: 4294967295,
                timestamp: FIXED_TIMESTAMP_MS,
                timestamp_usec: FIXED_TIMESTAMP_USEC,
                menu_endpoint: {
                    type: 'NavigationEndpoint',
                    name: 'liveChatItemContextMenuEndpoint',
                    payload: {
                        params: 'test-params'
                    },
                    metadata: {
                        api_url: '/live_chat/get_item_context_menu'
                    },
                    command: {
                        type: 'LiveChatItemContextMenuEndpoint'
                    }
                },
                context_menu_accessibility_label: 'Chat actions'
            },
            client_id: 'test-client-id-yt-004'
        },
        'supersticker': {
            type: 'AddChatItemAction',
            item: {
                type: 'LiveChatPaidSticker',
                id: 'LCC.test-supersticker-001',
                author: {
                    id: YOUTUBE_CHANNEL_ID_PRIMARY,
                    name: 'StickerSupporter',
                    thumbnails: [
                        {
                            url: 'https://example.com/yt-sticker-64.jpg',
                            width: 64,
                            height: 64
                        },
                        {
                            url: 'https://example.com/yt-sticker-32.jpg',
                            width: 32,
                            height: 32
                        }
                    ],
                    badges: [
                        {
                            type: 'LiveChatAuthorBadge',
                            tooltip: 'New member',
                            custom_thumbnail: [
                                {
                                    url: 'https://example.com/badge-32.jpg',
                                    width: 32,
                                    height: 32
                                }
                            ]
                        }
                    ],
                    is_moderator: false,
                    is_verified: false,
                    is_verified_artist: false,
                    url: 'https://www.youtube.example.invalid/u/undefined'
                },
                money_chip_background_color: 4280150454,
                money_chip_text_color: 4278190080,
                background_color: 4280150454,
                author_name_text_color: 2315255808,
                sticker: [
                    {
                        url: '//lh3.googleusercontent.example.invalid/test-sticker-176.jpg',
                        width: 176,
                        height: 176
                    },
                    {
                        url: '//lh3.googleusercontent.example.invalid/test-sticker-88.jpg',
                        width: 88,
                        height: 88
                    }
                ],
                sticker_accessibility_label: 'Test sticker description',
                sticker_display_width: 88,
                sticker_display_height: 88,
                purchase_amount: 'A$7.99',
                menu_endpoint: {
                    type: 'NavigationEndpoint',
                    name: 'liveChatItemContextMenuEndpoint',
                    payload: {
                        params: 'test-params'
                    },
                    metadata: {
                        api_url: '/live_chat/get_item_context_menu'
                    },
                    command: {
                        type: 'LiveChatItemContextMenuEndpoint'
                    }
                },
                context_menu_accessibility_label: 'Chat actions',
                timestamp: FIXED_TIMESTAMP_MS,
                timestamp_usec: FIXED_TIMESTAMP_USEC,
                is_v2_style: true
            },
            client_id: 'test-client-id-yt-005'
        },
        'gift-purchase-header': {
            type: 'AddChatItemAction',
            item: {
                type: 'LiveChatSponsorshipsGiftPurchaseAnnouncement',
                id: 'LCC.test-gift-purchase-001',
                timestamp_usec: FIXED_TIMESTAMP_USEC,
                author: {
                    id: YOUTUBE_CHANNEL_ID_PRIMARY,
                    name: '@GiftGiver'
                },
                author_external_channel_id: YOUTUBE_CHANNEL_ID_PRIMARY,
                header: {
                    type: 'LiveChatSponsorshipsHeader',
                    author_name: {
                        text: '@GiftGiver',
                        rtl: false
                    },
                    author_photo: [
                        {
                            url: 'https://example.com/yt-gifter-64.png',
                            width: 64,
                            height: 64
                        }
                    ],
                    author_badges: []
                },
                primary_text: {
                    text: 'Sent 5 Hero gift memberships',
                    runs: [
                        { text: 'Sent ' },
                        { text: '5' },
                        { text: ' Hero gift memberships' }
                    ]
                },
                giftMembershipsCount: 5,
                message: {
                    text: ''
                }
            }
        },
        'gift-membership': {
            type: 'AddChatItemAction',
            item: {
                type: 'LiveChatSponsorshipsGiftPurchaseAnnouncement',
                id: 'LCC.test-gift-membership-001',
                timestamp_usec: FIXED_TIMESTAMP_USEC,
                author: {
                    id: YOUTUBE_CHANNEL_ID_PRIMARY,
                    name: '@GiftGiver'
                },
                author_external_channel_id: YOUTUBE_CHANNEL_ID_PRIMARY,
                header: {
                    type: 'LiveChatSponsorshipsHeader',
                    author_name: {
                        text: '@GiftGiver',
                        rtl: false
                    },
                    author_photo: [
                        {
                            url: 'https://example.com/yt-gifter-64.png',
                            width: 64,
                            height: 64
                        }
                    ],
                    author_badges: []
                },
                headerPrimaryText: {
                    text: 'Hero gift memberships',
                    runs: [
                        { text: 'Hero gift memberships' }
                    ]
                },
                primary_text: {
                    text: 'Sent 5 Hero gift memberships',
                    runs: [
                        { text: 'Sent ' },
                        { text: '5' },
                        { text: ' Hero gift memberships' }
                    ]
                },
                giftMembershipsCount: 5,
                membershipGiftCount: 5,
                message: {
                    text: ''
                }
            }
        }
    },
    streamelements: {
        'youtube-follow': {
            platform: 'youtube',
            username: 'Test Follower',
            userId: '123456789',
            timestamp: FIXED_TIMESTAMP_ISO,
            eventId: 'follow_1700000000000_synthetic',
            source: 'streamelements',
            sourceType: 'streamelements:follow'
        }
    },
    obs: {
        'scene-changed': {
            eventType: 'SceneTransitionStarted',
            eventIntent: 1,
            eventData: {
                transitionName: 'Fade',
                fromSceneName: 'Main Scene',
                fromSceneUuid: '00000000-0000-0000-0000-000000000010',
                toSceneName: 'BRB Scene',
                toSceneUuid: '00000000-0000-0000-0000-000000000011'
            }
        },
        'source-updated': {
            eventType: 'InputSettingsChanged',
            eventIntent: 1,
            eventData: {
                inputName: 'Chat Display',
                inputUuid: '00000000-0000-0000-0000-000000000012',
                inputSettings: {
                    text: 'New chat message from viewer',
                    font: {
                        face: 'Arial',
                        size: 24
                    },
                    color: 4294967295
                }
            }
        }
    }
});

const cloneFixture = (fixture) => JSON.parse(JSON.stringify(fixture));

const getSyntheticFixture = (platform, eventType) => {
    if (!platform || !eventType) {
        throw new Error('Platform and eventType are required to load a synthetic fixture');
    }

    const fixture = SYNTHETIC_FIXTURES[platform]?.[eventType];
    if (!fixture) {
        throw new Error(`No synthetic fixture found for platform: ${platform}, eventType: ${eventType}`);
    }

    return cloneFixture(fixture);
};

const getSyntheticFixtureSet = () => ({
    tiktok: {
        chatMessage: getSyntheticFixture('tiktok', 'chat-message'),
        follow: getSyntheticFixture('tiktok', 'follow-event'),
        gift: getSyntheticFixture('tiktok', 'gift-event')
    },
    twitch: {
        chatMessage: getSyntheticFixture('twitch', 'eventsub-chat-message'),
        follow: getSyntheticFixture('twitch', 'eventsub-follow'),
        raid: getSyntheticFixture('twitch', 'eventsub-raid'),
        bits: getSyntheticFixture('twitch', 'eventsub-bits')
    },
    youtube: {
        chatMessage: getSyntheticFixture('youtube', 'chat-message'),
        superchat: getSyntheticFixture('youtube', 'superchat'),
        supersticker: getSyntheticFixture('youtube', 'supersticker')
    },
    streamelements: {
        youtubeFollow: getSyntheticFixture('streamelements', 'youtube-follow')
    },
    obs: {
        sceneChanged: getSyntheticFixture('obs', 'scene-changed'),
        sourceUpdated: getSyntheticFixture('obs', 'source-updated')
    }
});

const loadPlatformFixture = (platform, eventType) => {
    return getSyntheticFixture(platform, eventType);
};

// ================================================================================================
// EXPORTS
// ================================================================================================

module.exports = {
    // Core data collections
    INTERNATIONAL_USERNAMES,
    PHASE_5B_INTERNATIONAL_TEST_DATA,
    EDGE_CASE_AMOUNTS,
    BOUNDARY_CONDITIONS,
    SPECIAL_CHARACTERS,
    EMOJI_SETS,
    
    // Scenario builders
    createMultiPlatformEventScenario,
    createGiftSpamScenario,
    createRaidScenario,
    createErrorScenario,
    createInternationalUserScenario,
    createBoundaryTestSuite,
    
    // Fixture loading utilities
    loadPlatformFixture,
    getSyntheticFixture,
    getSyntheticFixtureSet,
    
    // Re-export platform builders for convenience
    createYouTubeSuperChatEvent,
    createYouTubeChatEvent,
    createTikTokGiftEvent,
    createTikTokChatEvent,
    createTwitchChatEvent,
    createTwitchSubscriptionEvent,
    createTwitchRaidEvent,
    
    // Utility functions
    detectLanguage,
    detectScript,
    isRightToLeft
};
