
describe('OBS Startup Display Clearing - Regression Tests', () => {
    let mockOBSManager;
    let mockConfig;
    let clearStartupDisplays;
    let hideAllDisplays;
    let clearTextSource;

    beforeEach(() => {
        // Clear all mocks
        jest.clearAllMocks();
        jest.resetModules();

        // Create tracked arrays for behavior validation
        const clearedSources = [];
        const hideAllDisplaysCalls = [];

        // Mock OBS Manager
        mockOBSManager = {
            isConnected: jest.fn(() => true),
            connected: true
        };

        // Mock hideAllDisplays function
        hideAllDisplays = jest.fn().mockImplementation((...args) => {
            hideAllDisplaysCalls.push(args);
            return Promise.resolve();
        });

        // Mock clearTextSource function  
        clearTextSource = jest.fn().mockImplementation((sourceName) => {
            clearedSources.push(sourceName);
            return Promise.resolve();
        });

        // Mock dependencies
        jest.doMock('../../src/obs/connection', () => ({
            getOBSConnectionManager: () => mockOBSManager
        }));

        jest.doMock('../../src/obs/sources', () => {
            const instance = { hideAllDisplays, clearTextSource };
            return {
                OBSSourcesManager: class {},
                createOBSSourcesManager: () => instance,
                getDefaultSourcesManager: () => instance
            };
        });

        jest.doMock('../../src/core/logging', () => ({
            logger: {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                console: jest.fn()
            },
            setConfigValidator: jest.fn(),
            setDebugMode: jest.fn(),
            initializeLoggingConfig: jest.fn(),
            getLogger: jest.fn(() => ({
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                console: jest.fn()
            })),
            initializeConsoleOverride: jest.fn()
        }));

        // Create test config
        mockConfig = {
            general: {
                chatMsgScene: 'stream pkmn switch',
                chatMsgTxt: 'notification streamlabs'
            },
            obs: {
                notificationScene: 'stream pkmn switch',
                notificationTxt: 'notification streamlabs',
                ttsTxt: 'tts txt'
            }
        };

        // Import the actual clearStartupDisplays utility
        const obsStartup = require('../../src/obs/startup');
        clearStartupDisplays = (config) => obsStartup.clearStartupDisplays(config || mockConfig);

        // Expose tracking arrays for test verification
        clearStartupDisplays.clearedSources = clearedSources;
        clearStartupDisplays.hideAllDisplaysCalls = hideAllDisplaysCalls;
    });

    describe('Core Clearing Behavior', () => {
        it('should call hideAllDisplays with correct parameters from config', async () => {
            // When: Clearing startup displays
            await clearStartupDisplays();

            // Then: hideAllDisplays should be called with correct parameters
            expect(hideAllDisplays).toHaveBeenCalledWith(
                'stream pkmn switch',           // chatSceneName
                'stream pkmn switch',           // notificationSceneName
                {
                    twitch: 'twitch-img',
                    youtube: 'youtube-img',
                    tiktok: 'tiktok-img'
                },                              // chatPlatformLogos
                {
                    twitch: 'twitch-img',
                    youtube: 'youtube-img',
                    tiktok: 'tiktok-img'
                },                              // notificationPlatformLogos
                'tts txt',                      // ttsSourceName
                'notification streamlabs'       // notificationSourceName
            );
        });

        it('should not clear text sources directly', async () => {
            // When: Clearing startup displays
            await clearStartupDisplays();

            // Then: Text sources should not be cleared directly
            expect(clearTextSource).not.toHaveBeenCalled();
        });

        it('should skip clearing when OBS is not connected', async () => {
            // Given: OBS is not connected
            mockOBSManager.isConnected = jest.fn(() => false);

            // When: Clearing startup displays
            await clearStartupDisplays();

            // Then: Should not call hideAllDisplays or clearTextSource
            expect(hideAllDisplays).not.toHaveBeenCalled();
            expect(clearTextSource).not.toHaveBeenCalled();
        });

        it('should skip clearing when config is incomplete', async () => {
            // Given: Incomplete config
            const incompleteConfig = {
                general: {},
                obs: {}
            };

            // When: Clearing startup displays with incomplete config
            await clearStartupDisplays(incompleteConfig);

            // Then: Should skip clearing
            expect(hideAllDisplays).not.toHaveBeenCalled();
        });

        it('should not invoke direct text source clearing', async () => {
            // Given: Direct text clearing would fail if invoked
            clearTextSource.mockImplementation(() => {
                throw new Error('Source not found');
            });

            // When: Clearing startup displays
            await clearStartupDisplays();

            // Then: Should complete without invoking direct text clearing
            expect(hideAllDisplays).toHaveBeenCalled();
            expect(clearTextSource).not.toHaveBeenCalled();
        });
    });

    describe('Configuration-Driven Behavior', () => {
        it('should use custom source names from config', async () => {
            // Given: Custom config with different source names
            const customConfig = {
                general: {
                    chatMsgScene: 'custom chat scene'
                },
                obs: {
                    notificationScene: 'custom notification scene',
                    ttsTxt: 'custom tts source',
                    notificationTxt: 'custom notification source'
                }
            };

            // When: Clearing startup displays with custom config
            await clearStartupDisplays(customConfig);

            // Then: Should use custom source names
            expect(hideAllDisplays).toHaveBeenCalledWith(
                'custom chat scene',
                'custom notification scene',
                expect.any(Object),
                expect.any(Object),
                'custom tts source',
                'custom notification source'
            );
        });
    });

    describe('Error Handling', () => {
        it('should not throw errors when hideAllDisplays fails', async () => {
            // Given: hideAllDisplays will fail
            hideAllDisplays.mockRejectedValue(new Error('OBS connection lost'));

            // When: Clearing startup displays
            // Then: Should not throw
            await expect(clearStartupDisplays()).resolves.not.toThrow();
        });

        it('should continue when OBS manager is null', async () => {
            // Given: OBS manager is null
            jest.doMock('../../src/obs/connection', () => ({
                getOBSConnectionManager: () => null
            }));

            // Reload the modules to use the mocked connection
            jest.resetModules();
            const obsStartup = require('../../src/obs/startup');

            // When: Clearing startup displays
            // Then: Should not throw
            await expect(obsStartup.clearStartupDisplays(mockConfig)).resolves.not.toThrow();
        });
    });
});
