import { expect } from 'bun:test';

import { initializeLoggingConfig } from '../../src/core/logging';
import { createRetrySystem, type RetrySystem } from '../../src/utils/retry-system';

import testClock from './test-clock';
import { createMockFn, isMockFunction, clearAllMocks, type TestMockFn } from './bun-mock-utils';
import { loadPlatformFixture as loadSyntheticFixture } from './platform-test-data';

type TestRecord = Record<string, unknown>;
type PlatformName = 'tiktok' | 'twitch' | 'youtube';
type LoggingPlatformOverrides = Partial<Record<PlatformName, TestRecord>>;

type TestUser = TestRecord & {
    username: string;
    displayName: string;
    userId: string;
    isMod: boolean;
    isSubscriber: boolean;
    isBroadcaster: boolean;
};

type TestGiftInput = TestRecord & {
    giftType?: unknown;
    giftCount?: unknown;
    amount?: unknown;
    currency?: unknown;
};

type TestGift = TestRecord & {
    giftType: string;
    giftCount: unknown;
    amount: unknown;
    currency: string;
    displayMessage: string;
    ttsMessage: string;
};

type TestNotification = TestRecord & {
    id: string;
    type: string;
    username: string;
    platform: string;
    displayMessage: string;
    ttsMessage: string;
    logMessage: string;
    processedAt: number;
    timestamp: string;
};

type NotificationLike = TestRecord & {
    id?: unknown;
    type?: unknown;
    username?: unknown;
    platform?: unknown;
    displayMessage?: unknown;
    ttsMessage?: unknown;
    processedAt?: unknown;
    timestamp?: unknown;
};

type UserLike = TestRecord & {
    username?: unknown;
    userId?: unknown;
};

type LoggerMock = {
    debug: TestMockFn;
    info: TestMockFn;
    warn: TestMockFn;
    error: TestMockFn;
};

type NotificationManagerMock = {
    emit: TestMockFn<[event: string, data: unknown], boolean>;
    on: TestMockFn<[event: string, handler: unknown], boolean>;
    removeListener: TestMockFn<[event: string, handler: unknown], boolean>;
};

type RetrySystemMock = {
    resetRetryCount: TestMockFn;
    handleConnectionError: TestMockFn;
    handleConnectionSuccess: TestMockFn;
    incrementRetryCount: TestMockFn;
    executeWithRetry: TestMockFn;
};

type MockPlatformBaseDependencies = TestRecord & {
    logger: LoggerMock;
    notificationManager: NotificationManagerMock;
    retrySystem: RetrySystemMock;
    constants: {
        GRACE_PERIODS: Record<'TIKTOK' | 'TWITCH' | 'YOUTUBE', number>;
    };
    USER_AGENTS: string[];
    notificationBridge: unknown;
};

type TikTokClientMock = {
    connect: TestMockFn<[], Promise<boolean>>;
    disconnect: TestMockFn<[], Promise<boolean>>;
    on: TestMockFn;
    removeAllListeners: TestMockFn;
};

type TikTokMockPlatformDependencies = MockPlatformBaseDependencies & {
    TikTokWebSocketClient: TestMockFn<[], TikTokClientMock>;
    WebcastEvent: TestRecord;
    ControlEvent: TestRecord;
    WebcastPushConnection: TestMockFn;
};

type TwitchMockPlatformDependencies = MockPlatformBaseDependencies & {
    tmi: TestMockFn;
    TwitchEventSub: TestMockFn;
    ApiClient: TestMockFn;
    RefreshingAuthProvider: TestMockFn;
    EventSubWsListener: TestMockFn;
};

type YouTubeLiveChatMock = {
    start: TestMockFn;
    stop: TestMockFn;
    on: TestMockFn;
    sendMessage: TestMockFn;
};

type YouTubeVideoInfoMock = {
    getLiveChat: TestMockFn<[], Promise<YouTubeLiveChatMock>>;
};

type YouTubeInnertubeApi = {
    getInfo: TestMockFn<[], Promise<YouTubeVideoInfoMock>>;
};

type YouTubeMockPlatformDependencies = MockPlatformBaseDependencies & {
    google: { youtube: TestMockFn };
    Innertube: {
        create: TestMockFn<[], Promise<YouTubeInnertubeApi>>;
    };
    streamDetectionService: {
        detectLiveStreams: TestMockFn<[], Promise<{ success: boolean; videoIds: string[] }>>;
    };
    axios: TestMockFn;
};

type MockPlatformDependencies = MockPlatformBaseDependencies
    | TikTokMockPlatformDependencies
    | TwitchMockPlatformDependencies
    | YouTubeMockPlatformDependencies;

type RetryExecuteMock = TestMockFn<[platform: string, executeFunction: () => Promise<unknown>, maxRetries?: number], Promise<unknown>> & {
    <T>(platform: string, executeFunction: () => Promise<T>, maxRetries?: number): Promise<T>;
};

type TestRetrySystem = Omit<RetrySystem, 'executeWithRetry' | 'resetRetryCount' | 'handleConnectionError' | 'handleConnectionSuccess' | 'incrementRetryCount' | 'getRetryCount'> & {
    executeWithRetry: RetryExecuteMock;
    resetRetryCount: TestMockFn<[platform: string], void>;
    handleConnectionError: TestMockFn<[platform: string, error: unknown, reconnectFunction: () => Promise<unknown>, cleanupFunction?: (() => Promise<unknown> | unknown) | null], void>;
    handleConnectionSuccess: TestMockFn<[platform: string, connection?: unknown, context?: string], void>;
    incrementRetryCount: TestMockFn<[], number>;
    getRetryCount: TestMockFn<[platform?: string], number>;
};

type CleanupOptions = {
    clearMocksAfterEach: boolean;
    validateMocksBeforeEach: boolean;
    logUnusedMocks: boolean;
    trackMockUsage: boolean;
    handleCleanupErrors: boolean;
};

type MockUsageMetric = {
    timestamp: number;
    totalMocksActive: number;
    memoryUsage: NodeJS.MemoryUsage;
};

type CleanupStats = {
    mocksCleared: number;
    unusedMocks: string[];
    performanceMetrics: MockUsageMetric[];
    cleanupErrors: unknown[];
};

type AutomatedCleanup = {
    config: CleanupOptions;
    beforeEach: () => void;
    afterEach: () => void;
    cleanupMock: (mockObject: unknown) => void;
    getCleanupStats: () => CleanupStats;
    isCompatible: boolean;
    preservesExistingSetup: boolean;
};

type MockUsageOptions = {
    requireAllMethodsCalled: boolean;
    detectUnusedMocks: boolean;
    validateMockTypes: boolean;
    behaviorFocusedMode: boolean;
    maxMethodsRecommended: number;
    expectedMockType: string | null;
};

type MockUsageValidation = {
    isValid: boolean;
    unusedMethods: string[];
    mockTypeValid: boolean;
    isFactoryMock: boolean;
    behaviorConfigured: boolean;
    complexityScore: number;
    recommendations: string[];
};

const isRecord = (value: unknown): value is TestRecord => {
    return !!value && typeof value === 'object';
};

const hasMockReset = (value: unknown): value is { mockReset: () => unknown } => {
    return isRecord(value) && typeof value.mockReset === 'function';
};

const BASE_TIMESTAMP_MS = Date.parse('2024-01-01T00:00:00.000Z');
let sequence = 0;
const nextSequence = () => {
    sequence += 1;
    return sequence;
};
const resetTestSetupSequence = () => {
    sequence = 0;
};
const nextTimestampMs = () => BASE_TIMESTAMP_MS + (nextSequence() * 1000);
const nextTestId = (prefix: string) => `${prefix}-${nextSequence().toString(36).padStart(6, '0')}`;

const createMockLoggingConfig = (platformOverrides: LoggingPlatformOverrides = {}) => ({
    console: { enabled: false },
    file: { enabled: false },
    platforms: { 
        tiktok: { enabled: true }, 
        twitch: { enabled: true }, 
        youtube: { enabled: true },
        ...platformOverrides 
    },
    chat: { enabled: false }
});

const initializeTestLogging = (platformOverrides: LoggingPlatformOverrides = {}) => {
    try {
        initializeLoggingConfig({ logging: createMockLoggingConfig(platformOverrides) });
    } catch {
        // Logging module is mocked or not available, skip initialization
    }
};

const createTestUser = <Overrides extends TestRecord = Record<string, never>>(overrides?: Overrides): TestUser & Overrides => ({
    username: 'TestUser',
    displayName: 'TestUser',
    userId: 'test-user-id',
    isMod: false,
    isSubscriber: false,
    isBroadcaster: false,
    ...overrides
} as TestUser & Overrides);

const createTestGift = (overrides: TestGiftInput = {}): TestGift => {
    const { giftType, giftCount, amount, currency } = overrides;

    if (!giftType || typeof giftType !== 'string' || !giftType.trim()) {
        throw new Error('giftType is required for test gift data');
    }

    if (giftCount === undefined || giftCount === null) {
        throw new Error('giftCount is required for test gift data');
    }

    if (amount === undefined || amount === null) {
        throw new Error('amount is required for test gift data');
    }

    if (!currency || typeof currency !== 'string' || !currency.trim()) {
        throw new Error('currency is required for test gift data');
    }

    const displayMessage = `${giftCount}x ${giftType}`;
    const ttsMessage = `${giftCount} ${giftType}`;

    return {
        giftType,
        giftCount,
        amount,
        currency,
        displayMessage,
        ttsMessage,
        ...overrides
    } as TestGift;
};

const createTestNotification = <Overrides extends TestRecord = Record<string, never>>(
    type = 'platform:gift',
    overrides?: Overrides
): TestNotification & Overrides => {
    const timestampMs = nextTimestampMs();
    const timestampIso = new Date(timestampMs).toISOString();

    return {
        id: nextTestId(`test-${type}`),
        type,
        username: 'TestUser',
        platform: 'tiktok',
        displayMessage: `TestUser ${type}`,
        ttsMessage: `TestUser ${type}`,
        logMessage: `${type} from TestUser`,
        processedAt: timestampMs,
        timestamp: timestampIso,
        ...overrides
    } as TestNotification & Overrides;
};

function createMockPlatformDependencies<Overrides extends TestRecord = Record<string, never>>(platformType?: 'tiktok', overrides?: Overrides): TikTokMockPlatformDependencies & Overrides;
function createMockPlatformDependencies<Overrides extends TestRecord = Record<string, never>>(platformType: 'twitch', overrides?: Overrides): TwitchMockPlatformDependencies & Overrides;
function createMockPlatformDependencies<Overrides extends TestRecord = Record<string, never>>(platformType: 'youtube', overrides?: Overrides): YouTubeMockPlatformDependencies & Overrides;
function createMockPlatformDependencies<Overrides extends TestRecord>(platformType: string, overrides: Overrides): MockPlatformBaseDependencies & Overrides;
function createMockPlatformDependencies(platformType = 'tiktok', overrides: TestRecord = {}): MockPlatformDependencies {
    const { notificationBridge: overrideBridge, ...restOverrides } = overrides;

    const baseMocks: MockPlatformBaseDependencies = {
        logger: { 
            debug: createMockFn(), 
            info: createMockFn(), 
            warn: createMockFn(), 
            error: createMockFn() 
        },
        notificationManager: {
            emit: createMockFn<[event: string, data: unknown], boolean>().mockImplementation((_event, _data) => true),
            on: createMockFn<[event: string, handler: unknown], boolean>().mockImplementation((_event, _handler) => true),
            removeListener: createMockFn<[event: string, handler: unknown], boolean>().mockImplementation((_event, _handler) => true)
        },
        retrySystem: { 
            resetRetryCount: createMockFn(),
            handleConnectionError: createMockFn(),
            handleConnectionSuccess: createMockFn(),
            incrementRetryCount: createMockFn(),
            executeWithRetry: createMockFn()
        },
        constants: { 
            GRACE_PERIODS: { TIKTOK: 5000, TWITCH: 3000, YOUTUBE: 3000 } 
        },
        USER_AGENTS: ['test-user-agent'],
        notificationBridge: overrideBridge || null
    };

    switch (platformType) {
        case 'tiktok':
            return {
                ...baseMocks,
                TikTokWebSocketClient: createMockFn<[], TikTokClientMock>().mockImplementation(() => ({
                    connect: createMockFn<[], Promise<boolean>>().mockResolvedValue(true),
                    disconnect: createMockFn<[], Promise<boolean>>().mockResolvedValue(true),
                    on: createMockFn(),
                    removeAllListeners: createMockFn()
                })),
                WebcastEvent: {},
                ControlEvent: {},
                WebcastPushConnection: createMockFn(),
                ...restOverrides
            };
        
        case 'twitch':
            return {
                ...baseMocks,
                tmi: createMockFn(),
                TwitchEventSub: createMockFn(),
                ApiClient: createMockFn(),
                RefreshingAuthProvider: createMockFn(),
                EventSubWsListener: createMockFn(),
                ...restOverrides
            };
        
        case 'youtube':
            return {
                ...baseMocks,
                google: { youtube: createMockFn() },
                Innertube: {
                    create: createMockFn<[], Promise<YouTubeInnertubeApi>>(() => Promise.resolve({
                        getInfo: createMockFn<[], Promise<YouTubeVideoInfoMock>>(() => Promise.resolve({
                            getLiveChat: createMockFn<[], Promise<YouTubeLiveChatMock>>(() => Promise.resolve({
                                start: createMockFn(),
                                stop: createMockFn(),
                                on: createMockFn(),
                                sendMessage: createMockFn()
                            }))
                        }))
                    }))
                },
                streamDetectionService: {
                    detectLiveStreams: createMockFn<[], Promise<{ success: boolean; videoIds: string[] }>>().mockResolvedValue({
                        success: true,
                        videoIds: []
                    })
                },
                axios: createMockFn(),
                ...restOverrides
            };

        default:
            return { ...baseMocks, ...restOverrides };
    }
}

const createTestApp = <Overrides extends TestRecord = Record<string, never>>(overrides?: Overrides) => ({
    handleChatMessage: createMockFn(),
    handleGiftNotification: createMockFn(),
    handleFollowNotification: createMockFn(),
    handlePaypiggyNotification: createMockFn(),
    handleRaidNotification: createMockFn(),
    updateViewerCount: createMockFn(),
    notificationManager: {
        handleNotification: createMockFn()
    },
    ...overrides
});

const createTestRetrySystem = <Overrides extends TestRecord = Record<string, never>>(overrides?: Overrides): TestRetrySystem & Overrides => {
    const retrySystem = createRetrySystem() as TestRetrySystem & Overrides;

    retrySystem.executeWithRetry = createMockFn<[platform: string, executeFunction: () => Promise<unknown>, maxRetries?: number], Promise<unknown>>().mockImplementation(async (_platform, executeFunction) => {
        return await executeFunction();
    }) as RetryExecuteMock;
    retrySystem.resetRetryCount = createMockFn<[platform: string], void>();
    retrySystem.handleConnectionError = createMockFn<[platform: string, error: unknown, reconnectFunction: () => Promise<unknown>, cleanupFunction?: (() => Promise<unknown> | unknown) | null], void>();
    retrySystem.handleConnectionSuccess = createMockFn<[platform: string, connection?: unknown, context?: string], void>();
    retrySystem.incrementRetryCount = createMockFn<[], number>().mockReturnValue(5000);
    retrySystem.getRetryCount = createMockFn<[platform?: string], number>().mockReturnValue(0);

    return Object.assign(retrySystem, overrides);
};

const expectValidNotificationData = (data: NotificationLike) => {
    expect(data).toHaveProperty('id');
    expect(data).toHaveProperty('type');
    expect(data).toHaveProperty('username');
    expect(data).toHaveProperty('platform');
    expect(data).toHaveProperty('displayMessage');
    expect(data).toHaveProperty('ttsMessage');
    expect(data).toHaveProperty('processedAt');
    expect(data.id).toBeTruthy();
    expect(data.displayMessage).toBeTruthy();
    expect(data.ttsMessage).toBeTruthy();
};

const expectValidUserData = (user: UserLike) => {
    expect(user).toHaveProperty('username');
    expect(user.username).toBeTruthy();
    if (user.userId !== undefined && user.userId !== null) {
        expect(String(user.userId)).toBeTruthy();
    }
};


const expectValidNotification = (notification: NotificationLike, expectedType: string, expectedPlatform: string) => {
    expect(notification).toHaveProperty('id');
    expect(notification).toHaveProperty('type');
    expect(notification).toHaveProperty('platform');
    expect(notification).toHaveProperty('username');
    expect(notification).toHaveProperty('displayMessage');
    expect(notification).toHaveProperty('ttsMessage');
    expect(notification).toHaveProperty('processedAt');
    expect(notification).toHaveProperty('timestamp');
    
    expect(notification.type).toBe(expectedType);
    expect(notification.platform).toBe(expectedPlatform);
    
    expect(notification.id).toBeTruthy();
    expect(notification.displayMessage).toBeTruthy();
    expect(notification.ttsMessage).toBeTruthy();
    expect(notification.processedAt).toBeInstanceOf(Number);
    expect(notification.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    
    expect(notification.username).toBeTruthy();
};

const expectNoTechnicalArtifacts = (content: string) => {
    expect(content).toBeTruthy();
    expect(typeof content).toBe('string');
    
    expect(content).not.toContain('undefined');
    expect(content).not.toContain('null');
    expect(content).not.toContain('NaN');
    expect(content).not.toContain('[object Object]');
    expect(content).not.toContain('[object Array]');
    expect(content).not.toContain('function');
    expect(content).not.toContain('TypeError');
    expect(content).not.toContain('ReferenceError');
    
    expect(content).not.toMatch(/\$\d+\.\d{3,}/);
    expect(content).not.toMatch(/\$NaN/);
    expect(content).not.toMatch(/\$undefined/);
    
    expect(content.trim()).toBeTruthy();
};

const TEST_TIMEOUTS = {
    FAST: 1000,
    MEDIUM: 5000,
    SLOW: 10000,
    PERFORMANCE: 15000
};

const INTERNATIONAL_USERNAMES = {
    english: 'TestUser',
    chinese: '测试用户',
    japanese: 'テストユーザー',
    korean: '테스트사용자',
    arabic: 'مستخدم تجريبي',
    emoji: '🎮TestUser🎮',
    mixed: '用户Test123🌸',
    rtl: 'مستخدم123',
    long: 'VeryLongInternationalUsernameWithUnicode测试用户テストユーザー🌸🎮'
};

const TEST_USERNAMES = {
    SIMPLE: 'TestUser',
    WITH_EMOJIS: '🌸DemoUser🌸',
    LONG: 'VeryLongUsername123456789',
    WITH_SPACES: 'User With Spaces',
    SPECIAL_CHARS: 'user123!@#',
    UNICODE: '用户名中文'
};

const TEST_COMMANDS = {
    SIMPLE: '!hello',
    WITH_PARAMS: '!command param',
    SPECIAL: '!boom',
    LONG: '!verylongcommandname'
};

const loadPlatformFixture = (platform: string, eventType: string) => {
    return loadSyntheticFixture(platform, eventType);
};

const setupAutomatedCleanup = (options: Partial<CleanupOptions> = {}): AutomatedCleanup => {
    const defaultOptions = {
        clearMocksAfterEach: true,
        validateMocksBeforeEach: false,
        logUnusedMocks: false,
        trackMockUsage: false,
        handleCleanupErrors: true,
        ...options
    };

    const cleanupStats: CleanupStats = {
        mocksCleared: 0,
        unusedMocks: [],
        performanceMetrics: [],
        cleanupErrors: []
    };

    const mockUsageTracker = new Map<string, unknown>();

    const cleanup: AutomatedCleanup = {
        config: defaultOptions,
        
        beforeEach: () => {
            if (defaultOptions.validateMocksBeforeEach) {
                validateActiveMocks();
            }
            
            if (defaultOptions.trackMockUsage) {
                mockUsageTracker.clear();
            }
        },

        afterEach: () => {
            try {
                if (defaultOptions.clearMocksAfterEach) {
                    const clearedCount = clearAllActiveMocks();
                    cleanupStats.mocksCleared += clearedCount;
                }

                if (defaultOptions.logUnusedMocks) {
                    const unusedMocks = findUnusedMocks();
                    cleanupStats.unusedMocks.push(...unusedMocks);
                }

                if (defaultOptions.trackMockUsage) {
                    const usageMetrics = collectMockUsageMetrics();
                    cleanupStats.performanceMetrics.push(usageMetrics);
                }
            } catch (error) {
                if (defaultOptions.handleCleanupErrors) {
                    cleanupStats.cleanupErrors.push(error);
                } else {
                    throw error;
                }
            }
        },

        cleanupMock: (mockObject: unknown) => {
            try {
                if (isRecord(mockObject)) {
                    Object.keys(mockObject).forEach(key => {
                        if (isMockFunction(mockObject[key])) {
                            mockObject[key].mockReset();
                        } else if (hasMockReset(mockObject[key])) {
                            mockObject[key].mockReset();
                        }
                    });
                }
            } catch (error) {
                if (defaultOptions.handleCleanupErrors) {
                    cleanupStats.cleanupErrors.push(error);
                } else {
                    throw error;
                }
            }
        },

        getCleanupStats: () => ({ ...cleanupStats }),

        isCompatible: true,
        preservesExistingSetup: true
    };

    return cleanup;
};

const validateMockUsage = (mockObject: unknown, options: Partial<MockUsageOptions> = {}): MockUsageValidation => {
    const defaultOptions = {
        requireAllMethodsCalled: false,
        detectUnusedMocks: true,
        validateMockTypes: false,
        behaviorFocusedMode: false,
        maxMethodsRecommended: 5,
        expectedMockType: null,
        ...options
    };

    const validation: MockUsageValidation = {
        isValid: true,
        unusedMethods: [],
        mockTypeValid: false,
        isFactoryMock: false,
        behaviorConfigured: false,
        complexityScore: 0,
        recommendations: []
    };

    if (!isRecord(mockObject)) {
        validation.isValid = false;
        validation.recommendations.push('Mock object is not valid');
        return validation;
    }

    if (defaultOptions.validateMockTypes && mockObject._mockType) {
        validation.isFactoryMock = true;
        validation.mockTypeValid = !defaultOptions.expectedMockType || 
            mockObject._mockType === defaultOptions.expectedMockType;
        
        if (mockObject._behavior) {
            validation.behaviorConfigured = true;
        }
    }

    if (defaultOptions.detectUnusedMocks) {
        const methods = Object.keys(mockObject).filter(key => 
            typeof mockObject[key] === 'function' && isMockFunction(mockObject[key])
        );

        validation.unusedMethods = methods.filter(method => {
            const mockFn = mockObject[method];
            return isMockFunction(mockFn) && mockFn.mock.calls.length === 0;
        });

        if (validation.unusedMethods.length > 0) {
            validation.recommendations.push('Consider removing unused mock methods');
        }
    }

    const totalMethods = Object.keys(mockObject).filter(key => 
        typeof mockObject[key] === 'function'
    ).length;
    
    const hasInternalProperties = Object.keys(mockObject).some(key => 
        key.startsWith('_') && key !== '_mockType' && key !== '_behavior' && key !== '_validMethods'
    );

    validation.complexityScore = (totalMethods / 20) + (hasInternalProperties ? 0.3 : 0);

    if (defaultOptions.behaviorFocusedMode) {
        if (totalMethods > defaultOptions.maxMethodsRecommended) {
            validation.recommendations.push('Mock has too many methods');
            validation.recommendations.push('Consider using behavior-focused factory');
        }
        
        if (hasInternalProperties) {
            validation.recommendations.push('Mock exposes internal implementation details');
        }
    }

    return validation;
};

const clearAllActiveMocks = () => {
    let clearedCount = 0;
    clearAllMocks();
    clearedCount++;
    return clearedCount;
};

const findUnusedMocks = () => {
    return [];
};

const collectMockUsageMetrics = () => {
    return {
        timestamp: testClock.now(),
        totalMocksActive: 0,
        memoryUsage: process.memoryUsage()
    };
};

const validateActiveMocks = () => {
    return true;
};

export {
    resetTestSetupSequence,
    initializeTestLogging,
    
    setupAutomatedCleanup,
    validateMockUsage,
    
    createTestUser,
    createTestGift,
    createTestNotification,
    createMockPlatformDependencies,
    createTestApp,
    createTestRetrySystem,
    
    loadPlatformFixture,
    
    expectValidNotificationData,
    expectValidUserData,
    
    expectValidNotification,
    expectNoTechnicalArtifacts,
    
    INTERNATIONAL_USERNAMES,
    
    TEST_TIMEOUTS,
    TEST_USERNAMES,
    TEST_COMMANDS
};
