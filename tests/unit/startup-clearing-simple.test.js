const { describe, test, expect, beforeEach, it } = require('bun:test');
const { createMockFn } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');
const { clearStartupDisplays } = require('../../src/obs/startup');

describe('OBS Startup Display Clearing - Regression Tests', () => {
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

    describe('Core Clearing Behavior', () => {
        it('should call hideAllDisplays with correct parameters from config', async () => {
            await clearStartupDisplays(mockConfig, testRuntimeConstants, deps);

            expect(hideAllDisplays).toHaveBeenCalledWith(
                'stream pkmn switch',
                'stream pkmn switch',
                testRuntimeConstants.CHAT_PLATFORM_LOGOS,
                testRuntimeConstants.NOTIFICATION_PLATFORM_LOGOS,
                'tts txt',
                'notification streamlabs'
            );
        });

        it('should not clear text sources directly', async () => {
            await clearStartupDisplays(mockConfig, testRuntimeConstants, deps);

            expect(clearTextSource).not.toHaveBeenCalled();
        });

        it('should skip clearing when OBS is not connected', async () => {
            mockOBSManager.isConnected = createMockFn(() => false);

            await clearStartupDisplays(mockConfig, testRuntimeConstants, deps);

            expect(hideAllDisplays).not.toHaveBeenCalled();
            expect(clearTextSource).not.toHaveBeenCalled();
        });

        it('should skip clearing when config is incomplete', async () => {
            const incompleteConfig = {
                general: {},
                obs: {}
            };

            await clearStartupDisplays(incompleteConfig, testRuntimeConstants, deps);

            expect(hideAllDisplays).not.toHaveBeenCalled();
        });

        it('should not invoke direct text source clearing', async () => {
            clearTextSource.mockImplementation(() => {
                throw new Error('Source not found');
            });

            await clearStartupDisplays(mockConfig, testRuntimeConstants, deps);

            expect(hideAllDisplays).toHaveBeenCalled();
            expect(clearTextSource).not.toHaveBeenCalled();
        });
    });

    describe('Configuration-Driven Behavior', () => {
        it('should use custom source names from config', async () => {
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

            await clearStartupDisplays(customConfig, testRuntimeConstants, deps);

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

            await expect(clearStartupDisplays(mockConfig, testRuntimeConstants, deps)).resolves.toBeUndefined();
        });

        it('should continue when OBS manager is null', async () => {
            const nullManagerDeps = {
                ...deps,
                getOBSConnectionManager: () => null
            };

            await expect(clearStartupDisplays(mockConfig, testRuntimeConstants, nullManagerDeps)).resolves.toBeUndefined();
        });
    });
});
