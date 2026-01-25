
const { describe, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { OBSConnectionManager } = require('../../../src/obs/connection');

describe('OBS Connection Race Condition - User Experience Validation', () => {
    let mockOBS;
    let connectionManager;
    let identifiedCallback;

    beforeEach(() => {
        identifiedCallback = null;

        mockOBS = {
            connect: createMockFn(),
            disconnect: createMockFn().mockResolvedValue(),
            call: createMockFn(),
            on: createMockFn().mockImplementation((event, callback) => {
                if (event === 'Identified') {
                    identifiedCallback = callback;
                }
            }),
            once: createMockFn().mockImplementation((event, callback) => {
                if (event === 'Identified') {
                    identifiedCallback = callback;
                }
            }),
            off: createMockFn()
        };

        connectionManager = new OBSConnectionManager({
            mockOBS,
            isTestEnvironment: true,
            testConnectionBehavior: true,
            config: {
                address: 'ws://localhost:4455',
                password: 'test123',
                enabled: true,
                connectionTimeoutMs: 5000
            }
        });
    });

    afterEach(() => {
        restoreAllMocks();
        clearAllMocks();
    });

    describe('Connection Readiness Behavior', () => {
        it('should NOT allow API calls until Identified event fires', async () => {
            mockOBS.connect.mockResolvedValue({
                obsWebSocketVersion: '5.0.0',
                negotiatedRpcVersion: 1
            });

            const connectPromise = connectionManager.connect();

            let connectResolved = false;
            connectPromise.then(() => { connectResolved = true; }).catch(() => { connectResolved = true; });

            await waitForDelay(50);

            expect(connectResolved).toBe(false);
            expect(connectionManager.isConnected()).toBe(false);

            if (identifiedCallback) {
                identifiedCallback();
                await connectPromise;
                expect(connectionManager.isConnected()).toBe(true);
            } else {
                throw new Error('identifiedCallback was not captured properly');
            }
        });

        it('should prevent API calls during the authentication window', async () => {
            mockOBS.connect.mockResolvedValue({
                obsWebSocketVersion: '5.0.0',
                negotiatedRpcVersion: 1
            });

            const connectPromise = connectionManager.connect();

            await waitForDelay(50);

            expect(connectionManager.isConnected()).toBe(false);

            await expect(connectionManager.call('GetSceneList')).rejects.toThrow(/not connected/i);

            if (identifiedCallback) {
                identifiedCallback();
                await connectPromise;
                expect(connectionManager.isConnected()).toBe(true);
            } else {
                throw new Error('identifiedCallback was not captured properly');
            }
        });
    });
});
