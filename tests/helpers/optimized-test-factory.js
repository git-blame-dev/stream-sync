
const NotificationBuilder = require('../../src/utils/notification-builder');
const { createMockFn } = require('./bun-mock-utils');

const BASE_TIMESTAMP_MS = Date.parse('2024-01-01T00:00:00.000Z');
let sequence = 0;
const nextSequence = () => {
    sequence += 1;
    return sequence;
};
const nextTimestamp = () => BASE_TIMESTAMP_MS + (nextSequence() * 1000);
const buildTestId = (prefix) => `${prefix}-${nextSequence().toString(36).padStart(6, '0')}`;

class OptimizedTestFactory {
    static createTestData(type, platform, overrides = {}) {
        if (!type || typeof type !== 'string' || !type.trim()) {
            throw new Error('OptimizedTestFactory.createTestData requires a type');
        }

        if (!platform || typeof platform !== 'string' || !platform.trim()) {
            throw new Error('OptimizedTestFactory.createTestData requires a platform');
        }

        const baseData = {
            username: 'TestUser',
            message: 'Test message',
            timestamp: nextTimestamp(),
            platform,
            type
        };

        const typeDefaults = {
            'platform:gift': {},
            'platform:follow': {
                followCount: 1
            },
            'platform:paypiggy': {
                tier: '1000',
                months: 1
            }
        };

        const payload = {
            ...baseData,
            ...(typeDefaults[type] || {}),
            ...overrides
        };

        if (type === 'platform:gift') {
            const requiredFields = ['giftType', 'giftCount', 'amount', 'currency'];
            requiredFields.forEach((field) => {
                if (payload[field] === undefined) {
                    throw new Error(`OptimizedTestFactory.createTestData requires ${field} for gift events`);
                }
            });
        }

        return payload;
    }

    static createConfigFixture(platformOverrides = {}) {
        return {
            general: {
                obsWebSocketUrl: 'ws://localhost:4455',
                obsWebSocketPassword: 'test-password',
                enableNotifications: true,
                enableTTS: false,
                enableVFX: true,
                debugEnabled: false,
                messagesEnabled: true,
                farewellsEnabled: true,
                followsEnabled: true,
                giftsEnabled: true,
                paypiggiesEnabled: true,
                raidsEnabled: true,
                greetingsEnabled: true,
                userSuppressionEnabled: false,
                maxNotificationsPerUser: 5,
                suppressionWindowMs: 60000,
                suppressionDurationMs: 300000,
                suppressionCleanupIntervalMs: 300000,
                streamDetectionEnabled: false,
                streamRetryInterval: 15,
                streamMaxRetries: 3,
                continuousMonitoringInterval: 60
            },
            obs: {
                notificationTxt: 'obs-notification-text',
                notificationScene: 'obs-notification-scene',
                notificationMsgGroup: 'obs-notification-group'
            },
            gifts: {
                enableGiftDisplay: true,
                enableGiftTTS: false,
                minGiftAmount: 1
            },
            monitoring: {},
            spam: {
                enableSpamDetection: true,
                maxDuplicateMessages: 3,
                timeWindowMinutes: 5
            },
            twitch: {
                enabled: false,
                ...platformOverrides.twitch
            },
            youtube: {
                enabled: false,
                ...platformOverrides.youtube
            },
            tiktok: {
                enabled: false,
                ...platformOverrides.tiktok
            }
        };
    }

    static createBusinessLogicMocks() {
        return {
            logger: {
                info: createMockFn(),
                error: createMockFn(),
                warn: createMockFn(),
                debug: createMockFn()
            },
            notificationBuilder: {
                build: createMockFn().mockImplementation((payload) => NotificationBuilder.build(payload))
            },
            config: this.createConfigFixture()
        };
    }

    static createPlatformEvent(platform, eventType, data = {}) {
        if (!platform || typeof platform !== 'string' || !platform.trim()) {
            throw new Error('OptimizedTestFactory.createPlatformEvent requires a platform');
        }

        if (!eventType || typeof eventType !== 'string' || !eventType.trim()) {
            throw new Error('OptimizedTestFactory.createPlatformEvent requires an eventType');
        }

        const baseEvent = {
            platform,
            type: eventType,
            timestamp: nextTimestamp(),
            id: buildTestId(`test-${platform}-${eventType}`),
            userId: 'test-user-id'
        };

        const platformDefaults = {
            youtube: {
                videoId: 'test-video-id',
                channelId: 'test-channel-id'
            },
            twitch: {
                channelName: 'test-channel',
                userId: 'test-user-id'
            },
            tiktok: {
                roomId: 'test-room-id',
                userId: 'test-user-id'
            }
        };

        const eventData = {
            ...baseEvent,
            ...(platformDefaults[platform] || {}),
            ...data
        };
        if (eventType === 'gift') {
            const requiredFields = ['giftType', 'giftCount', 'amount', 'currency'];
            requiredFields.forEach((field) => {
                if (eventData[field] === undefined) {
                    throw new Error(`OptimizedTestFactory.createPlatformEvent requires ${field} for gift events`);
                }
            });
        }
        return eventData;
    }

    static createServiceMocks() {
        return {
            notificationDispatcher: {
                dispatchSuperChat: createMockFn().mockResolvedValue(true),
                dispatchMembership: createMockFn().mockResolvedValue(true),
                dispatchGiftMembership: createMockFn().mockResolvedValue(true),
                dispatchSuperSticker: createMockFn().mockResolvedValue(true)
            },
            viewerService: {
                getViewerCount: createMockFn().mockResolvedValue(1500),
                setActiveStream: createMockFn().mockResolvedValue(),
                clearActiveStream: createMockFn()
            }
        };
    }

    static createNotificationWorkflowHarness(overrides = {}) {
        const harness = {};

        harness.displayQueue = overrides.displayQueue || {
            addToQueue: createMockFn().mockResolvedValue(true),
            addItem: createMockFn().mockResolvedValue(true),
            processQueue: createMockFn().mockResolvedValue(true),
            clear: createMockFn(),
            size: createMockFn().mockReturnValue(0)
        };

        harness.configService = overrides.configService || this.createConfigFixture();

        harness.notificationBridge = overrides.notificationBridge || null;

        return harness;
    }

    static validateNotificationFormat(notification, expectedType, expectedPlatform) {
        expect(notification).toBeDefined();
        expect(notification.success).toBe(true);
        expect(notification.notificationData).toBeDefined();
        expect(notification.notificationData.platform).toBe(expectedPlatform);
        expect(notification.notificationData.displayMessage).toBeDefined();
        expect(notification.notificationData.displayMessage).not.toMatch(/\{.*\}/);
    }

    static validateDataProcessing(input, output, expectedTransformations) {
        expect(output).toBeDefined();
        
        for (const [key, expectedValue] of Object.entries(expectedTransformations)) {
            if (typeof expectedValue === 'function') {
                expect(expectedValue(output[key])).toBe(true);
            } else {
                expect(output[key]).toBe(expectedValue);
            }
        }
    }
}

module.exports = OptimizedTestFactory;
