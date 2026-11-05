import { vi } from 'bun:test';
import type { DisplayQueueItem } from '../../src/interfaces/DisplayQueue';

import { parseTimestampISO, parseTimestampMs } from '../../src/utils/timestamp';

const BASE_TIMESTAMP_MS = Date.parse('2024-01-01T00:00:00.000Z');
type UnknownRecord = Record<string, unknown>;
type NodeStyleCallback = (error: Error | null, data?: unknown) => void;
type MockNotificationRecord = UnknownRecord & {
    type: string;
    platform: string;
    username: string;
    displayMessage: string;
};
type GiftWorkflowResult = UnknownRecord & {
    processed: boolean;
    notification: MockNotificationRecord;
};
type NormalizedMessageResult = UnknownRecord & {
    displayMessage: string;
    preservesUnicode: boolean;
};
type YouTubeConnectionService = {
    connect: () => Promise<boolean>;
    disconnect: () => Promise<boolean>;
    isConnected: () => boolean;
    getActiveChatId: () => Promise<string>;
};
type YouTubeStreamManager = {
    detectActiveStreams: () => Promise<string[]>;
    getStreamDetails: () => Promise<UnknownRecord>;
    monitorStreams: () => unknown;
};
type TikTokServiceConnection = {
    connect: () => Promise<boolean>;
    disconnect: () => Promise<boolean>;
    on: (...args: unknown[]) => unknown;
    off?: (...args: unknown[]) => unknown;
    getState: () => unknown;
};
type TikTokWebSocketClientConnection = TikTokServiceConnection & { getRoomInfo: () => Promise<UnknownRecord> };
type TwitchEventSubService = { initialize: () => Promise<boolean>; shutdown: () => Promise<boolean>; isInitialized: boolean };
type TwitchApiClient = { users: { getUserByName: () => Promise<UnknownRecord> }; channels: { getChannelInfo: () => Promise<UnknownRecord> } };
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
type DisplayQueueState = UnknownRecord & {
    shouldThrowError?: boolean;
    errorMessage?: string;
    length?: number;
    nextItem?: unknown;
    isProcessing?: boolean;
    items?: unknown[];
    maxSize?: number;
    isFull?: boolean;
    processed?: number;
    failed?: number;
    avgTime?: number;
};

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
const nextPseudoRandom = () => ((nextSequence() * 9301 + 49297) % 233280) / 233280;
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

const createMockNotificationDispatcher = (methodOverrides: UnknownRecord = {}) => {
    const baseMethods = {
        dispatchSuperChat: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        dispatchMembership: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        dispatchGiftMembership: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        dispatchSuperSticker: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        dispatchFollow: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        dispatchRaid: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        dispatchMessage: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true)
    };

    return {
        ...baseMethods,
        ...methodOverrides,
        _mockType: 'NotificationDispatcher',
        _validMethods: Object.keys(baseMethods)
    };
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

const createMockNotificationManager = (overrides: UnknownRecord = {}) => {
    const baseHandlers = {
        emit: vi.fn<(...args: unknown[]) => boolean>().mockImplementation((_event, _data) => true),
        on: vi.fn<(...args: unknown[]) => boolean>().mockImplementation((_event, _handler) => true),
        removeListener: vi.fn<(...args: unknown[]) => boolean>().mockImplementation((_event, _handler) => true),
        handleNotification: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        processNotification: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        handleGiftNotification: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        handleFollowNotification: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        handlePaypiggyNotification: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        handleRaidNotification: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        handleChatMessage: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true)
    };

    const behaviorMethods = {
        createNotification: vi.fn<(...args: [unknown?]) => UnknownRecord>().mockImplementation((notificationData = {}) => {
            const notificationRecord = requireRecord(notificationData, 'notificationData');

            const sourceNotification = isRecord(notificationRecord.notification) ? notificationRecord.notification : notificationRecord;
            const type = requireNonEmptyString(sourceNotification.type, 'type');
            const platform = requireNonEmptyString(sourceNotification.platform, 'platform');
            const username = requireNonEmptyString(sourceNotification.username, 'username');

            if (type === 'platform:gift') {
                requireGiftFields(sourceNotification);
            }

            const timestamp = createTimestamp();

            return {
                id: sourceNotification.id || buildTestId('notification'),
                userId: sourceNotification.userId,
                displayMessage: sourceNotification.displayMessage || `${username} ${type}`,
                ttsMessage: sourceNotification.ttsMessage || `${username} ${type}`,
                logMessage: sourceNotification.logMessage || `${type} from ${username}`,
                processedAt: sourceNotification.processedAt ?? timestamp.ms,
                timestamp: sourceNotification.timestamp || timestamp.iso,
                ...sourceNotification,
                type,
                platform,
                username
            };
        }),
        normalizeMessage: vi.fn<(...args: [unknown]) => NormalizedMessageResult>().mockImplementation((message) => {
            const sourceMessage = asRecord(message);
            let displayMessage = typeof sourceMessage.displayMessage === 'string'
                ? sourceMessage.displayMessage
                : (typeof sourceMessage.content === 'string' ? sourceMessage.content : 'No message content');
            
            const hasUnicode = displayMessage.includes('Pokémon') || 
                               displayMessage.includes('💜') || 
                               displayMessage.includes('⚡') || 
                               displayMessage.includes('User') || 
                               displayMessage.includes("'s") ||
                               /[^\u0000-\u007F]/.test(displayMessage);
            
            if (displayMessage && displayMessage.length > 500) {
                displayMessage = displayMessage.substring(0, 497) + '...';
            }
            
            const timestamp = createTimestamp();

            return {
                ...sourceMessage,
                displayMessage: displayMessage,
                preservesUnicode: hasUnicode,
                encoding: 'utf-8',
                originalTimestamp: sourceMessage.timestamp || timestamp.ms,
                normalized: true,
                timestamp: typeof sourceMessage.timestamp === 'number'
                    ? new Date(sourceMessage.timestamp).toISOString()
                    : (sourceMessage.timestamp || timestamp.iso)
            };
        }),
        processGift: vi.fn<(...args: [unknown?]) => Promise<GiftWorkflowResult>>().mockImplementation(async (giftData = {}) => {
            const giftRecord = requireRecord(giftData, 'giftData');
            const platform = requireNonEmptyString(giftRecord.platform, 'platform');
            const username = requireNonEmptyString(giftRecord.username, 'username');
            requireGiftFields(giftRecord);
            const giftType = String(giftRecord.giftType);
            const giftCount = Number(giftRecord.giftCount);
            const amount = Number(giftRecord.amount);
            const currency = String(giftRecord.currency);
            const displayMessage = typeof giftRecord.displayMessage === 'string'
                ? giftRecord.displayMessage
                : `${username} sent a ${amount} ${currency} ${giftType}`;
            const ttsMessage = typeof giftRecord.ttsMessage === 'string'
                ? giftRecord.ttsMessage
                : `${username} sent a ${amount} ${currency} ${giftType}`;
            const logMessage = typeof giftRecord.logMessage === 'string'
                ? giftRecord.logMessage
                : `Gift: ${amount} ${currency} from ${username}`;

            const timestamp = createTimestamp();
            return {
                processed: true,
                notification: {
                    id: buildTestId('gift'),
                    type: 'platform:gift',
                    platform,
                    username,
                    userId: giftRecord.userId,
                    giftType,
                    giftCount,
                    amount,
                    currency,
                    displayMessage,
                    ttsMessage,
                    logMessage,
                    processedAt: timestamp.ms,
                    timestamp: timestamp.iso
                },
                displayed: true,
                vfxTriggered: true,
                obsUpdated: true
            };
        }),
        processFollow: vi.fn<(...args: [unknown?]) => Promise<UnknownRecord>>().mockImplementation(async (followData = {}) => {
            const followRecord = requireRecord(followData, 'followData');
            const platform = requireNonEmptyString(followRecord.platform, 'platform');
            const username = requireNonEmptyString(followRecord.username, 'username');
            const timestamp = createTimestamp();
            return {
                notification: {
                    id: buildTestId('follow'),
                    type: 'platform:follow',
                    platform,
                    username,
                    userId: followRecord.userId,
                    displayMessage: followRecord.displayMessage || `${username} followed you!`,
                    ttsMessage: followRecord.ttsMessage || `${username} followed you`,
                    logMessage: followRecord.logMessage || `Follow from ${username}`,
                    processedAt: timestamp.ms,
                    timestamp: timestamp.iso
                },
                displayed: true
            };
        }),
        processSubscription: vi.fn<(...args: [unknown?]) => Promise<UnknownRecord>>().mockImplementation(async (subData = {}) => {
            const subRecord = requireRecord(subData, 'subData');
            const platform = requireNonEmptyString(subRecord.platform, 'platform');
            const username = requireNonEmptyString(subRecord.username, 'username');
            if (platform === 'twitch') {
                requireNonEmptyString(subRecord.tier, 'tier');
            }
            const timestamp = createTimestamp();
            return {
                notification: {
                    id: buildTestId('sub'),
                    type: 'platform:paypiggy',
                    platform,
                    username,
                    userId: subRecord.userId,
                    tier: subRecord.tier,
                    displayMessage: subRecord.displayMessage || `${username} subscribed!`,
                    ttsMessage: subRecord.ttsMessage || `${username} subscribed`,
                    logMessage: subRecord.logMessage || `Subscription from ${username}`,
                    processedAt: timestamp.ms,
                    timestamp: timestamp.iso
                },
                displayed: true
            };
        })
    };

    const baseMethods = { ...baseHandlers, ...behaviorMethods };
    const mergedMethods = { ...baseMethods, ...overrides };

    return {
        ...mergedMethods,
        _mockType: 'NotificationManager',
        _validMethods: Object.keys(mergedMethods)
    };
};

const createMockYouTubeServices = (configOverrides: UnknownRecord = {}) => {
    const defaultConfig = {
        enabled: true,
        channelHandle: '@testchannel',
        maxConnections: 3,
        connectionTimeout: 30000,
        handleSuperChat: true,
        handleMembership: true,
        handleMessage: true,
        ...configOverrides
    };

    return {
        google: {
            youtube: vi.fn<(...args: unknown[]) => { v3: { search: { list: import("bun:test").Mock<(..._args: unknown[]) => Promise<{ data: { items: never[]; }; }>>; }; videos: { list: import("bun:test").Mock<(..._args: unknown[]) => Promise<{ data: { items: { liveStreamingDetails: { activeLiveChatId: string; }; }[]; }; }>>; }; liveChatMessages: { list: import("bun:test").Mock<(..._args: unknown[]) => Promise<{ data: { items: never[]; }; }>>; }; }; }>().mockReturnValue({
                v3: {
                    search: { list: vi.fn<(...args: unknown[]) => Promise<{ data: { items: never[]; }; }>>().mockResolvedValue({ data: { items: [] } }) },
                    videos: { list: vi.fn<(...args: unknown[]) => Promise<{ data: { items: { liveStreamingDetails: { activeLiveChatId: string; }; }[]; }; }>>().mockResolvedValue({ data: { items: [{ liveStreamingDetails: { activeLiveChatId: 'test-chat-id' } }] } }) },
                    liveChatMessages: { list: vi.fn<(...args: unknown[]) => Promise<{ data: { items: never[]; }; }>>().mockResolvedValue({ data: { items: [] } }) }
                }
            })
        },

        Innertube: {
            create: vi.fn<(...args: unknown[]) => Promise<{ getInfo: import("bun:test").Mock<(..._args: unknown[]) => Promise<{ getLiveChat: import("bun:test").Mock<(..._args: unknown[]) => Promise<{ start: import("bun:test").Mock<(...args: unknown[]) => unknown>; stop: import("bun:test").Mock<(...args: unknown[]) => unknown>; on: import("bun:test").Mock<(...args: unknown[]) => unknown>; sendMessage: import("bun:test").Mock<(...args: unknown[]) => unknown>; }>>; }>>; }>>().mockResolvedValue({
                getInfo: vi.fn<(...args: unknown[]) => Promise<{ getLiveChat: import("bun:test").Mock<(..._args: unknown[]) => Promise<{ start: import("bun:test").Mock<(...args: unknown[]) => unknown>; stop: import("bun:test").Mock<(...args: unknown[]) => unknown>; on: import("bun:test").Mock<(...args: unknown[]) => unknown>; sendMessage: import("bun:test").Mock<(...args: unknown[]) => unknown>; }>>; }>>().mockResolvedValue({
                    getLiveChat: vi.fn<(...args: unknown[]) => Promise<{ start: import("bun:test").Mock<(...args: unknown[]) => unknown>; stop: import("bun:test").Mock<(...args: unknown[]) => unknown>; on: import("bun:test").Mock<(...args: unknown[]) => unknown>; sendMessage: import("bun:test").Mock<(...args: unknown[]) => unknown>; }>>().mockResolvedValue({
                        start: vi.fn<(...args: unknown[]) => unknown>(),
                        stop: vi.fn<(...args: unknown[]) => unknown>(),
                        on: vi.fn<(...args: unknown[]) => unknown>(),
                        sendMessage: vi.fn<(...args: unknown[]) => unknown>()
                    })
                })
            })
        },

        axios: vi.fn<(...args: unknown[]) => Promise<{ data: { status: string; }; }>>().mockResolvedValue({ data: { status: 'success' } }),

        ConnectionService: vi.fn<(...args: []) => YouTubeConnectionService>().mockImplementation(() => ({
            connect: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
            disconnect: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
            isConnected: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
            getActiveChatId: vi.fn<(...args: unknown[]) => Promise<string>>().mockResolvedValue('test-chat-id')
        })),

        EventRouter: vi.fn(() => ({
            routeEvent: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
            registerHandler: vi.fn<(...args: unknown[]) => unknown>(),
            unregisterHandler: vi.fn<(...args: unknown[]) => unknown>()
        })),

        StreamManager: vi.fn<(...args: []) => YouTubeStreamManager>().mockImplementation(() => ({
            detectActiveStreams: vi.fn<(...args: unknown[]) => Promise<string[]>>().mockResolvedValue(['test-stream-id']),
            getStreamDetails: vi.fn<(...args: unknown[]) => Promise<{ title: string; viewerCount: number; }>>().mockResolvedValue({ title: 'Test Stream', viewerCount: 100 }),
            monitorStreams: vi.fn<(...args: unknown[]) => unknown>()
        })),

        ViewerService: vi.fn(() => ({
            getViewerCount: vi.fn<(...args: unknown[]) => Promise<number>>().mockResolvedValue(100),
            startMonitoring: vi.fn<(...args: unknown[]) => unknown>(),
            stopMonitoring: vi.fn<(...args: unknown[]) => unknown>()
        })),

        _mockType: 'YouTubeServices',
        _config: defaultConfig
    };
};

const createMockTikTokServices = (configOverrides: UnknownRecord = {}) => {
    const defaultConfig = {
        username: 'testuser',
        enabled: true,
        debug: false,
        ...configOverrides
    };

    return {
        TikTokWebSocketClient: vi.fn<(...args: []) => TikTokWebSocketClientConnection>().mockImplementation(() => ({
            connect: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
            disconnect: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
            on: vi.fn<(...args: unknown[]) => unknown>(),
            off: vi.fn<(...args: unknown[]) => unknown>(),
            getState: vi.fn<(...args: unknown[]) => { isConnected: true; }>().mockReturnValue({ isConnected: true }),
            getRoomInfo: vi.fn<(...args: unknown[]) => Promise<{ viewerCount: number; title: string; }>>().mockResolvedValue({ viewerCount: 50, title: 'Test TikTok Stream' })
        })),

        mockConnection: {
            connect: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
            disconnect: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
            on: vi.fn<(...args: unknown[]) => unknown>(),
            off: vi.fn<(...args: unknown[]) => unknown>(),
            getState: vi.fn<(...args: unknown[]) => { isConnected: true; }>().mockReturnValue({ isConnected: true }),
            getRoomInfo: vi.fn<(...args: unknown[]) => Promise<{ viewerCount: number; title: string; }>>().mockResolvedValue({ viewerCount: 50, title: 'Test TikTok Stream' })
        },

        _mockType: 'TikTokServices',
        _config: defaultConfig
    };
};

const createMockTwitchServices = (configOverrides: UnknownRecord = {}) => {
    const defaultConfig = {
        enabled: true,
        channel: 'testchannel',
        clientId: 'test-client-id',
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        ...configOverrides
    };

    return {
        tmi: vi.fn(() => ({
            connect: vi.fn<(...args: unknown[]) => Promise<string[]>>().mockResolvedValue(['#testchannel']),
            disconnect: vi.fn<(...args: unknown[]) => Promise<string[]>>().mockResolvedValue(['#testchannel']),
            on: vi.fn<(...args: unknown[]) => unknown>(),
            say: vi.fn<(...args: unknown[]) => Promise<string[]>>().mockResolvedValue(['#testchannel', 'Test message']),
            getChannels: vi.fn<(...args: unknown[]) => string[]>().mockReturnValue(['#testchannel'])
        })),

        TwitchEventSub: vi.fn<(...args: []) => TwitchEventSubService>().mockImplementation(() => ({
            initialize: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
            shutdown: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
            isInitialized: true
        })),

        ApiClient: vi.fn<(...args: []) => TwitchApiClient>().mockImplementation(() => ({
            users: {
                getUserByName: vi.fn<(...args: unknown[]) => Promise<{ id: string; displayName: string; }>>().mockResolvedValue({ id: 'test-user-id', displayName: 'TestUser' })
            },
            channels: {
                getChannelInfo: vi.fn<(...args: unknown[]) => Promise<{ title: string; viewerCount: number; }>>().mockResolvedValue({ title: 'Test Stream', viewerCount: 75 })
            }
        })),

        RefreshingAuthProvider: vi.fn(() => ({
            getAccessToken: vi.fn<(...args: unknown[]) => Promise<{ accessToken: string; }>>().mockResolvedValue({ accessToken: 'test-token' }),
            refresh: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true)
        })),

        EventSubWsListener: vi.fn(() => ({
            start: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
            stop: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
            subscribeToChannelFollowEvents: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
            subscribeToChannelSubscriptionEvents: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
            subscribeToChannelRaidEvents: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true)
        })),

        _mockType: 'TwitchServices',
        _config: defaultConfig
    };
};

const createMockOBSManager = (connectionState = 'connected', overrides = {}) => {
    const isConnected = connectionState === 'connected';
    
    const baseMethods = {
        isConnected: vi.fn<(...args: unknown[]) => typeof isConnected>().mockReturnValue(isConnected),
        isReady: vi.fn<(...args: unknown[]) => Promise<typeof isConnected>>().mockResolvedValue(isConnected),
        connect: vi.fn<(...args: unknown[]) => Promise<typeof isConnected>>().mockResolvedValue(isConnected),
        disconnect: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        call: vi.fn<(...args: unknown[]) => Promise<{ status: string; }>>().mockResolvedValue({ status: 'success' }),
        addEventListener: vi.fn<(...args: unknown[]) => unknown>(),
        removeEventListener: vi.fn<(...args: unknown[]) => unknown>(),
        
        setCurrentScene: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        getCurrentScene: vi.fn<(...args: unknown[]) => Promise<{ sceneName: string; }>>().mockResolvedValue({ sceneName: 'main_scene' }),
        getSceneList: vi.fn<(...args: unknown[]) => Promise<{ scenes: { sceneName: string; }[]; }>>().mockResolvedValue({ scenes: [{ sceneName: 'main_scene' }] }),
        
        setTextSource: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        getSourceSettings: vi.fn<(...args: unknown[]) => Promise<{ text: string; }>>().mockResolvedValue({ text: 'Test text' }),
        setSourceVisibility: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        
        triggerMediaSource: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        setMediaSource: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        
        setFilterEnabled: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        getFilterList: vi.fn<(...args: unknown[]) => Promise<{ filters: never[]; }>>().mockResolvedValue({ filters: [] })
    };

    return {
        ...baseMethods,
        ...overrides,
        _mockType: 'OBSManager',
        _connectionState: connectionState,
        _validMethods: Object.keys(baseMethods)
    };
};

const createMockSourcesManager = (overrides = {}) => {
    const baseMethods = {
        updateTextSource: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
        clearTextSource: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
        updateChatMsgText: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
        getSceneItemId: vi.fn<(...args: unknown[]) => Promise<{ sceneItemId: number; sceneName: string; }>>().mockResolvedValue({ sceneItemId: 1, sceneName: 'test-scene' }),
        setSourceVisibility: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
        getGroupSceneItemId: vi.fn<(...args: unknown[]) => Promise<{ sceneItemId: number; }>>().mockResolvedValue({ sceneItemId: 1 }),
        setGroupSourceVisibility: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
        setPlatformLogoVisibility: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
        setNotificationPlatformLogoVisibility: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
        hideAllPlatformLogos: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
        hideAllNotificationPlatformLogos: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
        setChatDisplayVisibility: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
        setNotificationDisplayVisibility: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
        hideAllDisplays: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
        setSourceFilterVisibility: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined)
    };

    return {
        ...baseMethods,
        ...overrides,
        _mockType: 'SourcesManager'
    };
};

const createMockRetrySystem = (behaviorConfig: UnknownRecord = {}) => {
    const defaultBehavior = {
        maxRetries: 3,
        baseDelay: 1000,
        successRate: 1.0, // 100% success by default
        shouldExponentialBackoff: true,
        ...behaviorConfig
    };

    let callCount = 0;

    return {
        executeWithRetry: vi.fn<(...args: [unknown, () => unknown | Promise<unknown>]) => Promise<unknown>>().mockImplementation(async (_platform, fn) => {
            callCount++;
            
            if (nextPseudoRandom() > defaultBehavior.successRate) {
                throw new Error(`Simulated failure on attempt ${callCount}`);
            }
            
            return await fn();
        }),
        
        resetRetryCount: vi.fn(() => { callCount = 0; }),
        handleConnectionError: vi.fn<(...args: unknown[]) => unknown>(),
        handleConnectionSuccess: vi.fn<(...args: unknown[]) => unknown>(),
        incrementRetryCount: vi.fn(() => {
            callCount++;
            return defaultBehavior.baseDelay * (defaultBehavior.shouldExponentialBackoff ? Math.pow(2, callCount - 1) : 1);
        }),
        getRetryCount: vi.fn(() => callCount),
        
        _mockType: 'RetrySystem',
        _behavior: defaultBehavior,
        _callCount: () => callCount
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

const createTestApp = (handlerOverrides: UnknownRecord = {}) => {
    const baseHandlers = {
        handleChatMessage: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        handleGiftNotification: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        handleFollowNotification: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        handlePaypiggyNotification: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        handleRaidNotification: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        updateViewerCount: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        
        handlePlatformConnection: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        handlePlatformDisconnection: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        handleError: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true)
    };

    return {
        ...baseHandlers,
        ...handlerOverrides,
        
        notificationManager: createMockNotificationManager(),
        config: {
            general: { debug: false },
            platforms: { youtube: true, twitch: true, tiktok: true }
        },
        
        _mockType: 'Application',
        _validHandlers: Object.keys(baseHandlers)
    };
};

const createMockOBSConnection = (connectionState = 'connected', methodOverrides: UnknownRecord = {}) => {
    const baseMethods = {
        connect: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        disconnect: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        isConnected: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(connectionState === 'connected'),
        getConnectionState: vi.fn<(...args: unknown[]) => typeof connectionState>().mockReturnValue(connectionState),
        sendRequest: vi.fn<(...args: unknown[]) => Promise<{ status: string; }>>().mockResolvedValue({ status: 'ok' }),
        sendCommand: vi.fn<(...args: unknown[]) => Promise<{ status: string; }>>().mockResolvedValue({ status: 'ok' }),
        updateTextSource: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        setSourceVisibility: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        playMediaSource: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        stopMediaSource: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        getSceneList: vi.fn<(...args: unknown[]) => Promise<{ scenes: never[]; }>>().mockResolvedValue({ scenes: [] }),
        getSourceList: vi.fn<(...args: unknown[]) => Promise<{ sources: never[]; }>>().mockResolvedValue({ sources: [] }),
        setSceneItemEnabled: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        getSceneItemEnabled: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        setSourceFilterEnabled: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        getSourceFilterEnabled: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        setSourceSettings: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        getSourceSettings: vi.fn<(...args: unknown[]) => Promise<{}>>().mockResolvedValue({}),
        setInputVolume: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        getInputVolume: vi.fn<(...args: unknown[]) => Promise<{ inputVolume: number; }>>().mockResolvedValue({ inputVolume: 1.0 }),
        setInputMute: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        getInputMute: vi.fn<(...args: unknown[]) => Promise<{ inputMuted: false; }>>().mockResolvedValue({ inputMuted: false }),
        triggerHotkeyBySequence: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        triggerHotkeyByName: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        triggerHotkeyByKeySequence: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        getStudioModeEnabled: vi.fn<(...args: unknown[]) => Promise<{ studioModeEnabled: false; }>>().mockResolvedValue({ studioModeEnabled: false }),
        setStudioModeEnabled: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        getTransitionList: vi.fn<(...args: unknown[]) => Promise<{ transitions: never[]; }>>().mockResolvedValue({ transitions: [] }),
        setCurrentTransition: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        setTransitionDuration: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        triggerStudioModeTransition: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        executeBatch: vi.fn<(...args: unknown[]) => Promise<{ results: never[]; }>>().mockResolvedValue({ results: [] }),
        on: vi.fn<(...args: unknown[]) => unknown>(),
        off: vi.fn<(...args: unknown[]) => unknown>(),
        once: vi.fn<(...args: unknown[]) => unknown>(),
        emit: vi.fn<(...args: unknown[]) => unknown>(),
        
        processSourceEvent: vi.fn<(...args: [unknown]) => UnknownRecord>().mockImplementation((sourceData) => {
            const sourceRecord = asRecord(sourceData);
            const eventData = asRecord(sourceRecord.eventData);
            const inputSettings = asRecord(eventData.inputSettings);
            const timestamp = createTimestamp();
            return {
                eventType: sourceRecord.eventType || 'InputSettingsChanged',
                messageType: 'sourceUpdate',
                platform: 'obs',
                sourceName: eventData.sourceName || 'Test Source',
                sourceUuid: eventData.sourceUuid || 'source-uuid',
                inputKind: eventData.inputKind || 'text_source',
                inputName: eventData.inputName || eventData.sourceName || 'Chat Display',
                newText: inputSettings.text ?? 'New chat message from viewer',
                fontSize: inputSettings.font_size ?? 24,
                success: true,
                processed: true,
                timestamp: timestamp.iso
            };
        }),
        processSceneEvent: vi.fn<(...args: [unknown]) => UnknownRecord>().mockImplementation((sceneData) => {
            const sceneRecord = asRecord(sceneData);
            const eventData = asRecord(sceneRecord.eventData);
            const timestamp = createTimestamp();
            return {
                eventType: sceneRecord.eventType || 'SceneTransitionStarted',
                messageType: 'sceneChange',
                platform: 'obs',
                sceneName: eventData.sceneName || eventData.toSceneName || 'Main Scene',
                sceneUuid: eventData.sceneUuid || eventData.toSceneUuid || 'scene-uuid',
                transitionName: eventData.transitionName || 'Fade',
                fromScene: eventData.fromSceneName || 'Main Scene',
                toScene: eventData.toSceneName || 'BRB Scene',
                fromSceneUuid: eventData.fromSceneUuid || '00000000-0000-0000-0000-000000000010',
                toSceneUuid: eventData.toSceneUuid || '00000000-0000-0000-0000-000000000011',
                success: true,
                processed: true,
                timestamp: timestamp.iso
            };
        }),
        
        displayNotification: vi.fn<(...args: [unknown]) => UnknownRecord>().mockImplementation((notification) => {
            const notificationRecord = asRecord(notification);
            const timestamp = createTimestamp();
            return {
                displayed: true,
                obsSource: 'notification-display',
                finalText: notificationRecord.displayMessage ?? notificationRecord.message ?? `${notificationRecord.username || 'User'} notification`,
                notification: notificationRecord,
                success: true,
                timestamp: timestamp.iso
            };
        })
    };

    return {
        ...baseMethods,
        ...methodOverrides,
        _mockType: 'OBSConnection',
        _connectionState: connectionState,
        _validMethods: Object.keys(baseMethods)
    };
};

const createMockDisplayQueue = (queueState: DisplayQueueState = {}, methodOverrides: DisplayQueueState = {}) => {
    const normalizedQueueState = isRecord(queueState) ? queueState : {};
    const throwOnAdd = methodOverrides.shouldThrowError ?? normalizedQueueState.shouldThrowError;
    const errorMessage = methodOverrides.errorMessage ?? normalizedQueueState.errorMessage;
    const addItemMock = throwOnAdd
        ? vi.fn<(...args: [DisplayQueueItem]) => readonly DisplayQueueItem[]>().mockImplementation(() => {
            throw new Error(errorMessage || 'DisplayQueue error');
        })
        : vi.fn<(...args: [DisplayQueueItem]) => readonly DisplayQueueItem[]>((item) => [item]);
    const baseMethods = {
        addItem: addItemMock,
        addSequence: vi.fn<(...args: [DisplayQueueItem[]]) => readonly DisplayQueueItem[]>().mockImplementation((items) => {
            for (const item of items) {
                addItemMock(item);
            }
            return items;
        }),
        addToQueue: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        processQueue: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        removeItem: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        clearQueue: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        getQueueLength: vi.fn<(...args: unknown[]) => number>().mockReturnValue(normalizedQueueState.length || 0),
        getNextItem: vi.fn<(...args: unknown[]) => {} | null>().mockReturnValue(normalizedQueueState.nextItem || null),
        isProcessing: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(normalizedQueueState.isProcessing || false),
        startProcessing: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        stopProcessing: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        pauseProcessing: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        resumeProcessing: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        getQueueItems: vi.fn<(...args: unknown[]) => unknown[]>().mockReturnValue(normalizedQueueState.items || []),
        setMaxQueueSize: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        getMaxQueueSize: vi.fn<(...args: unknown[]) => number>().mockReturnValue(normalizedQueueState.maxSize ?? 100),
        isQueueFull: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(normalizedQueueState.isFull || false),
        getProcessingStats: vi.fn<(...args: unknown[]) => { processed: number; failed: number; averageProcessingTime: number; }>().mockReturnValue({
            processed: normalizedQueueState.processed || 0,
            failed: normalizedQueueState.failed || 0,
            averageProcessingTime: normalizedQueueState.avgTime || 0
        }),
        on: vi.fn<(...args: unknown[]) => unknown>(),
        off: vi.fn<(...args: unknown[]) => unknown>(),
        once: vi.fn<(...args: unknown[]) => unknown>(),
        emit: vi.fn<(...args: unknown[]) => unknown>()
    };

    return {
        ...baseMethods,
        ...methodOverrides,
        _mockType: 'DisplayQueue',
        _queueState: normalizedQueueState,
        _validMethods: Object.keys(baseMethods)
    };
};

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

const createMockSpamDetector = (behaviorOverrides = {}) => {
    const defaultBehavior = {
        shouldShow: true,
        aggregatedMessage: null,
        isLowValue: false,
        ...behaviorOverrides
    };

    const baseMethods = {
        handleDonationSpam: vi.fn<(...args: unknown[]) => { shouldShow: boolean; aggregatedMessage: null; }>().mockReturnValue({
            shouldShow: defaultBehavior.shouldShow,
            aggregatedMessage: defaultBehavior.aggregatedMessage
        }),
        isLowValueDonation: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(defaultBehavior.isLowValue),
        getStatistics: vi.fn<(...args: unknown[]) => { totalMessages: number; duplicates: number; spamDetected: number; }>().mockReturnValue({
            totalMessages: 0,
            duplicates: 0,
            spamDetected: 0
        }),
        resetTracking: vi.fn<(...args: unknown[]) => unknown>(),
        destroy: vi.fn<(...args: unknown[]) => unknown>()
    };

    return {
        ...baseMethods,
        _mockType: 'SpamDetector',
        _behavior: defaultBehavior,
        _validMethods: Object.keys(baseMethods)
    };
};

const createMockAuthManager = (state = 'READY', authOverrides = {}) => {
    const defaultAuthData = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        userId: 'test-broadcaster-id',
        clientId: 'test-client-id',
        scopes: ['user:read:chat', 'chat:edit', 'channel:read:subscriptions', 'moderator:read:followers', 'bits:read'],
        ...authOverrides
    };

    const baseMethods = {
        getState: vi.fn<(...args: unknown[]) => typeof state>().mockReturnValue(state),
        getUserId: vi.fn(() => {
            if (state !== 'READY') {
                throw new Error('Authentication not initialized. Call initialize() first.');
            }
            return defaultAuthData.userId;
        }),
        getAccessToken: vi.fn(() => {
            if (state !== 'READY') {
                return Promise.reject(new Error('Authentication not initialized. Call initialize() first.'));
            }
            return Promise.resolve(defaultAuthData.accessToken);
        }),
        getScopes: vi.fn(() => {
            if (state !== 'READY') {
                return Promise.reject(new Error('Authentication not initialized. Call initialize() first.'));
            }
            return Promise.resolve(defaultAuthData.scopes);
        }),
        initialize: vi.fn(async () => {
            if (state === 'ERROR') {
                throw new Error('Mock authentication initialization failed');
            }
            return state === 'READY';
        }),
        updateConfig: vi.fn<(...args: unknown[]) => unknown>(),
        getLastError: vi.fn<(...args: unknown[]) => Error | null>().mockReturnValue(state === 'ERROR' ? new Error('Mock auth error') : null),
        isReady: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(state === 'READY')
    };

    return {
        ...baseMethods,
        config: { ...defaultAuthData },
        state,
        
        _mockType: 'AuthManager',
        _authData: defaultAuthData,
        _validMethods: Object.keys(baseMethods)
    };
};

const createMockTikTokPlatformDependencies = (behaviorOverrides: UnknownRecord = {}) => {
    const connectionOverrides = asRecord(behaviorOverrides.connection);
    const constantsOverrides = asRecord(behaviorOverrides.constants);
    const mockTikTokWebSocketClient = vi.fn<(...args: []) => TikTokWebSocketClientConnection>().mockImplementation(() => {
        const mockConnection = {
            connect: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
            disconnect: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
            on: vi.fn<(...args: unknown[]) => unknown>(),
            off: vi.fn<(...args: unknown[]) => unknown>(),
            removeAllListeners: vi.fn<(...args: unknown[]) => unknown>(),
            getState: vi.fn<(...args: unknown[]) => string>().mockReturnValue('DISCONNECTED'),
            getRoomInfo: vi.fn<(...args: unknown[]) => Promise<{ room_id: string; title: string; user_count: number; }>>().mockResolvedValue({
                room_id: '12345',
                title: 'Test Room',
                user_count: 100
            }),
            state: 'DISCONNECTED',
            isConnecting: false,
            isConnected: false,
            connected: false,
            ...connectionOverrides
        };
        return mockConnection;
    });

    return {
        TikTokWebSocketClient: mockTikTokWebSocketClient,
        logger: noOpLogger,
        retrySystem: createMockRetrySystem(),
        constants: {
            GRACE_PERIODS: { TIKTOK: 5000 },
            ...constantsOverrides
        },
        notificationBridge: behaviorOverrides.notificationBridge || behaviorOverrides.app || null,
        config: behaviorOverrides.config || null,
        _mockType: 'TikTokPlatformDependencies'
    };
};

const createMockPlatformConnection = (handlerOverrides: UnknownRecord = {}) => {
    const baseHandlers = {
        processChatMessage: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        sendChatMessage: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        
        processGiftNotification: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        processFollowNotification: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        processSubscriptionNotification: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        
        getViewerCount: vi.fn<(...args: unknown[]) => Promise<number>>().mockResolvedValue(100),
        updateViewerCount: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        
        connect: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        disconnect: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        isConnected: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
        getConnectionState: vi.fn<(...args: unknown[]) => string>().mockReturnValue('connected'),
        
        handleTikTokMessage: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        handleTwitchMessage: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        handleYouTubeMessage: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        
        checkPermissions: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
        validateMessage: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
        normalizeMessage: vi.fn<(...args: [UnknownRecord]) => UnknownRecord>().mockImplementation(msg => msg),
        
        handleRapidMessages: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        handleConcurrentOperations: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true)
    };

    return {
        ...baseHandlers,
        ...handlerOverrides,
        
        platform: 'mock',
        version: '1.0.0',
        
        _mockType: 'PlatformConnection',
        _validHandlers: Object.keys(baseHandlers)
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
    createMockNotificationDispatcher,
    createMockNotificationBuilder,
    createMockNotificationManager,

    createMockYouTubeServices,
    createMockTikTokServices,
    createMockTwitchServices,
    createMockPlatformConnection,
    createMockTikTokPlatformDependencies,


    createMockOBSManager,
    createMockSourcesManager,
    createMockRetrySystem,
    createMockFileSystem,
    noOpLogger,
    createTestApp,
    createMockSpamDetector,
    createMockDisplayQueue,
    createMockOBSConnection,
    createMockAuthManager,


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
