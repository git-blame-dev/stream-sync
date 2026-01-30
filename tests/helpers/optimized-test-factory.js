const NotificationBuilder = require('../../src/utils/notification-builder');
const { createMockFn } = require('./bun-mock-utils');
const { createConfigFixture } = require('./config-fixture');

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
            config: createConfigFixture()
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

        harness.config = overrides.config || createConfigFixture();

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
