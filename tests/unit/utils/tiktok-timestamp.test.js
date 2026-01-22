const {
    resolveTikTokTimestampMs,
    resolveTikTokTimestampISO
} = require('../../../src/utils/tiktok-timestamp');

describe('resolveTikTokTimestampMs', () => {
    it('converts seconds to milliseconds from common.createTime', () => {
        const data = { common: { createTime: 1_700_000_000 } };
        expect(resolveTikTokTimestampMs(data)).toBe(1_700_000_000_000);
    });

    it('returns milliseconds unchanged from common.clientSendTime', () => {
        const millis = 1_700_000_000_000;
        expect(resolveTikTokTimestampMs({ common: { clientSendTime: millis } })).toBe(millis);
    });

    it('handles string timestamps with whitespace for common.clientSendTime', () => {
        const data = { common: { clientSendTime: ' 1700000000000 ' } };
        expect(resolveTikTokTimestampMs(data)).toBe(1_700_000_000_000);
    });

    it('converts microsecond timestamps down to milliseconds from common.createTime', () => {
        const micro = 1_700_000_000_000_000;
        expect(resolveTikTokTimestampMs({ common: { createTime: micro } })).toBe(1_700_000_000_000);
    });

    it('parses ISO timestamps from data.timestamp', () => {
        const iso = '2026-01-04T09:43:46.004Z';
        expect(resolveTikTokTimestampMs({ timestamp: iso })).toBe(Date.parse(iso));
    });

    it('parses numeric string timestamps from data.timestamp', () => {
        expect(resolveTikTokTimestampMs({ timestamp: '1700000000000' })).toBe(1_700_000_000_000);
    });

    it('parses ISO timestamps from common.createTime', () => {
        const iso = '2026-01-04T09:43:46.004Z';
        expect(resolveTikTokTimestampMs({ common: { createTime: iso } })).toBe(Date.parse(iso));
    });

    it('falls back to common.clientSendTime when createTime is invalid', () => {
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
