const { initializeTestLogging } = require('../../helpers/test-setup');

initializeTestLogging();

jest.unmock('../../../src/utils/http-client');
const { HttpClient } = require('../../../src/utils/http-client');

describe('HttpClient user agent configuration', () => {
    it('uses configured user agent list for rotation', () => {
        const client = new HttpClient({
            userAgents: ['ExampleAgent/1.0', 'ExampleAgent/2.0'],
            timeout: 5000
        });

        expect(client.getNextUserAgent()).toBe('ExampleAgent/1.0');
        expect(client.getNextUserAgent()).toBe('ExampleAgent/2.0');
    });
});
