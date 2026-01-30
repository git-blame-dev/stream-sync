
const testClock = require('./test-clock');
const { createMockFn, isMockFunction, clearAllMocks } = require('./bun-mock-utils');
const BASE_TIMESTAMP_MS = Date.parse('2024-01-01T00:00:00.000Z');
let sequence = 0;
const nextSequence = () => {
    sequence += 1;
    return sequence;
};
const nextTimestampMs = () => BASE_TIMESTAMP_MS + (nextSequence() * 1000);
const nextTestId = (prefix) => `${prefix}-${nextSequence().toString(36).padStart(6, '0')}`;

const createMockLoggingConfig = (platformOverrides = {}) => ({
    console: { enabled: false },
    file: { enabled: false },
    debug: { enabled: false },
    platforms: { 
        tiktok: { enabled: true }, 
        twitch: { enabled: true }, 
        youtube: { enabled: true },
        ...platformOverrides 
    },
    chat: { enabled: false }
});

const initializeTestLogging = (platformOverrides = {}) => {
    try {
        const { setConfigValidator } = require('../../src/core/logging');
        if (typeof setConfigValidator === 'function') {
            setConfigValidator(() => createMockLoggingConfig(platformOverrides));
        } else {
            // Logging module is mocked, skip initialization
            console.log('[Test Setup] Logging module is mocked, skipping initialization');
        }
    } catch (error) {
        // Logging module is mocked or not available, skip initialization
        console.log('[Test Setup] Logging initialization skipped:', error.message);
    }
};

const createTestUser = (overrides = {}) => ({
    username: 'TestUser',
    displayName: 'TestUser',
    userId: 'test-user-id',
    isMod: false,
    isSubscriber: false,
    isBroadcaster: false,
    ...overrides
});

const createTestGift = (overrides = {}) => {
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
    };
};

const createTestNotification = (type = 'platform:gift', overrides = {}) => {
    const timestampMs = nextTimestampMs();
    const timestampIso = new Date(timestampMs).toISOString();

    return {
        id: nextTestId(`test-${type}`),
    type: type,
    username: 'TestUser',
    platform: 'tiktok',
    displayMessage: `TestUser ${type}`,
    ttsMessage: `TestUser ${type}`,
    logMessage: `${type} from TestUser`,
        processedAt: timestampMs,
        timestamp: timestampIso,
        ...overrides
    };
};

const createMockPlatformDependencies = (platformType = 'tiktok', overrides = {}) => {
    const { notificationBridge: overrideBridge, ...restOverrides } = overrides;

    const baseMocks = {
        logger: { 
            debug: createMockFn(), 
            info: createMockFn(), 
            warn: createMockFn(), 
            error: createMockFn() 
        },
        notificationManager: {
            emit: createMockFn().mockImplementation((event, data) => true),
            on: createMockFn().mockImplementation((event, handler) => true),
            removeListener: createMockFn().mockImplementation((event, handler) => true)
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

    // Platform-specific mocks
    switch (platformType) {
        case 'tiktok':
            return {
                ...baseMocks,
                TikTokWebSocketClient: createMockFn().mockImplementation(() => ({
                    connect: createMockFn().mockResolvedValue(true),
                    disconnect: createMockFn().mockResolvedValue(true),
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
                    create: createMockFn(() => Promise.resolve({
                        getInfo: createMockFn(() => Promise.resolve({
                            getLiveChat: createMockFn(() => Promise.resolve({
                                start: createMockFn(),
                                stop: createMockFn(),
                                on: createMockFn(),
                                sendMessage: createMockFn()
                            }))
                        }))
                    }))
                },
                streamDetectionService: {
                    detectLiveStreams: createMockFn().mockResolvedValue({
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
};

const createTestApp = (overrides = {}) => ({
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

const createTestRetrySystem = (overrides = {}) => ({
    executeWithRetry: createMockFn().mockImplementation(async (platform, fn) => {
        // Default behavior: just execute the function
        return await fn();
    }),
    resetRetryCount: createMockFn(),
    handleConnectionError: createMockFn(),
    handleConnectionSuccess: createMockFn(),
    incrementRetryCount: createMockFn().mockReturnValue(5000),
    getRetryCount: createMockFn().mockReturnValue(0),
    ...overrides
});

const expectValidNotificationData = (data) => {
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

const expectValidUserData = (user) => {
    expect(user).toHaveProperty('username');
    expect(user.username).toBeTruthy();
    if (user.userId !== undefined && user.userId !== null) {
        expect(String(user.userId)).toBeTruthy();
    }
};


const expectValidNotification = (notification, expectedType, expectedPlatform) => {
    // Basic structure validation
    expect(notification).toHaveProperty('id');
    expect(notification).toHaveProperty('type');
    expect(notification).toHaveProperty('platform');
    expect(notification).toHaveProperty('username');
    expect(notification).toHaveProperty('displayMessage');
    expect(notification).toHaveProperty('ttsMessage');
    expect(notification).toHaveProperty('processedAt');
    expect(notification).toHaveProperty('timestamp');
    
    // Type and platform validation
    expect(notification.type).toBe(expectedType);
    expect(notification.platform).toBe(expectedPlatform);
    
    // Content quality validation
    expect(notification.id).toBeTruthy();
    expect(notification.displayMessage).toBeTruthy();
    expect(notification.ttsMessage).toBeTruthy();
    expect(notification.processedAt).toBeInstanceOf(Number);
    expect(notification.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    
    // User data validation
    expect(notification.username).toBeTruthy();
};

const expectNoTechnicalArtifacts = (content) => {
    expect(content).toBeTruthy();
    expect(typeof content).toBe('string');
    
    // Check for common technical artifacts
    expect(content).not.toContain('undefined');
    expect(content).not.toContain('null');
    expect(content).not.toContain('NaN');
    expect(content).not.toContain('[object Object]');
    expect(content).not.toContain('[object Array]');
    expect(content).not.toContain('function');
    expect(content).not.toContain('TypeError');
    expect(content).not.toContain('ReferenceError');
    
    // Check for malformed numbers
    expect(content).not.toMatch(/\$\d+\.\d{3,}/); // More than 2 decimal places
    expect(content).not.toMatch(/\$NaN/);
    expect(content).not.toMatch(/\$undefined/);
    
    // Check for empty or whitespace-only content
    expect(content.trim()).toBeTruthy();
};

const TEST_TIMEOUTS = {
    FAST: 1000,      // For unit tests
    MEDIUM: 5000,    // For integration tests
    SLOW: 10000,     // For complex integration tests
    PERFORMANCE: 15000 // For performance tests with timeout protection
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

const loadPlatformFixture = (platform, eventType) => {
    const { loadPlatformFixture: loadSyntheticFixture } = require('./platform-test-data');
    return loadSyntheticFixture(platform, eventType);
};

// ================================================================================================
// PHASE 4A: ENHANCED LIFECYCLE MANAGEMENT
// ================================================================================================

const setupAutomatedCleanup = (options = {}) => {
    const defaultOptions = {
        clearMocksAfterEach: true,
        validateMocksBeforeEach: false,
        logUnusedMocks: false,
        trackMockUsage: false,
        handleCleanupErrors: true,
        ...options
    };

    const cleanupStats = {
        mocksCleared: 0,
        unusedMocks: [],
        performanceMetrics: [],
        cleanupErrors: []
    };

    const mockUsageTracker = new Map();

    const cleanup = {
        config: defaultOptions,
        
        beforeEach: () => {
            if (defaultOptions.validateMocksBeforeEach) {
                // Validate existing mocks before starting new test
                validateActiveMocks();
            }
            
            if (defaultOptions.trackMockUsage) {
                // Reset usage tracking
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

        cleanupMock: (mockObject) => {
            try {
                if (mockObject && typeof mockObject === 'object') {
                    Object.keys(mockObject).forEach(key => {
                        if (isMockFunction(mockObject[key])) {
                            mockObject[key].mockReset();
                        } else if (mockObject[key] && typeof mockObject[key] === 'object' && typeof mockObject[key].mockReset === 'function') {
                            // Handle objects that have mockReset methods (like our test case)
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

const validateMockUsage = (mockObject, options = {}) => {
    const defaultOptions = {
        requireAllMethodsCalled: false,
        detectUnusedMocks: true,
        validateMockTypes: false,
        behaviorFocusedMode: false,
        maxMethodsRecommended: 5,
        expectedMockType: null,
        ...options
    };

    const validation = {
        isValid: true,
        unusedMethods: [],
        mockTypeValid: false,
        isFactoryMock: false,
        behaviorConfigured: false,
        complexityScore: 0,
        recommendations: []
    };

    if (!mockObject || typeof mockObject !== 'object') {
        validation.isValid = false;
        validation.recommendations.push('Mock object is not valid');
        return validation;
    }

    // Check mock type validation
    if (defaultOptions.validateMockTypes && mockObject._mockType) {
        validation.isFactoryMock = true;
        validation.mockTypeValid = !defaultOptions.expectedMockType || 
            mockObject._mockType === defaultOptions.expectedMockType;
        
        if (mockObject._behavior) {
            validation.behaviorConfigured = true;
        }
    }

    // Detect unused methods
    if (defaultOptions.detectUnusedMocks) {
        const methods = Object.keys(mockObject).filter(key => 
            typeof mockObject[key] === 'function' && isMockFunction(mockObject[key])
        );

        validation.unusedMethods = methods.filter(method => {
            const mockFn = mockObject[method];
            return mockFn.mock.calls.length === 0;
        });

        if (validation.unusedMethods.length > 0) {
            validation.recommendations.push('Consider removing unused mock methods');
        }
    }

    // Calculate complexity score
    const totalMethods = Object.keys(mockObject).filter(key => 
        typeof mockObject[key] === 'function'
    ).length;
    
    const hasInternalProperties = Object.keys(mockObject).some(key => 
        key.startsWith('_') && key !== '_mockType' && key !== '_behavior' && key !== '_validMethods'
    );

    validation.complexityScore = (totalMethods / 20) + (hasInternalProperties ? 0.3 : 0);

    // Behavior-focused mode recommendations
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

// Helper functions for cleanup
const clearAllActiveMocks = () => {
    let clearedCount = 0;
    clearAllMocks();
    clearedCount++; // clearAllMocks counts as one operation
    return clearedCount;
};

const findUnusedMocks = () => {
    // This would need to be implemented with a global mock registry
    // For now, return empty array
    return [];
};

const collectMockUsageMetrics = () => {
    return {
        timestamp: testClock.now(),
        totalMocksActive: 0, // Would need global tracking
        memoryUsage: process.memoryUsage()
    };
};

const validateActiveMocks = () => {
    // Placeholder for mock validation logic
    return true;
};

module.exports = {
    // Setup functions
    initializeTestLogging,
    
    // Enhanced lifecycle management
    setupAutomatedCleanup,
    validateMockUsage,
    
    // Factory functions
    createTestUser,
    createTestGift,
    createTestNotification,
    createMockPlatformDependencies,
    createTestApp,
    createTestRetrySystem,
    
    // Fixture utilities
    loadPlatformFixture,
    
    // Assertion helpers
    expectValidNotificationData,
    expectValidUserData,
    
    // Enterprise assertion helpers
    expectValidNotification,
    expectNoTechnicalArtifacts,
    
    INTERNATIONAL_USERNAMES,
    
    // Constants
    TEST_TIMEOUTS,
    TEST_USERNAMES,
    TEST_COMMANDS
};
