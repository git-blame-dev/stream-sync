
const { describe, it, expect, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks, spyOn } = require('../../helpers/bun-mock-utils');
const { unmockModule, requireActual, restoreAllModuleMocks, resetModules } = require('../../helpers/bun-module-mocks');

unmockModule('../../../src/platforms/twitch-eventsub');

const TwitchEventSub = requireActual('../../../src/platforms/twitch-eventsub');

describe('TwitchEventSub notification routing', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
        resetModules();
    });

    it('routes chat notifications to handleNotificationEvent', async () => {
        const logger = { info: createMockFn(), debug: createMockFn(), warn: createMockFn(), error: createMockFn() };
        const eventSub = new TwitchEventSub(
            { clientId: 'cid', accessToken: 'token', channel: 'streamer', username: 'streamer' },
            { authManager: { getState: () => 'READY', getUserId: () => '1', authState: { executeWhenReady: async fn => fn() }, getAccessToken: async () => 'token' }, logger }
        );
        spyOn(eventSub, 'handleNotificationEvent');

        const payload = {
            metadata: { message_type: 'notification', message_id: 'mid' },
            payload: {
                subscription: { type: 'channel.chat.message' },
                event: { message: { text: 'hello' } }
            }
        };

        await eventSub.handleWebSocketMessage(payload);

        const [eventType, eventPayload] = eventSub.handleNotificationEvent.mock.calls[0];
        expect(eventType).toBe('channel.chat.message');
        expect(eventPayload).toBe(payload.payload.event);
    });

    it('routes follow notifications to handleNotificationEvent', async () => {
        const logger = { info: createMockFn(), debug: createMockFn(), warn: createMockFn(), error: createMockFn() };
        const eventSub = new TwitchEventSub(
            { clientId: 'cid', accessToken: 'token', channel: 'streamer', username: 'streamer' },
            { authManager: { getState: () => 'READY', getUserId: () => '1', authState: { executeWhenReady: async fn => fn() }, getAccessToken: async () => 'token' }, logger }
        );
        spyOn(eventSub, 'handleNotificationEvent');

        const payload = {
            metadata: { message_type: 'notification', message_id: 'mid' },
            payload: {
                subscription: { type: 'channel.follow' },
                event: { user_name: 'follower' }
            }
        };

        await eventSub.handleWebSocketMessage(payload);

        const [eventType, eventPayload] = eventSub.handleNotificationEvent.mock.calls[0];
        expect(eventType).toBe('channel.follow');
        expect(eventPayload).toBe(payload.payload.event);
    });

    it('emits subscription events with canonical months for renewal handling', () => {
        const logger = { info: createMockFn(), debug: createMockFn(), warn: createMockFn(), error: createMockFn() };
        const eventSub = new TwitchEventSub(
            { clientId: 'cid', accessToken: 'token', channel: 'streamer', username: 'streamer', dataLoggingEnabled: false },
            { authManager: { getState: () => 'READY', getUserId: () => '1', authState: { executeWhenReady: async fn => fn() }, getAccessToken: async () => 'token' }, logger }
        );

        eventSub.emit = createMockFn();

        const subscriptionEvent = {
            user_name: 'LongTenure',
            user_id: '123',
            tier: '1000',
            cumulative_months: 7,
            is_gift: false,
            timestamp: '2024-01-01T00:00:00Z'
        };

        eventSub._handlePaypiggyEvent(subscriptionEvent);

        const [eventType, payload] = eventSub.emit.mock.calls[0];
        expect(eventType).toBe('paypiggy');
        expect(payload).toMatchObject({
            username: 'LongTenure',
            months: 7,
            timestamp: subscriptionEvent.timestamp
        });
    });

    it('emits resubscription messages with canonical months for renewal handling', () => {
        const logger = { info: createMockFn(), debug: createMockFn(), warn: createMockFn(), error: createMockFn() };
        const eventSub = new TwitchEventSub(
            { clientId: 'cid', accessToken: 'token', channel: 'streamer', username: 'streamer', dataLoggingEnabled: false },
            { authManager: { getState: () => 'READY', getUserId: () => '1', authState: { executeWhenReady: async fn => fn() }, getAccessToken: async () => 'token' }, logger }
        );

        eventSub.emit = createMockFn();

        const resubEvent = {
            user_name: 'Resubber',
            user_id: '456',
            tier: '1000',
            cumulative_months: 9,
            message: { text: 'Great stream!' },
            timestamp: '2024-01-01T00:00:00Z'
        };

        eventSub._handlePaypiggyMessageEvent(resubEvent);

        const [eventType, payload] = eventSub.emit.mock.calls[0];
        expect(eventType).toBe('paypiggyMessage');
        expect(payload).toMatchObject({
            username: 'Resubber',
            months: 9,
            message: 'Great stream!',
            timestamp: resubEvent.timestamp
        });
    });

    it('routes raid events through handleNotificationEvent', async () => {
        const logger = { info: createMockFn(), debug: createMockFn(), warn: createMockFn(), error: createMockFn() };
        const eventSub = new TwitchEventSub(
            { clientId: 'cid', accessToken: 'token', channel: 'streamer', username: 'streamer' },
            { authManager: { getState: () => 'READY', getUserId: () => '1', authState: { executeWhenReady: async fn => fn() }, getAccessToken: async () => 'token' }, logger }
        );
        spyOn(eventSub, 'handleNotificationEvent');

        const payload = {
            metadata: { message_type: 'notification', message_id: 'mid' },
            payload: {
                subscription: { type: 'channel.raid' },
                event: { from_broadcaster_user_name: 'Raider', viewers: 5 }
            }
        };

        await eventSub.handleWebSocketMessage(payload);

        const [eventType, eventPayload] = eventSub.handleNotificationEvent.mock.calls[0];
        expect(eventType).toBe('channel.raid');
        expect(eventPayload).toBe(payload.payload.event);
    });
});
