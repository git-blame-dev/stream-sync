const { describe, expect, beforeEach, it } = require('bun:test');
export {};
const { createMockFn } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');
const { clearStartupDisplays } = require('../../src/obs/startup');

type MockFn = ReturnType<typeof createMockFn>;

type ObsManager = {
    isConnected: MockFn;
    connected: boolean;
};

type StartupConfig = {
    obs: {
        chatMsgScene: string;
        chatMsgTxt?: string;
        chatMsgGroup: string;
        notificationScene: string;
        notificationTxt: string;
        ttsTxt: string;
        notificationMsgGroup: string;
        chatPlatformLogos: Record<string, string>;
        notificationPlatformLogos: Record<string, string>;
    };
    timing: {
        fadeDuration: number;
    };
};

type StartupDeps = {
    logger: typeof noOpLogger;
    getOBSConnectionManager: () => ObsManager | null;
    getDefaultSourcesManager: () => {
        hideAllDisplays: MockFn;
        clearTextSource: MockFn;
    };
};

describe('OBS Startup Display Clearing - Detailed Behavior', () => {
    let mockOBSManager: ObsManager;
    let hideAllDisplays: MockFn;
    let clearTextSource: MockFn;
    let configFixture: StartupConfig;
    let deps: StartupDeps;

    beforeEach(() => {
        mockOBSManager = {
            isConnected: createMockFn(() => true),
            connected: true
        };

        hideAllDisplays = createMockFn().mockResolvedValue();
        clearTextSource = createMockFn().mockResolvedValue();

        configFixture = {
            obs: {
                chatMsgScene: 'stream pkmn switch',
                chatMsgTxt: 'notification streamlabs',
                chatMsgGroup: 'test-chat-group',
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

        it('should warn and skip when config is null', async () => {
            const warnSpy = createMockFn();
            const warnDeps = {
                ...deps,
                logger: { ...deps.logger, warn: warnSpy }
            };

            await clearStartupDisplays(null, warnDeps);

            expect(hideAllDisplays).not.toHaveBeenCalled();
            expect(warnSpy).toHaveBeenCalledWith(
                'clearStartupDisplays requires config; skipping display clearing',
                'OBSStartup'
            );
        });

        it('should not clear text sources directly on startup', async () => {
            await clearStartupDisplays(configFixture, deps);

            expect(clearTextSource).not.toHaveBeenCalled();
        });

        it('should skip clearing when required obs fields are missing', async () => {
            const missingFieldsConfig = {
                obs: { chatMsgScene: 'stream pkmn switch', chatMsgGroup: 'test', notificationScene: 'stream pkmn switch', notificationMsgGroup: 'test' },
                timing: { fadeDuration: 750 }
            } as unknown as StartupConfig;

            await clearStartupDisplays(missingFieldsConfig, deps);

            expect(hideAllDisplays).not.toHaveBeenCalled();
        });

        it('should skip operations when OBS is not connected', async () => {
            mockOBSManager.isConnected = createMockFn(() => false);

            await clearStartupDisplays(configFixture, deps);

            expect(hideAllDisplays).not.toHaveBeenCalled();
            expect(clearTextSource).not.toHaveBeenCalled();
        });

        it('should not crash startup if entire clearing fails', async () => {
            hideAllDisplays.mockRejectedValue(new Error('OBS connection lost'));

            await expect(clearStartupDisplays(configFixture, deps)).resolves.toBeUndefined();
        });

        it('should use provided config for platform logos', async () => {
            const customConfig: StartupConfig = {
                obs: {
                    chatMsgScene: 'stream pkmn switch',
                    chatMsgGroup: 'test-group',
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
