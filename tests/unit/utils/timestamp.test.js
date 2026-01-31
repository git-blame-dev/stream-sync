const { describe, it, expect } = require('bun:test');
const testClock = require('../../helpers/test-clock');
const { isIsoTimestamp, getSystemTimestampISO } = require('../../../src/utils/timestamp');

describe('Timestamp utilities', () => {
    describe('isIsoTimestamp', () => {
        it('validates correct ISO timestamps', () => {
            expect(isIsoTimestamp('2024-01-01T00:00:00Z')).toBe(true);
            expect(isIsoTimestamp('2024-01-01T00:00:00.000Z')).toBe(true);
            expect(isIsoTimestamp('2026-12-31T23:59:59.999Z')).toBe(true);
        });

        it('rejects invalid formats', () => {
            expect(isIsoTimestamp('2024-01-01')).toBe(false);
            expect(isIsoTimestamp('2024-01-01T00:00:00')).toBe(false);
            expect(isIsoTimestamp('not-a-date')).toBe(false);
            expect(isIsoTimestamp('')).toBe(false);
            expect(isIsoTimestamp(null)).toBe(false);
            expect(isIsoTimestamp(123456)).toBe(false);
        });
    });

    describe('getSystemTimestampISO', () => {
        it('returns valid ISO timestamp string', () => {
            const result = getSystemTimestampISO();
            expect(typeof result).toBe('string');
            expect(isIsoTimestamp(result)).toBe(true);
        });

        it('returns current time', () => {
            const before = testClock.now();
            const result = getSystemTimestampISO();
            const after = testClock.now();
            const resultMs = new Date(result).getTime();
            expect(resultMs).toBeGreaterThanOrEqual(before);
            expect(resultMs).toBeLessThanOrEqual(after);
        });
    });
});
