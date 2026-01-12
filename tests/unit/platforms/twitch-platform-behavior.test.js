
jest.unmock('../../../src/platforms/twitch');

jest.resetModules();
const { TwitchPlatform } = jest.requireActual('../../../src/platforms/twitch');

describe('TwitchPlatform behavior standards', () => {
    const baseConfig = {
        enabled: true,
        username: 'streamer',
        channel: 'streamer',
        eventsub_enabled: true,
        dataLoggingEnabled: false
    };

    const buildPlatform = () => new TwitchPlatform(baseConfig, {
        authManager: {
            getState: jest.fn().mockReturnValue('READY'),
            getAccessToken: jest.fn().mockResolvedValue('mock-token'),
            initialize: jest.fn().mockResolvedValue()
        },
        logger: {
            info: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn()
        },
        timestampService: {
            extractTimestamp: jest.fn(() => new Date().toISOString())
        },
        TwitchEventSub: jest.fn().mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(),
            connect: jest.fn().mockResolvedValue(),
            disconnect: jest.fn().mockResolvedValue(),
            on: jest.fn(),
            isConnected: jest.fn().mockReturnValue(true)
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
            if (payload.type === 'platform:stream-status') connectedEvents.push(payload.data);
        });

        platform._handleEventSubConnectionChange(true, { reason: 'connected-test' });

        expect(connectedEvents).toHaveLength(1);
        expect(connectedEvents[0]).toMatchObject({
            platform: 'twitch',
            isLive: true
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
        const paypiggyHandler = jest.fn();
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
