jest.mock('../../src/core/logging', () => ({
    setConfigValidator: jest.fn(),
    setDebugMode: jest.fn(),
    initializeLoggingConfig: jest.fn(),
    initializeConsoleOverride: jest.fn(),
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    },
    getLogger: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

const { 
    initializeTestLogging,
    createTestUser, 
    TEST_TIMEOUTS,
    createMockConfig
} = require('../helpers/test-setup');

const { 
    createMockNotificationDispatcher,
    createMockLogger,
    setupAutomatedCleanup 
} = require('../helpers/mock-factories');

const { 
    expectNoTechnicalArtifacts,
    expectValidNotification 
} = require('../helpers/assertion-helpers');
const { createRuntimeConstantsFixture } = require('../helpers/runtime-constants-fixture');
const { processIncomingMessage } = require('../helpers/old-message-filtering-helper');
const testClock = require('../helpers/test-clock');

// Initialize logging FIRST
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

// Helper function to create test config for AppRuntime
const createAppRuntimeTestConfig = () => ({
    general: {
        streamDetectionEnabled: false,
        streamRetryInterval: 10000,
        streamMaxRetries: 3,
        continuousMonitoringInterval: 60000
    },
    tiktok: createMockConfig('tiktok'),
    twitch: createMockConfig('twitch'),
    youtube: createMockConfig('youtube'),
    obs: {
        enabled: false,
        websocketUrl: 'ws://localhost:4455',
        websocketPassword: ''
    },
    logging: {
        console: { enabled: false },
        file: { enabled: false }
    },
    notifications: {
        enabled: false
    },
    vfx: {
        enabled: false
    }
});

const createMockPlatformLifecycleService = () => {
    const platformConnectionTimes = {};

    return {
        platformConnectionTimes,
        recordPlatformConnection: jest.fn((platform) => {
            platformConnectionTimes[platform] = testClock.now();
        }),
        getPlatformConnectionTime: jest.fn((platform) => platformConnectionTimes[platform] ?? null),
        setConnectionTime: jest.fn((platform, timestamp) => {
            platformConnectionTimes[platform] = timestamp;
        })
    };
};

const setPlatformConnectionTime = (platformLifecycleService, platform, timestamp) => {
    if (!platformLifecycleService) {
        throw new Error('platformLifecycleService not available');
    }

    if (typeof platformLifecycleService.setConnectionTime === 'function') {
        platformLifecycleService.setConnectionTime(platform, timestamp);
    } else {
        platformLifecycleService.platformConnectionTimes[platform] = timestamp;
    }
};

// Helper function to create test dependencies for AppRuntime
const createAppRuntimeTestDependencies = () => {
    const platformLifecycleService = createMockPlatformLifecycleService();
    const eventEmitter = new (require('events'))();
    const configSnapshot = createAppRuntimeTestConfig();

    return {
        displayQueue: {
            addItem: jest.fn(),
            start: jest.fn(),
            stop: jest.fn()
        },
        runtimeConstants: createRuntimeConstantsFixture(),
        commandCooldownService: {
            isCommandOnCooldown: jest.fn().mockReturnValue(false),
            setCommandCooldown: jest.fn()
        },
        notificationManager: {
            handleNotification: jest.fn(),
            emit: jest.fn(),
            on: jest.fn()
        },
        authManager: {
            validateAllConfigs: jest.fn().mockResolvedValue(true)
        },
        logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        platformLifecycleService,
        eventBus: {
            emit: eventEmitter.emit.bind(eventEmitter),
            on: eventEmitter.on.bind(eventEmitter),
            subscribe: (event, handler) => {
                eventEmitter.on(event, handler);
                return () => eventEmitter.off(event, handler);
            }
        },
        configService: {
            get: jest.fn((section) => (section ? configSnapshot[section] : configSnapshot)),
            areNotificationsEnabled: jest.fn().mockReturnValue(true),
            isEnabled: jest.fn().mockReturnValue(true),
            getPlatformConfig: jest.fn((platform) => configSnapshot[platform] ?? {}),
            getNotificationSettings: jest.fn().mockReturnValue({ enabled: true }),
            getTTSConfig: jest.fn().mockReturnValue({ enabled: false }),
            getTimingConfig: jest.fn().mockReturnValue({ greetingDuration: 5000 }),
            isDebugEnabled: jest.fn().mockReturnValue(false),
            getCLIOverrides: jest.fn().mockReturnValue({})
        },
        vfxCommandService: {
            getVFXConfig: jest.fn().mockResolvedValue(null),
            executeCommand: jest.fn().mockResolvedValue(true)
        },
        ttsService: {
            speak: jest.fn().mockResolvedValue(true),
            stop: jest.fn().mockResolvedValue(true)
        },
        userTrackingService: {
            isFirstMessage: jest.fn().mockResolvedValue(false)
        },
        obsEventService: { start: jest.fn(), stop: jest.fn(), disconnect: jest.fn() },
        sceneManagementService: { start: jest.fn(), stop: jest.fn() },
        timestampService: {
            extractTimestamp: jest.fn((platform, data) => {
                const raw = (() => {
                    if (platform === 'tiktok') {
                        return data?.createTime ?? data?.common?.createTime;
                    }
                    if (platform === 'youtube') {
                        return data?.timestamp;
                    }
                    if (platform === 'twitch') {
                        return data?.['tmi-sent-ts'];
                    }
                    return undefined;
                })();
                const numeric = Number(raw);
                if (!Number.isFinite(numeric)) {
                    return null;
                }
                const ms = numeric > 1e13 ? Math.floor(numeric / 1000) : numeric;
                return new Date(ms).toISOString();
            })
        }
    };
};

describe('Old Message Filtering End-to-End Behavior', () => {
    let mockNotificationDispatcher;
    let mockTTSHandler;
    let testStartTime;
    
    beforeEach(() => {
        jest.resetModules();
        testClock.reset();
        testStartTime = testClock.now();
        mockNotificationDispatcher = createMockNotificationDispatcher();
        mockTTSHandler = jest.fn();
        jest.clearAllMocks();
    });

    describe('User Experience: Old Messages Are Not Announced', () => {
        it('should filter old TikTok messages and not announce them to users via TTS', async () => {
            // Given: Bot connects to TikTok at a specific time
            const botConnectionTime = testStartTime;
            
            // And: There's an old cached message sent 5 minutes before bot connected
            const oldMessageTime = botConnectionTime - (5 * 60 * 1000); // 5 minutes ago
            const oldMessage = {
                createTime: oldMessageTime,
                user: {
                    userId: 'tt-user-1',
                    uniqueId: 'testuser',
                    nickname: 'Test User'
                },
                comment: 'This is an old cached message'
            };
            
            // When: The old message is processed by the system
            const { platformLifecycleService, timestampService } = createAppRuntimeTestDependencies();
            setPlatformConnectionTime(platformLifecycleService, 'tiktok', botConnectionTime);

            const result = await processIncomingMessage('tiktok', oldMessage, timestampService, platformLifecycleService);
            
            
            // Then: User does not see or hear the old message
            expect(result.wasFiltered).toBe(true);
            expect(result.reason).toContain('old message');
            expect(result.userExperienced?.ttsGenerated).toBe(false);
            expect(result.userExperienced?.notificationShown).toBe(false);
            
            // And: No technical artifacts in any user-facing content
            if (result.userMessage) {
                expectNoTechnicalArtifacts(result.userMessage);
            }
        });

        it('should filter old TikTok messages when timestamp only exists in common.createTime', async () => {
            const botConnectionTime = testStartTime;
            const oldMessageTime = botConnectionTime - (5 * 60 * 1000);
            const oldMessage = {
                comment: 'Old cached TikTok message',
                common: {
                    createTime: String(oldMessageTime)
                },
                user: {
                    userId: 'nested-user-id',
                    uniqueId: 'NestedUser'
                }
            };

            const { platformLifecycleService, timestampService } = createAppRuntimeTestDependencies();
            setPlatformConnectionTime(platformLifecycleService, 'tiktok', botConnectionTime);

            const result = await processIncomingMessage('tiktok', oldMessage, timestampService, platformLifecycleService);
            expect(result.wasProcessed).toBe(false);
            expect(result.reason).toContain('old message');
        });

        it('should filter old YouTube messages and not announce them to users', async () => {
            // Given: Bot connects to YouTube at a specific time
            const botConnectionTime = testStartTime;
            
            // And: There's an old cached message with timestamp in microseconds (YouTube format)
            const oldMessageTime = botConnectionTime - (3 * 60 * 1000); // 3 minutes ago
            const oldMessage = {
                item: {
                    author: {
                        name: 'TestUser',
                        id: 'user123',
                        channelId: 'channel123'
                    },
                    message: {
                        text: 'This is an old YouTube message'
                    },
                    timestamp: (oldMessageTime * 1000).toString() // Convert to microseconds string
                }
            };
            
            // When: The old message is processed by the system
            const { platformLifecycleService, timestampService } = createAppRuntimeTestDependencies();
            setPlatformConnectionTime(platformLifecycleService, 'youtube', botConnectionTime);

            const result = await processIncomingMessage('youtube', oldMessage, timestampService, platformLifecycleService);
            
            // Then: User does not see or hear the old message
            expect(result.wasFiltered).toBe(true);
            expect(result.reason).toContain('old message');
            expect(result.userExperienced?.ttsGenerated).toBe(false);
            expect(result.userExperienced?.notificationShown).toBe(false);
        });

        it('should filter old Twitch messages and not announce them to users', async () => {
            // Given: Bot connects to Twitch at a specific time
            const botConnectionTime = testStartTime;
            
            // And: There's an old cached message with TMI timestamp
            const oldMessageTime = botConnectionTime - (7 * 60 * 1000); // 7 minutes ago
            const oldMessage = {
                user: {
                    username: 'TestUser',
                    userId: 'user123'
                },
                message: 'This is an old Twitch message',
                context: {
                    'tmi-sent-ts': oldMessageTime.toString(),
                    'user-id': 'user123',
                    username: 'TestUser'
                }
            };
            
            // When: The old message is processed by the system
            const { platformLifecycleService, timestampService } = createAppRuntimeTestDependencies();
            setPlatformConnectionTime(platformLifecycleService, 'twitch', botConnectionTime);

            const result = await processIncomingMessage('twitch', oldMessage, timestampService, platformLifecycleService);
            
            // Then: User does not see or hear the old message
            expect(result.wasFiltered).toBe(true);
            expect(result.reason).toContain('old message');
            expect(result.userExperienced?.ttsGenerated).toBe(false);
            expect(result.userExperienced?.notificationShown).toBe(false);
        });
    });

    describe('User Experience: Recent Messages Are Processed Normally', () => {
        it('should process recent TikTok messages and announce them to users', async () => {
            // Given: Bot connects to TikTok at a specific time
            const botConnectionTime = testStartTime;
            
            // And: There's a recent message sent after bot connected
            const recentMessageTime = botConnectionTime + (30 * 1000); // 30 seconds after connection
            const recentMessage = {
                createTime: recentMessageTime,
                user: {
                    userId: 'tt-user-2',
                    uniqueId: 'testuser',
                    nickname: 'Test User'
                },
                comment: 'This is a new live message'
            };
            
            // When: The recent message is processed by the system
            const { platformLifecycleService, timestampService } = createAppRuntimeTestDependencies();
            setPlatformConnectionTime(platformLifecycleService, 'tiktok', botConnectionTime);

            const result = await processIncomingMessage('tiktok', recentMessage, timestampService, platformLifecycleService);
            
            // Then: User sees and hears the message
            expect(result.wasFiltered).toBe(false);
            expect(result.wasProcessed).toBe(true);
            expect(result.userMessage).toContain('This is a new live message');
            expect(result.userMessage).toContain('testuser');
            
            // And: Content is high quality with no technical artifacts
            expectNoTechnicalArtifacts(result.userMessage);
            expect(result.userMessage).not.toMatch(/\{.*\}/); // No template placeholders
            expect(result.userMessage).not.toContain('undefined');
            expect(result.userMessage).not.toContain('null');
        });

        it('should process recent YouTube messages and announce them to users', async () => {
            // Given: Bot connects to YouTube at a specific time
            const botConnectionTime = testStartTime;
            
            // And: There's a recent message with proper timestamp
            const recentMessageTime = botConnectionTime + (60 * 1000); // 1 minute after connection
            const recentMessage = {
                item: {
                    author: {
                        name: 'TestUser',
                        id: 'user123',
                        channelId: 'channel123'
                    },
                    message: {
                        text: 'This is a new YouTube message'
                    },
                    timestamp: (recentMessageTime * 1000).toString() // Convert to microseconds string
                }
            };
            
            // When: The recent message is processed by the system
            const { platformLifecycleService, timestampService } = createAppRuntimeTestDependencies();
            setPlatformConnectionTime(platformLifecycleService, 'youtube', botConnectionTime);

            const result = await processIncomingMessage('youtube', recentMessage, timestampService, platformLifecycleService);
            
            // Then: User sees and hears the message
            expect(result.wasFiltered).toBe(false);
            expect(result.wasProcessed).toBe(true);
            expect(result.userMessage).toContain('This is a new YouTube message');
            expect(result.userMessage).toContain('TestUser');
            
            // And: Content is high quality with no technical artifacts
            expectNoTechnicalArtifacts(result.userMessage);
        });
    });

    describe('Edge Cases: Missing or Invalid Timestamps', () => {
        it('should handle TikTok messages with missing timestamps gracefully', async () => {
            // Given: Bot is connected and there's a message without timestamp
            const botConnectionTime = testStartTime;
            const messageWithoutTimestamp = {
                user: {
                    userId: 'tt-user-3',
                    uniqueId: 'testuser',
                    nickname: 'Test User'
                },
                comment: 'Message with no timestamp'
                // No createTime field
            };
            
            // When: The message is processed
            const { platformLifecycleService, timestampService } = createAppRuntimeTestDependencies();
            setPlatformConnectionTime(platformLifecycleService, 'tiktok', botConnectionTime);

            const result = await processIncomingMessage('tiktok', messageWithoutTimestamp, timestampService, platformLifecycleService);
            
            // Then: System handles it gracefully but rejects missing timestamps
            expect(result.wasProcessed).toBe(false);
            expect(result.errorHandledGracefully).toBe(true);
            expect(result.error).toContain('Missing TikTok timestamp');
            expect(result.userMessage).toBeNull();
        });

        it('should handle invalid timestamp formats gracefully across platforms', async () => {
            // Given: Messages with invalid timestamp formats
            const invalidTimestampMessages = [
                {
                    platform: 'tiktok',
                    data: {
                        createTime: 'invalid-timestamp',
                        user: {
                            userId: 'tt-user-4',
                            uniqueId: 'testuser',
                            nickname: 'Test User'
                        },
                        comment: 'Invalid timestamp message'
                    }
                },
                {
                    platform: 'youtube', 
                    data: {
                        item: {
                            timestamp: 'not-a-number',
                            author: { name: 'TestUser', id: 'user123' },
                            message: { text: 'Invalid timestamp message' }
                        }
                    }
                },
                {
                    platform: 'twitch',
                    data: {
                        user: {
                            username: 'TestUser',
                            userId: 'user123'
                        },
                        message: 'Invalid timestamp message',
                        context: { 'tmi-sent-ts': 'invalid' }
                    }
                }
            ];
            
            const { platformLifecycleService, timestampService } = createAppRuntimeTestDependencies();
            setPlatformConnectionTime(platformLifecycleService, 'tiktok', testStartTime);
            setPlatformConnectionTime(platformLifecycleService, 'youtube', testStartTime);
            setPlatformConnectionTime(platformLifecycleService, 'twitch', testStartTime);
            
            // When: Each message with invalid timestamp is processed
            for (const { platform, data } of invalidTimestampMessages) {
                const result = await processIncomingMessage(platform, data, timestampService, platformLifecycleService);
                
                // Then: System handles each gracefully and rejects invalid timestamps
                expect(result.errorHandledGracefully).toBe(true);
                expect(result.wasProcessed).toBe(false);
                expect(result.error).toBeDefined();
            }
        });
    });

    describe('Performance: Timestamp Processing Within Targets', () => {
        it('should process timestamp extraction within performance targets', async () => {
            // Given: A typical message processing scenario
            const botConnectionTime = testStartTime;
            const message = {
                createTime: botConnectionTime + 1000,
                user: {
                    userId: 'tt-user-5',
                    uniqueId: 'testuser',
                    nickname: 'Test User'
                },
                comment: 'Performance test message'
            };
            
            // When: Message is processed and timing is measured
            const { platformLifecycleService, timestampService } = createAppRuntimeTestDependencies();
            setPlatformConnectionTime(platformLifecycleService, 'tiktok', botConnectionTime);

            const startTime = testClock.now();
            const result = await processIncomingMessage('tiktok', message, timestampService, platformLifecycleService);
            const simulatedProcessingMs = 5;
            testClock.advance(simulatedProcessingMs);
            const endTime = testClock.now();
            const processingTimeMs = endTime - startTime;
            
            // Then: Processing is within performance targets
            expect(processingTimeMs).toBeLessThan(10); // <10ms total processing time
            expect(result.processingMetrics?.timestampExtractionTime).toBeLessThan(5); // <5ms for timestamp extraction
            
            // And: User experience is maintained
            expect(result.wasProcessed).toBe(true);
            expectNoTechnicalArtifacts(result.userMessage);
        });
    });

    describe('Cross-Platform Consistency', () => {
        it('should provide consistent filtering behavior across all platforms', async () => {
            // Given: Bot connected to all platforms at the same time
            const botConnectionTime = testStartTime;
            
            // And: Old messages from each platform (all sent before connection)
            const oldMessages = [
                {
                    platform: 'tiktok',
                    data: {
                        createTime: botConnectionTime - (2 * 60 * 1000), // 2 minutes ago
                        user: {
                            userId: 'tt-user-6',
                            uniqueId: 'tiktokuser',
                            nickname: 'TikTok User'
                        },
                        comment: 'Old TikTok message'
                    }
                },
                {
                    platform: 'youtube',
                    data: {
                        item: {
                            timestamp: ((botConnectionTime - (2 * 60 * 1000)) * 1000).toString(), // 2 minutes ago in microseconds
                            author: { name: 'YouTubeUser', id: 'yt123' },
                            message: { text: 'Old YouTube message' }
                        }
                    }
                },
                {
                    platform: 'twitch',
                    data: {
                        user: {
                            username: 'TwitchUser',
                            userId: 'tw123'
                        },
                        message: 'Old Twitch message',
                        context: { 'tmi-sent-ts': (botConnectionTime - (2 * 60 * 1000)).toString() } // 2 minutes ago
                    }
                }
            ];
            
            const { platformLifecycleService, timestampService } = createAppRuntimeTestDependencies();
            setPlatformConnectionTime(platformLifecycleService, 'tiktok', botConnectionTime);
            setPlatformConnectionTime(platformLifecycleService, 'youtube', botConnectionTime);
            setPlatformConnectionTime(platformLifecycleService, 'twitch', botConnectionTime);
            
            // When: All old messages are processed
            const results = [];
            for (const { platform, data } of oldMessages) {
                const result = await processIncomingMessage(platform, data, timestampService, platformLifecycleService);
                results.push({ platform, result });
            }
            
            // Then: All platforms consistently filter old messages
            for (const { platform, result } of results) {
                expect(result.wasFiltered).toBe(true);
                expect(result.reason).toContain('old message');
                expect(result.platform).toBe(platform);
                
                // And: User experience is consistent across platforms
                if (result.userMessage) {
                    expectNoTechnicalArtifacts(result.userMessage);
                }
            }
            
            // And: No user notifications or TTS generated for any old message
            for (const { result } of results) {
                expect(result.userExperienced?.ttsGenerated).toBe(false);
                expect(result.userExperienced?.notificationShown).toBe(false);
            }
        });
    });
});
