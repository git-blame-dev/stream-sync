const { describe, test, expect, it, afterEach } = require('bun:test');
const { unmockModule, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

unmockModule('../../../src/utils/http-client');
const { HttpClient } = require('../../../src/utils/http-client');

describe('HttpClient user agent configuration', () => {
    afterEach(() => {
        restoreAllModuleMocks();
    });

    it('uses configured user agent list for rotation', () => {
        const client = new HttpClient({
            userAgents: ['ExampleAgent/1.0', 'ExampleAgent/2.0'],
            timeout: 5000
        });

        expect(client.getNextUserAgent()).toBe('ExampleAgent/1.0');
        expect(client.getNextUserAgent()).toBe('ExampleAgent/2.0');
    });
});
