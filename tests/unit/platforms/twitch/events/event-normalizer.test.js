const { describe, test, expect } = require('bun:test');
const { applyTimestampFallback } = require('../../../../../src/platforms/twitch/events/event-normalizer');

describe('twitch event timestamp normalization', () => {
    test('uses metadata message timestamp for chat notifications', () => {
        const event = { message: { text: 'hi' } };
        const result = applyTimestampFallback(event, {
            message_timestamp: '2024-01-01T00:00:00.987654321Z'
        }, 'channel.chat.message');

        expect(result.timestamp).toBe('2024-01-01T00:00:00.987Z');
        expect(event.timestamp).toBeUndefined();
    });

    test('uses followed_at for follow notifications', () => {
        const result = applyTimestampFallback({
            user_name: 'follower',
            followed_at: '2024-01-02T00:00:00.111222333Z'
        }, {
            message_timestamp: '2024-01-02T00:00:05.000000000Z'
        }, 'channel.follow');

        expect(result.timestamp).toBe('2024-01-02T00:00:00.111Z');
    });

    test('uses started_at for stream online notifications', () => {
        const result = applyTimestampFallback({
            id: 'stream-1',
            started_at: '2024-01-03T00:00:00Z'
        }, {
            message_timestamp: '2024-01-03T00:00:20.000000000Z'
        }, 'stream.online');

        expect(result.timestamp).toBe('2024-01-03T00:00:00.000Z');
    });

    test('does not use payload timestamp for subscription notifications', () => {
        const result = applyTimestampFallback({
            user_name: 'subber',
            timestamp: '2024-01-04T00:00:00Z'
        }, undefined, 'channel.subscribe');

        expect(result.timestamp).toBeUndefined();
    });

    test('uses metadata timestamp for stream offline notifications', () => {
        const result = applyTimestampFallback({
            id: 'stream-1'
        }, {
            message_timestamp: '2024-01-05T00:00:00.123456789Z'
        }, 'stream.offline');

        expect(result.timestamp).toBe('2024-01-05T00:00:00.123Z');
    });

    test('drops timestamp for strict subscriptions when required source is invalid', () => {
        const result = applyTimestampFallback({
            user_name: 'subber',
            timestamp: '2024-01-04T00:00:00Z'
        }, {
            message_timestamp: 'invalid'
        }, 'channel.subscribe');

        expect(result.timestamp).toBeUndefined();
    });

    test('normalizes numeric metadata timestamp values', () => {
        const secondsResult = applyTimestampFallback({
            message: { text: 'hello' }
        }, {
            message_timestamp: '1704067200'
        }, 'channel.chat.message');

        const microsecondsResult = applyTimestampFallback({
            message: { text: 'hello' }
        }, {
            message_timestamp: '1704067200123456'
        }, 'channel.chat.message');

        expect(secondsResult.timestamp).toBe('2024-01-01T00:00:00.000Z');
        expect(microsecondsResult.timestamp).toBe('2024-01-01T00:00:00.123Z');
    });

    test('keeps unknown subscription events unchanged', () => {
        const inputEvent = {
            user_name: 'viewer',
            timestamp: '2024-01-06T00:00:00Z'
        };

        const result = applyTimestampFallback(inputEvent, {
            message_timestamp: '2024-01-06T00:00:10.000000000Z'
        }, 'channel.unknown');

        expect(result).toEqual(inputEvent);
    });
});
