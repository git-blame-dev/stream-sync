import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { createMockFn } from './bun-mock-utils';
import { MockLifecycleManager } from './mock-lifecycle';
import {
    initializeTestLogging,
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
} from './test-setup';
import testClock from './test-clock';

describe('test-setup helper behavior', () => {
    beforeEach(() => {
        testClock.reset();
    });

    afterEach(() => {
        testClock.useRealTime();
    });

    it('initializes logging and creates deterministic test users', () => {
        expect(() => initializeTestLogging()).not.toThrow();
        expect(() => initializeTestLogging({ youtube: { enabled: false } })).not.toThrow();

        const defaultUser = createTestUser();
        expect(defaultUser.username).toBe('TestUser');
        expect(defaultUser.userId).toBe('test-user-id');
        expect(defaultUser.isMod).toBe(false);

        const overriddenUser = createTestUser({ username: 'test-alt-user', isSubscriber: true });
        expect(overriddenUser.username).toBe('test-alt-user');
        expect(overriddenUser.isSubscriber).toBe(true);
    });

    it('validates createTestGift required fields and generated messages', () => {
        expect(() => createTestGift({})).toThrow('giftType is required');
        expect(() => createTestGift({ giftType: 'Rose' })).toThrow('giftCount is required');
        expect(() => createTestGift({ giftType: 'Rose', giftCount: 2 })).toThrow('amount is required');
        expect(() => createTestGift({ giftType: 'Rose', giftCount: 2, amount: 10 })).toThrow('currency is required');

        const gift = createTestGift({ giftType: 'Rose', giftCount: 2, amount: 10, currency: 'coins' });
        expect(gift.displayMessage).toBe('2x Rose');
        expect(gift.ttsMessage).toBe('2 Rose');
        expect(gift.amount).toBe(10);
    });

    it('creates notifications with deterministic identity and supports overrides', () => {
        const first = createTestNotification('platform:gift');
        const second = createTestNotification('platform:gift');

        expect(first.type).toBe('platform:gift');
        expect(first.platform).toBe('tiktok');
        expect(first.id).not.toBe(second.id);
        expect(first.processedAt).toBeLessThan(second.processedAt);
        expect(first.timestamp).toContain('T');

        const overridden = createTestNotification('platform:follow', {
            username: 'test-user',
            platform: 'youtube'
        });
        expect(overridden.username).toBe('test-user');
        expect(overridden.platform).toBe('youtube');
    });

    it('builds platform dependencies for tiktok, twitch, youtube, and default', async () => {
        const tiktokDeps = createMockPlatformDependencies('tiktok');
        const tiktokClient = tiktokDeps.TikTokWebSocketClient();
        await expect(tiktokClient.connect()).resolves.toBe(true);
        await expect(tiktokClient.disconnect()).resolves.toBe(true);

        const twitchDeps = createMockPlatformDependencies('twitch');
        expect(typeof twitchDeps.TwitchEventSub).toBe('function');
        expect(typeof twitchDeps.RefreshingAuthProvider).toBe('function');

        const youtubeDeps = createMockPlatformDependencies('youtube');
        const youtubeApi = await youtubeDeps.Innertube.create();
        const videoInfo = await youtubeApi.getInfo();
        const liveChat = await videoInfo.getLiveChat();
        expect(typeof liveChat.start).toBe('function');
        expect(typeof liveChat.sendMessage).toBe('function');

        const genericDeps = createMockPlatformDependencies('unknown', { sentinel: true });
        expect(genericDeps.sentinel).toBe(true);
    });

    it('creates app/retry-system helpers and executes retry callbacks', async () => {
        const app = createTestApp();
        app.handleGiftNotification('payload');
        expect(app.handleGiftNotification.mock.calls[0]).toEqual(['payload']);

        const retrySystem = createTestRetrySystem();
        const value = await retrySystem.executeWithRetry('youtube', async () => 'done');
        expect(value).toBe('done');
        expect(retrySystem.getRetryCount()).toBe(0);

        const customRetrySystem = createTestRetrySystem({ incrementRetryCount: createMockFn().mockReturnValue(9000) });
        expect(customRetrySystem.incrementRetryCount()).toBe(9000);
    });

    it('validates notification and user assertion helper behavior', () => {
        const notificationData = {
            id: 'n-1',
            type: 'platform:gift',
            username: 'TestUser',
            platform: 'tiktok',
            displayMessage: 'hello',
            ttsMessage: 'hello',
            processedAt: 1700000000000
        };
        expect(() => expectValidNotificationData(notificationData)).not.toThrow();
        expect(() => expectValidNotificationData({})).toThrow();

        expect(() => expectValidUserData({ username: 'TestUser' })).not.toThrow();
        expect(() => expectValidUserData({ username: '' })).toThrow();

        const fullNotification = {
            id: 'n-2',
            type: 'platform:gift',
            platform: 'tiktok',
            username: 'TestUser',
            displayMessage: 'TestUser platform:gift',
            ttsMessage: 'TestUser platform:gift',
            processedAt: new Number(1700000000000),
            timestamp: new Date(1700000000000).toISOString()
        };
        expect(() => expectValidNotification(fullNotification, 'platform:gift', 'tiktok')).not.toThrow();
        expect(() => expectValidNotification({ ...fullNotification, type: 'platform:follow' }, 'platform:gift', 'tiktok')).toThrow();
    });

    it('rejects technical artifacts in user-facing content', () => {
        expect(() => expectNoTechnicalArtifacts('Thanks test-user for 10 coins')).not.toThrow();
        expect(() => expectNoTechnicalArtifacts('undefined')).toThrow();
        expect(() => expectNoTechnicalArtifacts('TypeError: bad call')).toThrow();
        expect(() => expectNoTechnicalArtifacts('$10.999')).toThrow();
        expect(() => expectNoTechnicalArtifacts('   ')).toThrow();
    });

    it('exposes constants and fixture loader contracts', () => {
        expect(TEST_TIMEOUTS.FAST).toBe(1000);
        expect(TEST_TIMEOUTS.PERFORMANCE).toBe(15000);
        expect(TEST_USERNAMES.SIMPLE).toBe('TestUser');
        expect(TEST_COMMANDS.SIMPLE).toBe('!hello');
        expect(INTERNATIONAL_USERNAMES.chinese).toBeTruthy();

        const fixture = loadPlatformFixture('tiktok', 'gift-event');
        expect(fixture).toBeTruthy();
        expect(typeof fixture).toBe('object');
    });

    it('cleans real registered mocks without touching a retired mock replaced under the same key', () => {
        const manager = new MockLifecycleManager();
        const retired = { action: createMockFn() };
        const replacement = { action: createMockFn() };
        const independent = { action: createMockFn() };
        manager.registerMock('synthetic-owner', retired, { autoValidate: false });
        manager.registerMock('synthetic-owner', replacement, { autoValidate: false });
        retired.action();
        replacement.action();
        independent.action();
        manager.cleanup();
        expect(replacement.action.mock.calls).toHaveLength(0);
        expect(retired.action.mock.calls).toHaveLength(1);
        expect(independent.action.mock.calls).toHaveLength(1);
        expect(manager.getPerformanceMetrics().activeMocks).toBe(1);
        expect(manager.getPerformanceMetrics().totalCleanupOperations).toBe(1);
    });

    it('propagates a real registered mock cleanup failure', () => {
        const manager = new MockLifecycleManager();
        const target = {};
        Object.defineProperty(target, 'broken', {
            enumerable: true,
            get() { throw new Error('synthetic cleanup failure'); }
        });
        manager.registerMock('synthetic-broken', target, { autoValidate: false });
        expect(() => manager.cleanup()).toThrow('synthetic cleanup failure');
    });

    it('validates mock usage outcomes across validation options', () => {
        const invalid = validateMockUsage(null);
        expect(invalid.isValid).toBe(false);
        expect(invalid.recommendations[0]).toContain('not valid');

        const richMock = {
            _mockType: 'factory-mock',
            _behavior: { mode: 'test' },
            _internalMarker: true,
            usedMethod: createMockFn(),
            unusedMethod: createMockFn()
        };
        richMock.usedMethod('called');

        const fullValidation = validateMockUsage(richMock, {
            validateMockTypes: true,
            expectedMockType: 'factory-mock',
            behaviorFocusedMode: true,
            maxMethodsRecommended: 1
        });

        expect(fullValidation.isFactoryMock).toBe(true);
        expect(fullValidation.mockTypeValid).toBe(true);
        expect(fullValidation.behaviorConfigured).toBe(true);
        expect(fullValidation.unusedMethods).toContain('unusedMethod');
        expect(fullValidation.recommendations).toContain('Consider removing unused mock methods');
        expect(fullValidation.recommendations).toContain('Mock has too many methods');
        expect(fullValidation.recommendations).toContain('Consider using behavior-focused factory');
        expect(fullValidation.recommendations).toContain('Mock exposes internal implementation details');
        expect(fullValidation.complexityScore).toBeGreaterThan(0);

        const mismatchedType = validateMockUsage(
            { _mockType: 'wrong-type', method: createMockFn() },
            { validateMockTypes: true, expectedMockType: 'expected-type' }
        );
        expect(mismatchedType.mockTypeValid).toBe(false);

        const noUnusedCheck = validateMockUsage(
            { method: createMockFn() },
            { detectUnusedMocks: false }
        );
        expect(noUnusedCheck.unusedMethods).toEqual([]);
    });
});
