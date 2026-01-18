const { describe, test, expect, beforeEach, it } = require('bun:test');
const { createMockFn } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');
const { clearStartupDisplays } = require('../../src/obs/startup');

describe('OBS Startup Display Clearing - Detailed Behavior', () => {
    let mockOBSManager;
    let hideAllDisplays;
    let clearTextSource;
    let mockConfig;
    let testRuntimeConstants;
    let deps;

    beforeEach(() => {
        mockOBSManager = {
            isConnected: createMockFn(() => true),
            connected: true
        };

        hideAllDisplays = createMockFn().mockResolvedValue();
        clearTextSource = createMockFn().mockResolvedValue();

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

        testRuntimeConstants = {
            CHAT_PLATFORM_LOGOS: {
                twitch: 'twitch-img',
                youtube: 'youtube-img',
                tiktok: 'tiktok-img'
            },
            NOTIFICATION_PLATFORM_LOGOS: {
                twitch: 'twitch-img',
                youtube: 'youtube-img',
                tiktok: 'tiktok-img'
            }
        };

        deps = {
            logger: noOpLogger,
            getOBSConnectionManager: () => mockOBSManager,
            getDefaultSourcesManager: () => ({ hideAllDisplays, clearTextSource })
        };
    });

    describe('Behavior', () => {
        it('should call hideAllDisplays with correct parameters based on current config.ini', async () => {
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

            await clearStartupDisplays(currentConfig, testRuntimeConstants, deps);

            expect(hideAllDisplays).toHaveBeenCalledWith(
                'stream pkmn switch',
                'stream pkmn switch',
                testRuntimeConstants.CHAT_PLATFORM_LOGOS,
                testRuntimeConstants.NOTIFICATION_PLATFORM_LOGOS,
                'tts txt',
                'notification streamlabs'
            );
        });

        it('should warn and skip when runtimeConstants missing', async () => {
            const warnSpy = createMockFn();
            const warnDeps = {
                ...deps,
                logger: { ...deps.logger, warn: warnSpy }
            };

            await clearStartupDisplays(mockConfig, null, warnDeps);

            expect(hideAllDisplays).not.toHaveBeenCalled();
            expect(warnSpy).toHaveBeenCalledWith(
                'clearStartupDisplays requires runtimeConstants; skipping display clearing',
                'OBSStartup'
            );
        });

        it('should not clear text sources directly on startup', async () => {
            const config = {
                general: { chatMsgScene: 'stream pkmn switch' },
                obs: { notificationScene: 'stream pkmn switch', ttsTxt: 'tts txt', notificationTxt: 'notification streamlabs' }
            };

            await clearStartupDisplays(config, testRuntimeConstants, deps);

            expect(clearTextSource).not.toHaveBeenCalled();
        });

        it('should skip clearing when config sections are missing', async () => {
            const emptyConfig = {};

            await clearStartupDisplays(emptyConfig, testRuntimeConstants, deps);

            expect(hideAllDisplays).not.toHaveBeenCalled();
        });

        it('should skip clearing when required obs fields are missing', async () => {
            const missingFieldsConfig = {
                general: { chatMsgScene: 'stream pkmn switch' },
                obs: { notificationScene: 'stream pkmn switch' }
            };

            await clearStartupDisplays(missingFieldsConfig, testRuntimeConstants, deps);

            expect(hideAllDisplays).not.toHaveBeenCalled();
        });

        it('should skip operations when OBS is not connected', async () => {
            mockOBSManager.isConnected = createMockFn(() => false);

            const config = {
                general: { chatMsgScene: 'stream pkmn switch' },
                obs: { notificationScene: 'stream pkmn switch' }
            };

            await clearStartupDisplays(config, testRuntimeConstants, deps);

            expect(hideAllDisplays).not.toHaveBeenCalled();
            expect(clearTextSource).not.toHaveBeenCalled();
        });

        it('should not crash startup if entire clearing fails', async () => {
            hideAllDisplays.mockRejectedValue(new Error('OBS connection lost'));

            const config = {
                general: { chatMsgScene: 'stream pkmn switch' },
                obs: { notificationScene: 'stream pkmn switch' }
            };

            await expect(clearStartupDisplays(config, testRuntimeConstants, deps)).resolves.toBeUndefined();
        });

        it('should use provided runtime constants for platform logos', async () => {
            const customRuntimeConstants = {
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

            await clearStartupDisplays(mockConfig, customRuntimeConstants, deps);

            expect(hideAllDisplays).toHaveBeenCalledWith(
                'stream pkmn switch',
                'stream pkmn switch',
                customRuntimeConstants.CHAT_PLATFORM_LOGOS,
                customRuntimeConstants.NOTIFICATION_PLATFORM_LOGOS,
                'tts txt',
                'notification streamlabs'
            );
        });
    });
});
