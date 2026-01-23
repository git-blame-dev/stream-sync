const { describe, it, expect, afterEach, beforeEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../../helpers/mock-factories');
const { useFakeTimers, useRealTimers, setSystemTime } = require('../../../../helpers/bun-timers');
const testClock = require('../../../../helpers/test-clock');
const { TikTokPlatform } = require('../../../../../src/platforms/tiktok');

const createPlatform = (configOverrides = {}, dependencyOverrides = {}) => {
    const logger = dependencyOverrides.logger || noOpLogger;
    const notificationManager = dependencyOverrides.notificationManager || {
        emit: createMockFn(),
        on: createMockFn(),
        removeListener: createMockFn(),
        handleNotification: createMockFn().mockResolvedValue()
    };
    const connectionFactory = dependencyOverrides.connectionFactory || {
        createConnection: createMockFn().mockReturnValue({
            on: createMockFn(),
            emit: createMockFn(),
            removeAllListeners: createMockFn(),
            connect: createMockFn().mockResolvedValue(),
            disconnect: createMockFn()
        })
    };

    const TikTokWebSocketClient = dependencyOverrides.TikTokWebSocketClient || createMockFn().mockImplementation(() => ({
        on: createMockFn(),
        off: createMockFn(),
        connect: createMockFn(),
        disconnect: createMockFn(),
        getState: createMockFn().mockReturnValue('DISCONNECTED'),
        isConnecting: false,
        isConnected: false
    }));

    const WebcastEvent = dependencyOverrides.WebcastEvent || { ERROR: 'error', DISCONNECT: 'disconnect' };
    const ControlEvent = dependencyOverrides.ControlEvent || {};

    const config = {
        enabled: true,
        username: 'testUser',
        ...configOverrides
    };

    return new TikTokPlatform(config, {
        logger,
        notificationManager,
        TikTokWebSocketClient,
        WebcastEvent,
        ControlEvent,
        connectionFactory,
        ...dependencyOverrides
    });
};

describe('TikTokPlatform error normalization', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    describe('_normalizeErrorDetails', () => {
        it('returns "Unknown error" for null/undefined input', () => {
            const platform = createPlatform();

            expect(platform._normalizeErrorDetails(null).message).toBe('Unknown error');
            expect(platform._normalizeErrorDetails(undefined).message).toBe('Unknown error');
        });

        it('extracts message from error object', () => {
            const platform = createPlatform();

            const result = platform._normalizeErrorDetails({ message: 'test error message' });

            expect(result.message).toBe('test error message');
        });

        it('extracts requestUrl from exception', () => {
            const platform = createPlatform();

            const result = platform._normalizeErrorDetails({
                message: 'request failed',
                exception: { requestUrl: 'https://example.com/api' }
            });

            expect(result.url).toBe('https://example.com/api');
        });

        it('extracts code from exception', () => {
            const platform = createPlatform();

            const result = platform._normalizeErrorDetails({
                message: 'error',
                exception: { code: 'ECONNREFUSED' }
            });

            expect(result.code).toBe('ECONNREFUSED');
        });

        it('slices responseBody to 512 chars for response.body string', () => {
            const platform = createPlatform();
            const longBody = 'x'.repeat(1000);

            const result = platform._normalizeErrorDetails({
                message: 'error',
                response: { body: longBody }
            });

            expect(result.responseBody.length).toBe(512);
        });

        it('slices responseBody for response.data string', () => {
            const platform = createPlatform();
            const longData = 'y'.repeat(1000);

            const result = platform._normalizeErrorDetails({
                message: 'error',
                response: { data: longData }
            });

            expect(result.responseBody.length).toBe(512);
        });

        it('captures nested errors array as causes (max 3)', () => {
            const platform = createPlatform();

            const result = platform._normalizeErrorDetails({
                message: 'main error',
                errors: [
                    { message: 'cause 1' },
                    { message: 'cause 2' },
                    { message: 'cause 3' },
                    { message: 'cause 4' }
                ]
            });

            expect(result.causes).toHaveLength(3);
            expect(result.causes[0].message).toBe('cause 1');
            expect(result.causes[2].message).toBe('cause 3');
        });

        it('records remainingCauses count when more than 3 errors', () => {
            const platform = createPlatform();

            const result = platform._normalizeErrorDetails({
                message: 'main error',
                errors: [
                    { message: 'cause 1' },
                    { message: 'cause 2' },
                    { message: 'cause 3' },
                    { message: 'cause 4' },
                    { message: 'cause 5' }
                ]
            });

            expect(result.remainingCauses).toBe(2);
        });
    });

    describe('_normalizeConnectionIssue', () => {
        it('returns "Unknown disconnect reason" for null/undefined', () => {
            const platform = createPlatform();

            expect(platform._normalizeConnectionIssue(null).message).toBe('Unknown disconnect reason');
            expect(platform._normalizeConnectionIssue(undefined).message).toBe('Unknown disconnect reason');
        });

        it('extracts message from Error instance', () => {
            const platform = createPlatform();

            const result = platform._normalizeConnectionIssue(new Error('connection lost'));

            expect(result.message).toBe('connection lost');
        });

        it('wraps string as message', () => {
            const platform = createPlatform();

            const result = platform._normalizeConnectionIssue('stream ended');

            expect(result.message).toBe('stream ended');
        });

        it('extracts reason/message and code from object', () => {
            const platform = createPlatform();

            const result = platform._normalizeConnectionIssue({
                reason: 'server closed',
                code: 1000
            });

            expect(result.message).toBe('server closed');
            expect(result.code).toBe(1000);
        });

        it('converts non-object to string', () => {
            const platform = createPlatform();

            const result = platform._normalizeConnectionIssue(12345);

            expect(result.message).toBe('12345');
        });
    });

    describe('_isStreamNotLive', () => {
        it('returns true for code 4404', () => {
            const platform = createPlatform();

            expect(platform._isStreamNotLive({ code: 4404 })).toBe(true);
        });

        it('returns true when message contains "not live"', () => {
            const platform = createPlatform();

            expect(platform._isStreamNotLive({ message: 'Stream is not live' })).toBe(true);
            expect(platform._isStreamNotLive('User is NOT LIVE right now')).toBe(true);
        });

        it('returns false for empty/null message', () => {
            const platform = createPlatform();

            expect(platform._isStreamNotLive({ message: '' })).toBe(false);
            expect(platform._isStreamNotLive({ message: null })).toBe(false);
        });

        it('handles string input vs object input', () => {
            const platform = createPlatform();

            expect(platform._isStreamNotLive('not live')).toBe(true);
            expect(platform._isStreamNotLive({ message: 'not live' })).toBe(true);
        });
    });

    describe('_formatStreamNotLiveMessage', () => {
        it('includes code suffix when present', () => {
            const platform = createPlatform();

            const result = platform._formatStreamNotLiveMessage('testStreamer', { code: 4404 });

            expect(result).toBe("Stream is not live for TikTok user 'testStreamer' (code 4404)");
        });

        it('omits code suffix when missing', () => {
            const platform = createPlatform();

            const result = platform._formatStreamNotLiveMessage('testStreamer', {});

            expect(result).toBe("Stream is not live for TikTok user 'testStreamer'");
        });
    });

    describe('_wasRecentlyNotLiveLogged', () => {
        beforeEach(() => {
            useFakeTimers();
            setSystemTime(new Date('2025-01-15T12:00:00.000Z'));
            testClock.set(Date.parse('2025-01-15T12:00:00.000Z'));
        });

        afterEach(() => {
            useRealTimers();
            testClock.reset();
        });

        it('returns false when no warning recorded', () => {
            const platform = createPlatform();

            expect(platform._wasRecentlyNotLiveLogged()).toBe(false);
        });

        it('returns true within 2 seconds of recording', () => {
            const platform = createPlatform();
            platform._recordNotLiveWarning();

            setSystemTime(new Date('2025-01-15T12:00:01.500Z'));

            expect(platform._wasRecentlyNotLiveLogged()).toBe(true);
        });

        it('returns false after 2 seconds', () => {
            const platform = createPlatform();
            platform._recordNotLiveWarning();

            setSystemTime(new Date('2025-01-15T12:00:02.500Z'));

            expect(platform._wasRecentlyNotLiveLogged()).toBe(false);
        });
    });

    describe('_isRecoverableError', () => {
        it('returns false for "username is required"', () => {
            const platform = createPlatform();

            expect(platform._isRecoverableError('Username is required')).toBe(false);
        });

        it('returns false for "invalid username"', () => {
            const platform = createPlatform();

            expect(platform._isRecoverableError('Invalid username provided')).toBe(false);
        });

        it('returns false for "user not found"', () => {
            const platform = createPlatform();

            expect(platform._isRecoverableError('User not found on TikTok')).toBe(false);
        });

        it('returns false for "private account"', () => {
            const platform = createPlatform();

            expect(platform._isRecoverableError('This is a private account')).toBe(false);
        });

        it('returns false for "banned account"', () => {
            const platform = createPlatform();

            expect(platform._isRecoverableError('This is a banned account')).toBe(false);
        });

        it('returns true for "timeout" errors', () => {
            const platform = createPlatform();

            expect(platform._isRecoverableError('Connection timeout')).toBe(true);
        });

        it('returns true for "network" errors', () => {
            const platform = createPlatform();

            expect(platform._isRecoverableError('Network error occurred')).toBe(true);
        });

        it('returns true for "connection" errors', () => {
            const platform = createPlatform();

            expect(platform._isRecoverableError('Connection refused')).toBe(true);
        });

        it('returns true for "tls" errors', () => {
            const platform = createPlatform();

            expect(platform._isRecoverableError('TLS handshake failed')).toBe(true);
        });

        it('returns true for unknown errors (default recoverable)', () => {
            const platform = createPlatform();

            expect(platform._isRecoverableError('Some unknown error')).toBe(true);
        });
    });
});
