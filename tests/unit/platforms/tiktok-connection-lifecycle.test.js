const { describe, test, expect, afterEach } = require('bun:test');
const { restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { createMockTikTokPlatformDependencies, noOpLogger } = require('../../helpers/mock-factories');
const { TikTokPlatform } = require('../../../src/platforms/tiktok');

describe('TikTokPlatform connection lifecycle', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const createPlatform = (configOverrides = {}, dependencyOverrides = {}) => {
        const config = { enabled: true, username: 'testuser', ...configOverrides };
        const dependencies = createMockTikTokPlatformDependencies();
        dependencies.logger = noOpLogger;

        // Track emitted platform events
        const emittedEvents = [];
        const originalEmit = TikTokPlatform.prototype.emit;

        return {
            platform: new TikTokPlatform(config, { ...dependencies, ...dependencyOverrides }),
            emittedEvents,
            captureEvents: (platform) => {
                platform.emit = function (event, data) {
                    emittedEvents.push({ event, data });
                    return originalEmit.call(this, event, data);
                };
            }
        };
    };

    describe('_handleError stream status emission', () => {
        test('_handleError with gift processing context should NOT emit stream-status isLive:false', async () => {
            const { platform, emittedEvents, captureEvents } = createPlatform();
            captureEvents(platform);

            // Simulate a gift processing error (non-connection error)
            await platform._handleError(new Error('Gift validation failed'), {
                operation: 'handleGift',
                recoverable: true
            });

            // Find stream-status events
            const streamStatusEvents = emittedEvents.filter(
                (e) => e.event === 'platform:event' && e.data?.type === 'platform:stream-status'
            );

            // Should NOT emit isLive:false for gift processing errors
            const falseLiveEvents = streamStatusEvents.filter((e) => e.data?.data?.isLive === false);
            expect(falseLiveEvents.length).toBe(0);
        });

        test('_handleError with follow processing context should NOT emit stream-status isLive:false', async () => {
            const { platform, emittedEvents, captureEvents } = createPlatform();
            captureEvents(platform);

            await platform._handleError(new Error('Follow processing failed'), {
                operation: 'handleFollow',
                recoverable: true
            });

            const streamStatusEvents = emittedEvents.filter(
                (e) => e.event === 'platform:event' && e.data?.type === 'platform:stream-status'
            );

            const falseLiveEvents = streamStatusEvents.filter((e) => e.data?.data?.isLive === false);
            expect(falseLiveEvents.length).toBe(0);
        });

        test('_handleError with connection context SHOULD emit stream-status isLive:false', async () => {
            const { platform, emittedEvents, captureEvents } = createPlatform();
            captureEvents(platform);

            // Connection error should emit isLive:false
            await platform._handleError(new Error('Connection lost'), {
                operation: 'handleConnection',
                recoverable: false
            });

            const streamStatusEvents = emittedEvents.filter(
                (e) => e.event === 'platform:event' && e.data?.type === 'platform:stream-status'
            );

            const falseLiveEvents = streamStatusEvents.filter((e) => e.data?.data?.isLive === false);
            expect(falseLiveEvents.length).toBe(1);
        });
    });

    describe('handleConnectionIssue willReconnect flag', () => {
        test('handleConnectionIssue with enabled config should emit willReconnect:true', async () => {
            const { platform, emittedEvents, captureEvents } = createPlatform({ enabled: true });
            captureEvents(platform);

            // Setup connection state
            platform.connectionActive = true;
            platform.isPlannedDisconnection = false;

            await platform.handleConnectionIssue({ message: 'Connection dropped' }, false);

            // Find disconnection events
            const disconnectionEvents = emittedEvents.filter(
                (e) =>
                    e.event === 'platform:event' &&
                    (e.data?.type === 'platform:chat-disconnected' || e.data?.type === 'platform:stream-status')
            );

            // At least one event should have willReconnect: true
            const willReconnectTrue = disconnectionEvents.some(
                (e) => e.data?.data?.willReconnect === true
            );
            expect(willReconnectTrue).toBe(true);
        });

        test('handleConnectionIssue with disabled config should emit willReconnect:false', async () => {
            const { platform, emittedEvents, captureEvents } = createPlatform({ enabled: false });
            captureEvents(platform);

            platform.connectionActive = true;
            platform.isPlannedDisconnection = false;

            await platform.handleConnectionIssue({ message: 'Connection dropped' }, false);

            const disconnectionEvents = emittedEvents.filter(
                (e) =>
                    e.event === 'platform:event' &&
                    (e.data?.type === 'platform:chat-disconnected' || e.data?.type === 'platform:stream-status')
            );

            // All events should have willReconnect: false since config.enabled is false
            const willReconnectFalse = disconnectionEvents.every(
                (e) => e.data?.data?.willReconnect === false
            );
            expect(willReconnectFalse).toBe(true);
        });
    });

    describe('disconnection deduplication', () => {
        test('concurrent disconnection handlers only emit events once', async () => {
            const { platform, emittedEvents, captureEvents } = createPlatform({ enabled: true });
            captureEvents(platform);

            // Simulate both being called concurrently (as happens when 4404 triggers both events)
            // Don't await individually - fire both and then wait for both to complete
            const p1 = platform.handleConnectionIssue({ code: 4404, message: 'Stream not live' }, false);
            const p2 = platform._handleStreamEnd();
            await Promise.all([p1, p2]);

            // Find disconnection events
            const disconnectionEvents = emittedEvents.filter(
                (e) =>
                    e.event === 'platform:event' &&
                    (e.data?.type === 'platform:chat-disconnected' || e.data?.type === 'platform:stream-status')
            );

            // Should only have events from ONE handler (deduplication prevents second)
            // Each handler emits 2 events (chat-disconnected + stream-status)
            // So we expect exactly 2, not 4
            expect(disconnectionEvents.length).toBe(2);
        });
    });
});
