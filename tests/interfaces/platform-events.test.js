
const { PlatformEvents, PlatformEventValidator, PlatformEventBuilder } = require('../../src/interfaces/PlatformEvents');

describe('Platform Event Interface Design', () => {
    
    // ============================================================================
    // PLATFORM EVENT SCHEMA VALIDATION BEHAVIORS
    // ============================================================================
    
    describe('Platform Event Schema Validation', () => {
        let validator;
        
        beforeEach(() => {
            validator = new PlatformEventValidator();
        });
        
        // Platform Events
        describe('Chat and Communication Events', () => {
            it('should validate platform:chat-message event with required fields', () => {
            const event = {
                type: 'platform:chat-message',
                platform: 'twitch',
                username: 'testuser',
                userId: '12345',
                message: { text: 'Hello world!' },
                metadata: { emotes: [], badges: [] },
                timestamp: new Date().toISOString()
            };
                const result = validator.validate(event);
                expect(result.valid).toBe(true);
                expect(result.errors).toEqual([]);
            });
            
            it('should reject platform:chat-message event with missing required fields', () => {
                const event = {
                    type: 'platform:chat-message',
                    platform: 'twitch'
                // Missing username, message, metadata, timestamp
            };
                const result = validator.validate(event);
                expect(result.valid).toBe(false);
                expect(result.errors).toContain('Missing required field: username');
                expect(result.errors).toContain('Missing required field: userId');
                expect(result.errors).toContain('Missing required field: message');
                expect(result.errors).toContain('Missing required field: timestamp');
            });
            
            it('should validate platform:chat-connected event with connection details', () => {
                const event = {
                    type: 'platform:chat-connected',
                    platform: 'youtube',
                    connectionId: 'conn_12345',
                    timestamp: new Date().toISOString()
                };
                const result = validator.validate(event);
                expect(result.valid).toBe(true);
            });
            
            it('should validate platform:chat-disconnected event with reason', () => {
                const event = {
                    type: 'platform:chat-disconnected',
                    platform: 'tiktok',
                    reason: 'connection_timeout',
                    willReconnect: true
                };
                const result = validator.validate(event);
                expect(result.valid).toBe(true);
            });
        });
        
        describe('Notification and Interaction Events', () => {
            it('should validate platform:follow event with user details', () => {
            const event = {
                type: 'platform:follow',
                platform: 'twitch',
                username: 'newfollower',
                userId: '67890',
                timestamp: new Date().toISOString(),
                metadata: { isFirstTime: true }
            };
                const result = validator.validate(event);
                expect(result.valid).toBe(true);
            });

            it('should validate platform:share event with user details', () => {
                const event = {
                    type: 'platform:share',
                    platform: 'tiktok',
                    username: 'sharer',
                    userId: 'share-1',
                    timestamp: new Date().toISOString(),
                    metadata: { interactionType: 'share' }
                };
                const result = validator.validate(event);
                expect(result.valid).toBe(true);
            });
            
            it('should validate platform:paypiggy event with tier and duration', () => {
            const event = {
                type: 'platform:paypiggy',
                platform: 'twitch',
                username: 'subscriber',
                userId: '11111',
                tier: '1',
                months: 1,
                message: 'Thanks for the content!',
                timestamp: new Date().toISOString()
            };
                const result = validator.validate(event);
                expect(result.valid).toBe(true);
            });

            it('should validate platform:giftpaypiggy event with gift count', () => {
                const event = {
                    type: 'platform:giftpaypiggy',
                    platform: 'twitch',
                    username: 'gifter',
                    userId: '11112',
                    giftCount: 5,
                    tier: '1000',
                    timestamp: new Date().toISOString()
                };
                const result = validator.validate(event);
                expect(result.valid).toBe(true);
            });

            it('should reject platform:paypiggy event with missing timestamp', () => {
                const event = {
                    type: 'platform:paypiggy',
                    platform: 'twitch',
                    username: 'subscriber',
                    userId: '11111',
                    tier: '1',
                    months: 1
                };
                const result = validator.validate(event);
                expect(result.valid).toBe(false);
                expect(result.errors).toContain('Missing required field: timestamp');
            });
            
            it('should validate platform:gift event with monetary information', () => {
            const event = {
                type: 'platform:gift',
                platform: 'tiktok',
                username: 'gifter',
                userId: '22222',
                id: 'gift-evt-1',
                giftType: 'rose',
                giftCount: 1,
                repeatCount: 1,
                amount: 5,
                currency: 'coins',
                timestamp: new Date().toISOString()
            };
                const result = validator.validate(event);
                expect(result.valid).toBe(true);
            });

            it('should reject platform:gift event with missing id', () => {
                const event = {
                    type: 'platform:gift',
                    platform: 'tiktok',
                    username: 'gifter',
                    userId: '22222',
                    giftType: 'rose',
                    giftCount: 1,
                    amount: 5,
                    currency: 'coins',
                    timestamp: new Date().toISOString()
                };
                const result = validator.validate(event);
                expect(result.valid).toBe(false);
                expect(result.errors).toContain('Missing required field: id');
            });

            it('should allow platform:gift error events without id', () => {
                const event = {
                    type: 'platform:gift',
                    platform: 'tiktok',
                    username: 'gifter',
                    userId: '22222',
                    giftType: 'rose',
                    giftCount: 0,
                    amount: 0,
                    currency: 'coins',
                    timestamp: new Date().toISOString(),
                    isError: true
                };
                const result = validator.validate(event);
                expect(result.valid).toBe(true);
            });
            
            it('should validate platform:raid event with user information', () => {
            const event = {
                type: 'platform:raid',
                platform: 'twitch',
                username: 'raider',
                userId: '33333',
                viewerCount: 150,
                timestamp: new Date().toISOString()
            };
                const result = validator.validate(event);
                expect(result.valid).toBe(true);
            });
            
            it('should validate platform:envelope event with required fields', () => {
                const event = {
                    type: 'platform:envelope',
                    platform: 'tiktok',
                    username: 'gifter',
                    userId: '44444',
                    id: 'envelope-event-1',
                    giftType: 'Treasure Chest',
                    giftCount: 1,
                    amount: 50,
                    currency: 'coins',
                    timestamp: new Date().toISOString()
                };
                const result = validator.validate(event);
                expect(result.valid).toBe(true);
            });

            it('should reject platform:cheer events as unsupported', () => {
                const event = {
                    type: 'platform:cheer',
                    platform: 'twitch',
                    username: 'cheerer',
                    userId: '44444',
                    bits: 100,
                    message: 'Great stream!',
                    id: 'cheer-event-1',
                    repeatCount: 1,
                    timestamp: new Date().toISOString()
                };
                const result = validator.validate(event);
                expect(result.valid).toBe(false);
                expect(result.errors).toContain('Invalid event type: platform:cheer');
            });
        });
        
        describe('Connection and Health Events', () => {
            it('should validate platform:connection-status event with metrics', () => {
                const event = {
                    type: 'platform:connection-status',
                    platform: 'youtube',
                    status: 'connected',
                    latency: 45,
                    error: null
                };
                const result = validator.validate(event);
                expect(result.valid).toBe(true);
            });

            it('should validate platform:connection event with timestamp', () => {
                const event = {
                    type: 'platform:connection',
                    platform: 'twitch',
                    status: 'connected',
                    timestamp: new Date().toISOString()
                };
                const result = validator.validate(event);
                expect(result.valid).toBe(true);
            });

            it('should validate platform:notification event with timestamp', () => {
                const event = {
                    type: 'platform:notification',
                    platform: 'twitch',
                    notificationType: 'gift',
                    timestamp: new Date().toISOString(),
                    data: { message: 'test' }
                };
                const result = validator.validate(event);
                expect(result.valid).toBe(true);
            });
            
            it('should validate platform:authentication-required event', () => {
                const event = {
                    type: 'platform:authentication-required',
                    platform: 'twitch',
                    tokenType: 'oauth',
                    reason: 'token_expired'
                };
                const result = validator.validate(event);
                expect(result.valid).toBe(true);
            });
            
            it('should validate platform:rate-limit-hit event with retry information', () => {
                const event = {
                    type: 'platform:rate-limit-hit',
                    platform: 'youtube',
                    endpoint: '/chat/messages',
                    retryAfter: 30
                };
                const result = validator.validate(event);
                expect(result.valid).toBe(true);
            });
            
            it('should validate platform:viewer-count event with count data', () => {
                const event = {
                    type: 'platform:viewer-count',
                    platform: 'tiktok',
                    count: 1250,
                    timestamp: new Date().toISOString()
                };
                const result = validator.validate(event);
                expect(result.valid).toBe(true);
            });
            
            it('should validate platform:stream-status event with stream information', () => {
                const event = {
                    type: 'platform:stream-status',
                    platform: 'twitch',
                    isLive: true,
                    timestamp: new Date().toISOString()
                };
                const result = validator.validate(event);
                expect(result.valid).toBe(true);
            });
            
            it('should validate platform:error event with context', () => {
                const event = {
                    type: 'platform:error',
                    platform: 'youtube',
                    error: new Error('API connection failed'),
                    context: { endpoint: '/api/chat', operation: 'connect' },
                    recoverable: true
                };
                const result = validator.validate(event);
                expect(result.valid).toBe(true);
            });
            
            it('should validate platform:health-check event with metrics', () => {
                const event = {
                    type: 'platform:health-check',
                    platform: 'tiktok',
                    healthy: true,
                    metrics: { latency: 25, messagesPerMinute: 45 }
                };
                const result = validator.validate(event);
                expect(result.valid).toBe(true);
            });
        });
    });
    
    // ============================================================================
    // CROSS-PLATFORM EVENT NORMALIZATION BEHAVIORS
    // ============================================================================
    
    describe('Cross-Platform Event Normalization', () => {
        let builder;
        
        beforeEach(() => {
            builder = new PlatformEventBuilder();
        });
        
        it('should normalize chat messages from different platforms to standard format', () => {
            const tiktokData = {
                username: 'tiktok_user',
                userId: 'tt-123',
                message: { text: 'Hello from TikTok!' },
                timestamp: 1234567890000
            };
            
            const twitchData = {
                username: 'TwitchUser',
                userId: 'tw-123',
                message: { text: 'Hello from Twitch!' },
                timestamp: '1234567890000'
            };
            
            const youtubeData = {
                username: 'YouTubeUser',
                userId: 'yt-123',
                message: { text: 'Hello from YouTube!' },
                timestamp: '2024-01-01T12:00:00Z'
            };
            const tiktokEvent = builder.normalizeMessage('tiktok', tiktokData);
            const twitchEvent = builder.normalizeMessage('twitch', twitchData);
            const youtubeEvent = builder.normalizeMessage('youtube', youtubeData);
            expect(tiktokEvent.type).toBe('platform:chat-message');
            expect(twitchEvent.type).toBe('platform:chat-message');
            expect(youtubeEvent.type).toBe('platform:chat-message');
            
            expect(tiktokEvent).toHaveProperty('username');
            expect(twitchEvent).toHaveProperty('username');
            expect(youtubeEvent).toHaveProperty('username');
            
            expect(tiktokEvent).toHaveProperty('message');
            expect(twitchEvent).toHaveProperty('message');
            expect(youtubeEvent).toHaveProperty('message');

            expect(tiktokEvent.message).toEqual({ text: 'Hello from TikTok!' });
            expect(twitchEvent.message).toEqual({ text: 'Hello from Twitch!' });
            expect(youtubeEvent.message).toEqual({ text: 'Hello from YouTube!' });
            
            expect(tiktokEvent).toHaveProperty('timestamp');
            expect(twitchEvent).toHaveProperty('timestamp');
            expect(youtubeEvent).toHaveProperty('timestamp');
        });
        
        it('should normalize gift events from different platforms to standard format', () => {
            const tiktokGift = {
                username: 'gifter123',
                userId: 'tt-gift-1',
                id: 'tt-gift-evt-1',
                giftType: 'rose',
                giftCount: 1,
                amount: 1,
                currency: 'coins',
                timestamp: 1234567890000
            };
            
            const youtubeSuperchat = {
                username: 'Supporter123',
                userId: 'yt-support-1',
                id: 'yt-superchat-evt-1',
                giftType: 'Super Chat',
                giftCount: 1,
                amount: 5,
                currency: 'USD',
                message: 'Great stream!',
                timestamp: 1234567890001
            };
            const tiktokEvent = builder.normalizeGift('tiktok', tiktokGift);
            const youtubeEvent = builder.normalizeGift('youtube', youtubeSuperchat);
            expect(tiktokEvent.type).toBe('platform:gift');
            expect(youtubeEvent.type).toBe('platform:gift');
            expect(tiktokEvent.id).toBe('tt-gift-evt-1');
            expect(youtubeEvent.id).toBe('yt-superchat-evt-1');
            
            expect(tiktokEvent.username).toBe('gifter123');
            expect(youtubeEvent.username).toBe('Supporter123');
            
            expect(tiktokEvent.giftType).toBe('rose');
            expect(youtubeEvent.giftType).toBe('Super Chat');
            
            expect(typeof tiktokEvent.amount).toBe('number');
            expect(typeof youtubeEvent.amount).toBe('number');
        });
        
        it('should normalize follow events from different platforms', () => {
            const tiktokFollow = {
                username: 'new_follower',
                userId: 'tt-follow-1',
                timestamp: 1234567890000
            };
            
            const twitchFollow = {
                username: 'twitch_follower',
                userId: 'tw-follow-1',
                timestamp: '2024-01-01T12:00:00Z'
            };
            const tiktokEvent = builder.normalizeFollow('tiktok', tiktokFollow);
            const twitchEvent = builder.normalizeFollow('twitch', twitchFollow);
            expect(tiktokEvent.type).toBe('platform:follow');
            expect(twitchEvent.type).toBe('platform:follow');
            
            expect(tiktokEvent.platform).toBe('tiktok');
            expect(twitchEvent.platform).toBe('twitch');
            
            expect(tiktokEvent.username).toBe('new_follower');
            expect(twitchEvent.username).toBe('twitch_follower');
        });
        
        it('should handle missing or malformed data gracefully during normalization', () => {
            const malformedData = {
                // Missing required fields
                someRandomField: 'value'
            };
            const normalize = () => builder.normalizeMessage('twitch', malformedData);
            expect(normalize).toThrow('username');
        });
    });
    
    // ============================================================================
    // EVENT BUILDER CONSISTENCY BEHAVIORS
    // ============================================================================
    
    describe('Platform Event Builder Consistency', () => {
        let builder;
        
        beforeEach(() => {
            builder = new PlatformEventBuilder();
        });
        
        it('should create consistent platform:chat-message events', () => {
            const params = {
                platform: 'twitch',
                username: 'testuser',
                userId: '123',
                message: 'Hello world!',
                timestamp: '2024-01-01T00:00:00Z',
                metadata: { badges: [] }
            };
            const event = builder.createChatMessage(params);
            expect(event.type).toBe('platform:chat-message');
            expect(event.platform).toBe('twitch');
            expect(event.username).toBe('testuser');
            expect(event.userId).toBe('123');
            expect(event.message).toEqual({ text: 'Hello world!' });
            expect(event.timestamp).toBe('2024-01-01T00:00:00Z');
            expect(event.metadata).toEqual(params.metadata);
        });
        
        it('should create consistent platform:gift events', () => {
            const params = {
                platform: 'youtube',
                username: 'gifter',
                userId: '456',
                id: 'gift-evt-2',
                giftType: 'Super Chat',
                giftCount: 1,
                amount: 5.00,
                currency: 'USD',
                timestamp: '2024-01-01T00:00:01Z'
            };
            const event = builder.createGift(params);
            expect(event.type).toBe('platform:gift');
            expect(event.platform).toBe('youtube');
            expect(event.username).toBe('gifter');
            expect(event.userId).toBe('456');
            expect(event.id).toBe('gift-evt-2');
            expect(event.giftType).toBe('Super Chat');
            expect(event.giftCount).toBe(1);
            expect(event.amount).toBe(5.00);
            expect(event.currency).toBe('USD');
            expect(event.timestamp).toBe('2024-01-01T00:00:01Z');
        });
        
        it('should create consistent platform:follow events', () => {
            const params = {
                platform: 'tiktok',
                username: 'newfollower',
                userId: '789',
                timestamp: '2024-01-01T00:00:02Z',
                metadata: { isFirstTime: true }
            };
            const event = builder.createFollow(params);
            expect(event.type).toBe('platform:follow');
            expect(event.platform).toBe('tiktok');
            expect(event.username).toBe('newfollower');
            expect(event.userId).toBe('789');
            expect(event.timestamp).toBe('2024-01-01T00:00:02Z');
            expect(event.metadata).toEqual(params.metadata);
        });
        
        it('should validate event parameters before building', () => {
            const invalidParams = {
                platform: 'twitch'
                // Missing username and message
            };
            const buildEvent = () => builder.createChatMessage(invalidParams);
            expect(buildEvent).toThrow('Missing required parameter: username');
        });
        
        it('should require timestamp for chat message events', () => {
            const params = {
                platform: 'youtube',
                username: 'user',
                userId: '999',
                message: 'Test message'
            };

            const buildEvent = () => builder.createChatMessage(params);

            expect(buildEvent).toThrow('Missing required parameter: timestamp');
        });
        
        it('should preserve custom timestamp if provided', () => {
            const customTimestamp = '2024-01-01T12:00:00Z';
            const params = {
                platform: 'twitch',
                username: 'user',
                userId: '111',
                message: 'Test message',
                timestamp: customTimestamp
            };
            const event = builder.createChatMessage(params);
            expect(event.timestamp).toBe(customTimestamp);
        });
    });
    
    // ============================================================================
    // EVENT SCHEMA COMPLIANCE BEHAVIORS
    // ============================================================================
    
    describe('Event Schema Compliance Validation', () => {
        let validator;
        
        beforeEach(() => {
            validator = new PlatformEventValidator();
        });
        
        it('should validate all defined event types exist in schema', () => {
            const expectedEventTypes = [
                // Platform Events
                'platform:chat-message', 'platform:chat-connected', 'platform:chat-disconnected',
                'platform:follow', 'platform:paypiggy', 'platform:giftpaypiggy', 'platform:gift', 'platform:raid', 'platform:share', 'platform:envelope',
                'platform:connection-status', 'platform:authentication-required', 'platform:rate-limit-hit',
                'platform:connection', 'platform:notification', 'platform:viewer-count', 'platform:stream-status',
                'platform:stream-detected', 'platform:error', 'platform:health-check',
                
                // VFX Events
                'vfx:command-received', 'vfx:command-executed', 'vfx:effect-completed'
            ];
            const schemaEventTypes = validator.getSupportedEventTypes();
            for (const eventType of expectedEventTypes) {
                expect(schemaEventTypes).toContain(eventType);
            }
        });
        
        it('should enforce required fields for each event type', () => {
            const schema = validator.getEventSchema('platform:chat-message');
            expect(schema.required).toContain('type');
            expect(schema.required).toContain('platform');
            expect(schema.required).toContain('username');
            expect(schema.required).toContain('userId');
            expect(schema.required).toContain('message');
            expect(schema.required).toContain('timestamp');
        });
        
        it('should validate platform field is restricted to valid platforms', () => {
            const invalidEvent = {
                type: 'platform:chat-message',
                platform: 'invalid_platform',
                username: 'user',
                userId: '123',
                message: { text: 'test' },
                timestamp: new Date().toISOString()
            };
            const result = validator.validate(invalidEvent);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Invalid platform: invalid_platform. Must be one of: twitch, youtube, tiktok');
        });
        
        it('should allow optional fields while requiring mandatory ones', () => {
            const minimalEvent = {
                type: 'platform:chat-message',
                platform: 'twitch',
                username: 'user',
                userId: '123',
                message: { text: 'test' },
                timestamp: new Date().toISOString()
            };
            const result = validator.validate(minimalEvent);
            expect(result.valid).toBe(true);
        });
    });
    
    // ============================================================================
    // ERROR HANDLING AND EDGE CASES
    // ============================================================================
    
    describe('Event Interface Error Handling', () => {
        let validator, builder;
        
        beforeEach(() => {
            validator = new PlatformEventValidator();
            builder = new PlatformEventBuilder();
        });
        
        it('should handle null or undefined events gracefully', () => {
            const nullResult = validator.validate(null);
            const undefinedResult = validator.validate(undefined);
            expect(nullResult.valid).toBe(false);
            expect(nullResult.errors).toContain('Event is null or undefined');
            expect(undefinedResult.valid).toBe(false);
            expect(undefinedResult.errors).toContain('Event is null or undefined');
        });
        
        it('should handle circular references in event data', () => {
            const circularEvent = {
                type: 'platform:chat-message',
                platform: 'twitch',
                username: 'user',
                userId: '123',
                message: { text: 'test' },
                timestamp: new Date().toISOString()
            };
            circularEvent.self = circularEvent; // Create circular reference
            const validate = () => validator.validate(circularEvent);
            expect(validate).not.toThrow();
        });
        
        it('should provide detailed validation error messages', () => {
            const problematicEvent = {
                type: 'invalid-type',
                platform: 'invalid_platform',
                username: 123,
                message: 123, // Should be an object with text
                timestamp: 'invalid_date'
            };
            const result = validator.validate(problematicEvent);
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors.some(err => err.includes('Invalid event type'))).toBe(true);
            expect(result.errors.some(err => err.includes('Invalid platform'))).toBe(true);
        });
        
        it('should validate data type consistency across platforms', () => {
            const twitchEvent = builder.createChatMessage({
                platform: 'twitch',
                username: 'user',
                userId: '123',
                message: 'test',
                timestamp: new Date().toISOString()
            });
            
            const youtubeEvent = builder.createChatMessage({
                platform: 'youtube',
                username: 'user',
                userId: '456',
                message: 'test',
                timestamp: new Date().toISOString()
            });
            const twitchResult = validator.validate(twitchEvent);
            const youtubeResult = validator.validate(youtubeEvent);
            expect(twitchResult.valid).toBe(true);
            expect(youtubeResult.valid).toBe(true);
            
            // Should have same structure regardless of platform
            expect(Object.keys(twitchEvent).sort()).toEqual(Object.keys(youtubeEvent).sort());
        });
    });
});
