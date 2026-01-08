const { extractHttpErrorDetails } = require('../../../src/utils/http-error-utils');

describe('http-error-utils behavior', () => {
    test('extractHttpErrorDetails returns safe defaults for non-HTTP errors', () => {
        const error = new Error('boom');

        const details = extractHttpErrorDetails(error);

        expect(details).toEqual({
            message: 'boom',
            code: null,
            status: null,
            statusText: null,
            serviceError: null,
            serviceMessage: null,
            isAxiosError: false,
            method: null,
            url: null,
            responseSnippet: null
        });
    });

    test('extractHttpErrorDetails redacts sensitive fields from response data', () => {
        const error = {
            isAxiosError: true,
            message: 'Request failed with status code 401',
            code: 'ERR_BAD_REQUEST',
            config: {
                method: 'GET',
                url: 'https://api.example.com/v1/resource?access_token=should-not-log'
            },
            response: {
                status: 401,
                statusText: 'Unauthorized',
                data: {
                    error: 'Unauthorized',
                    message: 'Invalid OAuth token',
                    access_token: 'super-secret-token'
                },
                headers: {
                    'x-request-id': 'req-123'
                }
            }
        };

        const details = extractHttpErrorDetails(error, { maxResponseSnippetLength: 500 });

        expect(details.status).toBe(401);
        expect(details.serviceError).toBe('Unauthorized');
        expect(details.serviceMessage).toBe('Invalid OAuth token');
        expect(details.isAxiosError).toBe(true);
        expect(details.method).toBe('get');
        expect(details.url).toBe('https://api.example.com/v1/resource');
        expect(details.responseSnippet).toContain('"access_token":"[REDACTED]"');
        expect(details.responseSnippet).not.toContain('super-secret-token');
        expect(details.responseSnippet).not.toContain('should-not-log');
    });

    test('extractHttpErrorDetails truncates large response data safely', () => {
        const error = {
            isAxiosError: true,
            message: 'Request failed',
            config: { method: 'post', url: 'https://api.example.com/v1/large' },
            response: {
                status: 500,
                statusText: 'Internal Server Error',
                data: 'x'.repeat(2000)
            }
        };

        const details = extractHttpErrorDetails(error, { maxResponseSnippetLength: 250 });

        expect(details.responseSnippet.length).toBeLessThanOrEqual(250);
        expect(details.status).toBe(500);
        expect(details.url).toBe('https://api.example.com/v1/large');
    });
});

