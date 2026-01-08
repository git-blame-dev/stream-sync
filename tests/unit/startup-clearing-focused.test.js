
describe('OBS Startup Display Clearing - Detailed Behavior', () => {
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
        clearStartupDisplays = (config, runtimeConstants) => obsStartup.clearStartupDisplays(config || mockConfig, runtimeConstants);

        // Expose tracking arrays for test verification
        clearStartupDisplays.clearedSources = clearedSources;
        clearStartupDisplays.hideAllDisplaysCalls = hideAllDisplaysCalls;
    });

    describe('Behavior', () => {
        it('should call hideAllDisplays with correct parameters based on current config.ini', async () => {
            // Given: Current config.ini structure
            const currentConfig = {
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

            // When: Running current clearStartupDisplays implementation
            await clearStartupDisplays(currentConfig);

            // Then: hideAllDisplays should be called with current config values
            expect(hideAllDisplays).toHaveBeenCalledWith(
                'stream pkmn switch',           // From general.chatMsgScene
                'stream pkmn switch',           // From obs.notificationScene  
                {
                    twitch: 'twitch-img',
                    youtube: 'youtube-img',
                    tiktok: 'tiktok-img'
                },                              // Chat platform logos from runtime constants
                {
                    twitch: 'twitch-img',
                    youtube: 'youtube-img', 
                    tiktok: 'tiktok-img'
                },                              // Notification platform logos from runtime constants
                'tts txt',                      // From obs.ttsTxt
                'notification streamlabs'       // From obs.notificationTxt
            );
        });

        it('should not clear text sources directly on startup', async () => {
            // Given: Standard config
            const config = {
                general: { chatMsgScene: 'stream pkmn switch' },
                obs: { notificationScene: 'stream pkmn switch', ttsTxt: 'tts txt', notificationTxt: 'notification streamlabs' }
            };

            // When: Running clearStartupDisplays
            await clearStartupDisplays(config);

            // Then: Should not call direct text source clearing
            expect(clearTextSource).not.toHaveBeenCalled();
        });

        it('should skip clearing when config sections are missing', async () => {
            // Given: Empty config (missing sections)
            const emptyConfig = {};

            // When: Running clearStartupDisplays
            await clearStartupDisplays(emptyConfig);

            // Then: Should skip clearing
            expect(hideAllDisplays).not.toHaveBeenCalled();
        });

        it('should skip clearing when required obs fields are missing', async () => {
            // Given: Missing required obs fields
            const missingFieldsConfig = {
                general: { chatMsgScene: 'stream pkmn switch' },
                obs: { notificationScene: 'stream pkmn switch' }
            };

            // When: Running clearStartupDisplays
            await clearStartupDisplays(missingFieldsConfig);

            // Then: Should skip clearing
            expect(hideAllDisplays).not.toHaveBeenCalled();
        });

        it('should skip operations when OBS is not connected', async () => {
            // Given: OBS is not connected
            mockOBSManager.isConnected = jest.fn(() => false);

            const config = {
                general: { chatMsgScene: 'stream pkmn switch' },
                obs: { notificationScene: 'stream pkmn switch' }
            };

            // When: Running clearStartupDisplays
            await clearStartupDisplays(config);

            // Then: Should skip all OBS operations
            expect(hideAllDisplays).not.toHaveBeenCalled();
            expect(clearTextSource).not.toHaveBeenCalled();
        });

        it('should not crash startup if entire clearing fails', async () => {
            // Given: hideAllDisplays will fail
            hideAllDisplays.mockRejectedValue(new Error('OBS connection lost'));

            const config = {
                general: { chatMsgScene: 'stream pkmn switch' },
                obs: { notificationScene: 'stream pkmn switch' }
            };

            // When: Running clearStartupDisplays
            // Then: Should not throw error
            await expect(clearStartupDisplays(config)).resolves.not.toThrow();
        });

        it('should use provided runtime constants for platform logos', async () => {
            // Given: Runtime constants override
            const runtimeConstants = {
                CHAT_PLATFORM_LOGOS: {
                    twitch: 'custom-twitch',
                    youtube: 'custom-youtube',
                    tiktok: 'custom-tiktok'
                },
                NOTIFICATION_PLATFORM_LOGOS: {
                    twitch: 'notice-twitch',
                    youtube: 'notice-youtube',
                    tiktok: 'notice-tiktok'
                }
            };

            // When: Running clearStartupDisplays with runtime constants
            await clearStartupDisplays(undefined, runtimeConstants);

            // Then: Should use the provided runtime constants
            expect(hideAllDisplays).toHaveBeenCalledWith(
                'stream pkmn switch',
                'stream pkmn switch',
                runtimeConstants.CHAT_PLATFORM_LOGOS,
                runtimeConstants.NOTIFICATION_PLATFORM_LOGOS,
                'tts txt',
                'notification streamlabs'
            );
        });
    });
});
