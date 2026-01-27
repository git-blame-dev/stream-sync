const { describe, expect, beforeEach, it } = require('bun:test');
const { createMockFn } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');
const { clearStartupDisplays } = require('../../src/obs/startup');

describe('OBS Startup Display Clearing - Regression Tests', () => {
    let mockOBSManager;
    let hideAllDisplays;
    let clearTextSource;
    let configFixture;
    let deps;

    beforeEach(() => {
        mockOBSManager = {
            isConnected: createMockFn(() => true),
            connected: true
        };

        hideAllDisplays = createMockFn().mockResolvedValue();
        clearTextSource = createMockFn().mockResolvedValue();

        configFixture = {
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

    describe('Core Clearing Behavior', () => {
        it('should call hideAllDisplays with correct parameters from config', async () => {
            await clearStartupDisplays(configFixture, deps);

            expect(hideAllDisplays).toHaveBeenCalledWith(
                'stream pkmn switch',
                'stream pkmn switch',
                configFixture.obs.chatPlatformLogos,
                configFixture.obs.notificationPlatformLogos,
                'tts txt',
                'notification streamlabs'
            );
        });

        it('should not clear text sources directly', async () => {
            await clearStartupDisplays(configFixture, deps);

            expect(clearTextSource).not.toHaveBeenCalled();
        });

        it('should skip clearing when OBS is not connected', async () => {
            mockOBSManager.isConnected = createMockFn(() => false);

            await clearStartupDisplays(configFixture, deps);

            expect(hideAllDisplays).not.toHaveBeenCalled();
            expect(clearTextSource).not.toHaveBeenCalled();
        });

        it('should skip clearing when config is incomplete', async () => {
            const incompleteConfig = {
                general: {},
                obs: {}
            };

            await clearStartupDisplays(incompleteConfig, deps);

            expect(hideAllDisplays).not.toHaveBeenCalled();
        });

        it('should not invoke direct text source clearing', async () => {
            clearTextSource.mockImplementation(() => {
                throw new Error('Source not found');
            });

            await clearStartupDisplays(configFixture, deps);

            expect(hideAllDisplays).toHaveBeenCalled();
            expect(clearTextSource).not.toHaveBeenCalled();
        });
    });

    describe('Configuration-Driven Behavior', () => {
        it('should use custom source names from config', async () => {
            const customConfig = {
                general: {
                    chatMsgScene: 'custom chat scene',
                    chatMsgGroup: 'custom-chat-group'
                },
                obs: {
                    notificationScene: 'custom notification scene',
                    ttsTxt: 'custom tts source',
                    notificationTxt: 'custom notification source',
                    notificationMsgGroup: 'custom-notification-group',
                    chatPlatformLogos: { twitch: 'custom-twitch' },
                    notificationPlatformLogos: { twitch: 'custom-twitch' }
                },
                timing: {
                    fadeDuration: 500
                }
            };

            await clearStartupDisplays(customConfig, deps);

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
            hideAllDisplays.mockRejectedValue(new Error('OBS connection lost'));

            await expect(clearStartupDisplays(configFixture, deps)).resolves.toBeUndefined();
        });

        it('should continue when OBS manager is null', async () => {
            const nullManagerDeps = {
                ...deps,
                getOBSConnectionManager: () => null
            };

            await expect(clearStartupDisplays(configFixture, nullManagerDeps)).resolves.toBeUndefined();
        });
    });
});
