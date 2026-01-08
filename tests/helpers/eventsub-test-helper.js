
const { EventEmitter } = require('events');
const { scheduleTimeout } = require('./time-utils');

class MockWebSocket extends EventEmitter {
    constructor(url) {
        super();
        this.url = url;
        this.readyState = MockWebSocket.CONNECTING;
        this.messages = [];
        
        // Simulate connection after a short delay
        scheduleTimeout(() => {
            this.readyState = MockWebSocket.OPEN;
            this.emit('open');
        }, 10);
    }
    
    send(data) {
        if (this.readyState !== MockWebSocket.OPEN) {
            throw new Error('WebSocket is not open');
        }
        this.messages.push(data);
    }
    
    close() {
        this.readyState = MockWebSocket.CLOSED;
        this.emit('close', 1000, 'Normal closure');
    }
    
    // Simulate receiving a message
    simulateMessage(data) {
        this.emit('message', data);
    }
    
    // Simulate an error
    simulateError(error) {
        this.emit('error', error);
    }
}

// WebSocket ready states
MockWebSocket.CONNECTING = 0;
MockWebSocket.OPEN = 1;
MockWebSocket.CLOSING = 2;
MockWebSocket.CLOSED = 3;

function createSessionWelcomeMessage(sessionId = 'test-session-id') {
    return JSON.stringify({
        metadata: {
            message_id: 'test-message-id',
            message_type: 'session_welcome',
            message_timestamp: new Date().toISOString()
        },
        payload: {
            session: {
                id: sessionId,
                status: 'connected',
                connected_at: new Date().toISOString(),
                keepalive_timeout_seconds: 10,
                reconnect_url: null,
                recovery_url: null
            }
        }
    });
}

function createKeepaliveMessage() {
    return JSON.stringify({
        metadata: {
            message_id: 'test-keepalive-id',
            message_type: 'session_keepalive',
            message_timestamp: new Date().toISOString()
        },
        payload: {}
    });
}

function createNotificationMessage(eventType, eventData) {
    return JSON.stringify({
        metadata: {
            message_id: 'test-notification-id',
            message_type: 'notification',
            message_timestamp: new Date().toISOString(),
            subscription_type: eventType,
            subscription_version: '1'
        },
        payload: {
            subscription: {
                id: 'test-subscription-id',
                type: eventType,
                version: '1',
                status: 'enabled',
                cost: 1,
                condition: { broadcaster_user_id: '123456' },
                transport: { method: 'websocket', session_id: 'test-session-id' },
                created_at: new Date().toISOString()
            },
            event: eventData
        }
    });
}

function createChatMessageEvent(username = 'TestUser', message = 'Hello World') {
    return {
        chatter_user_id: '123456',
        chatter_user_name: username,
        chatter_display_name: username,
        message: {
            text: message,
            fragments: [{ type: 'text', text: message }]
        },
        message_id: 'test-message-id',
        broadcaster_user_id: '123456',
        broadcaster_user_name: 'TestBroadcaster',
        broadcaster_display_name: 'TestBroadcaster',
        badges: [],
        color: '#FF0000',
        timestamp: new Date().toISOString()
    };
}

function createFollowEvent(username = 'TestFollower') {
    return {
        user_id: '123456',
        user_name: username,
        user_display_name: username,
        broadcaster_user_id: '123456',
        broadcaster_user_name: 'TestBroadcaster',
        broadcaster_display_name: 'TestBroadcaster',
        followed_at: new Date().toISOString()
    };
}

function createPaypiggyEvent(username = 'TestSubscriber', tier = '1000') {
    return {
        user_id: '123456',
        user_name: username,
        user_display_name: username,
        broadcaster_user_id: '123456',
        broadcaster_user_name: 'TestBroadcaster',
        broadcaster_display_name: 'TestBroadcaster',
        tier: tier,
        is_gift: false,
        cumulative_months: 3,
        streak_months: 2,
        duration_months: 3,
        timestamp: new Date().toISOString()
    };
}

function createMockConfig() {
    return {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        channel: 'test-channel',
        username: 'test-username',
        enabled: true,
        eventsub_enabled: true
    };
}

function createMockTwitchAuth() {
    return {
        userId: 123456,
        isInitialized: true,
        getAuthProvider: jest.fn().mockResolvedValue({
            getAccessTokenForUser: jest.fn().mockResolvedValue({
                accessToken: 'test-access-token',
                expiresAt: new Date(Date.now() + 3600000)
            })
        })
    };
}

function createMockLogger() {
    return {
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    };
}

module.exports = {
    MockWebSocket,
    createSessionWelcomeMessage,
    createKeepaliveMessage,
    createNotificationMessage,
    createChatMessageEvent,
    createFollowEvent,
    createPaypiggyEvent,
    createMockConfig,
    createMockTwitchAuth,
    createMockLogger
};
