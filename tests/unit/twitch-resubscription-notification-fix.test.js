const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { EventEmitter } = require('events');

const TwitchEventSub = require('../../src/platforms/twitch-eventsub');
const { noOpLogger } = require('../helpers/mock-factories');

describe('TwitchEventSub Resubscription Notification Fix', () => {
    let eventSub;

    beforeEach(() => {
        const mockAuthManager = {
            getState: () => 'READY',
            getUserId: () => 'testUser123',
            authState: { executeWhenReady: async (fn) => fn() },
            getAccessToken: async () => 'testAccessToken'
        };

        class MockWebSocket extends EventEmitter {
            constructor() { super(); this.readyState = 1; }
            send() {}
            close() {}
        }

        eventSub = new TwitchEventSub(
            {
                clientId: 'testClientId',
                accessToken: 'testToken',
                channel: 'testStreamer',
                username: 'testStreamer',
                dataLoggingEnabled: false
            },
            {
                logger: noOpLogger,
                authManager: mockAuthManager,
                WebSocketCtor: MockWebSocket,
                ChatFileLoggingService: class {}
            }
        );
    });

    afterEach(() => {
        eventSub?.removeAllListeners();
    });

    describe('when resubscription message received', () => {
        test('emits paypiggyMessage with months and tier', (done) => {
            const resubEvent = {
                user_id: 'testUserId123',
                user_name: 'testResubUser',
                tier: '1000',
                cumulative_months: 3,
                timestamp: '2024-01-01T00:00:00Z',
                message: { text: '', emotes: null }
            };

            eventSub.on('paypiggyMessage', (payload) => {
                expect(payload.type).toBe('paypiggy');
                expect(payload.username).toBe('testResubUser');
                expect(payload.userId).toBe('testUserId123');
                expect(payload.tier).toBe('1000');
                expect(payload.months).toBe(3);
                expect(payload.timestamp).toBe(resubEvent.timestamp);
                done();
            });

            eventSub._handlePaypiggyMessageEvent(resubEvent);
        });

        test('emits paypiggyMessage with message text and premium tier', (done) => {
            const resubEvent = {
                user_id: 'testPremiumUser456',
                user_name: 'testPremiumSub',
                tier: '2000',
                cumulative_months: 12,
                timestamp: '2024-01-01T00:00:00Z',
                message: { text: 'Love the streams!', emotes: null }
            };

            eventSub.on('paypiggyMessage', (payload) => {
                expect(payload.type).toBe('paypiggy');
                expect(payload.username).toBe('testPremiumSub');
                expect(payload.tier).toBe('2000');
                expect(payload.months).toBe(12);
                expect(payload.message).toBe('Love the streams!');
                done();
            });

            eventSub._handlePaypiggyMessageEvent(resubEvent);
        });
    });

    describe('when standard subscription event received', () => {
        test('emits paypiggy with normalized months', (done) => {
            const subEvent = {
                user_id: 'testNewSub789',
                user_name: 'testNewSubscriber',
                tier: '2000',
                cumulative_months: 6,
                timestamp: '2024-01-01T00:00:00Z',
                is_gift: false
            };

            eventSub.on('paypiggy', (payload) => {
                expect(payload.type).toBe('paypiggy');
                expect(payload.username).toBe('testNewSubscriber');
                expect(payload.userId).toBe('testNewSub789');
                expect(payload.tier).toBe('2000');
                expect(payload.months).toBe(6);
                done();
            });

            eventSub._handlePaypiggyEvent(subEvent);
        });
    });
});
