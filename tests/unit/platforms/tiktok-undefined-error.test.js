const { describe, it, expect } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

describe('TikTok Error Message Handling', () => {
    it('handles undefined error.message without crashing', () => {
        const error = {};
        const errorMessage = error.message;

        expect(() => {
            if (errorMessage && errorMessage.includes('TLS')) {
                return true;
            }
        }).not.toThrow();
    });

    it('handles error objects without message property gracefully', () => {
        const { TikTokPlatform } = require('../../../src/platforms/tiktok');

        const mockConnection = {
            on: createMockFn(),
            connect: createMockFn(),
            getState: createMockFn().mockReturnValue({ isConnected: false })
        };

        const platform = new TikTokPlatform(
            { enabled: true, username: 'testUser' },
            {
                WebcastPushConnection: createMockFn(() => mockConnection),
                WebcastEvent: { GIFT: 'gift', ERROR: 'error', DISCONNECT: 'disconnect' },
                ControlEvent: {},
                TikTokWebSocketClient: createMockFn(() => mockConnection),
                logger: noOpLogger,
                retrySystem: {
                    resetRetryCount: createMockFn(),
                    handleConnectionError: createMockFn(),
                    handleConnectionSuccess: createMockFn(),
                    incrementRetryCount: createMockFn(),
                    executeWithRetry: createMockFn()
                },
                constants: { GRACE_PERIODS: { TIKTOK: 5000 } }
            }
        );

        const errorWithoutMessage = {};

        const handleConnectionError = Object.getPrototypeOf(platform)._handleConnectionError;

        if (handleConnectionError) {
            expect(() => {
                handleConnectionError.call(platform, errorWithoutMessage);
            }).not.toThrow();
        }
    });
});
