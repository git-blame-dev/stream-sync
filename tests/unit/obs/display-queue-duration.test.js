const { describe, expect, afterEach, it, beforeEach } = require('bun:test');
const { restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { DisplayQueue } = require('../../../src/obs/display-queue');
const { EventEmitter } = require('events');

describe('DisplayQueue TTS-driven durations', () => {
    let originalNodeEnv;

    beforeEach(() => {
        originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'test';
    });

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        restoreAllMocks();
    });

    function createQueue() {
        return new DisplayQueue(
            {},
            { ttsEnabled: true },
            {
                CHAT_MESSAGE_DURATION: 4500,
                CHAT_TRANSITION_DELAY: 0,
                PRIORITY_LEVELS: { CHAT: 1 }
            },
            new EventEmitter(),
            {}
        );
    }

    it('returns minimum window for short TTS content', () => {
        const queue = createQueue();
        const item = {
            type: 'platform:gift',
            data: { ttsMessage: 'Hi' }
        };

        const duration = queue.getDuration(item);

        expect(duration).toBe(2000);
    });

    it('sizes window based on TTS word count and stage delays', () => {
        const queue = createQueue();
        const item = {
            type: 'platform:paypiggy',
            data: {
                ttsMessage: 'Thank you for the membership',
                message: 'This is a custom message from the user',
                username: 'testUser'
            }
        };

        const duration = queue.getDuration(item);

        expect(duration).toBeGreaterThan(2000);
        expect(duration).toBeLessThanOrEqual(20000);
    });

    it('caps extremely long TTS at maximum window', () => {
        const queue = createQueue();
        const longText = Array(120).fill('word').join(' ');
        const item = {
            type: 'platform:gift',
            data: { ttsMessage: longText }
        };

        const duration = queue.getDuration(item);

        expect(duration).toBe(20000);
    });

    it('returns zero when no TTS content exists', () => {
        const queue = createQueue();
        const item = {
            type: 'platform:follow',
            data: {}
        };

        const duration = queue.getDuration(item);

        expect(duration).toBe(0);
    });

    it('returns zero for null or missing data', () => {
        const queue = createQueue();

        expect(queue.getDuration({ type: 'platform:gift' })).toBe(0);
        expect(queue.getDuration({ type: 'platform:gift', data: null })).toBe(0);
    });
});
