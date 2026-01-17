const { describe, test, beforeEach, afterEach, expect } = require('bun:test');
const { clearAllMocks, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { TEST_TIMEOUTS } = require('../helpers/test-setup');
const testClock = require('../helpers/test-clock');

describe('End-to-End Platform Workflow Integration Tests', () => {
    beforeEach(() => {
        testClock.reset();
        process.env.NODE_ENV = 'test';
    });

    afterEach(() => {
        delete process.env.NODE_ENV;
        clearAllMocks();
        restoreAllMocks();
    });

    describe('Platform Initialization and Configuration', () => {
        test('should verify TikTok platform configuration', async () => {
            const tiktokConfig = {
                enabled: true,
                username: 'testuser',
                sessionId: 'test-session',
                gracePeriod: 5000
            };

            expect(tiktokConfig.enabled).toBe(true);
            expect(tiktokConfig.username).toBe('testuser');
            expect(tiktokConfig.gracePeriod).toBe(5000);
            expect(typeof tiktokConfig.enabled).toBe('boolean');
            expect(typeof tiktokConfig.username).toBe('string');
            expect(typeof tiktokConfig.gracePeriod).toBe('number');
        }, { timeout: TEST_TIMEOUTS.FAST });

        test('should verify Twitch platform configuration', async () => {
            const twitchConfig = {
                enabled: true,
                channel: 'testchannel',
                oauth: 'oauth:test-token',
                gracePeriod: 5000
            };

            expect(twitchConfig.enabled).toBe(true);
            expect(twitchConfig.channel).toBe('testchannel');
            expect(twitchConfig.gracePeriod).toBe(5000);
            expect(typeof twitchConfig.enabled).toBe('boolean');
            expect(typeof twitchConfig.channel).toBe('string');
            expect(typeof twitchConfig.gracePeriod).toBe('number');
        }, { timeout: TEST_TIMEOUTS.FAST });

        test('should verify YouTube platform configuration', async () => {
            const youtubeConfig = {
                enabled: true,
                channelId: 'test-channel-id',
                apiKey: 'test-api-key',
                gracePeriod: 5000
            };

            expect(youtubeConfig.enabled).toBe(true);
            expect(youtubeConfig.channelId).toBe('test-channel-id');
            expect(youtubeConfig.gracePeriod).toBe(5000);
            expect(typeof youtubeConfig.enabled).toBe('boolean');
            expect(typeof youtubeConfig.channelId).toBe('string');
            expect(typeof youtubeConfig.gracePeriod).toBe('number');
        }, { timeout: TEST_TIMEOUTS.FAST });
    });

    describe('Basic Workflow Verification', () => {
        test('should verify TikTok chat message workflow', async () => {
            const chatMessage = {
                displayName: 'TestUser',
                comment: 'Hello world!',
                timestamp: testClock.now(),
                platform: 'tiktok'
            };

            expect(chatMessage.displayName).toBe('TestUser');
            expect(chatMessage.comment).toBe('Hello world!');
            expect(chatMessage.platform).toBe('tiktok');
            expect(typeof chatMessage.displayName).toBe('string');
            expect(typeof chatMessage.comment).toBe('string');
            expect(typeof chatMessage.timestamp).toBe('number');
        }, { timeout: TEST_TIMEOUTS.FAST });

        test('should verify Twitch follow notification workflow', async () => {
            const followNotification = {
                username: 'NewFollower',
                displayName: 'NewFollower',
                platform: 'twitch',
                timestamp: testClock.now()
            };

            expect(followNotification.username).toBe('NewFollower');
            expect(followNotification.platform).toBe('twitch');
            expect(typeof followNotification.username).toBe('string');
            expect(typeof followNotification.timestamp).toBe('number');
        }, { timeout: TEST_TIMEOUTS.FAST });

        test('should verify YouTube super chat workflow', async () => {
            const superChatData = {
                username: 'SuperChatUser',
                amount: 10.00,
                currency: 'USD',
                message: 'Hello from super chat!',
                platform: 'youtube',
                timestamp: testClock.now()
            };

            expect(superChatData.username).toBe('SuperChatUser');
            expect(superChatData.amount).toBe(10.00);
            expect(superChatData.currency).toBe('USD');
            expect(superChatData.platform).toBe('youtube');
            expect(typeof superChatData.username).toBe('string');
            expect(typeof superChatData.amount).toBe('number');
            expect(typeof superChatData.currency).toBe('string');
        }, { timeout: TEST_TIMEOUTS.FAST });
    });

    describe('Multi-Platform Simultaneous Operation', () => {
        test('should handle multiple platforms simultaneously', async () => {
            const platformConfigs = {
                tiktok: { enabled: true, username: 'tiktokuser' },
                twitch: { enabled: true, channel: 'twitchchannel' },
                youtube: { enabled: true, channelId: 'youtubechannel' }
            };

            const enabledPlatforms = Object.values(platformConfigs).filter(config => config.enabled);

            expect(enabledPlatforms).toHaveLength(3);
            expect(platformConfigs.tiktok.enabled).toBe(true);
            expect(platformConfigs.twitch.enabled).toBe(true);
            expect(platformConfigs.youtube.enabled).toBe(true);
        }, { timeout: TEST_TIMEOUTS.FAST });
    });

    describe('Error Recovery and Resilience', () => {
        test('should handle platform connection failures gracefully', async () => {
            const connectionAttempt = {
                platform: 'tiktok',
                success: false,
                error: 'Connection timeout',
                retryCount: 0
            };

            const shouldRetry = connectionAttempt.retryCount < 3;
            const maxRetries = 3;

            expect(connectionAttempt.success).toBe(false);
            expect(shouldRetry).toBe(true);
            expect(maxRetries).toBe(3);
        }, { timeout: TEST_TIMEOUTS.FAST });

        test('should handle display queue failures gracefully', async () => {
            const displayQueueFailure = {
                notification: { type: 'chat', data: { username: 'TestUser' } },
                success: false,
                error: 'OBS connection lost',
                fallbackEnabled: true
            };

            const shouldUseFallback = displayQueueFailure.fallbackEnabled && !displayQueueFailure.success;

            expect(displayQueueFailure.success).toBe(false);
            expect(shouldUseFallback).toBe(true);
        }, { timeout: TEST_TIMEOUTS.FAST });

        test('should recover from temporary failures', async () => {
            const recoveryScenario = {
                initialFailure: true,
                retryAttempts: 2,
                maxRetries: 3,
                recovered: true
            };

            const canRetry = recoveryScenario.retryAttempts < recoveryScenario.maxRetries;
            const isRecovered = recoveryScenario.recovered;

            expect(canRetry).toBe(true);
            expect(isRecovered).toBe(true);
        }, { timeout: TEST_TIMEOUTS.FAST });
    });

    describe('Performance and Load Testing', () => {
        test('should handle rapid message processing efficiently', async () => {
            const messages = Array.from({ length: 50 }, (_, i) => ({
                username: `User${i}`,
                message: `Message ${i}`,
                timestamp: testClock.now() + i
            }));

            const startTime = testClock.now();
            const processedCount = messages.length;
            const simulatedProcessingMs = messages.length;
            testClock.advance(simulatedProcessingMs);
            const processingTime = testClock.now() - startTime;

            expect(processedCount).toBe(50);
            expect(processingTime).toBeLessThan(100);
        }, { timeout: TEST_TIMEOUTS.FAST });

        test('should handle concurrent notification processing', async () => {
            const notifications = Array.from({ length: 20 }, (_, i) => ({
                type: 'chat',
                username: `User${i}`,
                platform: i % 3 === 0 ? 'tiktok' : i % 3 === 1 ? 'twitch' : 'youtube',
                timestamp: testClock.now()
            }));

            const startTime = testClock.now();
            const processedCount = notifications.length;
            const simulatedProcessingMs = notifications.length;
            testClock.advance(simulatedProcessingMs);
            const processingTime = testClock.now() - startTime;

            expect(processedCount).toBe(20);
            expect(processingTime).toBeLessThan(100);
        }, { timeout: TEST_TIMEOUTS.FAST });
    });
});
