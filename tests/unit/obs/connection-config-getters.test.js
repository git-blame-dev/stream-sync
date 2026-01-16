
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { initializeTestLogging } = require('../../helpers/test-setup');
const { OBSConnectionManager, initializeOBSConnection } = require('../../../src/obs/connection');

// Initialize logging system for tests
initializeTestLogging();

describe('OBS Connection Configuration with Getter Properties', () => {
    let mockOBSWebSocket;
    let mockLogger;
    let obsManager;

    beforeEach(() => {
        // Create mock OBS WebSocket
        mockOBSWebSocket = createMockFn().mockImplementation(() => ({
            connect: createMockFn().mockResolvedValue({
                obsWebSocketVersion: '5.0.0',
                negotiatedRpcVersion: '1'
            }),
            disconnect: createMockFn().mockResolvedValue(),
            call: createMockFn().mockResolvedValue({}),
            on: createMockFn(),
            off: createMockFn(),
            identified: false
        }));

        mockLogger = {
            debug: createMockFn(),
            info: createMockFn(),
            error: createMockFn(),
            warn: createMockFn()
        };
    });

    afterEach(() => {
        restoreAllMocks();
        clearAllMocks();
    });

    describe('Configuration with Getter Properties', () => {
        
        test('should correctly extract address from config object with getters', () => {
            // Create a config object with getter properties (like config.ini module provides)
            const configWithGetters = {
                get address() { return 'ws://custom-obs-server:4444'; },
                get password() { return 'secret123'; },
                get enabled() { return true; }
            };

            // Initialize OBS manager with getter-based config
            obsManager = new OBSConnectionManager({
                config: configWithGetters,
                OBSWebSocket: mockOBSWebSocket,
                logger: mockLogger,
                isTestEnvironment: false
            });

            // Behavior validation: OBS should use the correct address from getters
            expect(obsManager.config.address).toBe('ws://custom-obs-server:4444');
            expect(obsManager.config.password).toBe('secret123');
            expect(obsManager.config.enabled).toBe(true);
        });

        test('should properly handle config with getters vs naive spread approach', () => {
            // Create a config object with getters (like config.ini module provides)
            const configWithGetters = {
                get address() { return 'ws://test-server:4455'; },
                get password() { return 'test-pass'; },
                get enabled() { return false; }
            };

            // This is what the OBSConnectionManager does correctly:
            // Explicit property extraction (current implementation)
            const correctConfig = {
                address: configWithGetters.address,
                password: configWithGetters.password,
                enabled: configWithGetters.enabled
            };

            // Verify the correct approach works
            expect(correctConfig.address).toBe('ws://test-server:4455');
            expect(correctConfig.password).toBe('test-pass');
            expect(correctConfig.enabled).toBe(false);

            // Test that the OBSConnectionManager handles this correctly
            const obsManager = new OBSConnectionManager({
                config: configWithGetters,
                OBSWebSocket: mockOBSWebSocket,
                isTestEnvironment: true
            });

            // The manager should correctly extract values from getters
            expect(obsManager.config.address).toBe('ws://test-server:4455');
            expect(obsManager.config.password).toBe('test-pass');
            expect(obsManager.config.enabled).toBe(false);
        });

        test('should handle updateConfig with getter-based configuration', () => {
            // Create mock constants for proper injection
            const mockConstants = {
                OBS_CONNECTION_TIMEOUT: 5000,
                ERROR_MESSAGES: {
                    OBS_CONNECTION_TIMEOUT: 'OBS connection timeout',
                    OBS_NOT_CONNECTED: 'OBS not connected'
                }
            };

            // Initial config with no defaults
            obsManager = new OBSConnectionManager({
                OBSWebSocket: mockOBSWebSocket,
                constants: mockConstants,
                isTestEnvironment: true // Use test environment to avoid logger complications
            });

            // Verify initial config state
            expect(obsManager.config.address).toBeUndefined();
            expect(obsManager.config.password).toBeUndefined();
            expect(obsManager.config.enabled).toBeUndefined();

            // Update with getter-based config
            const newConfigWithGetters = {
                get address() { return 'ws://updated-server:5555'; },
                get password() { return 'updated-password'; },
                get enabled() { return false; }
            };

            obsManager.updateConfig(newConfigWithGetters);

            // Behavior validation: Configuration should be updated correctly
            expect(obsManager.config.address).toBe('ws://updated-server:5555');
            expect(obsManager.config.password).toBe('updated-password');
            expect(obsManager.config.enabled).toBe(false);
        });

        test('should connect to OBS using address from getter-based config', async () => {
            // Create config with getters
            const configWithGetters = {
                get address() { return 'ws://production-obs:6666'; },
                get password() { return 'prod-secret'; },
                get enabled() { return true; }
            };

            // Create mock OBS instance that properly simulates connection
            let identifiedHandler = null;
            const mockOBSInstance = {
                connect: createMockFn().mockImplementation(async () => {
                    // Simulate the 'Identified' event after successful connection
                    if (identifiedHandler) {
                        scheduleTestTimeout(() => identifiedHandler(), 10);
                    }
                    return {
                        obsWebSocketVersion: '5.0.0',
                        negotiatedRpcVersion: '1'
                    };
                }),
                disconnect: createMockFn().mockResolvedValue(),
                call: createMockFn().mockResolvedValue({}),
                on: createMockFn().mockImplementation((event, callback) => {
                    if (event === 'Identified') {
                        identifiedHandler = callback;
                    }
                }),
                off: createMockFn(),
                identified: false
            };

            mockOBSWebSocket.mockReturnValue(mockOBSInstance);

            // Initialize OBS manager
            obsManager = new OBSConnectionManager({
                config: configWithGetters,
                OBSWebSocket: mockOBSWebSocket,
                logger: mockLogger,
                isTestEnvironment: false
            });

            // Attempt connection
            await obsManager.connect();

            // Behavior validation: Should connect with correct address and password from getters
            expect(mockOBSInstance.connect).toHaveBeenCalledWith(
                'ws://production-obs:6666',
                'prod-secret'
            );
        });

        test('should handle partial getter-based config updates', () => {
            // Initial config
            obsManager = new OBSConnectionManager({
                config: {
                    address: 'ws://initial:4455',
                    password: 'initial-pass',
                    enabled: true
                },
                OBSWebSocket: mockOBSWebSocket,
                logger: mockLogger,
                isTestEnvironment: false
            });

            // Update with partial getter-based config (only address)
            const partialGetterConfig = {
                get address() { return 'ws://partial-update:7777'; }
                // Note: no password or enabled getters
            };

            obsManager.updateConfig(partialGetterConfig);

            // Behavior validation: Only address should update, others remain
            expect(obsManager.config.address).toBe('ws://partial-update:7777');
            expect(obsManager.config.password).toBe('initial-pass'); // Unchanged
            expect(obsManager.config.enabled).toBe(true); // Unchanged
        });

        test('should handle mixed getter and regular properties in config', () => {
            // Config with mixed getter and regular properties
            const mixedConfig = {
                get address() { return 'ws://getter-address:8888'; },
                password: 'regular-password', // Regular property
                get enabled() { return false; }
            };

            obsManager = new OBSConnectionManager({
                config: mixedConfig,
                OBSWebSocket: mockOBSWebSocket,
                logger: mockLogger,
                isTestEnvironment: false
            });

            // Behavior validation: Both getter and regular properties should work
            expect(obsManager.config.address).toBe('ws://getter-address:8888');
            expect(obsManager.config.password).toBe('regular-password');
            expect(obsManager.config.enabled).toBe(false);
        });

        test('should properly initialize OBS connection with getter-based config', async () => {
            // Config object with getters (simulating config.ini module)
            const configModuleStyle = {
                get address() { return 'ws://init-test:9999'; },
                get password() { return 'init-password'; },
                get enabled() { return true; }
            };

            // Create mock OBS instance that properly simulates connection
            let identifiedHandler = null;
            const mockOBSInstance = {
                connect: createMockFn().mockImplementation(async () => {
                    // Simulate the 'Identified' event after successful connection
                    if (identifiedHandler) {
                        scheduleTestTimeout(() => identifiedHandler(), 10);
                    }
                    return {
                        obsWebSocketVersion: '5.0.0',
                        negotiatedRpcVersion: '1'
                    };
                }),
                disconnect: createMockFn().mockResolvedValue(),
                call: createMockFn().mockResolvedValue({}),
                on: createMockFn().mockImplementation((event, callback) => {
                    if (event === 'Identified') {
                        identifiedHandler = callback;
                    }
                }),
                off: createMockFn(),
                identified: false
            };

            mockOBSWebSocket.mockReturnValue(mockOBSInstance);

            // Initialize through the main initialization function
            const manager = await initializeOBSConnection(configModuleStyle, {
                OBSWebSocket: mockOBSWebSocket,
                logger: mockLogger,
                isTestEnvironment: false
            });

            // Behavior validation: Should initialize with correct config from getters
            expect(manager.config.address).toBe('ws://init-test:9999');
            expect(manager.config.password).toBe('init-password');
            expect(manager.config.enabled).toBe(true);

            // Should attempt connection since enabled is true
            expect(mockOBSInstance.connect).toHaveBeenCalledWith(
                'ws://init-test:9999',
                'init-password'
            );
        });

        test('should not lose config values when using getConfig() method', () => {
            // Config with getters
            const getterConfig = {
                get address() { return 'ws://config-test:3333'; },
                get password() { return 'config-password'; },
                get enabled() { return true; }
            };

            obsManager = new OBSConnectionManager({
                config: getterConfig,
                OBSWebSocket: mockOBSWebSocket,
                logger: mockLogger,
                isTestEnvironment: false
            });

            // Get config copy
            const configCopy = obsManager.getConfig();

            // Behavior validation: getConfig should return proper values from getters
            expect(configCopy.address).toBe('ws://config-test:3333');
            expect(configCopy.password).toBe('config-password');
            expect(configCopy.enabled).toBe(true);

            // Config copy should be a plain object, not have getters
            const descriptor = Object.getOwnPropertyDescriptor(configCopy, 'address');
            expect(descriptor.get).toBeUndefined(); // Should not be a getter
            expect(descriptor.value).toBe('ws://config-test:3333'); // Should be a value
        });

        test('should maintain connection state with getter-based enabled property', () => {
            // Config where enabled is a getter that returns false
            const disabledConfig = {
                get address() { return 'ws://disabled-server:2222'; },
                get password() { return 'disabled-pass'; },
                get enabled() { return false; }
            };

            obsManager = new OBSConnectionManager({
                config: disabledConfig,
                OBSWebSocket: mockOBSWebSocket,
                logger: mockLogger,
                isTestEnvironment: false
            });

            // Get connection state
            const state = obsManager.getConnectionState();

            // Behavior validation: Connection state should reflect getter values
            expect(state.config.address).toBe('ws://disabled-server:2222');
            expect(state.config.password).toBe('disabled-pass');
            expect(state.config.enabled).toBe(false);
            expect(state.isConnected).toBe(false); // Should not be connected when disabled
        });
    });

        test('should demonstrate the importance of explicit property extraction', () => {
            const savedPassword = process.env.OBS_PASSWORD;
            const savedDisable = process.env.DISABLE_OBS;
            delete process.env.OBS_PASSWORD;
            delete process.env.DISABLE_OBS;

            try {
                const dynamicConfig = {
                    _baseAddress: 'ws://computed-server',
                    _port: 4455,
                    get address() {
                        return `${this._baseAddress}:${this._port}`;
                    },
                    get password() {
                        return process.env.OBS_PASSWORD || 'fallback-password';
                    },
                    get enabled() {
                        return !process.env.DISABLE_OBS;
                    }
                };

                const obsManager = new OBSConnectionManager({
                    config: dynamicConfig,
                    OBSWebSocket: mockOBSWebSocket,
                    isTestEnvironment: true
                });

                expect(obsManager.config.address).toBe('ws://computed-server:4455');
                expect(typeof obsManager.config.address).toBe('string');
                expect(obsManager.config.password).toBe('fallback-password');
                expect(obsManager.config.enabled).toBe(true);
            } finally {
                if (savedPassword !== undefined) process.env.OBS_PASSWORD = savedPassword;
                if (savedDisable !== undefined) process.env.DISABLE_OBS = savedDisable;
            }
        });

    describe('Edge Cases and Error Scenarios', () => {
        
        test('should handle undefined getter values gracefully', () => {
            // Config with getters that might return undefined
            const configWithUndefined = {
                get address() { return undefined; },
                get password() { return undefined; },
                get enabled() { return undefined; }
            };

            obsManager = new OBSConnectionManager({
                config: configWithUndefined,
                OBSWebSocket: mockOBSWebSocket,
                logger: mockLogger,
                isTestEnvironment: false
            });

            // Should surface undefined values when getters return undefined
            expect(obsManager.config.address).toBeUndefined();
            expect(obsManager.config.password).toBeUndefined();
            expect(obsManager.config.enabled).toBeUndefined();
        });

        test('should handle getter that throws an error', () => {
            // Config with a getter that throws
            const configWithError = {
                get address() { 
                    throw new Error('Config not loaded'); 
                },
                get password() { return 'valid-password'; },
                get enabled() { return true; }
            };

            // Should handle the error gracefully
            expect(() => {
                obsManager = new OBSConnectionManager({
                    config: configWithError,
                    OBSWebSocket: mockOBSWebSocket,
                    logger: mockLogger,
                    isTestEnvironment: false
                });
            }).toThrow('Config not loaded');
        });

        test('should validate that fix handles nested config objects with getters', () => {
            // Nested config structure with getters
            const nestedConfig = {
                obs: {
                    get address() { return 'ws://nested:1111'; },
                    get password() { return 'nested-pass'; },
                    get enabled() { return true; }
                }
            };

            // Pass the nested obs config
            obsManager = new OBSConnectionManager({
                config: nestedConfig.obs,
                OBSWebSocket: mockOBSWebSocket,
                logger: mockLogger,
                isTestEnvironment: false
            });

            // Should correctly extract from nested getter config
            expect(obsManager.config.address).toBe('ws://nested:1111');
            expect(obsManager.config.password).toBe('nested-pass');
            expect(obsManager.config.enabled).toBe(true);
        });
    });

    describe('User Behavior Validation', () => {
        
        test('user should see OBS connection established with custom server from config', async () => {
            // User has configured OBS with custom server in config.ini
            const userConfig = {
                get address() { return 'ws://streaming-pc:4455'; },
                get password() { return 'stream-password'; },
                get enabled() { return true; }
            };

            // Create mock constants
            const mockConstants = {
                OBS_CONNECTION_TIMEOUT: 5000,
                ERROR_MESSAGES: {
                    OBS_CONNECTION_TIMEOUT: 'OBS connection timeout',
                    OBS_NOT_CONNECTED: 'OBS not connected'
                }
            };

            // Create mock OBS instance that properly simulates connection
            let identifiedHandler = null;
            const mockOBSInstance = {
                connect: createMockFn().mockImplementation(async () => {
                    // Simulate the 'Identified' event after successful connection
                    if (identifiedHandler) {
                        scheduleTestTimeout(() => identifiedHandler(), 10);
                    }
                    return {
                        obsWebSocketVersion: '5.0.0',
                        negotiatedRpcVersion: '1'
                    };
                }),
                disconnect: createMockFn().mockResolvedValue(),
                call: createMockFn().mockResolvedValue({}),
                on: createMockFn().mockImplementation((event, callback) => {
                    if (event === 'Identified') {
                        identifiedHandler = callback;
                    }
                }),
                off: createMockFn(),
                identified: false
            };

            mockOBSWebSocket.mockReturnValue(mockOBSInstance);

            // User starts the bot
            obsManager = new OBSConnectionManager({
                config: userConfig,
                OBSWebSocket: mockOBSWebSocket,
                constants: mockConstants,
                isTestEnvironment: false // Keep false to test connection behavior
            });

            // Bot attempts to connect
            await obsManager.connect();

            // User expectation: Bot connects to their configured OBS instance
            expect(mockOBSInstance.connect).toHaveBeenCalledWith(
                'ws://streaming-pc:4455',
                'stream-password'
            );

            // Verify connection was established (behavior validation)
            const connectionState = obsManager.getConnectionState();
            expect(connectionState.config.address).toBe('ws://streaming-pc:4455');
            expect(connectionState.config.password).toBe('stream-password');
        });

        test('user should be able to update OBS settings without restarting bot', () => {
            // Create mock constants
            const mockConstants = {
                OBS_CONNECTION_TIMEOUT: 5000,
                ERROR_MESSAGES: {
                    OBS_CONNECTION_TIMEOUT: 'OBS connection timeout',
                    OBS_NOT_CONNECTED: 'OBS not connected'
                }
            };

            // User initially starts with one config
            obsManager = new OBSConnectionManager({
                config: {
                    get address() { return 'ws://old-server:4455'; },
                    get password() { return 'old-pass'; },
                    get enabled() { return true; }
                },
                OBSWebSocket: mockOBSWebSocket,
                constants: mockConstants,
                isTestEnvironment: true // Use test environment for simplicity
            });

            expect(obsManager.config.address).toBe('ws://old-server:4455');

            // User updates config while bot is running
            const updatedConfig = {
                get address() { return 'ws://new-server:6666'; },
                get password() { return 'new-pass'; },
                get enabled() { return true; }
            };

            obsManager.updateConfig(updatedConfig);

            // User expectation: New settings take effect immediately
            expect(obsManager.config.address).toBe('ws://new-server:6666');
            expect(obsManager.config.password).toBe('new-pass');

            // Verify updated settings are active (behavior validation)
            const finalState = obsManager.getConnectionState();
            expect(finalState.config.address).toBe('ws://new-server:6666');
            expect(finalState.config.password).toBe('new-pass');
        });
    });
});
