const { describe, it, expect } = require('bun:test');
const {
    resolveTikTokTimestampMs,
    resolveTikTokTimestampISO,
    resolveYouTubeTimestampISO,
    resolveTwitchTimestampISO
} = require('../../../src/utils/platform-timestamp');

describe('TikTok timestamp resolution', () => {
    describe('resolveTikTokTimestampMs', () => {
        it('converts seconds to milliseconds from common.createTime', () => {
            const data = { common: { createTime: 1_700_000_000 } };
            expect(resolveTikTokTimestampMs(data)).toBe(1_700_000_000_000);
        });

        it('returns milliseconds unchanged from common.clientSendTime', () => {
            const millis = 1_700_000_000_000;
            expect(resolveTikTokTimestampMs({ common: { clientSendTime: millis } })).toBe(millis);
        });

        it('handles string timestamps with whitespace', () => {
            const data = { common: { clientSendTime: ' 1700000000000 ' } };
            expect(resolveTikTokTimestampMs(data)).toBe(1_700_000_000_000);
        });

        it('converts microsecond timestamps down to milliseconds', () => {
            const micro = 1_700_000_000_000_000;
            expect(resolveTikTokTimestampMs({ common: { createTime: micro } })).toBe(1_700_000_000_000);
        });

        it('parses ISO timestamps from data.timestamp', () => {
            const iso = '2026-01-04T09:43:46.004Z';
            expect(resolveTikTokTimestampMs({ timestamp: iso })).toBe(Date.parse(iso));
        });

        it('parses numeric string timestamps', () => {
            expect(resolveTikTokTimestampMs({ timestamp: '1700000000000' })).toBe(1_700_000_000_000);
        });

        it('parses ISO timestamps from common.createTime', () => {
            const iso = '2026-01-04T09:43:46.004Z';
            expect(resolveTikTokTimestampMs({ common: { createTime: iso } })).toBe(Date.parse(iso));
        });

        it('falls back to clientSendTime when createTime is invalid', () => {
            const fallback = 1_700_000_000_000;
            const data = {
                common: {
                    createTime: 'not-a-time',
                    clientSendTime: fallback
                }
            };
            expect(resolveTikTokTimestampMs(data)).toBe(fallback);
        });

        it('returns null for missing or invalid values', () => {
            expect(resolveTikTokTimestampMs(null)).toBeNull();
            expect(resolveTikTokTimestampMs({})).toBeNull();
            expect(resolveTikTokTimestampMs({ common: { createTime: 'abc' } })).toBeNull();
            expect(resolveTikTokTimestampMs({ common: { createTime: 0 } })).toBeNull();
        });
    });

    describe('resolveTikTokTimestampISO', () => {
        it('returns ISO string when timestamp present', () => {
            const iso = resolveTikTokTimestampISO({ common: { createTime: 1_700_000_000 } });
            expect(typeof iso).toBe('string');
            expect(new Date(iso).getTime()).toBe(1_700_000_000_000);
        });

        it('returns null when no timestamp available', () => {
            expect(resolveTikTokTimestampISO({})).toBeNull();
        });
    });
});

describe('YouTube timestamp resolution', () => {
    describe('resolveYouTubeTimestampISO', () => {
        it('converts microsecond timestamp_usec to ISO', () => {
            const micros = 1_700_000_000_000_000;
            const result = resolveYouTubeTimestampISO({ timestamp_usec: micros });
            expect(result).toBe(new Date(Math.floor(micros / 1000)).toISOString());
        });

        it('handles string timestamp_usec', () => {
            const micros = 1_700_000_000_000_000;
            const result = resolveYouTubeTimestampISO({ timestamp_usec: micros.toString() });
            expect(result).toBe(new Date(Math.floor(micros / 1000)).toISOString());
        });

        it('extracts timestamp from nested item object', () => {
            const micros = 1_700_000_000_000_000;
            const result = resolveYouTubeTimestampISO({ item: { timestamp_usec: micros } });
            expect(result).toBe(new Date(Math.floor(micros / 1000)).toISOString());
        });

        it('falls back to timestamp field when timestamp_usec missing', () => {
            const millis = 1_700_000_000_000;
            const result = resolveYouTubeTimestampISO({ timestamp: millis });
            expect(result).toBe(new Date(millis).toISOString());
        });

        it('handles large millisecond timestamps by converting to ms', () => {
            const largeMicros = 1_700_000_000_000_000;
            const result = resolveYouTubeTimestampISO({ timestamp: largeMicros });
            expect(result).toBe(new Date(Math.floor(largeMicros / 1000)).toISOString());
        });

        it('returns null for invalid data', () => {
            expect(resolveYouTubeTimestampISO(null)).toBeNull();
            expect(resolveYouTubeTimestampISO({})).toBeNull();
            expect(resolveYouTubeTimestampISO({ timestamp: {} })).toBeNull();
            expect(resolveYouTubeTimestampISO({ timestamp_usec: 'invalid' })).toBeNull();
            expect(resolveYouTubeTimestampISO({ timestamp_usec: 0 })).toBeNull();
        });
    });
});

describe('Twitch timestamp resolution', () => {
    describe('resolveTwitchTimestampISO', () => {
        it('extracts followed_at timestamp', () => {
            const iso = '2024-01-01T00:00:00Z';
            const result = resolveTwitchTimestampISO({ followed_at: iso });
            expect(result).toBe(new Date(iso).toISOString());
        });

        it('extracts started_at timestamp', () => {
            const iso = '2024-01-01T12:00:00Z';
            const result = resolveTwitchTimestampISO({ started_at: iso });
            expect(result).toBe(new Date(iso).toISOString());
        });

        it('extracts generic timestamp field', () => {
            const iso = '2024-01-01T18:00:00Z';
            const result = resolveTwitchTimestampISO({ timestamp: iso });
            expect(result).toBe(new Date(iso).toISOString());
        });

        it('prioritizes followed_at over started_at and timestamp', () => {
            const result = resolveTwitchTimestampISO({
                followed_at: '2024-01-01T00:00:00Z',
                started_at: '2024-01-02T00:00:00Z',
                timestamp: '2024-01-03T00:00:00Z'
            });
            expect(result).toBe(new Date('2024-01-01T00:00:00Z').toISOString());
        });

        it('handles numeric timestamps', () => {
            const millis = 1_700_000_000_000;
            const result = resolveTwitchTimestampISO({ timestamp: millis });
            expect(result).toBe(new Date(millis).toISOString());
        });

        it('returns null for invalid data', () => {
            expect(resolveTwitchTimestampISO(null)).toBeNull();
            expect(resolveTwitchTimestampISO({})).toBeNull();
            expect(resolveTwitchTimestampISO({ timestamp: 'invalid' })).toBeNull();
            expect(resolveTwitchTimestampISO({ timestamp: 0 })).toBeNull();
        });
    });
});
