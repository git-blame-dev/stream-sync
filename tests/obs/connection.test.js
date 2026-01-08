
const { OBSConnectionManager } = require('../../src/obs/connection');

describe('OBS Connection Race Condition - User Experience Validation', () => {
    let mockOBS;
    let connectionManager;
    let identifiedCallback;
    let connectionOpenedCallback;

    beforeEach(() => {
        // Reset callbacks
        identifiedCallback = null;
        connectionOpenedCallback = null;
        
        // Create a properly mocked OBS WebSocket
        mockOBS = {
            connect: jest.fn(),
            disconnect: jest.fn().mockResolvedValue(),
            call: jest.fn(),
            on: jest.fn().mockImplementation((event, callback) => {
                if (event === 'Identified') {
                    identifiedCallback = callback;
                } else if (event === 'ConnectionOpened') {
                    connectionOpenedCallback = callback;
                }
            }),
            once: jest.fn().mockImplementation((event, callback) => {
                if (event === 'Identified') {
                    identifiedCallback = callback;
                } else if (event === 'ConnectionOpened') {
                    connectionOpenedCallback = callback;
                }
            }),
            off: jest.fn()
        };

        // Create the connection manager with mock
        connectionManager = new OBSConnectionManager({
            mockOBS,
            isTestEnvironment: true, // Use test environment to ensure mock is used
            testConnectionBehavior: true, // But test actual connection behavior
            config: {
                address: 'ws://localhost:4455',  
                password: 'test123',
                enabled: true
            }
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Connection Readiness Behavior', () => {
        it('should NOT allow API calls until Identified event fires', async () => {
            // Given: OBS connection that simulates the real sequence
            mockOBS.connect.mockResolvedValue({
                obsWebSocketVersion: '5.0.0',
                negotiatedRpcVersion: 1
            });

            // When: User initiates connection
            const connectPromise = connectionManager.connect();
            
            // CRITICAL TEST: Track if connect() resolved
            let connectResolved = false;
            connectPromise.then(() => { connectResolved = true; }).catch(() => { connectResolved = true; });
            
            // Give connect() time to resolve (but Identified hasn't fired yet)
            await waitForDelay(50);
            
            // Expected behavior: connect() should NOT resolve until Identified fires
            expect(connectResolved).toBe(false); // Should NOT resolve until Identified
            expect(connectionManager.isConnected()).toBe(false); // Should be false until Identified
            
            // Now fire the Identified event using the captured callback
            if (identifiedCallback) {
                identifiedCallback();
                // Wait for connect() promise to resolve after Identified
                await connectPromise;
                // Expected behavior:
                // - connect() should now resolve after Identified fires
                // - This ensures API calls can only be made when truly ready
                expect(connectionManager.isConnected()).toBe(true); // Should be true after Identified
            } else {
                throw new Error('identifiedCallback was not captured properly');
            }
        });

        it('should prevent API calls during the authentication window', async () => {
            // Given: Connection that immediately resolves at WebSocket level
            mockOBS.connect.mockResolvedValue({
                obsWebSocketVersion: '5.0.0',
                negotiatedRpcVersion: 1
            });

            // When: Connection initiated
            const connectPromise = connectionManager.connect();
            
            // Give time for WebSocket connection but before Identified
            await waitForDelay(50);
            
            // Then: Without Identified event, isConnected should be false
            expect(connectionManager.isConnected()).toBe(false);
            
            // API calls should fail if not truly connected
            await expect(connectionManager.call('GetSceneList')).rejects.toThrow(/not connected/i);
            
            // Now fire the Identified event using the captured callback
            if (identifiedCallback) {
                identifiedCallback();
                // Wait for connect promise to resolve after Identified
                await connectPromise;
                // Now API calls should work
                expect(connectionManager.isConnected()).toBe(true);
            } else {
                throw new Error('identifiedCallback was not captured properly');
            }
        });
    });
});
