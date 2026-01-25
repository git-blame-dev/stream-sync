const { describe, expect, beforeEach, it } = require('bun:test');
const { createMockFn } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');
const { clearStartupDisplays } = require('../../src/obs/startup');

describe('OBS Startup Display Clearing - Detailed Behavior', () => {
    let mockOBSManager;
    let hideAllDisplays;
    let clearTextSource;
    let mockConfig;
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
                chatMsgTxt: 'notification streamlabs',
                chatMsgGroup: 'test-chat-group'
            },
            obs: {
                notificationScene: 'stream pkmn switch',
                notificationTxt: 'notification streamlabs',
                ttsTxt: 'tts txt',
                notificationMsgGroup: 'test-notification-group',
                chatPlatformLogos: {
                    twitch: 'twitch-img',
                    youtube: 'youtube-img',
                    tiktok: 'tiktok-img'
                },
                notificationPlatformLogos: {
                    twitch: 'twitch-img',
                    youtube: 'youtube-img',
                    tiktok: 'tiktok-img'
                }
            },
            timing: {
                fadeDuration: 750
            }
        };

        deps = {
            logger: noOpLogger,
            getOBSConnectionManager: () => mockOBSManager,
            getDefaultSourcesManager: () => ({ hideAllDisplays, clearTextSource })
        };
    });

    describe('Behavior', () => {
        it('should call hideAllDisplays with correct parameters based on config', async () => {
            await clearStartupDisplays(mockConfig, deps);

            expect(hideAllDisplays).toHaveBeenCalledWith(
                'stream pkmn switch',
                'stream pkmn switch',
                mockConfig.obs.chatPlatformLogos,
                mockConfig.obs.notificationPlatformLogos,
                'tts txt',
                'notification streamlabs'
            );
        });

        it('should warn and skip when config missing required sections', async () => {
            const warnSpy = createMockFn();
            const warnDeps = {
                ...deps,
                logger: { ...deps.logger, warn: warnSpy }
            };

            await clearStartupDisplays({}, warnDeps);

            expect(hideAllDisplays).not.toHaveBeenCalled();
            expect(warnSpy).toHaveBeenCalledWith(
                'clearStartupDisplays requires general, obs, and timing config; skipping display clearing',
                'OBSStartup'
            );
        });

        it('should not clear text sources directly on startup', async () => {
            await clearStartupDisplays(mockConfig, deps);

            expect(clearTextSource).not.toHaveBeenCalled();
        });

        it('should skip clearing when config sections are missing', async () => {
            const emptyConfig = {};

            await clearStartupDisplays(emptyConfig, deps);

            expect(hideAllDisplays).not.toHaveBeenCalled();
        });

        it('should skip clearing when required obs fields are missing', async () => {
            const missingFieldsConfig = {
                general: { chatMsgScene: 'stream pkmn switch', chatMsgGroup: 'test' },
                obs: { notificationScene: 'stream pkmn switch', notificationMsgGroup: 'test' },
                timing: { fadeDuration: 750 }
            };

            await clearStartupDisplays(missingFieldsConfig, deps);

            expect(hideAllDisplays).not.toHaveBeenCalled();
        });

        it('should skip operations when OBS is not connected', async () => {
            mockOBSManager.isConnected = createMockFn(() => false);

            await clearStartupDisplays(mockConfig, deps);

            expect(hideAllDisplays).not.toHaveBeenCalled();
            expect(clearTextSource).not.toHaveBeenCalled();
        });

        it('should not crash startup if entire clearing fails', async () => {
            hideAllDisplays.mockRejectedValue(new Error('OBS connection lost'));

            await expect(clearStartupDisplays(mockConfig, deps)).resolves.toBeUndefined();
        });

        it('should use provided config for platform logos', async () => {
            const customConfig = {
                general: {
                    chatMsgScene: 'stream pkmn switch',
                    chatMsgGroup: 'test-group'
                },
                obs: {
                    notificationScene: 'stream pkmn switch',
                    notificationTxt: 'notification streamlabs',
                    ttsTxt: 'tts txt',
                    notificationMsgGroup: 'test-notification-group',
                    chatPlatformLogos: {
                        twitch: 'custom-twitch',
                        youtube: 'custom-youtube',
                        tiktok: 'custom-tiktok'
                    },
                    notificationPlatformLogos: {
                        twitch: 'notice-twitch',
                        youtube: 'notice-youtube',
                        tiktok: 'notice-tiktok'
                    }
                },
                timing: {
                    fadeDuration: 500
                }
            };

            await clearStartupDisplays(customConfig, deps);

            expect(hideAllDisplays).toHaveBeenCalledWith(
                'stream pkmn switch',
                'stream pkmn switch',
                customConfig.obs.chatPlatformLogos,
                customConfig.obs.notificationPlatformLogos,
                'tts txt',
                'notification streamlabs'
            );
        });
    });
});
