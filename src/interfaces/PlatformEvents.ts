import crypto from 'node:crypto';
import { DEFAULT_AVATAR_URL } from '../constants/avatar';
import { allowsYouTubeJewelsMissingUserId } from '../utils/missing-fields';
import { getSystemTimestampISO, parseTimestampISO } from '../utils/timestamp';

const PlatformEvents = {
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
    
    VFX_COMMAND_RECEIVED: 'vfx:command-received',
    VFX_COMMAND_EXECUTED: 'vfx:command-executed',
    VFX_EFFECT_COMPLETED: 'vfx:effect-completed',
    
    SYSTEM_STARTUP: 'system:startup',
    SYSTEM_READY: 'system:ready',
    SYSTEM_SHUTDOWN: 'system:shutdown',
    SYSTEM_ERROR: 'system:error',
    SYSTEM_HEALTH_CHECK: 'system:health-check',
    SYSTEM_PERFORMANCE_WARNING: 'system:performance-warning',
    SYSTEM_MEMORY_WARNING: 'system:memory-warning',
    SYSTEM_DEPENDENCY_RESOLVED: 'system:dependency-resolved',
    
    CONFIG_LOADED: 'config:loaded',
    CONFIG_CHANGED: 'config:changed',
    CONFIG_VALIDATED: 'config:validated',
    CONFIG_RELOADED: 'config:reloaded',
    CONFIG_ERROR: 'config:error',
    CONFIG_MIGRATION: 'config:migration',
    
    AUTH_TOKEN_REFRESHED: 'auth:token-refreshed',
    AUTH_TOKEN_EXPIRED: 'auth:token-expired',
    AUTH_AUTHENTICATION_FAILED: 'auth:authentication-failed',
    AUTH_AUTHENTICATION_SUCCESS: 'auth:authentication-success',
    AUTH_CREDENTIALS_UPDATED: 'auth:credentials-updated',
    AUTH_HEALTH_CHECK: 'auth:health-check',
    
    // OBS runtime events are emitted through service-specific channels, not PlatformEvents.
};

const VALID_PLATFORMS = ['twitch', 'youtube', 'tiktok'];

type PlatformName = (typeof VALID_PLATFORMS)[number];

interface EventFieldSchema {
    type?: string | string[];
    enum?: readonly unknown[];
    required?: readonly string[];
    properties?: Record<string, EventFieldSchema>;
}

interface EventSchema {
    required?: readonly string[];
    optional?: readonly string[];
    properties?: Record<string, EventFieldSchema>;
}

type EventSchemas = Record<string, EventSchema>;

interface ValidationResult {
    valid: boolean;
    errors: string[];
}

interface ChatMessageEventRecord extends Record<string, unknown> {
    type: string;
    platform: unknown;
    username: unknown;
    userId: unknown;
    avatarUrl: string;
    message: { text: string };
    timestamp: unknown;
    metadata?: unknown;
}

interface GiftEventRecord extends Record<string, unknown> {
    type: string;
    platform: unknown;
    username: unknown;
    userId: unknown;
    avatarUrl: string;
    id: unknown;
    giftType: unknown;
    giftCount: unknown;
    amount: unknown;
    currency: unknown;
    timestamp: unknown;
    repeatCount?: unknown;
    giftImageUrl?: string;
}

interface FollowEventRecord extends Record<string, unknown> {
    type: string;
    platform: unknown;
    username: unknown;
    userId: unknown;
    avatarUrl: string;
    timestamp: unknown;
    metadata?: unknown;
}

interface NormalizedMessageRecord extends Record<string, unknown> {
    type: string;
    platform: string;
    username: string;
    userId: string;
    avatarUrl: string;
    message: { text: string };
    timestamp: string;
    metadata?: unknown;
}

interface EnhancedNormalizedMessage extends Record<string, unknown> {
    text: string;
    platform: string;
    timestamp: string;
    username: string;
    userId: string;
    avatarUrl: string;
    emotes?: unknown;
    metadata?: unknown;
}

interface EventBuilderRecord extends Record<string, unknown> {
    id: string;
    correlationId: string;
    timestamp: string;
    platform?: string;
    type?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPlatformName(value: unknown): value is PlatformName {
    return typeof value === 'string' && VALID_PLATFORMS.includes(value);
}

function resolveAvatarUrl(avatarUrl: unknown): string {
    const normalizedAvatarUrl = typeof avatarUrl === 'string' ? avatarUrl.trim() : '';
    return normalizedAvatarUrl || DEFAULT_AVATAR_URL;
}

function requireTimestampISO(value: unknown, errorMessage: string): string {
    const timestamp = parseTimestampISO(value, {
        allowDateString: true,
        allowDateObject: true
    });
    if (timestamp === null) {
        throw new Error(errorMessage);
    }
    return timestamp;
}

const EVENT_SCHEMAS = {
    'platform:chat-message': {
        required: ['type', 'platform', 'username', 'message', 'avatarUrl'],
        optional: ['userId', 'timestamp', 'isMod', 'isPaypiggy', 'isBroadcaster', 'metadata'],
        properties: {
            type: { type: 'string', enum: ['platform:chat-message'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            username: { type: 'string' },
            userId: { type: 'string' },
            avatarUrl: { type: 'string' },
            message: {
                type: 'object',
                required: ['text'],
                properties: {
                    text: { type: 'string' }
                }
            },
            isMod: { type: 'boolean' },
            isPaypiggy: { type: 'boolean' },
            isBroadcaster: { type: 'boolean' },
            timestamp: { type: 'string' },
            metadata: { type: 'object' }
        }
    },
    'platform:chat-connected': {
        required: ['type', 'platform', 'connectionId', 'timestamp'],
        optional: ['metadata'],
        properties: {
            type: { type: 'string', enum: ['platform:chat-connected'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            connectionId: { type: 'string' },
            timestamp: { type: 'string' },
            metadata: { type: 'object' }
        }
    },
    'platform:chat-disconnected': {
        required: ['type', 'platform', 'reason', 'willReconnect'],
        optional: ['timestamp', 'metadata'],
        properties: {
            type: { type: 'string', enum: ['platform:chat-disconnected'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            reason: { type: 'string' },
            willReconnect: { type: 'boolean' },
            timestamp: { type: 'string' },
            metadata: { type: 'object' }
        }
    },
    'platform:follow': {
        required: ['type', 'platform', 'username', 'userId', 'timestamp'],
        optional: ['avatarUrl', 'metadata', 'source', 'sourceType'],
        properties: {
            type: { type: 'string', enum: ['platform:follow'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            username: { type: 'string' },
            userId: { type: 'string' },
            avatarUrl: { type: 'string' },
            timestamp: { type: 'string' },
            metadata: { type: 'object' },
            source: { type: 'string' },
            sourceType: { type: 'string' }
        }
    },
    'platform:share': {
        required: ['type', 'platform', 'username', 'userId', 'timestamp'],
        optional: ['avatarUrl', 'metadata'],
        properties: {
            type: { type: 'string', enum: ['platform:share'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            username: { type: 'string' },
            userId: { type: 'string' },
            avatarUrl: { type: 'string' },
            timestamp: { type: 'string' },
            metadata: { type: 'object' }
        }
    },
    'platform:paypiggy': {
        required: ['type', 'platform', 'username', 'userId', 'timestamp'],
        optional: ['avatarUrl', 'tier', 'months', 'message', 'isRenewal', 'isError', 'eventType', 'metadata'],
        properties: {
            type: { type: 'string', enum: ['platform:paypiggy'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            username: { type: 'string' },
            userId: { type: 'string' },
            avatarUrl: { type: 'string' },
            tier: { type: 'string' },
            months: { type: 'number' },
            message: { type: 'string' },
            isRenewal: { type: 'boolean' },
            timestamp: { type: 'string' },
            isError: { type: 'boolean' },
            eventType: { type: 'string' },
            metadata: { type: 'object' }
        }
    },
    'platform:giftpaypiggy': {
        required: ['type', 'platform', 'giftCount', 'timestamp'],
        optional: ['username', 'userId', 'avatarUrl', 'tier', 'isAnonymous', 'cumulativeTotal', 'isError', 'eventType', 'metadata'],
        properties: {
            type: { type: 'string', enum: ['platform:giftpaypiggy'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            username: { type: 'string' },
            userId: { type: 'string' },
            avatarUrl: { type: 'string' },
            giftCount: { type: 'number' },
            tier: { type: 'string' },
            isAnonymous: { type: 'boolean' },
            cumulativeTotal: { type: 'number' },
            timestamp: { type: 'string' },
            isError: { type: 'boolean' },
            eventType: { type: 'string' },
            metadata: { type: 'object' }
        }
    },
    'platform:gift': {
        required: ['type', 'platform', 'id', 'giftType', 'giftCount', 'amount', 'currency', 'timestamp'],
        optional: ['avatarUrl', 'repeatCount', 'message', 'cheermoteInfo', 'giftImageUrl', 'isError', 'isAnonymous', 'isAggregated', 'aggregatedCount', 'enhancedGiftData', 'sourceType', 'eventType', 'metadata'],
        properties: {
            type: { type: 'string', enum: ['platform:gift'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            username: { type: 'string' },
            userId: { type: 'string' },
            avatarUrl: { type: 'string' },
            id: { type: 'string' },
            giftType: { type: 'string' },
            giftCount: { type: 'number' },
            repeatCount: { type: 'number' },
            amount: { type: 'number' },
            currency: { type: 'string' },
            timestamp: { type: 'string' },
            message: { type: 'string' },
            cheermoteInfo: { type: 'object' },
            giftImageUrl: { type: 'string' },
            isError: { type: 'boolean' },
            isAnonymous: { type: 'boolean' },
            isAggregated: { type: 'boolean' },
            aggregatedCount: { type: 'number' },
            enhancedGiftData: { type: 'object' },
            sourceType: { type: 'string' },
            metadata: { type: 'object' },
            eventType: { type: 'string' }
        }
    },
    'platform:envelope': {
        required: ['type', 'platform', 'username', 'userId', 'id', 'giftType', 'giftCount', 'amount', 'currency', 'timestamp'],
        optional: ['avatarUrl', 'repeatCount', 'message', 'isError', 'sourceType', 'eventType', 'metadata'],
        properties: {
            type: { type: 'string', enum: ['platform:envelope'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            username: { type: 'string' },
            userId: { type: 'string' },
            avatarUrl: { type: 'string' },
            id: { type: 'string' },
            giftType: { type: 'string' },
            giftCount: { type: 'number' },
            repeatCount: { type: 'number' },
            amount: { type: 'number' },
            currency: { type: 'string' },
            timestamp: { type: 'string' },
            message: { type: 'string' },
            isError: { type: 'boolean' },
            sourceType: { type: 'string' },
            eventType: { type: 'string' },
            metadata: { type: 'object' }
        }
    },
    'platform:raid': {
        required: ['type', 'platform', 'username', 'userId', 'viewerCount', 'timestamp'],
        optional: ['avatarUrl', 'metadata'],
        properties: {
            type: { type: 'string', enum: ['platform:raid'] },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            username: { type: 'string' },
            userId: { type: 'string' },
            avatarUrl: { type: 'string' },
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
        required: ['type', 'command', 'commandKey', 'username', 'platform', 'userId', 'correlationId', 'result', 'duration', 'context'],
        properties: {
            type: { type: 'string', enum: ['vfx:command-executed'] },
            command: { type: 'string' },
            commandKey: { type: 'string' },
            filename: { type: 'string' },
            mediaSource: { type: 'string' },
            username: { type: 'string' },
            userId: { type: 'string' },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            correlationId: { type: 'string' },
            vfxConfig: { type: 'object' },
            result: { type: 'object' },
            duration: { type: 'number' },
            context: { type: 'object' }
        }
    },
    'vfx:effect-completed': {
        required: ['type', 'correlationId'],
        properties: {
            type: { type: 'string', enum: ['vfx:effect-completed'] },
            correlationId: { type: 'string' },
            effectId: { type: 'string' },
            success: { type: 'boolean' },
            duration: { type: 'number' },
            command: { type: 'string' },
            commandKey: { type: 'string' },
            username: { type: 'string' },
            userId: { type: 'string' },
            platform: { type: 'string', enum: VALID_PLATFORMS },
            result: { type: 'object' },
            context: { type: 'object' }
        }
    }
} satisfies EventSchemas;

class PlatformEventValidator {
    private readonly schemas: EventSchemas;

    constructor() {
        this.schemas = EVENT_SCHEMAS;
    }
    
    validate(event: Record<string, unknown> | null | undefined): ValidationResult {
        if (!event) {
            return {
                valid: false,
                errors: ['Event is null or undefined']
            };
        }
        
        const errors: string[] = [];
        const eventType = typeof event.type === 'string' ? event.type : '';
        
        if (!eventType || !this.schemas[eventType]) {
            errors.push(`Invalid event type: ${event.type}`);
        }
        
        if (event.platform && !isPlatformName(event.platform)) {
            errors.push(`Invalid platform: ${event.platform}. Must be one of: ${VALID_PLATFORMS.join(', ')}`);
        }
        
        if (!eventType || !this.schemas[eventType]) {
            return { valid: false, errors };
        }
        
        const schema = this.schemas[eventType];
        
        if (schema.required) {
            const isMonetizationEvent = event.type === PlatformEvents.GIFT ||
                event.type === PlatformEvents.GIFTPAYPIGGY ||
                event.type === PlatformEvents.PAYPIGGY ||
                event.type === PlatformEvents.ENVELOPE;
            const isErrorMonetizationEvent = isMonetizationEvent && event.isError === true;
            const isAnonymousGift = (event.type === PlatformEvents.GIFT || event.type === PlatformEvents.GIFTPAYPIGGY)
                && event.isAnonymous === true;
            const requiredFields = isAnonymousGift
                ? schema.required.filter((field) => field !== 'username' && field !== 'userId')
                : isErrorMonetizationEvent
                    ? schema.required.filter((field) => field === 'type' || field === 'platform' || field === 'timestamp')
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
    
    getSupportedEventTypes(): string[] {
        return Object.keys(this.schemas);
    }
    
    getEventSchema(eventType: string): EventSchema | null {
        return this.schemas[eventType] || null;
    }
    
    private _validateFieldType(
        value: unknown,
        schema: EventFieldSchema,
        fieldName: string
    ): boolean {
        if (schema.enum && !schema.enum.includes(value)) {
            return false;
        }
        
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
            if (fieldName === 'timestamp' && parseTimestampISO(value, { allowDateString: true }) === null) {
                return false;
            }
        }

        if (schema.type === 'number' && typeof value === 'number') {
            if (!Number.isFinite(value)) {
                return false;
            }
        }

        if (schema.type === 'object' && isRecord(value)) {
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
    private readonly validator: PlatformEventValidator;

    constructor() {
        this.validator = new PlatformEventValidator();
    }
    
    createChatMessage(params: Record<string, unknown>) {
        this._validateRequiredParams(params, ['platform', 'username', 'userId', 'message', 'timestamp']);
        if (typeof params.message !== 'string') {
            throw new Error('Chat message text must be a string');
        }
        
        const result: ChatMessageEventRecord = {
            type: 'platform:chat-message',
            platform: params.platform,
            username: params.username,
            userId: params.userId,
            avatarUrl: resolveAvatarUrl(params.avatarUrl),
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
    
    createGift(params: Record<string, unknown>) {
        this._validateRequiredParams(params, ['platform', 'username', 'userId', 'id', 'giftType', 'giftCount', 'amount', 'currency', 'timestamp']);
        
        const result: GiftEventRecord = {
            type: 'platform:gift',
            platform: params.platform,
            username: params.username,
            userId: params.userId,
            avatarUrl: resolveAvatarUrl(params.avatarUrl),
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
        if (typeof params.giftImageUrl === 'string' && params.giftImageUrl.trim()) {
            result.giftImageUrl = params.giftImageUrl.trim();
        }

        const validation = this.validator.validate(result);
        if (!validation.valid) {
            throw new Error(`Invalid event: ${validation.errors.join(', ')}`);
        }

        return result;
    }
    
    createFollow(params: Record<string, unknown>) {
        this._validateRequiredParams(params, ['platform', 'username', 'userId', 'timestamp']);
        
        const result: FollowEventRecord = {
            type: 'platform:follow',
            platform: params.platform,
            username: params.username,
            userId: params.userId,
            avatarUrl: resolveAvatarUrl(params.avatarUrl),
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
    
    normalizeMessage(platform: string, data: Record<string, unknown>) {
        if (!isRecord(data)) {
            throw new Error('Message payload must be an object');
        }

        if (!data.username || typeof data.username !== 'string') {
            throw new Error('Missing required username for message');
        }

        if (!data.userId || typeof data.userId !== 'string') {
            throw new Error('Missing required userId for message');
        }

        if (!isRecord(data.message)) {
            throw new Error('Missing required message payload');
        }

        if (!data.message.text || typeof data.message.text !== 'string') {
            throw new Error('Missing required message text');
        }

        if (data.timestamp === undefined || data.timestamp === null) {
            throw new Error('Missing required message timestamp');
        }

        const timestamp = requireTimestampISO(data.timestamp, 'Invalid timestamp for message');

        const normalizedMessage: NormalizedMessageRecord = {
            type: 'platform:chat-message',
            platform,
            username: data.username,
            userId: data.userId,
            avatarUrl: resolveAvatarUrl(data.avatarUrl),
            message: {
                text: data.message.text
            },
            timestamp
        };

        if (data.metadata !== undefined) {
            normalizedMessage.metadata = data.metadata;
        }

        return normalizedMessage;
    }
    
    normalizeGift(platform: string, data: Record<string, unknown>) {
        if (!isRecord(data)) {
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

        const timestamp = requireTimestampISO(data.timestamp, 'Invalid gift timestamp');

        const normalizedGift: GiftEventRecord = {
            type: 'platform:gift',
            platform,
            username: data.username,
            userId: data.userId,
            avatarUrl: resolveAvatarUrl(data.avatarUrl),
            id: data.id,
            giftType: data.giftType,
            giftCount: data.giftCount,
            amount: data.amount,
            currency: data.currency,
            timestamp
        };

        const validation = this.validator.validate(normalizedGift);
        if (!validation.valid) {
            throw new Error(`Invalid event: ${validation.errors.join(', ')}`);
        }

        return normalizedGift;
    }
    
    normalizeFollow(platform: string, data: Record<string, unknown>) {
        if (!isRecord(data)) {
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

        const timestamp = requireTimestampISO(data.timestamp, 'Invalid follow timestamp');

        return {
            type: 'platform:follow',
            platform,
            username: data.username,
            userId: data.userId,
            avatarUrl: resolveAvatarUrl(data.avatarUrl),
            timestamp,
            metadata: {}
        };
    }
    
    _validateRequiredParams(params: Record<string, unknown>, requiredFields: readonly string[]): void {
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

    static _generateId(): string {
        return crypto.randomUUID();
    }

    static _generateCorrelationId(): string {
        return crypto.randomUUID();
    }

    static _sanitizeText(text: unknown): string {
        if (typeof text !== 'string') return '';
        
        return text
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/javascript:/gi, '')
            .replace(/on\w+\s*=/gi, '')
            .replace(/\$\{[^}]*\}/g, '')
            .replace(/\{\{[^}]*\}\}/g, '')
            .trim();
    }

    static _validatePlatform(platform: unknown): PlatformName {
        if (!isPlatformName(platform)) {
            throw new Error(`Invalid platform: ${platform}. Valid platforms: ${VALID_PLATFORMS.join(', ')}`);
        }
        return platform;
    }

    static createChatMessageEvent(
        platform: string,
        identity: Record<string, unknown>,
        message: string,
        metadata: Record<string, unknown> = {}
    ) {
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
            avatarUrl: normalizedIdentity.avatarUrl,
            message: {
                text: this._sanitizeText(message)
            },
            metadata: metadata || {}
        };
    }

    static createNotificationEvent(platform: string, notificationType: string, data: Record<string, unknown>) {
        const username = typeof data?.username === 'string' && data.username.trim()
            ? data.username
            : undefined;
        const userId = typeof data?.userId === 'string' && data.userId.trim()
            ? data.userId
            : undefined;
        return {
            id: this._generateId(),
            type: 'platform:notification',
            platform: this._validatePlatform(platform),
            notificationType: notificationType,
            correlationId: this._generateCorrelationId(),
            timestamp: getSystemTimestampISO(),
            priority: this._calculatePriority(notificationType),
            data: data || {},
            ...(username ? { username } : {}),
            ...(userId ? { userId } : {})
        };
    }

    static createConnectionEvent(platform: string, status: string, error: unknown = null) {
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

    static createErrorEvent(platform: string, error: Error & { code?: string }, context: Record<string, unknown> = {}) {
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

    static normalizeIdentity(platform: string, rawIdentity: Record<string, unknown>) {
        if (!isRecord(rawIdentity)) {
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
            username,
            avatarUrl: resolveAvatarUrl(rawIdentity.avatarUrl)
        };
    }

    static normalizeMessage(platform: string, rawMessage: Record<string, unknown>) {
        if (!isRecord(rawMessage)) {
            throw new Error('Message payload must be an object');
        }

        if (!isRecord(rawMessage.message)) {
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

        const timestamp = requireTimestampISO(rawMessage.timestamp, 'Invalid message timestamp');

        const normalizedMessage: EnhancedNormalizedMessage = {
            text: String(text).trim(),
            platform: this._validatePlatform(platform),
            timestamp,
            username: normalizedIdentity.username,
            userId: normalizedIdentity.userId,
            avatarUrl: normalizedIdentity.avatarUrl
        };

        if (rawMessage.emotes !== undefined) {
            normalizedMessage.emotes = rawMessage.emotes;
        }

        if (rawMessage.metadata !== undefined) {
            normalizedMessage.metadata = rawMessage.metadata;
        }

        return normalizedMessage;
    }

    static validateChatMessageEvent(event: unknown): boolean {
        if (!isRecord(event) || event.type !== 'platform:chat-message') {
            return false;
        }

        const validator = new PlatformEventValidator();
        if (!validator.validate(event).valid) {
            return false;
        }

        const metadata = isRecord(event.metadata) ? event.metadata : null;
        const missingFields = Array.isArray(metadata?.missingFields)
            ? metadata.missingFields
            : [];

        const hasUserId = typeof event.userId === 'string' && event.userId.trim().length > 0;
        const hasTimestamp = typeof event.timestamp === 'string' && event.timestamp.trim().length > 0;

        if (!hasUserId && !missingFields.includes('userId')) {
            return false;
        }

        if (!hasTimestamp && !missingFields.includes('timestamp')) {
            return false;
        }

        return true;
    }

    static validateRuntimeMonetizationEvent(event: unknown): boolean {
        if (!isRecord(event)) {
            return false;
        }

        const validator = new PlatformEventValidator();
        if (!validator.validate(event).valid) {
            return false;
        }

        const isErrorPayload = event.isError === true;
        const isAnonymousGift = event.isAnonymous === true &&
            (event.type === PlatformEvents.GIFT || event.type === PlatformEvents.GIFTPAYPIGGY);
        const hasValidUsername = typeof event.username === 'string' && event.username.trim().length > 0;
        const hasValidUserId = typeof event.userId === 'string' && event.userId.trim().length > 0;
        const metadata = event.metadata && typeof event.metadata === 'object'
            ? event.metadata
            : null;
        const allowsMissingUserId = allowsYouTubeJewelsMissingUserId({
            type: event.type,
            platform: event.platform,
            currency: event.currency,
            metadata
        });

        if (isErrorPayload) {
            return true;
        }

        if (isAnonymousGift) {
            if ((event.username !== undefined && event.username !== null && !hasValidUsername) ||
                (event.userId !== undefined && event.userId !== null && !hasValidUserId)) {
                return false;
            }
            if ((hasValidUsername && !hasValidUserId) || (!hasValidUsername && hasValidUserId)) {
                return false;
            }
            return true;
        }

        return hasValidUsername && (hasValidUserId || allowsMissingUserId);
    }

    static validateNotificationEvent(event: unknown): boolean {
        if (!isRecord(event) || event.type !== 'platform:notification') {
            return false;
        }

        if (!isPlatformName(event.platform)) {
            return false;
        }

        if (typeof event.notificationType !== 'string' || !Object.values(this.NOTIFICATION_TYPES).includes(event.notificationType)) {
            return false;
        }

        if (!isRecord(event.data)) {
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

    static validateConnectionEvent(event: unknown): boolean {
        return !!(isRecord(event) &&
               event.type === 'platform:connection' &&
               isPlatformName(event.platform) &&
               typeof event.status === 'string');
    }

    static validateErrorEvent(event: unknown): boolean {
        return !!(isRecord(event) &&
               event.type === 'platform:error' &&
               isPlatformName(event.platform) &&
               isRecord(event.error) &&
               typeof event.error.message === 'string');
    }

    static validateStreamDetectedEvent(event: unknown): boolean {
        if (!isRecord(event) || event.type !== PlatformEvents.STREAM_DETECTED) {
            return false;
        }

        if (!isPlatformName(event.platform)) {
            return false;
        }

        if (typeof event.eventType !== 'string' || !['stream-detected', 'stream-ended'].includes(event.eventType)) {
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

    static validateEvent(event: unknown): boolean {
        if (!isRecord(event)) return false;

        const validator = new PlatformEventValidator();

        switch (event.type) {
            case 'platform:chat-message':
                return this.validateChatMessageEvent(event);
            case 'platform:connection':
                return this.validateConnectionEvent(event);
            case 'platform:error':
                return this.validateErrorEvent(event);
            case 'platform:gift':
            case 'platform:giftpaypiggy':
                return this.validateRuntimeMonetizationEvent(event);
            case 'platform:paypiggy':
            case 'platform:raid':
            case 'platform:viewer-count':
            case 'platform:envelope':
            case 'platform:follow':
            case 'platform:share':
            case PlatformEvents.VFX_COMMAND_EXECUTED:
            case PlatformEvents.VFX_EFFECT_COMPLETED:
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

    static _calculatePriority(notificationType: string): number {
        const priorities: Record<string, number> = {
            [this.NOTIFICATION_TYPES.GIFT]: 8,
            [this.NOTIFICATION_TYPES.RAID]: 6,
            [this.NOTIFICATION_TYPES.PAYPIGGY]: 5,
            [this.NOTIFICATION_TYPES.FOLLOW]: 2
        };
        return priorities[notificationType] || 1;
    }

    static _isRecoverableError(error: Error, context: Record<string, unknown>): boolean {
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
    private readonly _event: EventBuilderRecord;

    constructor() {
        this._event = {
            id: EnhancedPlatformEvents._generateId(),
            correlationId: EnhancedPlatformEvents._generateCorrelationId(),
            timestamp: getSystemTimestampISO()
        };
    }

    platform(platform: string) {
        this._event.platform = platform;
        return this;
    }

    type(eventType: string) {
        if (eventType && !eventType.includes(':')) {
            eventType = `platform:${eventType}`;
        }
        this._event.type = eventType;
        return this;
    }

    username(username: string) {
        this._event.username = username;
        return this;
    }

    userId(userId: string) {
        this._event.userId = userId;
        return this;
    }

    avatarUrl(avatarUrl: string) {
        this._event.avatarUrl = avatarUrl;
        return this;
    }

    message(text: string) {
        this._event.message = {
            text: EnhancedPlatformEvents._sanitizeText(text),
            original: text
        };
        return this;
    }

    metadata(metadata: Record<string, unknown>) {
        this._event.metadata = metadata;
        return this;
    }

    priority(priority: number) {
        this._event.priority = priority;
        return this;
    }

    data(data: Record<string, unknown>) {
        this._event.data = data;
        return this;
    }

    build(): EventBuilderRecord {
        if (!this._event.platform || !isPlatformName(this._event.platform)) {
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

const CombinedPlatformEvents = Object.assign({}, PlatformEvents, {
    VALID_PLATFORMS: EnhancedPlatformEvents.VALID_PLATFORMS,
    EVENT_TYPES: EnhancedPlatformEvents.EVENT_TYPES,
    NOTIFICATION_TYPES: EnhancedPlatformEvents.NOTIFICATION_TYPES,
    createChatMessageEvent: EnhancedPlatformEvents.createChatMessageEvent.bind(EnhancedPlatformEvents),
    createNotificationEvent: EnhancedPlatformEvents.createNotificationEvent.bind(EnhancedPlatformEvents),
    createConnectionEvent: EnhancedPlatformEvents.createConnectionEvent.bind(EnhancedPlatformEvents),
    createErrorEvent: EnhancedPlatformEvents.createErrorEvent.bind(EnhancedPlatformEvents),
    normalizeIdentity: EnhancedPlatformEvents.normalizeIdentity.bind(EnhancedPlatformEvents),
    normalizeMessage: EnhancedPlatformEvents.normalizeMessage.bind(EnhancedPlatformEvents),
    validateChatMessageEvent: EnhancedPlatformEvents.validateChatMessageEvent.bind(EnhancedPlatformEvents),
    validateNotificationEvent: EnhancedPlatformEvents.validateNotificationEvent.bind(EnhancedPlatformEvents),
    validateConnectionEvent: EnhancedPlatformEvents.validateConnectionEvent.bind(EnhancedPlatformEvents),
    validateErrorEvent: EnhancedPlatformEvents.validateErrorEvent.bind(EnhancedPlatformEvents),
    validateStreamDetectedEvent: EnhancedPlatformEvents.validateStreamDetectedEvent.bind(EnhancedPlatformEvents),
    validateEvent: EnhancedPlatformEvents.validateEvent.bind(EnhancedPlatformEvents),
    builder: EnhancedPlatformEvents.builder.bind(EnhancedPlatformEvents),
    _generateCorrelationId: EnhancedPlatformEvents._generateCorrelationId.bind(EnhancedPlatformEvents)
});

export {
    CombinedPlatformEvents as PlatformEvents,
    EnhancedPlatformEvents,
    PlatformEventValidator,
    PlatformEventBuilder,
    VALID_PLATFORMS,
    EVENT_SCHEMAS
};
