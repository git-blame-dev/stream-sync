
const { validateNormalizedMessage } = require('../src/utils/message-normalization');
const TwitchEventSub = jest.requireActual('../src/platforms/twitch-eventsub');

// Mock the logging module
jest.mock('../src/core/logging', () => ({
    logger: {
        debug: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn()
    }
}));

describe('Twitch EventSub Message Normalization', () => {
    const buildTimestampService = () => ({
        extractTimestamp: jest.fn((platform, data) => {
            const raw = data?.timestamp || data?.['tmi-sent-ts'];
            if (!raw) {
                throw new Error('Missing twitch timestamp');
            }
            return new Date(raw).toISOString();
        })
    });

    test('should normalize EventSub chat message with proper metadata structure', () => {
        // Simulate EventSub chat message event
        const eventSubEvent = {
            chatter_user_name: 'testuser',
            chatter_user_id: '123456',
            message: {
                text: 'Hello world!'
            },
            message_timestamp: '2025-07-20T02:34:30.186Z',
            message_id: '78e5b645-1237-45aa-aa0b-a48c8b08fd18',
            badges: {
                moderator: '1',
                subscriber: '1'
            },
            broadcaster_user_id: '789012'
        };

        // Create user object for normalization (as done in the fix)
        const user = {
            username: eventSubEvent.chatter_user_name,
            userId: eventSubEvent.chatter_user_id,
            isMod: eventSubEvent.badges?.moderator === '1',
            isSubscriber: !!eventSubEvent.badges?.subscriber,
            isBroadcaster: eventSubEvent.broadcaster_user_id === eventSubEvent.chatter_user_id
        };

        // Create context object for normalization (as done in the fix)
        const context = {
            'user-id': eventSubEvent.chatter_user_id,
            'username': eventSubEvent.chatter_user_name,
            'mod': eventSubEvent.badges?.moderator === '1',
            'subscriber': !!eventSubEvent.badges?.subscriber,
            'badges': eventSubEvent.badges || {},
            'color': null, // EventSub doesn't provide color
            'emotes': {}, // EventSub doesn't provide emotes
            'room-id': eventSubEvent.broadcaster_user_id,
            timestamp: eventSubEvent.message_timestamp
        };

        // Use standard message normalization utility
        const { normalizeTwitchMessage } = require('../src/utils/message-normalization');
        const normalizedData = normalizeTwitchMessage(user, eventSubEvent.message.text, context, 'twitch', buildTimestampService());

        // Add EventSub-specific messageId to metadata (as done in the fix)
        normalizedData.metadata.messageId = eventSubEvent.message_id;
        normalizedData.metadata.source = 'eventsub';

        // Validate the normalized data
        const validation = validateNormalizedMessage(normalizedData);

        // Verify validation passes
        expect(validation.isValid).toBe(true);
        expect(validation.errors).toEqual([]);

        // Verify the structure is correct
        expect(normalizedData).toEqual({
            platform: 'twitch',
            userId: '123456',
            username: 'testuser',
            message: 'Hello world!',
            timestamp: expect.any(String),
            isMod: true,
            isSubscriber: true,
            isBroadcaster: false,
            metadata: {
                badges: {
                    moderator: '1',
                    subscriber: '1'
                },
                color: null,
                emotes: {},
                roomId: '789012',
                messageId: '78e5b645-1237-45aa-aa0b-a48c8b08fd18',
                source: 'eventsub'
            },
            rawData: { user, message: 'Hello world!', context }
        });

        // Verify timestamp is valid ISO string
        expect(new Date(normalizedData.timestamp).toISOString()).toBe(normalizedData.timestamp);
    });

    test('should handle EventSub message with minimal data', () => {
        // Simulate EventSub chat message with minimal data
        const eventSubEvent = {
            chatter_user_name: 'minimaluser',
            chatter_user_id: '654321',
            message: {
                text: 'd'
            },
            message_id: 'test-message-id',
            badges: {},
            broadcaster_user_id: '789012'
        };

        // Create user object for normalization
        const user = {
            username: eventSubEvent.chatter_user_name,
            userId: eventSubEvent.chatter_user_id,
            isMod: eventSubEvent.badges?.moderator === '1',
            isSubscriber: !!eventSubEvent.badges?.subscriber,
            isBroadcaster: eventSubEvent.broadcaster_user_id === eventSubEvent.chatter_user_id
        };

        // Create context object for normalization
        const context = {
            'user-id': eventSubEvent.chatter_user_id,
            'username': eventSubEvent.chatter_user_name,
            'mod': eventSubEvent.badges?.moderator === '1',
            'subscriber': !!eventSubEvent.badges?.subscriber,
            'badges': eventSubEvent.badges || {},
            'color': null,
            'emotes': {},
            'room-id': eventSubEvent.broadcaster_user_id,
            timestamp: new Date().toISOString()
        };

        // Use standard message normalization utility
        const { normalizeTwitchMessage } = require('../src/utils/message-normalization');
        const normalizedData = normalizeTwitchMessage(user, eventSubEvent.message.text, context, 'twitch', buildTimestampService());

        // Add EventSub-specific messageId to metadata
        normalizedData.metadata.messageId = eventSubEvent.message_id;
        normalizedData.metadata.source = 'eventsub';

        // Validate the normalized data
        const validation = validateNormalizedMessage(normalizedData);

        // Verify validation passes
        expect(validation.isValid).toBe(true);
        expect(validation.errors).toEqual([]);

        // Verify the structure is correct
        expect(normalizedData.platform).toBe('twitch');
        expect(normalizedData.userId).toBe('654321');
        expect(normalizedData.username).toBe('minimaluser');
        expect(normalizedData.message).toBe('d');
        expect(normalizedData.isMod).toBe(false);
        expect(normalizedData.isSubscriber).toBe(false);
        expect(normalizedData.isBroadcaster).toBe(false);
        expect(normalizedData.metadata).toBeDefined();
        expect(normalizedData.metadata.messageId).toBe('test-message-id');
        expect(normalizedData.metadata.source).toBe('eventsub');
    });

    test('should handle broadcaster messages correctly', () => {
        // Simulate broadcaster message
        const eventSubEvent = {
            chatter_user_name: 'broadcaster',
            chatter_user_id: '789012',
            message: {
                text: 'Broadcaster message'
            },
            message_id: 'broadcaster-msg-id',
            badges: {},
            broadcaster_user_id: '789012' // Same as chatter_user_id
        };

        // Create user object for normalization
        const user = {
            username: eventSubEvent.chatter_user_name,
            displayName: eventSubEvent.chatter_user_name,
            userId: eventSubEvent.chatter_user_id,
            isMod: eventSubEvent.badges?.moderator === '1',
            isSubscriber: !!eventSubEvent.badges?.subscriber,
            isBroadcaster: eventSubEvent.broadcaster_user_id === eventSubEvent.chatter_user_id
        };

        // Create context object for normalization
        const context = {
            'user-id': eventSubEvent.chatter_user_id,
            'username': eventSubEvent.chatter_user_name,
            'display-name': eventSubEvent.chatter_user_name,
            'mod': eventSubEvent.badges?.moderator === '1',
            'subscriber': !!eventSubEvent.badges?.subscriber,
            'badges': eventSubEvent.badges || {},
            'color': null,
            'emotes': {},
            'room-id': eventSubEvent.broadcaster_user_id,
            timestamp: new Date().toISOString()
        };

        // Use standard message normalization utility
        const { normalizeTwitchMessage } = require('../src/utils/message-normalization');
        const normalizedData = normalizeTwitchMessage(user, eventSubEvent.message.text, context, 'twitch', buildTimestampService());

        // Add EventSub-specific messageId to metadata
        normalizedData.metadata.messageId = eventSubEvent.message_id;
        normalizedData.metadata.source = 'eventsub';

        // Validate the normalized data
        const validation = validateNormalizedMessage(normalizedData);

        // Verify validation passes
        expect(validation.isValid).toBe(true);
        expect(validation.errors).toEqual([]);

        // Verify broadcaster flag is set correctly
        expect(normalizedData.isBroadcaster).toBe(true);
        expect(normalizedData.metadata.messageId).toBe('broadcaster-msg-id');
    });

    test('EventSub chat events preserve original timestamps for filtering', () => {
        const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
        const eventSub = new TwitchEventSub({ dataLoggingEnabled: false }, { logger: noopLogger });
        expect(typeof eventSub.emit).toBe('function');

        const eventSubEvent = {
            chatter_user_name: 'timestampeduser',
            chatter_user_id: '998877',
            message: {
                text: 'Old message'
            },
            message_timestamp: '2024-11-14T01:02:03.456Z',
            message_id: 'timestamp-test-id',
            badges: {},
            broadcaster_user_id: '123456'
        };

        let emittedPayload = null;
        const originalEmit = eventSub.emit.bind(eventSub);
        eventSub.emit = (eventName, payload) => {
            if (eventName === 'message') {
                emittedPayload = payload;
            }
            return originalEmit(eventName, payload);
        };

        try {
            eventSub._handleChatMessageEvent(eventSubEvent);
        } finally {
            if (eventSub.cleanupInterval) {
                clearInterval(eventSub.cleanupInterval);
                eventSub.cleanupInterval = null;
            }
        }

        expect(emittedPayload).not.toBeNull();
        expect(emittedPayload.context.timestamp).toBe(eventSubEvent.message_timestamp);
    });
});
