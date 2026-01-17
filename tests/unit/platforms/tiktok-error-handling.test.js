const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks, spyOn } = require('../../helpers/bun-mock-utils');
const { expectNoTechnicalArtifacts } = require('../../helpers/assertion-helpers');

describe('TikTokPlatform Error Handling', () => {
    let TikTokPlatform;
    let logger;
    let mockConnection;
    let mockRetrySystem;
    let baseConfig;
    let baseDependencies;

    beforeEach(() => {
        ({ TikTokPlatform } = require('../../../src/platforms/tiktok'));

        logger = {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };

        mockConnection = {
            connect: createMockFn(),
            fetchIsLive: createMockFn(),
            waitUntilLive: createMockFn(),
            on: createMockFn(),
            getState: createMockFn().mockReturnValue({ isConnected: false })
        };

        mockRetrySystem = {
            handleConnectionError: createMockFn(),
            handleConnectionSuccess: createMockFn(),
            resetRetryCount: createMockFn(),
            incrementRetryCount: createMockFn(),
            executeWithRetry: createMockFn()
        };

        baseConfig = {
            enabled: true,
            username: 'testUser',
            apiKey: 'testKey',
            dataLoggingEnabled: false
        };

        baseDependencies = {
            logger,
            retrySystem: mockRetrySystem,
            WebcastPushConnection: createMockFn(() => mockConnection),
            WebcastEvent: { GIFT: 'gift', FOLLOW: 'follow', CHAT: 'chat' },
            ControlEvent: {},
            TikTokWebSocketClient: createMockFn(() => mockConnection)
        };
    });

    afterEach(() => {
        restoreAllMocks();
    });

    describe('handleConnectionError', () => {
        test('handles error object without message property without crashing', () => {
            const platform = new TikTokPlatform(baseConfig, baseDependencies);
            const errorWithoutMessage = {};

            expect(() => {
                platform.handleConnectionError(errorWithoutMessage);
            }).not.toThrow();
        });

        test('handles null error gracefully', () => {
            const platform = new TikTokPlatform(baseConfig, baseDependencies);

            expect(() => {
                platform.handleConnectionError(null);
            }).not.toThrow();
        });

        test('handles string error properly', () => {
            const platform = new TikTokPlatform(baseConfig, baseDependencies);
            const stringError = 'Connection timeout';

            expect(() => {
                platform.handleConnectionError(stringError);
            }).not.toThrow();
        });

        test('provides specific guidance for TLS errors', () => {
            const platform = new TikTokPlatform(baseConfig, baseDependencies);
            const tlsError = new Error('Client network socket disconnected before secure TLS connection was established');

            platform.handleConnectionError(tlsError);

            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('TLS/Network connection failed'),
                'tiktok'
            );
        });

        test('provides guidance for room info retrieval failures', () => {
            const platform = new TikTokPlatform(baseConfig, baseDependencies);
            const roomError = new Error('Failed to retrieve room info');

            platform.handleConnectionError(roomError);

            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Room info retrieval failed'),
                'tiktok'
            );
        });

        test('provides guidance for timeout errors', () => {
            const platform = new TikTokPlatform(baseConfig, baseDependencies);
            const timeoutError = new Error('Connection timeout exceeded');

            platform.handleConnectionError(timeoutError);

            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('timeout'),
                'tiktok'
            );
        });

        test('cleans up connection state after error', () => {
            const platform = new TikTokPlatform(baseConfig, baseDependencies);
            platform.connection = mockConnection;
            platform.connectionActive = true;
            platform.listenersConfigured = true;

            platform.handleConnectionError(new Error('Test error'));

            expect(platform.connection).toBeNull();
            expect(platform.connectionActive).toBe(false);
            expect(platform.listenersConfigured).toBe(false);
        });

        test('triggers retry system on error', () => {
            const platform = new TikTokPlatform(baseConfig, baseDependencies);

            platform.handleConnectionError(new Error('Test error'));

            expect(mockRetrySystem.handleConnectionError).toHaveBeenCalled();
        });
    });

    describe('stream not live detection', () => {
        test('detects stream not live error and logs appropriate warning', () => {
            const platform = new TikTokPlatform(baseConfig, baseDependencies);
            const notLiveError = new Error('Stream is not live');

            platform.handleConnectionError(notLiveError);

            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('not live'),
                'tiktok'
            );
        });
    });
});
