const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

const { initializeTestLogging } = require('../../helpers/test-setup');
const { OBSConnectionManager, initializeOBSConnection } = require('../../../src/obs/connection');

initializeTestLogging();

describe('OBS Connection Configuration with Getter Properties', () => {
    let mockOBSWebSocket;
    let obsManager;

    beforeEach(() => {
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
    });

    afterEach(() => {
        restoreAllMocks();
        clearAllMocks();
    });

    describe('Configuration with Getter Properties', () => {

        test('should correctly extract address from config object with getters', () => {
            const configWithGetters = {
                get address() { return 'ws://custom-obs-server:4444'; },
                get password() { return 'secret123'; },
                get enabled() { return true; }
            };

            obsManager = new OBSConnectionManager({
                config: configWithGetters,
                OBSWebSocket: mockOBSWebSocket,
                logger: noOpLogger,
                isTestEnvironment: false
            });

            expect(obsManager.config.address).toBe('ws://custom-obs-server:4444');
            expect(obsManager.config.password).toBe('secret123');
            expect(obsManager.config.enabled).toBe(true);
        });

        test('should properly handle config with getters vs naive spread approach', () => {
            const configWithGetters = {
                get address() { return 'ws://test-server:4455'; },
                get password() { return 'test-pass'; },
                get enabled() { return false; }
            };

            const correctConfig = {
                address: configWithGetters.address,
                password: configWithGetters.password,
                enabled: configWithGetters.enabled
            };

            expect(correctConfig.address).toBe('ws://test-server:4455');
            expect(correctConfig.password).toBe('test-pass');
            expect(correctConfig.enabled).toBe(false);

            const obsManager = new OBSConnectionManager({
                config: configWithGetters,
                OBSWebSocket: mockOBSWebSocket,
                isTestEnvironment: true
            });

            expect(obsManager.config.address).toBe('ws://test-server:4455');
            expect(obsManager.config.password).toBe('test-pass');
            expect(obsManager.config.enabled).toBe(false);
        });

        test('should handle updateConfig with getter-based configuration', () => {
            const mockConstants = {
                OBS_CONNECTION_TIMEOUT: 5000,
                ERROR_MESSAGES: {
                    OBS_CONNECTION_TIMEOUT: 'OBS connection timeout',
                    OBS_NOT_CONNECTED: 'OBS not connected'
                }
            };

            obsManager = new OBSConnectionManager({
                OBSWebSocket: mockOBSWebSocket,
                constants: mockConstants,
                isTestEnvironment: true
            });

            expect(obsManager.config.address).toBeUndefined();
            expect(obsManager.config.password).toBeUndefined();
            expect(obsManager.config.enabled).toBeUndefined();

            const newConfigWithGetters = {
                get address() { return 'ws://updated-server:5555'; },
                get password() { return 'updated-password'; },
                get enabled() { return false; }
            };

            obsManager.updateConfig(newConfigWithGetters);

            expect(obsManager.config.address).toBe('ws://updated-server:5555');
            expect(obsManager.config.password).toBe('updated-password');
            expect(obsManager.config.enabled).toBe(false);
        });

        test('should connect to OBS using address from getter-based config', async () => {
            const configWithGetters = {
                get address() { return 'ws://production-obs:6666'; },
                get password() { return 'prod-secret'; },
                get enabled() { return true; }
            };

            let identifiedHandler = null;
            const mockOBSInstance = {
                connect: createMockFn().mockImplementation(async () => {
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

            obsManager = new OBSConnectionManager({
                config: configWithGetters,
                OBSWebSocket: mockOBSWebSocket,
                logger: noOpLogger,
                isTestEnvironment: false
            });

            await obsManager.connect();

            expect(mockOBSInstance.connect).toHaveBeenCalledWith(
                'ws://production-obs:6666',
                'prod-secret'
            );
        });

        test('should handle partial getter-based config updates', () => {
            obsManager = new OBSConnectionManager({
                config: {
                    address: 'ws://initial:4455',
                    password: 'initial-pass',
                    enabled: true
                },
                OBSWebSocket: mockOBSWebSocket,
                logger: noOpLogger,
                isTestEnvironment: false
            });

            const partialGetterConfig = {
                get address() { return 'ws://partial-update:7777'; }
            };

            obsManager.updateConfig(partialGetterConfig);

            expect(obsManager.config.address).toBe('ws://partial-update:7777');
            expect(obsManager.config.password).toBe('initial-pass');
            expect(obsManager.config.enabled).toBe(true);
        });

        test('should handle mixed getter and regular properties in config', () => {
            const mixedConfig = {
                get address() { return 'ws://getter-address:8888'; },
                password: 'regular-password',
                get enabled() { return false; }
            };

            obsManager = new OBSConnectionManager({
                config: mixedConfig,
                OBSWebSocket: mockOBSWebSocket,
                logger: noOpLogger,
                isTestEnvironment: false
            });

            expect(obsManager.config.address).toBe('ws://getter-address:8888');
            expect(obsManager.config.password).toBe('regular-password');
            expect(obsManager.config.enabled).toBe(false);
        });

        test('should properly initialize OBS connection with getter-based config', async () => {
            const configModuleStyle = {
                get address() { return 'ws://init-test:9999'; },
                get password() { return 'init-password'; },
                get enabled() { return true; }
            };

            let identifiedHandler = null;
            const mockOBSInstance = {
                connect: createMockFn().mockImplementation(async () => {
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

            const manager = await initializeOBSConnection(configModuleStyle, {
                OBSWebSocket: mockOBSWebSocket,
                logger: noOpLogger,
                isTestEnvironment: false
            });

            expect(manager.config.address).toBe('ws://init-test:9999');
            expect(manager.config.password).toBe('init-password');
            expect(manager.config.enabled).toBe(true);

            expect(mockOBSInstance.connect).toHaveBeenCalledWith(
                'ws://init-test:9999',
                'init-password'
            );
        });

        test('should not lose config values when using getConfig() method', () => {
            const getterConfig = {
                get address() { return 'ws://config-test:3333'; },
                get password() { return 'config-password'; },
                get enabled() { return true; }
            };

            obsManager = new OBSConnectionManager({
                config: getterConfig,
                OBSWebSocket: mockOBSWebSocket,
                logger: noOpLogger,
                isTestEnvironment: false
            });

            const configCopy = obsManager.getConfig();

            expect(configCopy.address).toBe('ws://config-test:3333');
            expect(configCopy.password).toBe('config-password');
            expect(configCopy.enabled).toBe(true);

            const descriptor = Object.getOwnPropertyDescriptor(configCopy, 'address');
            expect(descriptor.get).toBeUndefined();
            expect(descriptor.value).toBe('ws://config-test:3333');
        });

        test('should maintain connection state with getter-based enabled property', () => {
            const disabledConfig = {
                get address() { return 'ws://disabled-server:2222'; },
                get password() { return 'disabled-pass'; },
                get enabled() { return false; }
            };

            obsManager = new OBSConnectionManager({
                config: disabledConfig,
                OBSWebSocket: mockOBSWebSocket,
                logger: noOpLogger,
                isTestEnvironment: false
            });

            const state = obsManager.getConnectionState();

            expect(state.config.address).toBe('ws://disabled-server:2222');
            expect(state.config.password).toBe('disabled-pass');
            expect(state.config.enabled).toBe(false);
            expect(state.isConnected).toBe(false);
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
            const configWithUndefined = {
                get address() { return undefined; },
                get password() { return undefined; },
                get enabled() { return undefined; }
            };

            obsManager = new OBSConnectionManager({
                config: configWithUndefined,
                OBSWebSocket: mockOBSWebSocket,
                logger: noOpLogger,
                isTestEnvironment: false
            });

            expect(obsManager.config.address).toBeUndefined();
            expect(obsManager.config.password).toBeUndefined();
            expect(obsManager.config.enabled).toBeUndefined();
        });

        test('should handle getter that throws an error', () => {
            const configWithError = {
                get address() {
                    throw new Error('Config not loaded');
                },
                get password() { return 'valid-password'; },
                get enabled() { return true; }
            };

            expect(() => {
                obsManager = new OBSConnectionManager({
                    config: configWithError,
                    OBSWebSocket: mockOBSWebSocket,
                    logger: noOpLogger,
                    isTestEnvironment: false
                });
            }).toThrow('Config not loaded');
        });

        test('should validate that fix handles nested config objects with getters', () => {
            const nestedConfig = {
                obs: {
                    get address() { return 'ws://nested:1111'; },
                    get password() { return 'nested-pass'; },
                    get enabled() { return true; }
                }
            };

            obsManager = new OBSConnectionManager({
                config: nestedConfig.obs,
                OBSWebSocket: mockOBSWebSocket,
                logger: noOpLogger,
                isTestEnvironment: false
            });

            expect(obsManager.config.address).toBe('ws://nested:1111');
            expect(obsManager.config.password).toBe('nested-pass');
            expect(obsManager.config.enabled).toBe(true);
        });
    });

    describe('User Behavior Validation', () => {

        test('user should see OBS connection established with custom server from config', async () => {
            const userConfig = {
                get address() { return 'ws://streaming-pc:4455'; },
                get password() { return 'stream-password'; },
                get enabled() { return true; }
            };

            const mockConstants = {
                OBS_CONNECTION_TIMEOUT: 5000,
                ERROR_MESSAGES: {
                    OBS_CONNECTION_TIMEOUT: 'OBS connection timeout',
                    OBS_NOT_CONNECTED: 'OBS not connected'
                }
            };

            let identifiedHandler = null;
            const mockOBSInstance = {
                connect: createMockFn().mockImplementation(async () => {
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

            obsManager = new OBSConnectionManager({
                config: userConfig,
                OBSWebSocket: mockOBSWebSocket,
                constants: mockConstants,
                isTestEnvironment: false
            });

            await obsManager.connect();

            expect(mockOBSInstance.connect).toHaveBeenCalledWith(
                'ws://streaming-pc:4455',
                'stream-password'
            );

            const connectionState = obsManager.getConnectionState();
            expect(connectionState.config.address).toBe('ws://streaming-pc:4455');
            expect(connectionState.config.password).toBe('stream-password');
        });

        test('user should be able to update OBS settings without restarting bot', () => {
            const mockConstants = {
                OBS_CONNECTION_TIMEOUT: 5000,
                ERROR_MESSAGES: {
                    OBS_CONNECTION_TIMEOUT: 'OBS connection timeout',
                    OBS_NOT_CONNECTED: 'OBS not connected'
                }
            };

            obsManager = new OBSConnectionManager({
                config: {
                    get address() { return 'ws://old-server:4455'; },
                    get password() { return 'old-pass'; },
                    get enabled() { return true; }
                },
                OBSWebSocket: mockOBSWebSocket,
                constants: mockConstants,
                isTestEnvironment: true
            });

            expect(obsManager.config.address).toBe('ws://old-server:4455');

            const updatedConfig = {
                get address() { return 'ws://new-server:6666'; },
                get password() { return 'new-pass'; },
                get enabled() { return true; }
            };

            obsManager.updateConfig(updatedConfig);

            expect(obsManager.config.address).toBe('ws://new-server:6666');
            expect(obsManager.config.password).toBe('new-pass');

            const finalState = obsManager.getConnectionState();
            expect(finalState.config.address).toBe('ws://new-server:6666');
            expect(finalState.config.password).toBe('new-pass');
        });
    });
});
