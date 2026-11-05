import { vi } from 'bun:test';

import { parseTimestampISO, parseTimestampMs } from '../../src/utils/timestamp';

const BASE_TIMESTAMP_MS = Date.parse('2024-01-01T00:00:00.000Z');
type UnknownRecord = Record<string, unknown>;
type NodeStyleCallback = (error: Error | null, data?: unknown) => void;
type UserGiftScenarioState = {
    platform: string;
    username: string;
    userId: string;
    amount: number;
    currency: string;
    message: string;
};
type TikTokGiftScenarioState = {
    platform: 'tiktok';
    username: string;
    userId: string;
    giftType: string;
    giftCount: number;
    amount: number;
};
type SupportedPlatform = 'twitch' | 'youtube' | 'tiktok';
type TwitchWebSocketMessage = {
    metadata: UnknownRecord & { subscription_type: string; message_type: string };
    payload: { subscription: UnknownRecord; event: UnknownRecord };
};
type YouTubeWebSocketMessage = UnknownRecord & {
    snippet: UnknownRecord & {
        publishedAt: string;
        hasDisplayContent: boolean;
        liveChatId: string;
        messageDeletedDetails: null;
        type?: string;
        displayMessage?: unknown;
        textMessageDetails?: UnknownRecord;
        superChatDetails?: UnknownRecord;
        memberMilestoneChatDetails?: UnknownRecord;
    };
};
type TikTokWebSocketMessage = UnknownRecord & { type?: string };
type SupportedWebSocketMessage = TwitchWebSocketMessage | YouTubeWebSocketMessage | TikTokWebSocketMessage;
const isRecord = (value: unknown): value is UnknownRecord => {
    return typeof value === 'object' && value !== null;
};

const asRecord = (value: unknown): UnknownRecord => {
    return isRecord(value) ? value : {};
};

const requireRecord = (value: unknown, field: string): UnknownRecord => {
    if (!isRecord(value)) {
        throw new Error(`${field} is required`);
    }

    return value;
};

let sequence = 0;
const nextSequence = () => {
    sequence += 1;
    return sequence;
};
const resetMockFactorySequence = () => {
    sequence = 0;
};
const nextIdSuffix = () => nextSequence().toString(36).padStart(8, '0');
const buildTestId = (prefix: string) => `${prefix}-${nextIdSuffix()}`;
const createTimestamp = () => {
    const ms = BASE_TIMESTAMP_MS + (nextSequence() * 1000);
    return { ms, iso: new Date(ms).toISOString() };
};
const requireNonEmptyString = (value: unknown, field: string): string => {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${field} is required`);
    }
    return value;
};
const requireFiniteNumber = (value: unknown, field: string): number => {
    if (value === undefined || value === null) {
        throw new Error(`${field} is required`);
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        throw new Error(`${field} must be a finite number`);
    }
    return numeric;
};
const requireGiftFields = (payload: unknown): void => {
    const giftPayload = requireRecord(payload, 'gift payload');
    requireNonEmptyString(giftPayload.giftType, 'giftType');
    requireFiniteNumber(giftPayload.giftCount, 'giftCount');
    requireFiniteNumber(giftPayload.amount, 'amount');
    requireNonEmptyString(giftPayload.currency, 'currency');
};

const createMockNotificationBuilder = (dataOverrides: UnknownRecord = {}) => {
    return {
        build: vi.fn<(...args: [unknown?]) => UnknownRecord>().mockImplementation((notificationData = {}) => {
            const notificationRecord = requireRecord(notificationData, 'notificationData');
            const type = requireNonEmptyString(notificationRecord.type, 'type');
            const platform = requireNonEmptyString(notificationRecord.platform, 'platform');
            const username = requireNonEmptyString(notificationRecord.username, 'username');

            if (type === 'platform:gift') {
                requireGiftFields(notificationRecord);
            }

            const timestamp = createTimestamp();
            const processedAt = notificationRecord.processedAt ?? timestamp.ms;
            const isoTimestamp = notificationRecord.timestamp || timestamp.iso;

            return {
                id: notificationRecord.id || buildTestId('test-notification'),
                userId: notificationRecord.userId,
                displayMessage: notificationRecord.displayMessage || `${username} ${type}`,
                ttsMessage: notificationRecord.ttsMessage || `${username} ${type}`,
                logMessage: notificationRecord.logMessage || `${type} from ${username}`,
                processedAt,
                timestamp: isoTimestamp,
                ...dataOverrides,
                ...notificationRecord,
                type,
                platform,
                username
            };
        }),
        _mockType: 'NotificationBuilder',
        _defaultData: dataOverrides
    };
};

const createMockFileSystem = (behaviorConfig: UnknownRecord = {}) => {
    const defaultBehavior = {
        fileExists: true,
        readFileContent: '{}',
        writeSucceeds: true,
        ...behaviorConfig
    };

    const baseMethods = {
        readFile: vi.fn<(...args: unknown[]) => Promise<unknown>>().mockImplementation((_path, callback) => {
            if (typeof callback === 'function') {
                callback(null, defaultBehavior.readFileContent);
            }
            return Promise.resolve(defaultBehavior.readFileContent);
        }),
        readFileSync: vi.fn<(...args: unknown[]) => string>().mockReturnValue(defaultBehavior.readFileContent),
        writeFile: vi.fn<(...args: unknown[]) => Promise<void>>().mockImplementation((_path, _data, callback) => {
            if (defaultBehavior.writeSucceeds) {
                if (typeof callback === 'function') callback(null);
                return Promise.resolve();
            } else {
                const error = new Error('Write failed');
                if (typeof callback === 'function') callback(error);
                return Promise.reject(error);
            }
        }),
        writeFileSync: vi.fn<(...args: unknown[]) => void>().mockImplementation((_path, _data) => {
            if (!defaultBehavior.writeSucceeds) {
                throw new Error('Write failed');
            }
        }),
        existsSync: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(defaultBehavior.fileExists),
        access: vi.fn<(...args: unknown[]) => Promise<void>>().mockImplementation((_path, callback) => {
            if (typeof callback === 'function') {
                callback(defaultBehavior.fileExists ? null : new Error('File not found'));
            }
            return defaultBehavior.fileExists ? Promise.resolve() : Promise.reject(new Error('File not found'));
        }),
        mkdir: vi.fn<(...args: unknown[]) => Promise<void>>().mockImplementation((_path, options, callback) => {
            const cb: NodeStyleCallback | undefined = typeof options === 'function'
                ? options as NodeStyleCallback
                : (typeof callback === 'function' ? callback as NodeStyleCallback : undefined);
            if (cb) cb(null);
            return Promise.resolve();
        }),
        mkdirSync: vi.fn<(...args: unknown[]) => unknown>(),
        stat: vi.fn<(...args: unknown[]) => Promise<{ isFile: () => true; isDirectory: () => false; }>>().mockResolvedValue({ isFile: () => true, isDirectory: () => false }),
        statSync: vi.fn<(...args: unknown[]) => { isFile: () => true; isDirectory: () => false; }>().mockReturnValue({ isFile: () => true, isDirectory: () => false })
    };

    return {
        ...baseMethods,
        _mockType: 'FileSystem',
        _validMethods: Object.keys(baseMethods)
    };
};

const noOpLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

const resetMock = (mockObject: unknown) => {
    const mockRecord = asRecord(mockObject);
    if (!mockRecord._mockType) {
        console.warn('Attempting to reset non-factory mock object');
        return;
    }

    Object.keys(mockRecord).forEach(key => {
        const method = mockRecord[key];
        if (typeof method === 'function' && 'mockReset' in method && typeof method.mockReset === 'function') {
            method.mockReset();
        }
    });
};

const clearMockCalls = (mockObject: unknown) => {
    const mockRecord = asRecord(mockObject);
    if (!mockRecord._mockType) {
        console.warn('Attempting to clear non-factory mock object');
        return;
    }

    Object.keys(mockRecord).forEach(key => {
        const method = mockRecord[key];
        if (typeof method === 'function' && 'mockClear' in method && typeof method.mockClear === 'function') {
            method.mockClear();
        }
    });
};

const validateMockAPI = (mockObject: unknown, expectedMethods: string[] = []) => {
    const mockRecord = asRecord(mockObject);
    if (!mockRecord._mockType) {
        console.warn('Validating non-factory mock object');
        return false;
    }

    const missingMethods = expectedMethods.filter(method => !Object.prototype.hasOwnProperty.call(mockRecord, method));
    
    if (missingMethods.length > 0) {
        console.error(`Mock ${mockRecord._mockType} missing methods:`, missingMethods);
        return false;
    }

    return true;
};

const createUserGiftScenario = (scenarioConfig: Partial<UserGiftScenarioState> = {}) => {
    const scenario: UserGiftScenarioState = {
        platform: 'youtube',
        username: 'TestUser',
        userId: 'test-user-id',
        amount: 5.00,
        currency: 'USD',
        message: 'Great stream!',
        ...scenarioConfig
    };
    
    return {
        fromPlatform(platform: string) {
            scenario.platform = platform;
            return this;
        },
        
        withUser(username: string, userId: string | null = null) {
            scenario.username = username;
            if (userId !== null && userId !== undefined) {
                scenario.userId = userId;
            }
            return this;
        },
        
        withAmount(amount: number) {
            scenario.amount = amount;
            return this;
        },
        
        withCurrency(currency: string) {
            scenario.currency = currency;
            return this;
        },
        
        withMessage(message: string) {
            scenario.message = message;
            return this;
        },
        
        build() {
            return {
                type: 'platform:gift',
                platform: scenario.platform,
                username: scenario.username,
                userId: scenario.userId,
                amount: scenario.amount,
                currency: scenario.currency,
                message: scenario.message,
                timestamp: createTimestamp().iso,
                _scenarioType: 'UserGiftScenario'
            };
        }
    };
};

// eslint-disable-next-line no-restricted-properties -- Actual elapsed time is monotonic; helper tests inject a deterministic clock.
const createPerformanceTracker = (now: () => number = () => performance.now()) => {
    let startTime = now();
    return {
        getElapsedTime() {
            return now() - startTime;
        },
        reset() {
            startTime = now();
        }
    };
};

const isSupportedPlatform = (platform: unknown): platform is SupportedPlatform => {
    return platform === 'twitch' || platform === 'youtube' || platform === 'tiktok';
};

const createBulkGiftEvents = (count: number, giftTemplate: UnknownRecord = {}) => {
    const resolvedPlatform = isSupportedPlatform(giftTemplate.platform) ? giftTemplate.platform : 'youtube';
    const platformDefaults = {
        twitch: {
            giftType: 'bits',
            giftCount: 1,
            amount: 100,
            currency: 'bits'
        },
        youtube: {
            giftType: 'Super Chat',
            giftCount: 1,
            amount: 5.00,
            currency: 'USD'
        },
        tiktok: {
            giftType: 'Rose',
            giftCount: 1,
            amount: 2,
            currency: 'coins'
        }
    };
    const defaultTemplate = {
        platform: resolvedPlatform,
        username: 'TestUser',
        userId: 'test-user-id',
        ...(platformDefaults[resolvedPlatform] || platformDefaults.youtube),
        ...giftTemplate
    };
    
    return Array.from({ length: count }, (_, index) => ({
        ...defaultTemplate,
        id: `gift-${index}`,
        username: `${defaultTemplate.username}${index}`,
        userId: `${defaultTemplate.userId}${index}`,
        timestamp: BASE_TIMESTAMP_MS + (index * 1000)
    }));
};

const createTikTokGiftBuilder = () => {
    const gift: TikTokGiftScenarioState = {
        platform: 'tiktok',
        username: 'TikTokUser',
        userId: 'test-tiktok-123',
        giftType: 'Rose',
        giftCount: 1,
        amount: 0.05
    };
    
    return {
        withUser(username: string, userId: string | null = null) {
            gift.username = username;
            if (userId !== null && userId !== undefined) {
                gift.userId = userId;
            }
            return this;
        },
        
        withAmount(cents: number) {
            gift.amount = cents / 100;
            return this;
        },
        
        withGift(giftType: string, count = 1) {
            gift.giftType = giftType;
            gift.giftCount = count;
            return this;
        },
        
        build() {
            const timestamp = createTimestamp();
            return {
                type: 'platform:gift',
                platform: 'tiktok',
                username: gift.username,
                userId: gift.userId,
                giftType: gift.giftType,
                giftCount: gift.giftCount,
                amount: gift.amount,
                currency: 'coins',
                timestamp: timestamp.iso,
                _scenarioType: 'TikTokGiftScenario'
            };
        }
    };
};

const createInvalidEventBuilder = () => {
    return {
        build() {
            return {
                type: 'invalid',
                malformedData: true,
                missingRequiredFields: true,
                _scenarioType: 'InvalidEventScenario'
            };
        }
    };
};

function createMockWebSocketMessage(platform: 'twitch', eventType: string, eventData?: UnknownRecord): TwitchWebSocketMessage;
function createMockWebSocketMessage(platform: 'youtube', eventType: string, eventData?: UnknownRecord): YouTubeWebSocketMessage;
function createMockWebSocketMessage(platform: 'tiktok', eventType: string, eventData?: UnknownRecord): TikTokWebSocketMessage;
function createMockWebSocketMessage(platform: string, eventType: string, eventData?: UnknownRecord): SupportedWebSocketMessage;
function createMockWebSocketMessage(platform: string, eventType: string, eventData: UnknownRecord = {}): SupportedWebSocketMessage {
    switch (platform) {
        case 'twitch':
            return createTwitchWebSocketMessage(eventType, eventData);
        case 'youtube':
            return createYouTubeWebSocketMessage(eventType, eventData);
        case 'tiktok':
            return createTikTokWebSocketMessage(eventType, eventData);
        default:
            throw new Error(`Unsupported platform: ${platform}`);
    }
}

const createTwitchWebSocketMessage = (eventType: string, eventData: UnknownRecord = {}): TwitchWebSocketMessage => {
    const timestamp = createTimestamp();
    const eventTimestamp = parseTimestampISO(eventData.timestamp, { allowDateString: true }) ?? timestamp.iso;
    const username = typeof eventData.username === 'string' ? eventData.username : undefined;
    const baseMessage: TwitchWebSocketMessage = {
        metadata: {
            message_id: buildTestId('msg'),
            message_type: 'notification',
            message_timestamp: eventTimestamp,
            subscription_type: eventType,
            subscription_version: '1'
        },
        payload: {
            subscription: {
                id: buildTestId('sub'),
                type: eventType,
                version: '1',
                status: 'enabled',
                cost: 1,
                condition: {
                    broadcaster_user_id: 'test-broadcaster-id'
                },
                transport: {
                    method: 'websocket',
                    session_id: 'session_123'
                },
                created_at: timestamp.iso
            },
            event: {}
        }
    };

    switch (eventType) {
        case 'channel.chat.message':
            baseMessage.payload.event = {
                broadcaster_user_id: 'test-broadcaster-id',
                broadcaster_user_name: 'teststreamer',
                broadcaster_user_login: 'teststreamer',
                chatter_user_id: eventData.userId,
                chatter_user_name: username || 'TestUser',
                chatter_user_login: username?.toLowerCase() || 'testuser',
                message_id: buildTestId('msg'),
                message: {
                    text: eventData.message ?? 'Test message',
                    fragments: []
                },
                color: eventData.color || '#FF0000',
                badges: eventData.badges || [],
                message_type: 'text'
            };
            break;

        case 'channel.follow':
            baseMessage.payload.event = {
                user_id: eventData.userId,
                user_name: username || 'TestFollower',
                user_login: username?.toLowerCase() || 'testfollower',
                broadcaster_user_id: 'test-broadcaster-id',
                broadcaster_user_name: 'teststreamer',
                broadcaster_user_login: 'teststreamer',
                followed_at: eventTimestamp
            };
            break;

        case 'channel.bits.use':
            const bitsAmount = eventData.bits ?? 100;
            const messagePayload = eventData.message && typeof eventData.message === 'object'
                ? eventData.message
                : {
                    text: `Cheer${bitsAmount}`,
                    fragments: [
                        {
                            type: 'cheermote',
                            text: `Cheer${bitsAmount}`,
                            cheermote: { prefix: 'Cheer', bits: bitsAmount }
                        }
                    ]
                };

            baseMessage.payload.event = {
                is_anonymous: eventData.isAnonymous || false,
                user_id: eventData.userId,
                user_name: username || 'TestCheerer',
                user_login: username?.toLowerCase() || 'testcheerer',
                broadcaster_user_id: 'test-broadcaster-id',
                broadcaster_user_name: 'teststreamer',
                broadcaster_user_login: 'teststreamer',
                bits: bitsAmount,
                type: eventData.bitsUseType || eventData.type || 'cheer',
                message: messagePayload
            };
            break;

        case 'channel.raid':
            baseMessage.payload.event = {
                from_broadcaster_user_id: eventData.userId,
                from_broadcaster_user_name: username || 'TestRaider',
                from_broadcaster_user_login: username?.toLowerCase() || 'testraider',
                to_broadcaster_user_id: 'test-broadcaster-id',
                to_broadcaster_user_name: 'teststreamer',
                to_broadcaster_user_login: 'teststreamer',
                viewers: eventData.viewerCount ?? 42
            };
            break;

        case 'channel.subscribe':
            baseMessage.payload.event = {
                user_id: eventData.userId,
                user_name: username || 'TestSubscriber',
                user_login: username?.toLowerCase() || 'testsubscriber',
                broadcaster_user_id: 'test-broadcaster-id',
                broadcaster_user_name: 'teststreamer',
                broadcaster_user_login: 'teststreamer',
                tier: eventData.tier || '1000',
                is_gift: eventData.isGift || false
            };
            break;

        default:
            throw new Error(`Unsupported Twitch event type: ${eventType}`);
    }

    return baseMessage;
};

const createYouTubeWebSocketMessage = (eventType: string, eventData: UnknownRecord = {}): YouTubeWebSocketMessage => {
    const timestamp = createTimestamp();
    const channelId = eventData.userId;
    const baseMessage: YouTubeWebSocketMessage = {
        id: buildTestId('msg'),
        kind: 'youtube#liveChatMessage',
        etag: buildTestId('etag'),
        snippet: {
            publishedAt: parseTimestampISO(eventData.timestamp, { allowDateString: true }) ?? timestamp.iso,
            hasDisplayContent: true,
            liveChatId: 'live_chat_123',
            messageDeletedDetails: null
        },
        authorDetails: {
            channelId: channelId,
            channelUrl: channelId
                ? `https://www.youtube.example.invalid/channel/${channelId}`
                : null,
            displayName: eventData.username || 'TestUser',
            profileImageUrl: 'https://yt3.ggpht.example.invalid/default.jpg',
            isVerified: false,
            isChatOwner: false,
            isChatSponsor: false,
            isChatModerator: false
        }
    };

    switch (eventType) {
        case 'textMessageEvent':
            baseMessage.snippet.type = 'textMessageEvent';
            baseMessage.snippet.displayMessage = eventData.message ?? 'Test message';
            baseMessage.snippet.textMessageDetails = {
                messageText: eventData.message ?? 'Test message'
            };
            break;

        case 'superChatEvent':
            const amount = Number.isFinite(Number(eventData.amount)) ? Number(eventData.amount) : 5;
            baseMessage.snippet.type = 'superChatEvent';
            baseMessage.snippet.displayMessage = eventData.message || 'Great stream!';
            baseMessage.snippet.superChatDetails = {
                amountMicros: amount * 1000000,
                currency: eventData.currency || 'USD',
                amountDisplayString: `$${amount}.00`,
                userComment: eventData.message || 'Great stream!',
                tier: 1
            };
            break;

        case 'newSponsorEvent':
            baseMessage.snippet.type = 'newSponsorEvent';
            baseMessage.snippet.displayMessage = `${eventData.username || 'TestUser'} became a member!`;
            break;

        case 'memberMilestoneChatEvent':
            baseMessage.snippet.type = 'memberMilestoneChatEvent';
            baseMessage.snippet.displayMessage = eventData.message || 'Thanks for the support!';
            baseMessage.snippet.memberMilestoneChatDetails = {
                memberMonth: eventData.memberMonth || 6,
                memberLevelName: eventData.memberLevelName || 'Member',
                userComment: eventData.message || 'Thanks for the support!'
            };
            break;

        default:
            throw new Error(`Unsupported YouTube event type: ${eventType}`);
    }

    return baseMessage;
};

const createTikTokWebSocketMessage = (eventType: string, eventData: UnknownRecord = {}): TikTokWebSocketMessage => {
    const baseUser = {
        userId: eventData.userId,
        uniqueId: eventData.username || 'testuser',
        nickname: eventData.displayName || eventData.username || 'TestUser',
        profilePictureUrl: 'https://example.com/avatar.jpg',
        following: false,
        followerCount: 1000,
        teamMemberLevel: eventData.teamMemberLevel ?? 1,
        gifterLevel: eventData.gifterLevel ?? 1,
        isSubscriber: eventData.isSubscriber || false
    };

    switch (eventType) {
        case 'chat':
            return {
                type: 'chat',
                user: baseUser,
                comment: eventData.message ?? 'Test chat message',
                timestamp: parseTimestampMs(eventData.timestamp, { allowDateString: true }) ?? createTimestamp().ms,
                emotes: eventData.emotes || []
            };

        case 'gift':
            return {
                type: 'gift',
                user: baseUser,
                gift: {
                    gift_id: eventData.giftId || 5655,
                    name: eventData.giftName || 'rose',
                    diamonds: eventData.diamonds ?? 1,
                    image: {
                        url_list: ['https://example.com/gift.png']
                    }
                },
                giftCount: eventData.giftCount ?? 1,
                totalCost: eventData.totalCost ?? eventData.diamonds ?? 1,
                comboId: eventData.comboId || null,
                timestamp: createTimestamp().ms
            };

        case 'social':
            return {
                type: 'social',
                action: 'follow',
                user: baseUser,
                timestamp: createTimestamp().ms
            };

        case 'roomUser':
            return {
                type: 'roomUser',
                viewerCount: eventData.viewerCount ?? 100,
                timestamp: createTimestamp().ms
            };

        default:
            throw new Error(`Unsupported TikTok event type: ${eventType}`);
    }
};

const createWebSocketMessageSimulator = (options: { platform?: SupportedPlatform } = {}) => {
    const { platform = 'twitch' } = options;
    const chatEventTypes: Record<SupportedPlatform, string> = {
        twitch: 'channel.chat.message',
        youtube: 'textMessageEvent',
        tiktok: 'chat'
    };
    
    return {
        generateRapidMessages: (count = 10, eventType = 'chat') => {
            const messages: SupportedWebSocketMessage[] = [];
            for (let i = 0; i < count; i++) {
                messages.push(createMockWebSocketMessage(platform, eventType, {
                    username: `User${i}`,
                    message: `Message ${i}`,
                    userId: `user_${i}`
                }));
            }
            return messages;
        },

        generateConcurrentPlatformMessages: (platforms: SupportedPlatform[] = ['twitch', 'youtube', 'tiktok']) => {
            const messages: Record<string, SupportedWebSocketMessage> = {};
            platforms.forEach(plat => {
                messages[plat] = createMockWebSocketMessage(plat, chatEventTypes[plat], {
                    username: `TestUser_${plat}`,
                    userId: `synthetic-concurrent-${plat}`,
                    message: `Hello from ${plat}!`
                });
            });
            return messages;
        },

        generateMalformedMessage: (targetPlatform: SupportedPlatform) => {
            if (targetPlatform === 'twitch') {
                const validMessage = createMockWebSocketMessage('twitch', 'channel.chat.message');
                const metadata = validMessage.metadata as Omit<typeof validMessage.metadata, 'message_type'> & { message_type?: string };
                delete metadata.message_type;
                return validMessage;
            }
            if (targetPlatform === 'youtube') {
                const validMessage = createMockWebSocketMessage('youtube', 'textMessageEvent');
                delete (validMessage as Partial<YouTubeWebSocketMessage>).snippet;
                return validMessage;
            }

            const validMessage = createMockWebSocketMessage('tiktok', 'chat');
            delete validMessage.type;
            return validMessage;
        },

        generateHighValueEvents: (targetPlatform: SupportedPlatform) => {
            switch (targetPlatform) {
                case 'twitch':
                    return createMockWebSocketMessage('twitch', 'channel.bits.use', {
                        bits: 10000,
                        username: 'BigCheerer',
                        message: {
                            text: 'Cheer10000 Amazing stream!',
                            fragments: [
                                { type: 'cheermote', text: 'Cheer10000', cheermote: { prefix: 'Cheer', bits: 10000 } },
                                { type: 'text', text: ' Amazing stream!' }
                            ]
                        }
                    });
                case 'youtube':
                    return createMockWebSocketMessage('youtube', 'superChatEvent', {
                        amount: 100,
                        username: 'GenerousViewer',
                        message: 'Keep up the great work!'
                    });
                case 'tiktok':
                    return createMockWebSocketMessage('tiktok', 'gift', {
                        giftName: 'Lion',
                        diamonds: 29999,
                        giftCount: 5,
                        username: 'TikTokFan'
                    });
                default:
                    throw new Error(`Unsupported platform: ${platform}`);
            }
        }
    };
};

export {
    resetMockFactorySequence,
    createMockNotificationBuilder,

    createMockFileSystem,
    noOpLogger,

    resetMock,
    clearMockCalls,
    validateMockAPI,

    createUserGiftScenario,
    createPerformanceTracker,
    createBulkGiftEvents,
    createTikTokGiftBuilder,
    createInvalidEventBuilder,

    createMockWebSocketMessage,
    createTwitchWebSocketMessage,
    createYouTubeWebSocketMessage,
    createTikTokWebSocketMessage,
    createWebSocketMessageSimulator
};
