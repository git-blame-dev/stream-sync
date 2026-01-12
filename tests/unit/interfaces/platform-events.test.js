
const { createTestUser, createMockConfig } = require('../../helpers/test-setup');
const { PlatformEvents, PlatformEventValidator } = require('../../../src/interfaces/PlatformEvents');
const testClock = require('../../helpers/test-clock');

describe('Platform Events Interface', () => {
    describe('Event Schema Validation', () => {
        it('should validate chat message events from all platforms', () => {
            const testCases = [
                {
                    platform: 'tiktok',
                    identity: createTestUser({ username: 'TikTokUser' }),
                    message: 'Hello from TikTok!',
                    metadata: { giftType: null }
                },
                {
                    platform: 'twitch',
                    identity: createTestUser({ username: 'TwitchUser' }),
                    message: 'Hello from Twitch!',
                    metadata: { badges: ['vip'] }
                },
                {
                    platform: 'youtube',
                    identity: createTestUser({ username: 'YouTubeUser' }),
                    message: 'Hello from YouTube!',
                    metadata: { membership: true }
                }
            ];

            testCases.forEach(testCase => {
                const event = PlatformEvents.createChatMessageEvent(
                    testCase.platform,
                    testCase.identity,
                    testCase.message,
                    testCase.metadata
                );

                expect(PlatformEvents.validateChatMessageEvent(event)).toBe(true);
                expect(event.type).toBe('platform:chat-message');
                expect(event.platform).toBe(testCase.platform);
                expect(event.timestamp).toEqual(expect.any(String));
                expect(event.username).toBe(testCase.identity.username);
                expect(event.userId).toBe(testCase.identity.userId);
                expect(event.message).toEqual({ text: testCase.message });
            });
        });

        it('should validate notification events across all platforms', () => {
            const testCases = [
                {
                    platform: 'tiktok',
                    type: 'platform:gift',
                    data: { giftType: 'rose', amount: 5, username: 'Gifter' }
                },
                {
                    platform: 'twitch',
                    type: 'platform:paypiggy',
                    data: { tier: 1, duration: 1, username: 'Subscriber' }
                },
                {
                    platform: 'youtube',
                    type: 'platform:paypiggy',
                    data: { level: 'sponsor', username: 'Member' }
                },
                {
                    platform: 'tiktok',
                    type: 'platform:paypiggy',
                    data: { tier: 'superfan', username: 'SuperFanUser' }
                }
            ];

            testCases.forEach(testCase => {
                const event = PlatformEvents.createNotificationEvent(
                    testCase.platform,
                    testCase.type,
                    testCase.data
                );

                expect(PlatformEvents.validateNotificationEvent(event)).toBe(true);
                expect(event.type).toBe('platform:notification');
                expect(event.notificationType).toBe(testCase.type);
                expect(event.platform).toBe(testCase.platform);
            });
        });

        it('should validate connection status events', () => {
            const platforms = ['tiktok', 'twitch', 'youtube'];
            const statuses = ['connected', 'disconnected', 'reconnecting'];

            platforms.forEach(platform => {
                statuses.forEach(status => {
                    const event = PlatformEvents.createConnectionEvent(platform, status);
                    
                    expect(PlatformEvents.validateConnectionEvent(event)).toBe(true);
                    expect(event.type).toBe('platform:connection');
                    expect(event.platform).toBe(platform);
                    expect(event.status).toBe(status);
                });
            });
        });

        it('should validate error events with proper context', () => {
            const platforms = ['tiktok', 'twitch', 'youtube'];
            
            platforms.forEach(platform => {
                const error = new Error('Test error');
                const context = { method: 'handleMessage', retryable: true };
                
                const event = PlatformEvents.createErrorEvent(platform, error, context);
                
                expect(PlatformEvents.validateErrorEvent(event)).toBe(true);
                expect(event.type).toBe('platform:error');
                expect(event.platform).toBe(platform);
                expect(event.error).toBeDefined();
                expect(event.context).toEqual(context);
            });
        });
    });

    describe('Cross-Platform Event Normalization', () => {
        it('rejects identities missing canonical fields', () => {
            expect(() => PlatformEvents.normalizeIdentity('twitch', { userId: 'user-1' }))
                .toThrow('username');
        });

        it('should normalize identity data consistently across platforms', () => {
            const rawUsers = {
                tiktok: { username: 'TikUser', userId: 'tt-123', profilePictureUrl: 'http://pic.example.invalid' },
                twitch: { username: 'TwitchUser', userId: 'tw-123', id: 'twitch123' },
                youtube: { username: 'YouTubeUser', userId: 'yt-123', imageUrl: 'http://yt.example.invalid' }
            };

            Object.entries(rawUsers).forEach(([platform, rawUser]) => {
                const normalizedUser = PlatformEvents.normalizeIdentity(platform, rawUser);
                
                expect(normalizedUser).toHaveProperty('userId');
                expect(normalizedUser).toHaveProperty('username');
                expect(normalizedUser).toHaveProperty('platform', platform);
                expect(typeof normalizedUser.userId).toBe('string');
                expect(typeof normalizedUser.username).toBe('string');
            });
        });

        it('should normalize message data consistently across platforms', () => {
            const now = testClock.now();
            const rawMessages = {
                tiktok: { message: { text: 'Hello TikTok!' }, username: 'TikUser', userId: 'tt-1', timestamp: now },
                twitch: { message: { text: 'Hello Twitch!' }, username: 'TwitchUser', userId: 'tw-1', timestamp: now, emotes: {} },
                youtube: { message: { text: 'Hello YouTube!' }, username: 'YTUser', userId: 'yt-1', timestamp: now }
            };

            Object.entries(rawMessages).forEach(([platform, rawMessage]) => {
                const normalizedMessage = PlatformEvents.normalizeMessage(platform, rawMessage);
                
                expect(normalizedMessage).toHaveProperty('text');
                expect(normalizedMessage).toHaveProperty('username');
                expect(normalizedMessage).toHaveProperty('userId');
                expect(normalizedMessage).toHaveProperty('platform', platform);
                expect(normalizedMessage).toHaveProperty('timestamp');
                expect(typeof normalizedMessage.text).toBe('string');
                expect(normalizedMessage.text.length).toBeGreaterThan(0);
            });
        });

        it('should normalize gift data consistently across platforms', () => {
            const rawGifts = {
                tiktok: { 
                    type: 'platform:gift',
                    id: 'tt-gift-event-1',
                    giftType: 'rose',
                    giftCount: 1,
                    amount: 50,
                    currency: 'coins',
                    username: 'Gifter',
                    userId: 'tt-gift-1',
                    timestamp: 1234567890000
                },
                twitch: {
                    type: 'platform:gift',
                    id: 'tw-gift-event-1',
                    giftType: 'bits',
                    giftCount: 1,
                    amount: 100,
                    currency: 'bits',
                    username: 'Cheerer',
                    userId: 'tw-bits-1',
                    message: 'Take my bits!',
                    timestamp: 1234567890001
                },
                youtube: {
                    type: 'platform:gift',
                    id: 'yt-gift-event-1',
                    giftType: 'Super Chat',
                    giftCount: 1,
                    amount: 5,
                    currency: 'USD',
                    username: 'Donator',
                    userId: 'yt-dono-1',
                    message: 'Great stream!',
                    timestamp: 1234567890002
                }
            };

            Object.entries(rawGifts).forEach(([platform, rawGift]) => {
                const normalizedGift = PlatformEvents.normalizeGift(platform, rawGift);
                
                expect(normalizedGift).toHaveProperty('id');
                expect(normalizedGift).toHaveProperty('giftType');
                expect(normalizedGift).toHaveProperty('giftCount');
                expect(normalizedGift).toHaveProperty('amount');
                expect(normalizedGift).toHaveProperty('currency');
                expect(normalizedGift).toHaveProperty('username');
                expect(normalizedGift).toHaveProperty('userId');
                expect(normalizedGift).toHaveProperty('platform', platform);
                expect(typeof normalizedGift.amount).toBe('number');
                expect(normalizedGift.amount).toBeGreaterThan(0);
            });
        });
    });

    describe('Event Factory Methods', () => {
        it('should create standardized chat events with correlation tracking', () => {
            const identity = createTestUser({ username: 'TestUser' });
            const message = 'Test message';
            const platform = 'tiktok';
            
            const event = PlatformEvents.createChatMessageEvent(platform, identity, message);
            
            expect(event.correlationId).toBeDefined();
            expect(typeof event.correlationId).toBe('string');
            expect(event.correlationId.length).toBeGreaterThan(0);
            expect(event.timestamp).toEqual(expect.any(String));
            expect(event.id).toBeDefined();
        });

        it('should create standardized notification events with priority', () => {
            const notificationData = {
                type: 'platform:gift',
                username: 'Gifter',
                amount: 10
            };
            
            const event = PlatformEvents.createNotificationEvent('tiktok', 'platform:gift', notificationData);
            
            expect(event.priority).toBeDefined();
            expect(typeof event.priority).toBe('number');
            expect(event.priority).toBeGreaterThanOrEqual(1);
            expect(event.priority).toBeLessThanOrEqual(10);
        });

        it('should create error events with proper error serialization', () => {
            const error = new Error('Test error');
            error.code = 'TEST_ERROR';
            error.stack = 'Error stack trace';
            
            const event = PlatformEvents.createErrorEvent('twitch', error, { method: 'test' });
            
            expect(event.error).toHaveProperty('message', 'Test error');
            expect(event.error).toHaveProperty('code', 'TEST_ERROR');
            expect(event.error).toHaveProperty('stack');
            expect(event.recoverable).toBeDefined();
            expect(typeof event.recoverable).toBe('boolean');
        });
    });

    describe('Event Validation and Sanitization', () => {
        it('should sanitize malicious content in messages', () => {
            const maliciousInputs = [
                '<script>alert("xss")</script>',
                'javascript:void(0)',
                '<img src="x" onerror="alert(1)">',
                '${process.env}',
                '{{constructor.constructor("alert(1)")()}}'
            ];

            maliciousInputs.forEach(maliciousInput => {
                const event = PlatformEvents.createChatMessageEvent(
                    'tiktok',
                    createTestUser({ username: 'TestUser' }),
                    maliciousInput
                );
                
                expect(event.message.text).not.toContain('<script>');
                expect(event.message.text).not.toContain('javascript:');
                expect(event.message.text).not.toContain('onerror=');
                expect(event.message.text).not.toMatch(/\$\{.*\}/);
                expect(event.message.text).not.toMatch(/\{\{.*\}\}/);
            });
        });

        it('should validate event schemas and reject invalid events', () => {
            const invalidEvents = [
                { type: 'platform:chat-message' }, // missing required fields
                { type: 'platform:chat-message', platform: 'invalid' }, // invalid platform
                { type: 'invalid:type', platform: 'tiktok' }, // invalid type
                null,
                undefined,
                'not an object'
            ];

            invalidEvents.forEach(invalidEvent => {
                expect(PlatformEvents.validateEvent(invalidEvent)).toBe(false);
            });
        });

        it('should handle Unicode and emoji content properly', () => {
            const unicodeMessages = [
                '你好世界 🌍',
                'مرحبا بالعالم 🌎',
                'Здравствуй мир 🌏',
                '🎉🎊✨🌟💫⭐',
                '😀😃😄😁😆😅😂🤣'
            ];

            unicodeMessages.forEach(unicodeMessage => {
                const event = PlatformEvents.createChatMessageEvent(
                    'youtube',
                    createTestUser({ username: 'UnicodeUser' }),
                    unicodeMessage
                );
                
                expect(event.message.text).toBe(unicodeMessage);
                expect(PlatformEvents.validateChatMessageEvent(event)).toBe(true);
            });
        });
    });

    describe('Event Builder Pattern', () => {
        it('should support fluent event building', () => {
            const event = PlatformEvents.builder()
                .platform('twitch')
                .type('chat-message')
                .username('FluentUser')
                .message('Built with fluent API')
                .metadata({ vip: true })
                .priority(5)
                .build();

            expect(event.platform).toBe('twitch');
            expect(event.type).toBe('platform:chat-message');
            expect(event.message.text).toBe('Built with fluent API');
            expect(event.metadata.vip).toBe(true);
        });

        it('should validate during build process', () => {
            expect(() => {
                PlatformEvents.builder()
                    .platform('invalid')
                    .type('chat-message')
                    .build();
            }).toThrow();

            expect(() => {
                PlatformEvents.builder()
                    .platform('twitch')
                    .type('invalid-type')
                    .build();
            }).toThrow();
        });
    });

    describe('Stream Detection Event Contract', () => {
        it('should expose standardized platform:stream-detected events', () => {
            const validator = new PlatformEventValidator();

            const event = {
                type: 'platform:stream-detected',
                platform: 'youtube',
                eventType: 'stream-detected',
                newStreamIds: ['stream-1', 'stream-2'],
                allStreamIds: ['stream-1', 'stream-2'],
                detectionTime: testClock.now(),
                connectionCount: 0
            };

            expect(PlatformEvents.STREAM_DETECTED).toBe('platform:stream-detected');
            expect(validator.validate(event)).toEqual({
                valid: true,
                errors: []
            });
        });
    });
});
