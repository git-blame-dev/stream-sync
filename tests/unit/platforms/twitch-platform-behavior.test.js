
const { describe, it, expect, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { unmockModule, resetModules, requireActual, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

unmockModule('../../../src/platforms/twitch');

resetModules();
const { TwitchPlatform } = requireActual('../../../src/platforms/twitch');

describe('TwitchPlatform behavior standards', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
        resetModules();
    });

    const baseConfig = {
        enabled: true,
        username: 'streamer',
        channel: 'streamer',
        eventsub_enabled: true,
        dataLoggingEnabled: false
    };

    const buildPlatform = () => new TwitchPlatform(baseConfig, {
        authManager: {
            getState: createMockFn().mockReturnValue('READY'),
            getAccessToken: createMockFn().mockResolvedValue('mock-token'),
            initialize: createMockFn().mockResolvedValue()
        },
        logger: {
            info: createMockFn(),
            error: createMockFn(),
            warn: createMockFn(),
            debug: createMockFn()
        },
        timestampService: {
            extractTimestamp: createMockFn(() => new Date().toISOString())
        },
        TwitchEventSub: createMockFn().mockImplementation(() => ({
            initialize: createMockFn().mockResolvedValue(),
            connect: createMockFn().mockResolvedValue(),
            disconnect: createMockFn().mockResolvedValue(),
            on: createMockFn(),
            isConnected: createMockFn().mockReturnValue(true)
        }))
    });

    it('emits chat events using the standardized schema', async () => {
        const platform = buildPlatform();
        const emitted = [];
        platform.on('platform:event', (payload) => {
            if (payload.type === 'platform:chat-message') emitted.push(payload.data);
        });

        const context = {
            'user-id': '12345',
            username: 'viewer1',
            'display-name': 'Viewer 1',
            mod: false,
            subscriber: true
        };

        await platform.onMessageHandler('#streamer', context, '  hello  ', false);

        expect(emitted).toHaveLength(1);
        const payload = emitted[0];
        expect(payload.userId).toBe('12345');
        expect(payload.username).toBe('viewer1');
        expect(payload.message.text).toBe('hello');
        expect(payload.platform).toBe('twitch');
        expect(payload.timestamp).toEqual(expect.any(String));
    });

    it('emits connection lifecycle events for EventSub changes', () => {
        const platform = buildPlatform();
        const connectedEvents = [];
        platform.on('platform:event', (payload) => {
            if (payload.type === 'platform:connection') connectedEvents.push(payload.data);
        });

        platform._handleEventSubConnectionChange(true, { reason: 'connected-test' });

        expect(connectedEvents).toHaveLength(1);
        expect(connectedEvents[0]).toMatchObject({
            platform: 'twitch',
            status: 'connected'
        });
    });

    it('maps resubscription data to months and isRenewal in subscription events', () => {
        const platform = buildPlatform();
        const resubData = {
            tier: '1000',
            months: 5,
            userId: 'user123',
            username: 'resubber',
            displayName: 'Resub User',
            timestamp: '2024-01-01T00:00:00Z'
        };

        const event = platform.eventFactory.createPaypiggyMessageEvent(resubData);

        expect(event.type).toBe('platform:paypiggy');
        expect(event.months).toBe(5);
        expect(event.isRenewal).toBe(true);
    });

    it('uses provided months for resubscription messages', () => {
        const platform = buildPlatform();
        const resubData = {
            tier: '1000',
            months: 7,
            userId: 'user789',
            username: 'longtenure',
            displayName: 'Long Tenure Sub',
            timestamp: '2024-01-01T00:00:00Z'
        };

        const event = platform.eventFactory.createPaypiggyMessageEvent(resubData);

        expect(event.type).toBe('platform:paypiggy');
        expect(event.months).toBe(7);
        expect(event.isRenewal).toBe(true);
    });

    it('routes paypiggy events through the canonical handler and rejects subscription aliases', () => {
        const platform = buildPlatform();
        const paypiggyHandler = createMockFn();
        const logger = platform.logger;

        platform.handlers = {
            onPaypiggy: paypiggyHandler
        };

        const payload = { type: 'platform:paypiggy', platform: 'twitch', username: 'supporter' };

        platform._emitPlatformEvent('platform:paypiggy', payload);
        platform._emitPlatformEvent('subscription', payload);

        expect(paypiggyHandler).toHaveBeenCalledTimes(1);
        const [handledPayload] = paypiggyHandler.mock.calls[0];
        expect(handledPayload).toBe(payload);
        expect(logger.debug).toHaveBeenCalledWith(
            'No handler for twitch event type: subscription',
            'twitch',
            { payloadType: undefined }
        );
    });
});
