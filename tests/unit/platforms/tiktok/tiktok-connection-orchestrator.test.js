const {
    createTikTokConnectionOrchestrator
} = require('../../../../src/platforms/tiktok/connection/tiktok-connection-orchestrator');

describe('TikTok connection orchestrator', () => {
    test('connect is a no-op when connection prerequisites fail', async () => {
        const platform = {
            logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
            config: { username: '' },
            connectingPromise: null,
            connectionActive: false,
            retryLock: false,
            connection: null,
            listenersConfigured: false,
            checkConnectionPrerequisites: () => ({ canConnect: false, reason: 'Username is required' }),
            connectionStateManager: {
                markDisconnected: jest.fn(),
                markConnecting: jest.fn(),
                markError: jest.fn(),
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
            errorHandler: { handleConnectionError: jest.fn() }
        };

        const orchestrator = createTikTokConnectionOrchestrator({ platform });

        await expect(orchestrator.connect({})).resolves.toBeUndefined();
        expect(platform.connection).toBeNull();
        expect(platform.connectingPromise).toBeNull();
    });
});

