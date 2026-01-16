const { describe, test, expect } = require('bun:test');
const { HttpClient } = require('../../../src/utils/http-client');

describe('HttpClient user agent configuration', () => {
    test('uses configured user agent list for rotation', () => {
        const client = new HttpClient({
            userAgents: ['TestAgent/1.0', 'TestAgent/2.0'],
            timeout: 5000
        });

        expect(client.getNextUserAgent()).toBe('TestAgent/1.0');
        expect(client.getNextUserAgent()).toBe('TestAgent/2.0');
    });
});
