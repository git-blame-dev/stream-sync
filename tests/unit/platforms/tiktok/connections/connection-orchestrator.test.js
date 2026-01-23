const { describe, test, expect } = require('bun:test');
const { noOpLogger } = require('../../../../helpers/mock-factories');
const {
    createTikTokConnectionOrchestrator
} = require('../../../../../src/platforms/tiktok/connections/tiktok-connection-orchestrator');

describe('TikTok connection orchestrator', () => {
    const buildPlatform = (overrides = {}) => ({
        logger: noOpLogger,
        config: { username: 'testuser' },
        connectingPromise: null,
        connectionActive: false,
        retryLock: false,
        connection: null,
        listenersConfigured: false,
        checkConnectionPrerequisites: () => ({ canConnect: true }),
        cleanupEventListeners: () => {},
        setupEventListeners: () => {},
        handleConnectionSuccess: async () => {},
        handleConnectionError: () => {},
        cleanup: () => {},
        connectionStateManager: {
            markDisconnected: () => {},
            markConnecting: () => {},
            markError: () => {},
            ensureConnection: () => ({
                connect: async () => {},
                disconnect: async () => {},
                isConnecting: false,
                isConnected: false
            })
        },
        errorHandler: {
            handleConnectionError: () => {},
            handleCleanupError: () => {}
        },
        ...overrides
    });

    test('throws when platform is missing', () => {
        expect(() => createTikTokConnectionOrchestrator({})).toThrow('platform is required');
    });

    test('connect returns undefined when prerequisites fail', async () => {
        const platform = buildPlatform({
            checkConnectionPrerequisites: () => ({ canConnect: false, reason: 'Username is required' })
        });
        const orchestrator = createTikTokConnectionOrchestrator({ platform });

        const result = await orchestrator.connect({});

        expect(result).toBeUndefined();
    });

    test('connect resets stale connecting state before proceeding', async () => {
        const platform = buildPlatform({
            connection: { isConnecting: true, isConnected: false },
            connectionActive: false,
            listenersConfigured: true
        });
        const orchestrator = createTikTokConnectionOrchestrator({ platform });

        await orchestrator.connect({});

        expect(platform.listenersConfigured).toBe(false);
    });

    test('connect returns existing connectingPromise when one exists', async () => {
        const existingPromise = Promise.resolve('existing-result');
        const platform = buildPlatform({ connectingPromise: existingPromise });
        const orchestrator = createTikTokConnectionOrchestrator({ platform });

        const result = await orchestrator.connect({});

        expect(result).toBe('existing-result');
    });

    test('connect returns undefined when already connecting', async () => {
        const platform = buildPlatform({
            connection: { isConnecting: true, isConnected: false },
            connectionActive: true
        });
        const orchestrator = createTikTokConnectionOrchestrator({ platform });

        const result = await orchestrator.connect({});

        expect(result).toBeUndefined();
    });

    test('connect returns undefined when already connected', async () => {
        const platform = buildPlatform({
            connection: { isConnecting: false, isConnected: true },
            connectionActive: true
        });
        const orchestrator = createTikTokConnectionOrchestrator({ platform });

        const result = await orchestrator.connect({});

        expect(result).toBeUndefined();
    });

    test('connect sets platform.connection after successful connection', async () => {
        const mockConnection = {
            connect: async () => {},
            isConnecting: false,
            isConnected: false
        };
        const platform = buildPlatform({
            connectionStateManager: {
                markDisconnected: () => {},
                markConnecting: () => {},
                ensureConnection: () => mockConnection
            }
        });
        const orchestrator = createTikTokConnectionOrchestrator({ platform });

        await orchestrator.connect({});

        expect(platform.connection).toBe(mockConnection);
    });

    test('connect clears connectingPromise after completion', async () => {
        const platform = buildPlatform();
        const orchestrator = createTikTokConnectionOrchestrator({ platform });

        await orchestrator.connect({});

        expect(platform.connectingPromise).toBeNull();
    });

    test('connect propagates connection error', async () => {
        const connectionError = new Error('connection failed');
        const platform = buildPlatform({
            connectionStateManager: {
                markDisconnected: () => {},
                markConnecting: () => {},
                markError: () => {},
                ensureConnection: () => ({
                    connect: async () => { throw connectionError; },
                    isConnecting: false,
                    isConnected: false
                })
            }
        });
        const orchestrator = createTikTokConnectionOrchestrator({ platform });

        await expect(orchestrator.connect({})).rejects.toThrow('connection failed');
    });

    test('connect clears connectingPromise even on error', async () => {
        const platform = buildPlatform({
            connectionStateManager: {
                markDisconnected: () => {},
                markConnecting: () => {},
                markError: () => {},
                ensureConnection: () => ({
                    connect: async () => { throw new Error('fail'); },
                    isConnecting: false,
                    isConnected: false
                })
            }
        });
        const orchestrator = createTikTokConnectionOrchestrator({ platform });

        try {
            await orchestrator.connect({});
        } catch {
            // expected
        }

        expect(platform.connectingPromise).toBeNull();
    });

    test('connect sets connection to null on error when handleConnectionError is missing', async () => {
        const platform = buildPlatform({
            handleConnectionError: null,
            connectionStateManager: {
                markDisconnected: () => {},
                markConnecting: () => {},
                markError: () => {},
                ensureConnection: () => ({
                    connect: async () => { throw new Error('fail'); },
                    isConnecting: false,
                    isConnected: false
                })
            }
        });
        const orchestrator = createTikTokConnectionOrchestrator({ platform });

        try {
            await orchestrator.connect({});
        } catch {
            // expected
        }

        expect(platform.connection).toBeNull();
        expect(platform.listenersConfigured).toBe(false);
    });

    test('disconnect sets connectionActive to false', async () => {
        const platform = buildPlatform({
            connectionActive: true,
            connection: { disconnect: async () => {} }
        });
        const orchestrator = createTikTokConnectionOrchestrator({ platform });

        await orchestrator.disconnect();

        expect(platform.connectionActive).toBe(false);
    });

    test('disconnect completes without error when connection.disconnect fails', async () => {
        const platform = buildPlatform({
            connection: { disconnect: async () => { throw new Error('disconnect error'); } }
        });
        const orchestrator = createTikTokConnectionOrchestrator({ platform });

        await expect(orchestrator.disconnect()).resolves.toBeUndefined();
    });

    test('disconnect completes when no connection exists', async () => {
        const platform = buildPlatform({ connection: null });
        const orchestrator = createTikTokConnectionOrchestrator({ platform });

        await expect(orchestrator.disconnect()).resolves.toBeUndefined();
    });
});
