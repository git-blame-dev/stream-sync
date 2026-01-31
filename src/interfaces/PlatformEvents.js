
const { logger } = require('../core/logging');
const crypto = require('crypto');
const { getSystemTimestampISO } = require('../utils/timestamp');

const PlatformEvents = {
    // Platform Events
    CHAT_MESSAGE: 'platform:chat-message',
    CHAT_CONNECTED: 'platform:chat-connected', 
    CHAT_DISCONNECTED: 'platform:chat-disconnected',
    FOLLOW: 'platform:follow',
    SHARE: 'platform:share',
    PAYPIGGY: 'platform:paypiggy',
    GIFTPAYPIGGY: 'platform:giftpaypiggy',
    GIFT: 'platform:gift',
    ENVELOPE: 'platform:envelope',
    RAID: 'platform:raid',
    CONNECTION_STATUS: 'platform:connection-status',
    AUTHENTICATION_REQUIRED: 'platform:authentication-required',
    RATE_LIMIT_HIT: 'platform:rate-limit-hit',
    PLATFORM_CONNECTION: 'platform:connection',
    PLATFORM_NOTIFICATION: 'platform:notification',
    VIEWER_COUNT: 'platform:viewer-count',
    STREAM_STATUS: 'platform:stream-status',
    STREAM_DETECTED: 'platform:stream-detected',
    ERROR: 'platform:error',
    HEALTH_CHECK: 'platform:health-check',
    
    // VFX Events
    VFX_COMMAND_RECEIVED: 'vfx:command-received',
    VFX_COMMAND_EXECUTED: 'vfx:command-executed',
    VFX_EFFECT_COMPLETED: 'vfx:effect-completed',
    
    // System Events (8 types)
    SYSTEM_STARTUP: 'system:startup',
    SYSTEM_READY: 'system:ready',
    SYSTEM_SHUTDOWN: 'system:shutdown',
    SYSTEM_ERROR: 'system:error',
    SYSTEM_HEALTH_CHECK: 'system:health-check',
    SYSTEM_PERFORMANCE_WARNING: 'system:performance-warning',
    SYSTEM_MEMORY_WARNING: 'system:memory-warning',
    SYSTEM_DEPENDENCY_RESOLVED: 'system:dependency-resolved',
    
    // Configuration Events (6 types)
    CONFIG_LOADED: 'config:loaded',
    CONFIG_CHANGED: 'config:changed',
    CONFIG_VALIDATED: 'config:validated',
    CONFIG_RELOADED: 'config:reloaded',
    CONFIG_ERROR: 'config:error',
    CONFIG_MIGRATION: 'config:migration',
    
    // Authentication Events (6 types)
    AUTH_TOKEN_REFRESHED: 'auth:token-refreshed',
    AUTH_TOKEN_EXPIRED: 'auth:token-expired',
    AUTH_AUTHENTICATION_FAILED: 'auth:authentication-failed',
    AUTH_AUTHENTICATION_SUCCESS: 'auth:authentication-success',
    AUTH_CREDENTIALS_UPDATED: 'auth:credentials-updated',
    AUTH_HEALTH_CHECK: 'auth:health-check',
    
    // OBS Events (6 types)
    OBS_CONNECTED: 'obs:connected',
    OBS_DISCONNECTED: 'obs:disconnected',
    OBS_SCENE_CHANGED: 'obs:scene-changed',
    OBS_SOURCE_UPDATED: 'obs:source-updated',
    OBS_EFFECT_TRIGGERED: 'obs:effect-triggered',
    OBS_HEALTH_CHECK: 'obs:health-check',
    
    // TTS Events (8 types)
    TTS_SPEECH_REQUESTED: 'tts:speech-requested',
    TTS_SPEECH_QUEUED: 'tts:speech-queued',
    TTS_SPEECH_STARTED: 'tts:speech-started',
    TTS_SPEECH_COMPLETED: 'tts:speech-completed',
    TTS_SPEECH_FAILED: 'tts:speech-failed',
    TTS_VOICE_CHANGED: 'tts:voice-changed',
    TTS_QUEUE_CLEARED: 'tts:queue-cleared',
    TTS_HEALTH_CHECK: 'tts:health-check'
};

const VALID_PLATFORMS = ['twitch', 'youtube', 'tiktok'];

const EVENT_SCHEMAS = {
    'platform:chat-message': {
        required: ['type', 'platform', 'username', 'userId', 'message', 'timestamp'],
        optional: ['metadata'],
        properties: {
            type: { type: 'string', enum: ['platform:chat-message'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            username: { type: 'string' },
            userId: { type: 'string' },
            message: {
                type: 'object',
                required: ['text'],
                properties: {
                    text: { type: 'string' }
                }
            },
            timestamp: { type: 'string' },
            metadata: { type: 'object' }
        }
    },
    'platform:chat-connected': {
        required: ['type', 'platform', 'connectionId', 'timestamp'],
        properties: {
            type: { type: 'string', enum: ['platform:chat-connected'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            connectionId: { type: 'string' },
            timestamp: { type: 'string' }
        }
    },
    'platform:chat-disconnected': {
        required: ['type', 'platform', 'reason', 'willReconnect'],
        properties: {
            type: { type: 'string', enum: ['platform:chat-disconnected'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            reason: { type: 'string' },
            willReconnect: { type: 'boolean' }
        }
    },
    'platform:follow': {
        required: ['type', 'platform', 'username', 'userId', 'timestamp'],
        optional: ['metadata'],
        properties: {
            type: { type: 'string', enum: ['platform:follow'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            username: { type: 'string' },
            userId: { type: 'string' },
            timestamp: { type: 'string' },
            metadata: { type: 'object' }
        }
    },
    'platform:share': {
        required: ['type', 'platform', 'username', 'userId', 'timestamp'],
        optional: ['metadata'],
        properties: {
            type: { type: 'string', enum: ['platform:share'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            username: { type: 'string' },
            userId: { type: 'string' },
            timestamp: { type: 'string' },
            metadata: { type: 'object' }
        }
    },
    'platform:paypiggy': {
        required: ['type', 'platform', 'username', 'userId', 'timestamp'],
        properties: {
            type: { type: 'string', enum: ['platform:paypiggy'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            username: { type: 'string' },
            userId: { type: 'string' },
            tier: { type: 'string' },
            months: { type: 'number' },
            message: { type: 'string' },
            timestamp: { type: 'string' }
        }
    },
    'platform:giftpaypiggy': {
        required: ['type', 'platform', 'username', 'userId', 'giftCount', 'timestamp'],
        properties: {
            type: { type: 'string', enum: ['platform:giftpaypiggy'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            username: { type: 'string' },
            userId: { type: 'string' },
            giftCount: { type: 'number' },
            tier: { type: 'string' },
            isAnonymous: { type: 'boolean' },
            cumulativeTotal: { type: 'number' },
            timestamp: { type: 'string' }
        }
    },
    'platform:gift': {
        required: ['type', 'platform', 'username', 'userId', 'id', 'giftType', 'giftCount', 'amount', 'currency', 'timestamp'],
        optional: ['repeatCount', 'message', 'cheermoteInfo', 'isError', 'isAnonymous', 'isAggregated', 'aggregatedCount', 'enhancedGiftData', 'sourceType'],
        properties: {
            type: { type: 'string', enum: ['platform:gift'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            username: { type: 'string' },
            userId: { type: 'string' },
            id: { type: 'string' },
            giftType: { type: 'string' },
            giftCount: { type: 'number' },
            repeatCount: { type: 'number' },
            amount: { type: 'number' },
            currency: { type: 'string' },
            timestamp: { type: 'string' },
            message: { type: 'string' },
            cheermoteInfo: { type: 'object' },
            isError: { type: 'boolean' },
            isAnonymous: { type: 'boolean' },
            isAggregated: { type: 'boolean' },
            aggregatedCount: { type: 'number' },
            enhancedGiftData: { type: 'object' },
            sourceType: { type: 'string' }
        }
    },
    'platform:envelope': {
        required: ['type', 'platform', 'username', 'userId', 'id', 'giftType', 'giftCount', 'amount', 'currency', 'timestamp'],
        optional: ['repeatCount', 'message', 'isError', 'sourceType'],
        properties: {
            type: { type: 'string', enum: ['platform:envelope'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            username: { type: 'string' },
            userId: { type: 'string' },
            id: { type: 'string' },
            giftType: { type: 'string' },
            giftCount: { type: 'number' },
            repeatCount: { type: 'number' },
            amount: { type: 'number' },
            currency: { type: 'string' },
            timestamp: { type: 'string' },
            message: { type: 'string' },
            isError: { type: 'boolean' },
            sourceType: { type: 'string' }
        }
    },
    'platform:raid': {
        required: ['type', 'platform', 'username', 'userId', 'viewerCount', 'timestamp'],
        optional: ['metadata'],
        properties: {
            type: { type: 'string', enum: ['platform:raid'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            username: { type: 'string' },
            userId: { type: 'string' },
            viewerCount: { type: 'number' },
            timestamp: { type: 'string' },
            metadata: { type: 'object' }
        }
    },
    'platform:connection-status': {
        required: ['type', 'platform', 'status', 'latency', 'error'],
        properties: {
            type: { type: 'string', enum: ['platform:connection-status'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            status: { type: 'string' },
            latency: { type: 'number' },
            error: { type: ['object', 'null'] }
        }
    },
    'platform:authentication-required': {
        required: ['type', 'platform', 'tokenType', 'reason'],
        properties: {
            type: { type: 'string', enum: ['platform:authentication-required'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            tokenType: { type: 'string' },
            reason: { type: 'string' }
        }
    },
    'platform:rate-limit-hit': {
        required: ['type', 'platform', 'endpoint', 'retryAfter'],
        properties: {
            type: { type: 'string', enum: ['platform:rate-limit-hit'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            endpoint: { type: 'string' },
            retryAfter: { type: 'number' }
        }
    },
    'platform:connection': {
        required: ['type', 'platform', 'status', 'timestamp'],
        optional: ['error', 'willReconnect', 'correlationId', 'id'],
        properties: {
            type: { type: 'string', enum: ['platform:connection'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            status: { type: 'string' },
            timestamp: { type: 'string' },
            correlationId: { type: 'string' },
            id: { type: 'string' },
            error: { type: ['object', 'null'] },
            willReconnect: { type: 'boolean' }
        }
    },
    'platform:notification': {
        required: ['type', 'platform', 'notificationType', 'timestamp', 'data'],
        optional: ['priority', 'username', 'userId', 'correlationId', 'id'],
        properties: {
            type: { type: 'string', enum: ['platform:notification'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            notificationType: { type: 'string' },
            timestamp: { type: 'string' },
            priority: { type: 'number' },
            data: { type: 'object' },
            username: { type: 'string' },
            userId: { type: 'string' },
            correlationId: { type: 'string' },
            id: { type: 'string' }
        }
    },
    'platform:viewer-count': {
        required: ['type', 'platform', 'count', 'timestamp'],
        properties: {
            type: { type: 'string', enum: ['platform:viewer-count'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            count: { type: 'number' },
            timestamp: { type: 'string' }
        }
    },
    'platform:stream-status': {
        required: ['type', 'platform', 'isLive', 'timestamp'],
        optional: ['status', 'message', 'title', 'category'],
        properties: {
            type: { type: 'string', enum: ['platform:stream-status'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            isLive: { type: 'boolean' },
            timestamp: { type: 'string' },
            status: { type: 'string' },
            message: { type: 'string' },
            title: { type: 'string' },
            category: { type: 'string' }
        }
    },
    'platform:stream-detected': {
        required: ['type', 'platform', 'eventType', 'newStreamIds', 'allStreamIds', 'detectionTime', 'connectionCount'],
        properties: {
            type: { type: 'string', enum: ['platform:stream-detected'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            eventType: { type: 'string', enum: ['stream-detected', 'stream-ended'] },
            newStreamIds: { type: 'array' },
            allStreamIds: { type: 'array' },
            detectionTime: { type: 'number' },
            connectionCount: { type: 'number' },
            endedStreamIds: { type: 'array' }
        }
    },
    'platform:error': {
        required: ['type', 'platform', 'error', 'context', 'recoverable'],
        properties: {
            type: { type: 'string', enum: ['platform:error'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            error: { type: 'object' },
            context: { type: 'object' },
            recoverable: { type: 'boolean' }
        }
    },
    'platform:health-check': {
        required: ['type', 'platform', 'healthy', 'metrics'],
        properties: {
            type: { type: 'string', enum: ['platform:health-check'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            healthy: { type: 'boolean' },
            metrics: { type: 'object' }
        }
    },
    // VFX Events
    'vfx:command-received': {
        required: ['type', 'command', 'username', 'platform', 'args', 'timestamp'],
        optional: ['userId'],
        properties: {
            type: { type: 'string', enum: ['vfx:command-received'] },
            command: { type: 'string' },
            username: { type: 'string' },
            userId: { type: 'string' },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            args: { type: 'array' },
            timestamp: { type: 'string' }
        }
    },
    'vfx:command-executed': {
        required: ['type', 'command', 'result', 'duration', 'effects'],
        properties: {
            type: { type: 'string', enum: ['vfx:command-executed'] },
            command: { type: 'string' },
            result: { type: 'object' },
            duration: { type: 'number' },
            effects: { type: 'array' }
        }
    },
    'vfx:effect-completed': {
        required: ['type', 'effectId', 'success', 'duration'],
        properties: {
            type: { type: 'string', enum: ['vfx:effect-completed'] },
            effectId: { type: 'string' },
            success: { type: 'boolean' },
            duration: { type: 'number' }
        }
    }
};

class PlatformEventValidator {
    constructor() {
        this.schemas = EVENT_SCHEMAS;
    }
    
    validate(event) {
        if (!event) {
            return {
                valid: false,
                errors: ['Event is null or undefined']
            };
        }
        
        const errors = [];
        
        // Check if event type is supported
        if (!event.type || !this.schemas[event.type]) {
            errors.push(`Invalid event type: ${event.type}`);
        }
        
        // Validate platform field specifically - check even for invalid event types
        if (event.platform && !VALID_PLATFORMS.includes(event.platform)) {
            errors.push(`Invalid platform: ${event.platform}. Must be one of: ${VALID_PLATFORMS.join(', ')}`);
        }
        
        // If event type is invalid, return early but include platform validation error
        if (!event.type || !this.schemas[event.type]) {
            return { valid: false, errors };
        }
        
        const schema = this.schemas[event.type];
        
        // Check required fields
        if (schema.required) {
            const isAnonymousGift = (event.type === PlatformEvents.GIFT || event.type === PlatformEvents.GIFTPAYPIGGY)
                && event.isAnonymous === true;
            const requiredFields = isAnonymousGift
                ? schema.required.filter((field) => field !== 'username' && field !== 'userId')
                : schema.required;
            for (const field of requiredFields) {
                const fieldSchema = schema.properties?.[field];
                const fieldTypes = fieldSchema ? (Array.isArray(fieldSchema.type) ? fieldSchema.type : [fieldSchema.type]) : [];
                const allowsNull = fieldTypes.includes('null');
                if (event[field] === undefined || (event[field] === null && !allowsNull)) {
                    errors.push(`Missing required field: ${field}`);
                }
            }
        }
        
        // Validate field types
        if (schema.properties) {
            for (const [fieldName, fieldSchema] of Object.entries(schema.properties)) {
                if (fieldName in event) {
                    const value = event[fieldName];
                    if (!this._validateFieldType(value, fieldSchema, fieldName)) {
                        errors.push(`Invalid type for field ${fieldName}`);
                    }
                }
            }

            const allowedFields = new Set(Object.keys(schema.properties));
            allowedFields.add('id');
            allowedFields.add('correlationId');
            for (const fieldName of Object.keys(event)) {
                if (!allowedFields.has(fieldName)) {
                    errors.push(`Unexpected field: ${fieldName}`);
                }
            }
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }
    
    getSupportedEventTypes() {
        return Object.keys(this.schemas);
    }
    
    getEventSchema(eventType) {
        return this.schemas[eventType] || null;
    }
    
    _validateFieldType(value, schema, fieldName) {
        // Handle enum validation
        if (schema.enum && !schema.enum.includes(value)) {
            return false;
        }
        
        // Handle type validation
        if (schema.type) {
            const types = Array.isArray(schema.type) ? schema.type : [schema.type];
            const valueType = value === null ? 'null' : typeof value;
            const isArray = Array.isArray(value);
            
            let typeMatch = false;
            for (const type of types) {
                if (type === 'array' && isArray) {
                    typeMatch = true;
                    break;
                } else if (type === 'null' && value === null) {
                    typeMatch = true;
                    break;
                } else if (type === valueType && !isArray) {
                    typeMatch = true;
                    break;
                }
            }
            
            if (!typeMatch) {
                return false;
            }
        }
        
        if (schema.type === 'string' && typeof value === 'string') {
            if ((fieldName === 'username' || fieldName === 'userId') && !value.trim()) {
                return false;
            }
            if (fieldName === 'timestamp' && Number.isNaN(Date.parse(value))) {
                return false;
            }
        }

        if (schema.type === 'number' && typeof value === 'number') {
            if (!Number.isFinite(value)) {
                return false;
            }
        }

        // Handle object validation with required fields
        if (schema.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
            if (schema.required) {
                for (const requiredField of schema.required) {
                    if (value[requiredField] === undefined || value[requiredField] === null) {
                        return false;
                    }
                }
            }

            if (schema.properties) {
                for (const [childName, childSchema] of Object.entries(schema.properties)) {
                    if (childName in value) {
                        if (!this._validateFieldType(value[childName], childSchema, childName)) {
                            return false;
                        }
                    }
                }
            }
        }
        
        return true;
    }
}

class PlatformEventBuilder {
    constructor() {
        this.validator = new PlatformEventValidator();
    }
    
    createChatMessage(params) {
        this._validateRequiredParams(params, ['platform', 'username', 'userId', 'message', 'timestamp']);
        if (typeof params.message !== 'string') {
            throw new Error('Chat message text must be a string');
        }
        
        const result = {
            type: 'platform:chat-message',
            platform: params.platform,
            username: params.username,
            userId: params.userId,
            message: {
                text: params.message
            },
            timestamp: params.timestamp
        };
        if (params.metadata !== undefined) {
            result.metadata = params.metadata;
        }

        const validation = this.validator.validate(result);
        if (!validation.valid) {
            throw new Error(`Invalid event: ${validation.errors.join(', ')}`);
        }

        return result;
    }
    
    createGift(params) {
        this._validateRequiredParams(params, ['platform', 'username', 'userId', 'id', 'giftType', 'giftCount', 'amount', 'currency', 'timestamp']);
        
        const result = {
            type: 'platform:gift',
            platform: params.platform,
            username: params.username,
            userId: params.userId,
            id: params.id,
            giftType: params.giftType,
            giftCount: params.giftCount,
            amount: params.amount,
            currency: params.currency,
            timestamp: params.timestamp
        };
        if (params.repeatCount !== undefined) {
            result.repeatCount = params.repeatCount;
        }

        const validation = this.validator.validate(result);
        if (!validation.valid) {
            throw new Error(`Invalid event: ${validation.errors.join(', ')}`);
        }

        return result;
    }
    
    createFollow(params) {
        this._validateRequiredParams(params, ['platform', 'username', 'userId', 'timestamp']);
        
        const result = {
            type: 'platform:follow',
            platform: params.platform,
            username: params.username,
            userId: params.userId,
            timestamp: params.timestamp
        };
        if (params.metadata !== undefined) {
            result.metadata = params.metadata;
        }

        const validation = this.validator.validate(result);
        if (!validation.valid) {
            throw new Error(`Invalid event: ${validation.errors.join(', ')}`);
        }

        return result;
    }
    
    normalizeMessage(platform, data) {
        if (!data || typeof data !== 'object') {
            throw new Error('Message payload must be an object');
        }

        if (!data.username || typeof data.username !== 'string') {
            throw new Error('Missing required username for message');
        }

        if (!data.userId || typeof data.userId !== 'string') {
            throw new Error('Missing required userId for message');
        }

        if (!data.message || typeof data.message !== 'object') {
            throw new Error('Missing required message payload');
        }

        if (!data.message.text || typeof data.message.text !== 'string') {
            throw new Error('Missing required message text');
        }

        if (data.timestamp === undefined || data.timestamp === null) {
            throw new Error('Missing required message timestamp');
        }

        let timestamp = new Date();
        if (typeof data.timestamp === 'number') {
            timestamp = new Date(data.timestamp);
        } else if (typeof data.timestamp === 'string') {
            const numericTimestamp = Number(data.timestamp);
            timestamp = Number.isFinite(numericTimestamp)
                ? new Date(numericTimestamp)
                : new Date(data.timestamp);
        }

        if (Number.isNaN(timestamp.getTime())) {
            throw new Error('Invalid timestamp for message');
        }

        const normalizedMessage = {
            type: 'platform:chat-message',
            platform,
            username: data.username,
            userId: data.userId,
            message: {
                text: data.message.text
            },
            timestamp: timestamp.toISOString()
        };

        if (data.metadata !== undefined) {
            normalizedMessage.metadata = data.metadata;
        }

        return normalizedMessage;
    }
    
    normalizeGift(platform, data) {
        if (!data || typeof data !== 'object') {
            throw new Error('Gift payload must be an object');
        }

        if (!data.username || typeof data.username !== 'string') {
            throw new Error('Missing required username for gift');
        }

        if (!data.userId || typeof data.userId !== 'string') {
            throw new Error('Missing required userId for gift');
        }

        if (!data.giftType || typeof data.giftType !== 'string') {
            throw new Error('Missing required gift type');
        }

        if (!data.id || typeof data.id !== 'string') {
            throw new Error('Missing required gift id');
        }

        if (typeof data.giftCount !== 'number') {
            throw new Error('Missing required gift count');
        }

        if (typeof data.amount !== 'number') {
            throw new Error('Missing required gift amount');
        }

        if (!data.currency || typeof data.currency !== 'string') {
            throw new Error('Missing required gift currency');
        }

        if (data.timestamp === undefined || data.timestamp === null) {
            throw new Error('Missing required gift timestamp');
        }

        return {
            type: 'platform:gift',
            platform,
            username: data.username,
            userId: data.userId,
            id: data.id,
            giftType: data.giftType,
            giftCount: data.giftCount,
            amount: data.amount,
            currency: data.currency,
            timestamp: data.timestamp
        };
    }
    
    normalizeFollow(platform, data) {
        if (!data || typeof data !== 'object') {
            throw new Error('Follow payload must be an object');
        }

        if (!data.username || typeof data.username !== 'string') {
            throw new Error('Missing required username for follow');
        }

        if (!data.userId || typeof data.userId !== 'string') {
            throw new Error('Missing required userId for follow');
        }

        if (data.timestamp === undefined || data.timestamp === null) {
            throw new Error('Missing required follow timestamp');
        }

        const timestamp = new Date(data.timestamp);
        if (Number.isNaN(timestamp.getTime())) {
            throw new Error('Invalid follow timestamp');
        }

        return {
            type: 'platform:follow',
            platform,
            username: data.username,
            userId: data.userId,
            timestamp: timestamp.toISOString(),
            metadata: {}
        };
    }
    
    _validateRequiredParams(params, requiredFields) {
        if (!params || typeof params !== 'object') {
            throw new Error('Parameters must be an object');
        }
        
        for (const field of requiredFields) {
            if (!(field in params)) {
                throw new Error(`Missing required parameter: ${field}`);
            }
        }
    }
}

class EnhancedPlatformEvents {
    static VALID_PLATFORMS = VALID_PLATFORMS;
    static EVENT_TYPES = PlatformEvents;
    static NOTIFICATION_TYPES = {
        GIFT: 'platform:gift',
        GIFTPAYPIGGY: 'platform:giftpaypiggy',
        FOLLOW: 'platform:follow',
        PAYPIGGY: 'platform:paypiggy',
        RAID: 'platform:raid'
    };

    static _generateId() {
        return crypto.randomUUID();
    }

    static _generateCorrelationId() {
        return crypto.randomUUID();
    }

    static _sanitizeText(text) {
        if (typeof text !== 'string') return '';
        
        return text
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/javascript:/gi, '')
            .replace(/on\w+\s*=/gi, '')
            .replace(/\$\{[^}]*\}/g, '')
            .replace(/\{\{[^}]*\}\}/g, '')
            .trim();
    }

    static _validatePlatform(platform) {
        if (!VALID_PLATFORMS.includes(platform)) {
            throw new Error(`Invalid platform: ${platform}. Valid platforms: ${VALID_PLATFORMS.join(', ')}`);
        }
        return platform;
    }

    static createChatMessageEvent(platform, identity, message, metadata = {}) {
        const normalizedIdentity = this.normalizeIdentity(platform, identity);
        const timestamp = getSystemTimestampISO();
        return {
            id: this._generateId(),
            type: 'platform:chat-message',
            platform: this._validatePlatform(platform),
            correlationId: this._generateCorrelationId(),
            timestamp,
            username: normalizedIdentity.username,
            userId: normalizedIdentity.userId,
            message: {
                text: this._sanitizeText(message)
            },
            metadata: metadata || {}
        };
    }

    static createNotificationEvent(platform, notificationType, data) {
        return {
            id: this._generateId(),
            type: 'platform:notification',
            platform: this._validatePlatform(platform),
            notificationType: notificationType,
            correlationId: this._generateCorrelationId(),
            timestamp: getSystemTimestampISO(),
            priority: this._calculatePriority(notificationType),
            data: data || {},
            username: data?.username || null,
            userId: data?.userId || null
        };
    }

    static createConnectionEvent(platform, status, error = null) {
        return {
            id: this._generateId(),
            type: 'platform:connection',
            platform: this._validatePlatform(platform),
            status: status,
            correlationId: this._generateCorrelationId(),
            timestamp: getSystemTimestampISO(),
            error: error,
            willReconnect: status === 'disconnected'
        };
    }

    static createErrorEvent(platform, error, context = {}) {
        return {
            id: this._generateId(),
            type: 'platform:error',
            platform: this._validatePlatform(platform),
            correlationId: this._generateCorrelationId(),
            timestamp: getSystemTimestampISO(),
            error: {
                message: error.message || 'Unknown error',
                code: error.code || 'UNKNOWN',
                stack: error.stack || '',
                name: error.name || 'Error'
            },
            context: context || {},
            recoverable: this._isRecoverableError(error, context)
        };
    }

    static normalizeIdentity(platform, rawIdentity) {
        if (!rawIdentity || typeof rawIdentity !== 'object') {
            throw new Error('Identity payload must be an object');
        }

        const platformName = this._validatePlatform(platform);
        const username = rawIdentity.username;
        const userId = rawIdentity.userId;

        if (!username || typeof username !== 'string') {
            throw new Error('Missing required username for identity');
        }

        if (!userId || typeof userId !== 'string') {
            throw new Error('Missing required userId for identity');
        }

        return {
            platform: platformName,
            original: rawIdentity,
            userId,
            username
        };
    }

    static normalizeMessage(platform, rawMessage) {
        if (!rawMessage || typeof rawMessage !== 'object') {
            throw new Error('Message payload must be an object');
        }

        if (!rawMessage.message || typeof rawMessage.message !== 'object') {
            throw new Error('Missing required message payload');
        }

        const text = rawMessage.message.text;
        if (!text || typeof text !== 'string') {
            throw new Error('Missing required message text');
        }

        const normalizedIdentity = this.normalizeIdentity(platform, rawMessage);

        if (rawMessage.timestamp === undefined || rawMessage.timestamp === null) {
            throw new Error('Missing required message timestamp');
        }

        let timestamp = new Date();
        if (typeof rawMessage.timestamp === 'number') {
            timestamp = new Date(rawMessage.timestamp);
        } else if (typeof rawMessage.timestamp === 'string') {
            const numericTimestamp = Number(rawMessage.timestamp);
            timestamp = Number.isFinite(numericTimestamp)
                ? new Date(numericTimestamp)
                : new Date(rawMessage.timestamp);
        }

        if (Number.isNaN(timestamp.getTime())) {
            throw new Error('Invalid message timestamp');
        }

        const normalizedMessage = {
            text: String(text).trim(),
            platform: this._validatePlatform(platform),
            timestamp: timestamp.toISOString(),
            username: normalizedIdentity.username,
            userId: normalizedIdentity.userId
        };

        if (rawMessage.emotes !== undefined) {
            normalizedMessage.emotes = rawMessage.emotes;
        }

        if (rawMessage.metadata !== undefined) {
            normalizedMessage.metadata = rawMessage.metadata;
        }

        return normalizedMessage;
    }

    static normalizeGift(platform, rawGift) {
        if (!rawGift || typeof rawGift !== 'object') {
            throw new Error('Gift payload must be an object');
        }

        const normalizedIdentity = this.normalizeIdentity(platform, rawGift);

        if (!rawGift.type || typeof rawGift.type !== 'string') {
            throw new Error('Missing required gift type');
        }

        if (!rawGift.giftType || typeof rawGift.giftType !== 'string') {
            throw new Error('Missing required gift type');
        }

        if (!rawGift.id || typeof rawGift.id !== 'string') {
            throw new Error('Missing required gift id');
        }

        if (typeof rawGift.giftCount !== 'number') {
            throw new Error('Missing required gift count');
        }

        if (typeof rawGift.amount !== 'number') {
            throw new Error('Missing required gift amount');
        }

        if (!rawGift.currency || typeof rawGift.currency !== 'string') {
            throw new Error('Missing required gift currency');
        }

        const normalizedGift = {
            platform: this._validatePlatform(platform),
            original: rawGift,
            id: rawGift.id,
            giftType: rawGift.giftType,
            giftCount: rawGift.giftCount,
            amount: rawGift.amount,
            currency: rawGift.currency,
            username: normalizedIdentity.username,
            userId: normalizedIdentity.userId
        };

        if (rawGift.message !== undefined) {
            normalizedGift.message = rawGift.message;
        }

        return normalizedGift;
    }

    static validateChatMessageEvent(event) {
        return !!(event &&
               event.type === 'platform:chat-message' &&
               VALID_PLATFORMS.includes(event.platform) &&
               event.username &&
               event.userId &&
               event.message && typeof event.message.text === 'string' &&
               event.timestamp);
    }

    static validateNotificationEvent(event) {
        if (!event || event.type !== 'platform:notification') {
            return false;
        }

        if (!VALID_PLATFORMS.includes(event.platform)) {
            return false;
        }

        if (!Object.values(this.NOTIFICATION_TYPES).includes(event.notificationType)) {
            return false;
        }

        if (!event.data || typeof event.data !== 'object') {
            return false;
        }

        if (typeof event.priority !== 'number' || !Number.isFinite(event.priority)) {
            return false;
        }

        const isAnonymousGift = event.data?.isAnonymous === true &&
            (event.notificationType === PlatformEvents.GIFT || event.notificationType === PlatformEvents.GIFTPAYPIGGY);
        const hasValidUsername = typeof event.username === 'string' && event.username.trim();
        const hasValidUserId = typeof event.userId === 'string' && event.userId.trim();

        if (!isAnonymousGift) {
            if (!hasValidUsername) {
                return false;
            }
            if (!hasValidUserId) {
                return false;
            }
            return true;
        }

        if ((event.username !== undefined && event.username !== null && !hasValidUsername) ||
            (event.userId !== undefined && event.userId !== null && !hasValidUserId)) {
            return false;
        }

        return true;
    }

    static validateConnectionEvent(event) {
        return !!(event &&
               event.type === 'platform:connection' &&
               VALID_PLATFORMS.includes(event.platform) &&
               typeof event.status === 'string');
    }

    static validateErrorEvent(event) {
        return !!(event &&
               event.type === 'platform:error' &&
               VALID_PLATFORMS.includes(event.platform) &&
               event.error &&
               typeof event.error === 'object' &&
               typeof event.error.message === 'string');
    }

    static validateStreamDetectedEvent(event) {
        if (!event || event.type !== PlatformEvents.STREAM_DETECTED) {
            return false;
        }

        if (!VALID_PLATFORMS.includes(event.platform)) {
            return false;
        }

        if (!event.eventType || !['stream-detected', 'stream-ended'].includes(event.eventType)) {
            return false;
        }

        if (!Array.isArray(event.allStreamIds) || !Array.isArray(event.newStreamIds)) {
            return false;
        }

        if (typeof event.connectionCount !== 'number' || typeof event.detectionTime !== 'number') {
            return false;
        }

        if (event.eventType === 'stream-detected' && event.newStreamIds.length === 0) {
            return false;
        }

        if (event.eventType === 'stream-ended') {
            if (!Array.isArray(event.endedStreamIds) || event.endedStreamIds.length === 0) {
                return false;
            }
        } else if (event.endedStreamIds && !Array.isArray(event.endedStreamIds)) {
            return false;
        }

        return true;
    }

    static validateEvent(event) {
        if (!event || typeof event !== 'object') return false;

        const validator = new PlatformEventValidator();

        switch (event.type) {
            case 'platform:chat-message':
                return this.validateChatMessageEvent(event);
            case 'platform:notification':
                return this.validateNotificationEvent(event);
            case 'platform:connection':
                return this.validateConnectionEvent(event);
            case 'platform:error':
                return this.validateErrorEvent(event);
            case 'platform:gift':
            case 'platform:giftpaypiggy':
            case 'platform:paypiggy':
            case 'platform:raid':
            case 'platform:viewer-count':
            case 'platform:envelope':
            case 'platform:follow':
            case 'platform:share':
                return validator.validate(event).valid;
            case PlatformEvents.STREAM_DETECTED:
                return this.validateStreamDetectedEvent(event);
            default:
                return false;
        }
    }

    static builder() {
        return new EventBuilder();
    }

    static _calculatePriority(notificationType) {
        const priorities = {
            [this.NOTIFICATION_TYPES.GIFT]: 8,
            [this.NOTIFICATION_TYPES.RAID]: 6,
            [this.NOTIFICATION_TYPES.PAYPIGGY]: 5,
            [this.NOTIFICATION_TYPES.FOLLOW]: 2
        };
        return priorities[notificationType] || 1;
    }

    static _isRecoverableError(error, context) {
        const recoverablePatterns = [
            /network/i,
            /connection/i,
            /timeout/i,
            /rate limit/i,
            /temporary/i
        ];

        const errorString = (error.message || '').toLowerCase();
        return recoverablePatterns.some(pattern => pattern.test(errorString));
    }
}

class EventBuilder {
    constructor() {
        this._event = {
            id: EnhancedPlatformEvents._generateId(),
            correlationId: EnhancedPlatformEvents._generateCorrelationId(),
            timestamp: getSystemTimestampISO()
        };
    }

    platform(platform) {
        this._event.platform = platform;
        return this;
    }

    type(eventType) {
        if (eventType && !eventType.includes(':')) {
            eventType = `platform:${eventType}`;
        }
        this._event.type = eventType;
        return this;
    }

    username(username) {
        this._event.username = username;
        return this;
    }

    userId(userId) {
        this._event.userId = userId;
        return this;
    }

    message(text) {
        this._event.message = {
            text: EnhancedPlatformEvents._sanitizeText(text),
            original: text
        };
        return this;
    }

    metadata(metadata) {
        this._event.metadata = metadata;
        return this;
    }

    priority(priority) {
        this._event.priority = priority;
        return this;
    }

    data(data) {
        this._event.data = data;
        return this;
    }

    build() {
        if (!this._event.platform || !VALID_PLATFORMS.includes(this._event.platform)) {
            throw new Error(`Invalid platform: ${this._event.platform}`);
        }
        
        if (!this._event.type || !Object.values(PlatformEvents).includes(this._event.type)) {
            throw new Error(`Invalid event type: ${this._event.type}`);
        }

        const validator = new PlatformEventValidator();
        const result = validator.validate(this._event);
        if (!result.valid) {
            throw new Error(`Invalid event: ${result.errors.join(', ')}`);
        }

        return { ...this._event };
    }
}

// Create combined PlatformEvents object with both constants and methods
const CombinedPlatformEvents = Object.assign({}, PlatformEvents, {
    // Add all static methods from EnhancedPlatformEvents, bound to the class
    VALID_PLATFORMS: EnhancedPlatformEvents.VALID_PLATFORMS,
    EVENT_TYPES: EnhancedPlatformEvents.EVENT_TYPES,
    NOTIFICATION_TYPES: EnhancedPlatformEvents.NOTIFICATION_TYPES,
    createChatMessageEvent: EnhancedPlatformEvents.createChatMessageEvent.bind(EnhancedPlatformEvents),
    createNotificationEvent: EnhancedPlatformEvents.createNotificationEvent.bind(EnhancedPlatformEvents),
    createConnectionEvent: EnhancedPlatformEvents.createConnectionEvent.bind(EnhancedPlatformEvents),
    createErrorEvent: EnhancedPlatformEvents.createErrorEvent.bind(EnhancedPlatformEvents),
    normalizeIdentity: EnhancedPlatformEvents.normalizeIdentity.bind(EnhancedPlatformEvents),
    normalizeMessage: EnhancedPlatformEvents.normalizeMessage.bind(EnhancedPlatformEvents),
    normalizeGift: EnhancedPlatformEvents.normalizeGift.bind(EnhancedPlatformEvents),
    validateChatMessageEvent: EnhancedPlatformEvents.validateChatMessageEvent.bind(EnhancedPlatformEvents),
    validateNotificationEvent: EnhancedPlatformEvents.validateNotificationEvent.bind(EnhancedPlatformEvents),
    validateConnectionEvent: EnhancedPlatformEvents.validateConnectionEvent.bind(EnhancedPlatformEvents),
    validateErrorEvent: EnhancedPlatformEvents.validateErrorEvent.bind(EnhancedPlatformEvents),
    validateStreamDetectedEvent: EnhancedPlatformEvents.validateStreamDetectedEvent.bind(EnhancedPlatformEvents),
    validateEvent: EnhancedPlatformEvents.validateEvent.bind(EnhancedPlatformEvents),
    builder: EnhancedPlatformEvents.builder.bind(EnhancedPlatformEvents),
    _generateCorrelationId: EnhancedPlatformEvents._generateCorrelationId.bind(EnhancedPlatformEvents)
});

// Export the classes and constants
module.exports = {
    PlatformEvents: CombinedPlatformEvents,
    EnhancedPlatformEvents,
    PlatformEventValidator,
    PlatformEventBuilder,
    VALID_PLATFORMS,
    EVENT_SCHEMAS
};
