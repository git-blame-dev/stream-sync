const { describe, it, expect } = require('bun:test');
const {
    sanitizeDataForInterpolation,
    sanitizeStringValue,
    convertValueToString
} = require('../../../src/utils/notification-string-sanitizer');

describe('notification-string-sanitizer', () => {
    describe('sanitizeStringValue', () => {
        it('strips template injection attempts', () => {
            expect(sanitizeStringValue('test{injection}here')).toBe('testhere');
        });

        it('truncates strings longer than 1000 characters', () => {
            const long = 'x'.repeat(2000);
            expect(sanitizeStringValue(long).length).toBe(1000);
        });

        it('returns empty string for null', () => {
            expect(sanitizeStringValue(null)).toBe('');
        });

        it('returns empty string for undefined', () => {
            expect(sanitizeStringValue(undefined)).toBe('');
        });

        it('converts numbers to sanitized strings', () => {
            expect(sanitizeStringValue(42)).toBe('42');
        });

        it('converts booleans to sanitized strings', () => {
            expect(sanitizeStringValue(true)).toBe('true');
        });

        it('passes through normal strings unchanged', () => {
            expect(sanitizeStringValue('test-user sent a gift')).toBe('test-user sent a gift');
        });
    });

    describe('convertValueToString', () => {
        it('returns empty string for null', () => {
            expect(convertValueToString(null)).toBe('');
        });

        it('returns empty string for undefined', () => {
            expect(convertValueToString(undefined)).toBe('');
        });

        it('returns string values as-is', () => {
            expect(convertValueToString('hello')).toBe('hello');
        });

        it('converts valid numbers to string', () => {
            expect(convertValueToString(42)).toBe('42');
        });

        it('returns empty string for NaN', () => {
            expect(convertValueToString(NaN)).toBe('');
        });

        it('returns empty string for Infinity', () => {
            expect(convertValueToString(Infinity)).toBe('');
        });

        it('converts booleans to string', () => {
            expect(convertValueToString(true)).toBe('true');
            expect(convertValueToString(false)).toBe('false');
        });

        it('returns first element for single-element arrays', () => {
            expect(convertValueToString(['only'])).toBe('only');
        });

        it('returns summary for multi-element arrays', () => {
            expect(convertValueToString(['first', 'second', 'third'])).toBe('first and 2 more');
        });

        it('returns empty string for empty arrays', () => {
            expect(convertValueToString([])).toBe('');
        });

        it('formats Date instances as ISO string', () => {
            const date = new Date('2025-01-15T12:00:00Z');
            expect(convertValueToString(date)).toBe('2025-01-15T12:00:00.000Z');
        });

        it('extracts name property from objects', () => {
            expect(convertValueToString({ name: 'test-name' })).toBe('test-name');
        });

        it('extracts username property from objects', () => {
            expect(convertValueToString({ username: 'test-user' })).toBe('test-user');
        });

        it('extracts value property from objects', () => {
            expect(convertValueToString({ value: 'test-value' })).toBe('test-value');
        });

        it('extracts text property from objects', () => {
            expect(convertValueToString({ text: 'test-text' })).toBe('test-text');
        });

        it('extracts title property from objects', () => {
            expect(convertValueToString({ title: 'test-title' })).toBe('test-title');
        });

        it('extracts string from nested objects up to 3 levels', () => {
            const nested = { a: { b: { c: 'deep-value' } } };
            expect(convertValueToString(nested)).toBe('deep-value');
        });

        it('falls back to JSON for objects nested beyond extraction depth', () => {
            const deep = { a: { b: { c: { d: { e: 'deep-value' } } } } };
            const result = convertValueToString(deep);
            expect(result).toContain('deep-value');
        });

        it('uses toString when it returns non-default value', () => {
            const obj = { toString: () => 'custom-string' };
            expect(convertValueToString(obj)).toBe('custom-string');
        });

        it('uses JSON.stringify for small objects without meaningful properties', () => {
            const obj = { id: 123 };
            const result = convertValueToString(obj);
            expect(result).toBe('123');
        });

        it('returns empty string for functions', () => {
            expect(convertValueToString(() => {})).toBe('');
        });

        it('handles circular references without throwing', () => {
            const obj = { a: {} };
            obj.a.self = obj.a;
            expect(() => convertValueToString(obj)).not.toThrow();
        });
    });

    describe('sanitizeDataForInterpolation', () => {
        it('returns empty object for null input', () => {
            expect(sanitizeDataForInterpolation(null)).toEqual({});
        });

        it('returns empty object for undefined input', () => {
            expect(sanitizeDataForInterpolation(undefined)).toEqual({});
        });

        it('returns empty object for non-object input', () => {
            expect(sanitizeDataForInterpolation('string')).toEqual({});
        });

        it('passes through primitive string values with sanitization', () => {
            const result = sanitizeDataForInterpolation({ name: 'test-user' });
            expect(result.name).toBe('test-user');
        });

        it('passes through number values with sanitization', () => {
            const result = sanitizeDataForInterpolation({ count: 42 });
            expect(result.count).toBe('42');
        });

        it('passes through boolean values with sanitization', () => {
            const result = sanitizeDataForInterpolation({ flag: true });
            expect(result.flag).toBe('true');
        });

        it('extracts first element from arrays', () => {
            const result = sanitizeDataForInterpolation({ items: ['first', 'second'] });
            expect(result.items).toBe('first');
        });

        it('returns empty string for empty arrays', () => {
            const result = sanitizeDataForInterpolation({ items: [] });
            expect(result.items).toBe('');
        });

        it('handles circular references gracefully', () => {
            const data = { a: {} };
            data.a.self = data.a;
            expect(() => sanitizeDataForInterpolation(data)).not.toThrow();
            expect(data.a).toBeDefined();
        });

        it('returns empty string for deeply nested objects without extractable properties', () => {
            let obj = { nested: {} };
            for (let i = 0; i < 15; i++) {
                obj = { nested: obj };
            }
            const result = sanitizeDataForInterpolation({ deep: obj });
            expect(result.deep).toBe('');
        });

        it('converts remaining object values to strings', () => {
            const result = sanitizeDataForInterpolation({
                obj: { name: 'test-object' }
            });
            expect(result.obj).toBe('test-object');
        });

        it('handles functions as empty string', () => {
            const result = sanitizeDataForInterpolation({ fn: () => {} });
            expect(result.fn).toBe('');
        });
    });
});
