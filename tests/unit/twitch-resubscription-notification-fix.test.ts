import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createRequire } from 'node:module';

const load = createRequire(__filename);
const { EventEmitter } = load('events');

const TwitchEventSub = load('../../src/platforms/twitch-eventsub');
const { noOpLogger } = load('../helpers/mock-factories');
const { secrets, _resetForTesting, initializeStaticSecrets } = load('../../src/core/secrets');

describe('TwitchEventSub Resubscription Notification Fix', () => {
    let eventSub: InstanceType<typeof TwitchEventSub>;

    beforeEach(() => {
        _resetForTesting();
        initializeStaticSecrets();
        secrets.twitch.accessToken = 'testAccessToken';
        const mockTwitchAuth = {
            isReady: () => true,
            getUserId: () => 'testUser123',
            refreshTokens: async () => true
        };

        class MockWebSocket extends EventEmitter {
            constructor() { super(); this.readyState = 1; }
            send() {}
            close() {}
        }

        eventSub = new TwitchEventSub(
            {
                clientId: 'testClientId',
                channel: 'testStreamer',
                username: 'testStreamer',
                broadcasterId: 'test-broadcaster-id',
                dataLoggingEnabled: false
            },
            {
                logger: noOpLogger,
                twitchAuth: mockTwitchAuth,
                WebSocketCtor: MockWebSocket,
                ChatFileLoggingService: class {}
            }
        );
    });

    afterEach(() => {
        eventSub?.removeAllListeners();
        _resetForTesting();
        initializeStaticSecrets();
    });

    describe('when resubscription message received', () => {
        test('emits paypiggyMessage with months and tier', (done) => {
            const resubEvent = {
                user_id: 'test-user-123',
                user_login: 'testresubuser',
                user_name: 'testResubUser',
                tier: '1000',
                cumulative_months: 3,
                timestamp: '2024-01-01T00:00:00Z',
                message: { text: '', emotes: null }
            };

            eventSub.on('paypiggyMessage', (payload) => {
                expect(payload.type).toBe('paypiggy');
                expect(payload.username).toBe('testResubUser');
                expect(payload.userId).toBe('test-user-123');
                expect(payload.tier).toBe('1000');
                expect(payload.months).toBe(3);
                expect(payload.timestamp).toBe(resubEvent.timestamp);
                done();
            });

            eventSub._handlePaypiggyMessageEvent(resubEvent);
        });

        test('emits paypiggyMessage with message text and premium tier', (done) => {
            const resubEvent = {
                user_id: 'test-user-456',
                user_login: 'testpremiumsub',
                user_name: 'testPremiumSub',
                tier: '2000',
                cumulative_months: 12,
                timestamp: '2024-01-01T00:00:00Z',
                message: { text: 'Love the streams!', emotes: null }
            };

            eventSub.on('paypiggyMessage', (payload) => {
                expect(payload.type).toBe('paypiggy');
                expect(payload.username).toBe('testPremiumSub');
                expect(payload.userId).toBe('test-user-456');
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
                user_id: 'test-user-789',
                user_login: 'testnewsubscriber',
                user_name: 'testNewSubscriber',
                tier: '2000',
                cumulative_months: 6,
                timestamp: '2024-01-01T00:00:00Z',
                is_gift: false
            };

            eventSub.on('paypiggy', (payload) => {
                expect(payload.type).toBe('paypiggy');
                expect(payload.username).toBe('testNewSubscriber');
                expect(payload.userId).toBe('test-user-789');
                expect(payload.tier).toBe('2000');
                expect(payload.months).toBe(6);
                done();
            });

            eventSub._handlePaypiggyEvent(subEvent);
        });
    });
});
