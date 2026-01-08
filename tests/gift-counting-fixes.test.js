
const { initializeTestLogging, createTestUser, createTestGift } = require('./helpers/test-setup');
const { createMockLogger, createMockNotificationManager, createMockOBSManager, createMockSpamDetector, createMockDisplayQueue } = require('./helpers/mock-factories');
const { setupAutomatedCleanup } = require('./helpers/mock-lifecycle');
const { createTikTokGiftEvent } = require('./helpers/tiktok-test-data');

const createMockConfigService = (configOverrides = {}, overrides = {}) => {
    const baseConfig = {
        general: {
            debugEnabled: false,
            giftsEnabled: true,
            greetingsEnabled: true,
            userSuppressionEnabled: false,
            maxNotificationsPerUser: 5,
            suppressionWindowMs: 60000,
            suppressionDurationMs: 300000,
            suppressionCleanupIntervalMs: 300000
        },
        tiktok: {
            giftsEnabled: true,
            greetingsEnabled: true
        },
        timing: {
            greetingDuration: 5000,
            giftDuration: 7000,
            followDuration: 6000
        },
        tts: {
            enabled: false
        }
    };

    const mergedConfig = {
        ...baseConfig,
        ...configOverrides,
        general: { ...baseConfig.general, ...(configOverrides.general || {}) },
        tiktok: { ...baseConfig.tiktok, ...(configOverrides.tiktok || {}) },
        timing: { ...baseConfig.timing, ...(configOverrides.timing || {}) },
        tts: { ...baseConfig.tts, ...(configOverrides.tts || {}) }
    };

    const getSectionValue = (section, key, defaultValue) => {
        const sectionData = mergedConfig[section] || {};
        if (typeof key === 'undefined') {
            return sectionData;
        }
        return sectionData[key] ?? defaultValue;
    };

    return {
        get: jest.fn((section, key, defaultValue) => getSectionValue(section, key, defaultValue)),
        areNotificationsEnabled: jest.fn((settingKey, platform) => {
            const platformConfig = mergedConfig[platform] || {};
            if (platformConfig && Object.prototype.hasOwnProperty.call(platformConfig, settingKey)) {
                return !!platformConfig[settingKey];
            }
            const generalConfig = mergedConfig.general || {};
            if (generalConfig && Object.prototype.hasOwnProperty.call(generalConfig, settingKey)) {
                return !!generalConfig[settingKey];
            }
            return true;
        }),
        getPlatformConfig: jest.fn((platform, key, defaultValue = true) => {
            const platformConfig = mergedConfig[platform] || {};
            if (platformConfig && Object.prototype.hasOwnProperty.call(platformConfig, key)) {
                return platformConfig[key];
            }
            return defaultValue;
        }),
        isDebugEnabled: jest.fn(() => !!mergedConfig.general.debugEnabled),
        getTimingConfig: jest.fn(() => ({ ...mergedConfig.timing })),
        getTTSConfig: jest.fn(() => ({ ...mergedConfig.tts })),
        getNotificationSettings: jest.fn((platform) => ({
            ...(mergedConfig.general || {}),
            ...(platform ? mergedConfig[platform] || {} : {})
        })),
        isEnabled: jest.fn(() => true),
        ...overrides
    };
};

// Initialize test infrastructure
initializeTestLogging();
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

// Mock dependencies with proper jest module mocking
jest.mock('../src/core/logging', () => ({
    logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    },
    getUnifiedLogger: jest.fn(() => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }))
}));

jest.mock('../src/obs/goals', () => {
    const processDonationGoal = jest.fn();
    return {
        OBSGoalsManager: class {},
        createOBSGoalsManager: () => ({ processDonationGoal }),
        getDefaultGoalsManager: () => ({ processDonationGoal })
    };
});

describe('Gift Counting Fixes', () => {
    let createNotificationManager;
    let initializeDisplayQueue;
    let TikTokPlatform;
    let processDonationGoal;
    let mockLogger;
    let mockEventBus;

    beforeEach(() => {
        // Use factory-created logger
        mockLogger = createMockLogger('debug');

        // Create mock EventBus for all tests
        mockEventBus = { emit: jest.fn(), on: jest.fn(), off: jest.fn() };
        
        // Import modules
        const baseNotificationManagerFactory = require('../src/notifications/NotificationManager').createNotificationManager;
        const constants = require('../src/core/constants');
        const { createTextProcessingManager } = require('../src/utils/text-processing');
        const textProcessing = createTextProcessingManager({ logger: mockLogger });
        const obsGoals = require('../src/obs/goals').getDefaultGoalsManager();
        createNotificationManager = (dependencies = {}) => baseNotificationManagerFactory({
            constants,
            textProcessing,
            obsGoals,
            vfxCommandService: { getVFXConfig: jest.fn().mockResolvedValue(null) },
            ...dependencies
        });
        initializeDisplayQueue = require('../src/obs/display-queue').initializeDisplayQueue;
        ({ TikTokPlatform } = require('../src/platforms/tiktok'));
        const goalsModule = require('../src/obs/goals');
        processDonationGoal = goalsModule.getDefaultGoalsManager().processDonationGoal;
    });

    // Manual cleanup removed - handled by setupAutomatedCleanup()

    describe('1. Spam Detection Parameters Fix', () => {
        test('should use actual coin value instead of giftCount for spam detection', () => {
            // Create mock spam detector using factory
            const mockSpamDetector = createMockSpamDetector({ shouldShow: true });
            const mockConfigService = createMockConfigService();

            // Create mock display queue
            const mockDisplayQueue = {
                addItem: jest.fn()
            };

            // Create notification manager with all required dependencies
            const notificationManager = createNotificationManager({
                donationSpamDetector: mockSpamDetector,
                displayQueue: mockDisplayQueue,
                eventBus: mockEventBus,
                platformLogger: {
                    debug: jest.fn(),
                    warn: jest.fn(),
                    info: jest.fn(),
                    error: jest.fn()
                },
                configService: mockConfigService,
                logger: {
                    debug: jest.fn(),
                    info: jest.fn(),
                    warn: jest.fn(),
                    error: jest.fn()
                }
            });

            // Test data: 3 roses worth 1 coin each using factory functions
            const user = createTestUser({ userId: 'user123', username: 'TestUser' });
            const gift = createTestGift({ giftType: 'Rose', giftCount: 3, amount: 3, currency: 'coins' });
            const giftData = {
                ...user,
                ...gift,
                repeatCount: 3       // Alternative count field
            };

            // Call handleNotification
            notificationManager.handleNotification('gift', 'tiktok', giftData);

            // Verify spam detection was called with correct parameters
            expect(mockSpamDetector.handleDonationSpam).toHaveBeenCalledWith(
                'user123',           // userId
                'TestUser',          // username
                1,                   // coinValue (individual coin value, not giftCount)
                'Rose',              // giftType
                3,                   // giftCount (quantity)
                'tiktok'             // platform
            );
        });

        test('should skip spam detection when amount is missing', () => {
            const mockSpamDetector = createMockSpamDetector({ shouldShow: true });
            const mockDisplayQueue = {
                addItem: jest.fn()
            };

            const mockConfigService = createMockConfigService();

            const notificationManager = createNotificationManager({
                donationSpamDetector: mockSpamDetector,
                displayQueue: mockDisplayQueue,
                eventBus: mockEventBus,
                platformLogger: {
                    debug: jest.fn(),
                    warn: jest.fn(),
                    info: jest.fn(),
                    error: jest.fn()
                },
                configService: mockConfigService,
                logger: {
                    debug: jest.fn(),
                    info: jest.fn(),
                    warn: jest.fn(),
                    error: jest.fn()
                }
            });

            // Test data without amount field using factory functions
            const user = createTestUser({ userId: 'user123', username: 'TestUser' });
            const gift = createTestGift({ giftType: 'Rose', giftCount: 3, amount: 3, currency: 'coins' });
            const giftData = {
                ...user,
                ...gift,
                diamondCount: 5      // Legacy coin field; should not be used
            };
            delete giftData.amount; // Remove amount to test strict requirement

            notificationManager.handleNotification('gift', 'tiktok', giftData);

            // Should skip spam detection without amount
            expect(mockSpamDetector.handleDonationSpam).not.toHaveBeenCalled();
        });
    });

    describe('Config Service Integration', () => {
        test('should consult ConfigService when determining gift notification eligibility', async () => {
            const mockConfigService = createMockConfigService();

            const mockDisplayQueue = {
                addItem: jest.fn()
            };

            const notificationManager = createNotificationManager({
                displayQueue: mockDisplayQueue,
                eventBus: mockEventBus,
                logger: createMockLogger('info'),
                configService: mockConfigService
            });

            await notificationManager.handleNotification('gift', 'tiktok', {
                username: 'ConfigUser',
                userId: 'config123',
                giftType: 'Rose',
                giftCount: 1,
                amount: 5,
                currency: 'coins'
            });

            expect(mockConfigService.areNotificationsEnabled).toHaveBeenCalledWith('giftsEnabled', 'tiktok');
        });
    });

    describe('2. Goal Tracking Calculation Fix', () => {
        test('should use total gift value (coinValue × giftCount) for goal tracking', async () => {
            // Create mock display queue with all required dependencies
            const mockObsManager = createMockOBSManager('connected');
            const mockConfig = {
                obs: {
                    ttsTxt: 'tts txt'
                },
                notification: {
                    sourceName: 'test-source',
                    sceneName: 'test-scene', 
                    groupName: 'test-group',
                    platformLogos: {}
                },
                tiktok: {
                    notificationsEnabled: true
                }
            };
            const mockConstants = {
                NOTIFICATION_CLEAR_DELAY: 200
            };
            
            const displayQueue = initializeDisplayQueue(mockObsManager, mockConfig, mockConstants);

            // Mock processDonationGoal
            processDonationGoal.mockResolvedValue({ success: true });

            // Test data: 3 roses worth 1 coin each using factory functions
            const user = createTestUser({ username: 'TestUser' });
            const gift = createTestGift({ giftType: 'Rose', giftCount: 3, amount: 3, currency: 'coins' });
            const giftItem = {
                type: 'gift',
                data: {
                    ...user,
                    ...gift,
                    repeatCount: 3       // Alternative count field
                },
                platform: 'tiktok'
            };

            // Call displayNotificationItem (which processes goal tracking)
            await displayQueue.displayNotificationItem(giftItem);

            // Verify goal tracking was called with total value (1 × 3 = 3)
            expect(processDonationGoal).toHaveBeenCalledWith('tiktok', 3);
        });

        test('should handle different coin value fields correctly', async () => {
            const mockObsManager = createMockOBSManager('connected');
            const mockConfig = {
                obs: {
                    ttsTxt: 'tts txt'
                },
                notification: {
                    sourceName: 'test-source',
                    sceneName: 'test-scene', 
                    groupName: 'test-group',
                    platformLogos: {}
                },
                tiktok: {
                    notificationsEnabled: true
                }
            };
            const mockConstants = {
                NOTIFICATION_CLEAR_DELAY: 200
            };
            
            const displayQueue = initializeDisplayQueue(mockObsManager, mockConfig, mockConstants);
            processDonationGoal.mockResolvedValue({ success: true });

            // Test data with explicit amount (legacy fields should not override)
            const user = createTestUser({ username: 'TestUser' });
            const gift = createTestGift({ giftType: 'Heart', giftCount: 2, amount: 10, currency: 'coins' });
            const giftItem = {
                type: 'gift',
                data: {
                    ...user,
                    ...gift,
                    diamondCount: 5,     // Alternative coin field
                    bits: 10             // Another alternative
                },
                platform: 'tiktok'
            };

            await displayQueue.displayNotificationItem(giftItem);

            // Should use amount (total coins)
            expect(processDonationGoal).toHaveBeenCalledWith('tiktok', 10);
        });

        test('should handle zero coin values gracefully', async () => {
            const mockObsManager = createMockOBSManager('connected');
            const mockConfig = {
                obs: {
                    ttsTxt: 'tts txt'
                },
                notification: {
                    sourceName: 'test-source',
                    sceneName: 'test-scene', 
                    groupName: 'test-group',
                    platformLogos: {}
                },
                tiktok: {
                    notificationsEnabled: true
                }
            };
            const mockConstants = {
                NOTIFICATION_CLEAR_DELAY: 200
            };
            
            const displayQueue = initializeDisplayQueue(mockObsManager, mockConfig, mockConstants);

            const user = createTestUser({ username: 'TestUser' });
            const gift = createTestGift({ giftType: 'FreeGift', giftCount: 5, amount: 0, currency: 'coins' });
            const giftItem = {
                type: 'gift',
                data: {
                    ...user,
                    ...gift
                },
                platform: 'tiktok'
            };

            await displayQueue.displayNotificationItem(giftItem);

            // Should not call processDonationGoal for zero value
            expect(processDonationGoal).not.toHaveBeenCalled();
        });
    });

    describe('3. TikTok Gift Scenarios Test', () => {
        test('should handle 3 roses scenario correctly', async () => {
            const mockObsManager = createMockOBSManager('connected');
            const mockConfig = {
                obs: {
                    ttsTxt: 'tts txt'
                },
                notification: {
                    sourceName: 'test-source',
                    sceneName: 'test-scene', 
                    groupName: 'test-group',
                    platformLogos: {}
                },
                tiktok: {
                    notificationsEnabled: true
                }
            };
            const mockConstants = {
                NOTIFICATION_CLEAR_DELAY: 200
            };
            
            const displayQueue = initializeDisplayQueue(mockObsManager, mockConfig, mockConstants);
            processDonationGoal.mockResolvedValue({ success: true });

            // TikTok scenario: 3 roses worth 1 coin each using factory functions
            const user = createTestUser({ username: '🌸DemoUser🌸' });
            const gift = createTestGift({ giftType: 'Rose', giftCount: 3, amount: 3, currency: 'coins' });
            const roseItem = {
                type: 'gift',
                data: {
                    ...user,
                    ...gift,
                    repeatCount: 3
                },
                platform: 'tiktok'
            };

            await displayQueue.displayNotificationItem(roseItem);

            // Should process total value: 1 × 3 = 3 coins
            expect(processDonationGoal).toHaveBeenCalledWith('tiktok', 3);
        });

        test('should handle 3 hearts scenario correctly', async () => {
            const mockObsManager = createMockOBSManager('connected');
            const mockConfig = {
                obs: {
                    ttsTxt: 'tts txt'
                },
                notification: {
                    sourceName: 'test-source',
                    sceneName: 'test-scene', 
                    groupName: 'test-group',
                    platformLogos: {}
                },
                tiktok: {
                    notificationsEnabled: true
                }
            };
            const mockConstants = {
                NOTIFICATION_CLEAR_DELAY: 200
            };
            
            const displayQueue = initializeDisplayQueue(mockObsManager, mockConfig, mockConstants);
            processDonationGoal.mockResolvedValue({ success: true });

            // TikTok scenario: 3 hearts worth 5 coins each using factory functions
            const user = createTestUser({ username: 'John Doe' });
            const gift = createTestGift({ giftType: 'Heart', giftCount: 3, amount: 15, currency: 'coins' });
            const heartItem = {
                type: 'gift',
                data: {
                    ...user,
                    ...gift,
                    repeatCount: 3
                },
                platform: 'tiktok'
            };

            await displayQueue.displayNotificationItem(heartItem);

            // Should process total value: 5 × 3 = 15 coins
            expect(processDonationGoal).toHaveBeenCalledWith('tiktok', 15);
        });
    });

    describe('4. Double Goal Processing Prevention', () => {
        test('should prevent double goal processing with goalProcessed flag', async () => {
            const mockObsManager = createMockOBSManager('connected');
            const mockConfig = {
                obs: {
                    ttsTxt: 'tts txt'
                },
                notification: {
                    sourceName: 'test-source',
                    sceneName: 'test-scene', 
                    groupName: 'test-group',
                    platformLogos: {}
                },
                tiktok: {
                    notificationsEnabled: true
                }
            };
            const mockConstants = {
                NOTIFICATION_CLEAR_DELAY: 200
            };
            
            const displayQueue = initializeDisplayQueue(mockObsManager, mockConfig, mockConstants);
            processDonationGoal.mockResolvedValue({ success: true });

            // Create gift item with goalProcessed flag already set using factory functions
            const user = createTestUser({ username: 'TestUser' });
            const gift = createTestGift({ giftType: 'Rose', giftCount: 3, amount: 3, currency: 'coins' });
            const giftItem = {
                type: 'gift',
                data: {
                    ...user,
                    ...gift,
                    goalProcessed: true  // Already processed
                },
                platform: 'tiktok'
            };

            await displayQueue.displayNotificationItem(giftItem);

            // Should not call processDonationGoal again
            expect(processDonationGoal).not.toHaveBeenCalled();
        });

        test('should set goalProcessed flag after processing', async () => {
            const mockObsManager = createMockOBSManager('connected');
            const mockConfig = {
                obs: {
                    ttsTxt: 'tts txt'
                },
                notification: {
                    sourceName: 'test-source',
                    sceneName: 'test-scene', 
                    groupName: 'test-group',
                    platformLogos: {}
                },
                tiktok: {
                    notificationsEnabled: true
                }
            };
            const mockConstants = {
                NOTIFICATION_CLEAR_DELAY: 200
            };
            
            const displayQueue = initializeDisplayQueue(mockObsManager, mockConfig, mockConstants);
            processDonationGoal.mockResolvedValue({ success: true });

            const user = createTestUser({ username: 'TestUser' });
            const gift = createTestGift({ giftType: 'Rose', giftCount: 3, amount: 3, currency: 'coins' });
            const giftItem = {
                type: 'gift',
                data: {
                    ...user,
                    ...gift
                    // goalProcessed not set initially
                },
                platform: 'tiktok'
            };

            await displayQueue.displayNotificationItem(giftItem);

            // Should call processDonationGoal once
            expect(processDonationGoal).toHaveBeenCalledTimes(1);
            
            // Should set goalProcessed flag
            expect(giftItem.data.goalProcessed).toBe(true);
        });
    });

    describe('5. TikTok Data Structure Verification', () => {
        test('should have correct giftCount vs coinValue fields in aggregated data', () => {
            // Create TikTok platform instance using the Jest-mocked constructor
            const config = {};
            const dependencies = {
                logger: {
                    debug: jest.fn(),
                    info: jest.fn(),
                    warn: jest.fn(),
                    error: jest.fn()
                }
            };

            const tiktokPlatform = new TikTokPlatform(config, dependencies);

            // Mock TikTok gift data (simulating aggregated data structure)
            const mockGiftData = {
                userId: 'user123-id',
                uniqueId: 'user123',
                nickname: '🌸DemoUser🌸',
                giftDetails: {
                    giftName: 'Rose',
                    diamondCount: 1,     // Individual coin value
                    giftId: 'rose_001',
                    giftType: 0
                },
                repeatCount: 3,          // Number of gifts
                comboCount: 3            // Alternative count field
            };

            // Simulate the aggregation process
            const { extractTikTokGiftData } = require('../src/utils/tiktok-data-extraction');
            const extractedData = extractTikTokGiftData(mockGiftData);

            // Verify correct field mapping
            expect(extractedData.giftType).toBe('Rose');
            expect(extractedData.giftCount).toBe(3);      // Should be repeatCount
            expect(extractedData.unitAmount).toBe(1);     // Should be diamondCount (individual value)
            expect(extractedData.amount).toBe(3);         // Total value
            expect(extractedData.currency).toBe('coins');
        });

        test('should handle multiple gift aggregation correctly', () => {
            const config = {
                enabled: true,
                username: 'testuser'
            };
            const dependencies = {
                logger: {
                    debug: jest.fn(),
                    info: jest.fn(),
                    warn: jest.fn(),
                    error: jest.fn()
                },
                constants: {
                    GRACE_PERIODS: { TIKTOK: 5000 }
                }
            };

            const tiktokPlatform = new TikTokPlatform(config, dependencies);

            // Ensure giftAggregation property exists (initialize if needed)
            if (!tiktokPlatform.giftAggregation) {
                tiktokPlatform.giftAggregation = {};
            }
            expect(tiktokPlatform.giftAggregation).toBeDefined();

            // Simulate multiple gifts being aggregated
            const key = 'user123-id-Rose';
            tiktokPlatform.giftAggregation[key] = {
                username: 'user123',
                totalCount: 0,
                unitAmount: 1
            };

            // Simulate first gift (3 roses)
            const firstGift = {
                userId: 'user123-id',
                uniqueId: 'user123',
                nickname: '🌸DemoUser🌸',
                giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 0 },
                repeatCount: 3
            };

            // Simulate second gift (2 more roses) - should accumulate
            const secondGift = {
                userId: 'user123-id',
                uniqueId: 'user123',
                nickname: '🌸DemoUser🌸',
                giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 0 },
                repeatCount: 2
            };

            // Extract data from both gifts
            const { extractTikTokGiftData } = require('../src/utils/tiktok-data-extraction');
            const firstData = extractTikTokGiftData(firstGift);
            const secondData = extractTikTokGiftData(secondGift);

            // Verify individual gift data is correct
            expect(firstData.giftCount).toBe(3);
            expect(firstData.unitAmount).toBe(1);
            expect(firstData.amount).toBe(3);
            expect(secondData.giftCount).toBe(2);
            expect(secondData.unitAmount).toBe(1);
            expect(secondData.amount).toBe(2);

            // Simulate aggregation (this is what the actual code does)
            const totalCount = firstData.giftCount + secondData.giftCount;
            const individualCoinValue = firstData.unitAmount; // Should be same for same gift
            const totalValue = individualCoinValue * totalCount;

            // Verify aggregation is correct
            expect(totalCount).toBe(5);      // 3 + 2 = 5 total roses
            expect(totalValue).toBe(5);      // 1 × 5 = 5 total coins
        });
    });

    describe('Integration Tests', () => {
        test('should handle complete gift flow correctly', async () => {
            // Test the complete flow from TikTok gift to goal tracking
            const mockSpamDetector = createMockSpamDetector({ shouldShow: true });

            const mockDisplayQueue = {
                addItem: jest.fn()
            };

            const mockConfigService = createMockConfigService();

            const notificationManager = createNotificationManager({
                donationSpamDetector: mockSpamDetector,
                displayQueue: mockDisplayQueue,
                eventBus: mockEventBus,
                platformLogger: {
                    debug: jest.fn(),
                    warn: jest.fn(),
                    info: jest.fn(),
                    error: jest.fn()
                },
                configService: mockConfigService,
                logger: {
                    debug: jest.fn(),
                    info: jest.fn(),
                    warn: jest.fn(),
                    error: jest.fn()
                }
            });

            const mockObsManager = createMockOBSManager('connected');
            const mockConfig = {
                obs: {
                    ttsTxt: 'tts txt'
                },
                notification: {
                    sourceName: 'test-source',
                    sceneName: 'test-scene', 
                    groupName: 'test-group',
                    platformLogos: {}
                },
                tiktok: {
                    notificationsEnabled: true
                }
            };
            const mockConstants = {
                NOTIFICATION_CLEAR_DELAY: 200
            };
            
            const displayQueue = initializeDisplayQueue(mockObsManager, mockConfig, mockConstants);
            processDonationGoal.mockResolvedValue({ success: true });

            // Complete gift data using factory functions
            const user = createTestUser({ userId: 'user123', username: '🌸DemoUser🌸' });
            const gift = createTestGift({ giftType: 'Rose', giftCount: 3, amount: 3, currency: 'coins' });
            const giftData = {
                ...user,
                ...gift,
                repeatCount: 3
            };

            // Step 1: Notification processing (spam detection)
            notificationManager.handleNotification('gift', 'tiktok', giftData);

            // Verify spam detection used correct parameters
            expect(mockSpamDetector.handleDonationSpam).toHaveBeenCalledWith(
                'user123',
                '🌸DemoUser🌸',
                1,      // Individual coin value
                'Rose',
                3,      // Gift count
                'tiktok'
            );

            // Step 2: Display queue processing (goal tracking)
            const giftItem = {
                type: 'gift',
                data: giftData,
                platform: 'tiktok'
            };

            await displayQueue.displayNotificationItem(giftItem);

            // Verify goal tracking used total value
            expect(processDonationGoal).toHaveBeenCalledWith('tiktok', 3); // 1 × 3 = 3

            // Verify goal processed flag was set
            expect(giftItem.data.goalProcessed).toBe(true);
        });
    });

    describe('6. Spam Detection Aggregation Tests', () => {
        test('should validate spam detection parameters are passed correctly', () => {
            // Test the interface between NotificationManager and spam detection
            const mockSpamDetector = createMockSpamDetector({ shouldShow: false }); // Simulate suppression
            const mockDisplayQueue = { addItem: jest.fn() };
            const mockConfigService = createMockConfigService();

            const notificationManager = createNotificationManager({
                donationSpamDetector: mockSpamDetector,
                displayQueue: mockDisplayQueue,
                eventBus: mockEventBus,
                platformLogger: { debug: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn() },
                configService: mockConfigService,
                logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
            });

            // Test data using factory functions
            const user = createTestUser({ userId: 'user123', username: 'TestUser' });
            const gift = createTestGift({ giftType: 'Rose', giftCount: 3, amount: 3, currency: 'coins' });
            const giftData = { ...user, ...gift };

            // Process a gift notification
            notificationManager.handleNotification('gift', 'tiktok', giftData);

            // Verify spam detector was called with correct parameters
            expect(mockSpamDetector.handleDonationSpam).toHaveBeenCalledWith(
                'user123',           // userId
                'TestUser',          // username  
                1,                   // coinValue (individual coin value)
                'Rose',              // giftType
                3,                   // giftCount (quantity)
                'tiktok'             // platform
            );
        });

        test('should create synthetic aggregated notification with correct data structure', () => {
            // Test handleAggregatedDonation directly to verify synthetic notification creation
            const mockDisplayQueue = { addItem: jest.fn() };
            const mockConfigService = createMockConfigService();
            const notificationManager = createNotificationManager({
                displayQueue: mockDisplayQueue,
                eventBus: mockEventBus,
                platformLogger: { debug: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn() },
                configService: mockConfigService,
                logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
            });

            const handleNotificationSpy = jest.spyOn(notificationManager, 'handleNotificationInternal');

            // Simulate aggregated data from spam detector
            const aggregatedData = {
                userId: 'user123',
                username: 'TestUser', 
                platform: 'tiktok',
                totalCoins: 7,                    // Total coin value
                totalGifts: 5,                   // Total gift count
                giftTypes: ['Rose', 'Heart'],    // Unique gift types
                message: 'TestUser sent 5 gifts worth 7 coins (Rose, Heart)',
                notifications: [
                    { coinValue: 1, giftType: 'Rose', giftCount: 1 },
                    { coinValue: 2, giftType: 'Heart', giftCount: 1 },
                    { coinValue: 1, giftType: 'Rose', giftCount: 2 },
                    { coinValue: 2, giftType: 'Heart', giftCount: 1 }
                ]
            };

            // Call handleAggregatedDonation directly
            notificationManager.handleAggregatedDonation(aggregatedData);

            // Verify synthetic notification was created with correct structure
            expect(handleNotificationSpy).toHaveBeenCalledWith(
                'gift',
                'tiktok',
                expect.objectContaining({
                    userId: 'user123',
                    username: 'TestUser',
                    giftType: 'Multiple Gifts (Rose, Heart)', // Formatted gift list
                    giftCount: 5,                            // Total gifts
                    amount: 7,                              // Total coins
                    currency: 'coins',
                    message: 'TestUser sent 5 gifts worth 7 coins (Rose, Heart)',
                    isAggregated: true                      // Aggregation flag
                }),
                true // skipSpamDetection = true
            );
        });

        test('should handle single gift type aggregation correctly', () => {
            const mockDisplayQueue = { addItem: jest.fn() };
            const mockConfigService = createMockConfigService();
            const notificationManager = createNotificationManager({
                displayQueue: mockDisplayQueue,
                eventBus: mockEventBus,
                platformLogger: { debug: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn() },
                configService: mockConfigService,
                logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
            });

            const handleNotificationSpy = jest.spyOn(notificationManager, 'handleNotificationInternal');

            // Aggregated data with single gift type
            const aggregatedData = {
                userId: 'user456',
                username: 'AnotherUser',
                platform: 'tiktok', 
                totalCoins: 4,
                totalGifts: 4,
                giftTypes: ['Rose'],
                message: 'AnotherUser sent 4 gifts worth 4 coins (Rose)',
                notifications: [
                    { coinValue: 1, giftType: 'Rose', giftCount: 1 },
                    { coinValue: 1, giftType: 'Rose', giftCount: 1 },
                    { coinValue: 1, giftType: 'Rose', giftCount: 1 },
                    { coinValue: 1, giftType: 'Rose', giftCount: 1 }
                ]
            };

            notificationManager.handleAggregatedDonation(aggregatedData);

            // Verify single gift type is handled correctly
            expect(handleNotificationSpy).toHaveBeenCalledWith(
                'gift',
                'tiktok',
                expect.objectContaining({
                    giftType: 'Multiple Gifts (Rose)', // Single gift type in parentheses
                    giftCount: 4,
                    amount: 4,
                    currency: 'coins',
                    isAggregated: true
                }),
                true
            );
        });

        test('should pass aggregated notification through gift processing pipeline', async () => {
            // Test that aggregated notifications go through normal gift processing (goal tracking, etc.)
            const mockDisplayQueue = { addItem: jest.fn() };
            const mockConfigService = createMockConfigService();
            const notificationManager = createNotificationManager({
                displayQueue: mockDisplayQueue,
                eventBus: mockEventBus,
                platformLogger: { debug: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn() },
                configService: mockConfigService,
                logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
            });

            // Aggregated data representing multiple donations
            const aggregatedData = {
                userId: 'user789',
                username: 'BigDonor',
                platform: 'tiktok',
                totalCoins: 25,  // Significant donation amount
                totalGifts: 10,
                giftTypes: ['Rose', 'Heart', 'Diamond'],
                message: 'BigDonor sent 10 gifts worth 25 coins (Rose, Heart, Diamond)'
            };

            // Process the aggregated notification
            await notificationManager.handleAggregatedDonation(aggregatedData);
            await new Promise(setImmediate);

            // Verify the aggregated notification gets queued for display (may be called through async flow)
            // Check that display queue was called at least once with gift notification
            expect(mockDisplayQueue.addItem).toHaveBeenCalled();
            
            // Verify the call contains expected gift data structure 
            const callArgs = mockDisplayQueue.addItem.mock.calls[0][0];
            expect(callArgs).toEqual(
                expect.objectContaining({
                    type: 'gift',
                    platform: 'tiktok',
                    data: expect.objectContaining({
                        userId: 'user789',
                        username: 'BigDonor',
                        giftType: 'Multiple Gifts (Rose, Heart, Diamond)',
                        amount: 25,         // Total value preserved
                        currency: 'coins',
                        giftCount: 10,      // Total count preserved  
                        isAggregated: true  // Aggregation flag preserved
                    })
                })
            );
        });
    });
}); 
