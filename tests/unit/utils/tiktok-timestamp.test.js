const {
    resolveTikTokTimestampMs,
    resolveTikTokTimestampISO
} = require('../../../src/utils/tiktok-timestamp');

describe('resolveTikTokTimestampMs', () => {
    it('converts seconds to milliseconds', () => {
        const data = { createTime: 1_700_000_000 };
        expect(resolveTikTokTimestampMs(data)).toBe(1_700_000_000_000);
    });

    it('returns milliseconds unchanged', () => {
        const millis = 1_700_000_000_000;
        expect(resolveTikTokTimestampMs({ timestamp: millis })).toBe(millis);
    });

    it('handles string timestamps with whitespace', () => {
        expect(resolveTikTokTimestampMs({ clientSendTime: ' 1700000000000 ' })).toBe(1_700_000_000_000);
    });

    it('converts microsecond timestamps down to milliseconds', () => {
        const micro = 1_700_000_000_000_000;
        expect(resolveTikTokTimestampMs({ message: { timestamp: micro } })).toBe(1_700_000_000_000);
    });

    it('returns null for missing or invalid values', () => {
        expect(resolveTikTokTimestampMs(null)).toBeNull();
        expect(resolveTikTokTimestampMs({})).toBeNull();
        expect(resolveTikTokTimestampMs({ createTime: 'abc' })).toBeNull();
    });
});

describe('resolveTikTokTimestampISO', () => {
    it('returns ISO string when timestamp present', () => {
        const iso = resolveTikTokTimestampISO({ createTime: 1_700_000_000 });
        expect(typeof iso).toBe('string');
        expect(new Date(iso).getTime()).toBe(1_700_000_000_000);
    });

    it('returns null when no timestamp available', () => {
        expect(resolveTikTokTimestampISO({})).toBeNull();
    });
});
