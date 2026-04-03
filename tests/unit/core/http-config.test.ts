import { describe, expect, it } from 'bun:test';

const { DEFAULT_HTTP_USER_AGENTS, parseUserAgentList } = require('../../../src/core/http-config.ts');

describe('core/http-config', () => {
    it('exports non-empty default user agent list', () => {
        expect(Array.isArray(DEFAULT_HTTP_USER_AGENTS)).toBe(true);
        expect(DEFAULT_HTTP_USER_AGENTS.length).toBeGreaterThan(0);
    });

    it('parses multiline and delimited user agent strings', () => {
        expect(parseUserAgentList('one\ntwo|three')).toEqual(['one', 'two', 'three']);
    });

    it('parses array values and drops empty entries', () => {
        expect(parseUserAgentList(['one', ' ', null, 'two'])).toEqual(['one', 'two']);
    });

    it('returns empty list for non-string non-array values', () => {
        expect(parseUserAgentList(42)).toEqual([]);
    });
});
