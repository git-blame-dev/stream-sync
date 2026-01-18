const { describe, test, expect } = require('bun:test');
const { createMockFn } = require('../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../helpers/mock-factories');
const {
    createTikTokConnectionOrchestrator
} = require('../../../../src/platforms/tiktok/connection/tiktok-connection-orchestrator');

describe('TikTok connection orchestrator', () => {
    test('connect is a no-op when connection prerequisites fail', async () => {
        const platform = {
            logger: noOpLogger,
            config: { username: '' },
            connectingPromise: null,
            connectionActive: false,
            retryLock: false,
            connection: null,
            listenersConfigured: false,
            checkConnectionPrerequisites: () => ({ canConnect: false, reason: 'Username is required' }),
            connectionStateManager: {
                markDisconnected: createMockFn(),
                markConnecting: createMockFn(),
                markError: createMockFn(),
                ensureConnection: () => {
                    throw new Error('ensureConnection should not be called');
                }
            },
            setupEventListeners: () => {
                throw new Error('setupEventListeners should not be called');
            },
            handleConnectionSuccess: async () => {
                throw new Error('handleConnectionSuccess should not be called');
            },
            errorHandler: { handleConnectionError: createMockFn() }
        };

        const orchestrator = createTikTokConnectionOrchestrator({ platform });

        await expect(orchestrator.connect({})).resolves.toBeUndefined();
        expect(platform.connection).toBeNull();
        expect(platform.connectingPromise).toBeNull();
    });
});

