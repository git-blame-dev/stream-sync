const { describe, expect, beforeEach, it, afterEach } = require('bun:test');
const { restoreAllMocks } = require('../helpers/bun-mock-utils');
const { DisplayQueue } = require('../../src/obs/display-queue');
const { createDisplayQueueDependencies } = require('../helpers/display-queue-test-factory');

describe('DisplayQueue TTS Configuration Respect', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let mockOBSManager;
    let displayQueue;
    let dependencies;
    const baseConstants = { PRIORITY_LEVELS: { CHAT: 1 } };

    beforeEach(() => {
        dependencies = createDisplayQueueDependencies();
        mockOBSManager = dependencies.mockOBS;
    });

    describe('when ttsEnabled is explicitly false', () => {
        beforeEach(() => {
            const config = {
                ttsEnabled: false,
                chat: {
                    sourceName: 'chat msg txt',
                    sceneName: 'v efx statusbar',
                    groupName: 'statusbar chat grp',
                    platformLogos: {
                        youtube: 'youtube-img'
                    }
                },
                obs: {
                    ttsTxt: 'tts txt'
                }
            };
            displayQueue = new DisplayQueue(mockOBSManager, config, baseConstants, null, {
                sourcesManager: dependencies.sourcesManager,
                goalsManager: dependencies.goalsManager
            });
        });

        it('should return false for isTTSEnabled()', () => {
            expect(displayQueue.isTTSEnabled()).toBe(false);
        });

        it('should NOT send TTS text when processing chat message', async () => {
            const chatItem = {
                type: 'chat',
                platform: 'youtube',
                data: {
                    username: 'TestUser',
                    message: 'Hello world'
                }
            };

            await displayQueue.handleChatMessageTTS(chatItem);

            const ttsCallsOnly = mockOBSManager.call.mock.calls.filter(call =>
                call[0] === 'SetInputSettings' && call[1].inputName === 'tts txt'
            );

            expect(ttsCallsOnly).toHaveLength(0);
            expect(mockOBSManager.call).not.toHaveBeenCalledWith('SetInputSettings',
                expect.objectContaining({
                    inputName: 'tts txt'
                })
            );
        });

        it('should skip TTS processing when explicitly disabled', async () => {
            const chatItem = {
                type: 'chat',
                platform: 'youtube',
                data: {
                    username: 'TestUser',
                    message: 'Hello world'
                }
            };

            await displayQueue.handleChatMessageTTS(chatItem);

            const ttsCallsOnly = mockOBSManager.call.mock.calls.filter(call =>
                call[0] === 'SetInputSettings' && call[1].inputName === 'tts txt'
            );

            expect(ttsCallsOnly).toHaveLength(0);
        });
    });

    describe('when ttsEnabled is explicitly true', () => {
        beforeEach(() => {
            const config = {
                ttsEnabled: true,
                chat: {
                    sourceName: 'chat msg txt',
                    sceneName: 'v efx statusbar',
                    groupName: 'statusbar chat grp',
                    platformLogos: {
                        youtube: 'youtube-img'
                    }
                },
                obs: {
                    ttsTxt: 'tts txt'
                }
            };
            displayQueue = new DisplayQueue(mockOBSManager, config, baseConstants, null, {
                sourcesManager: dependencies.sourcesManager,
                goalsManager: dependencies.goalsManager
            });
        });

        it('should return true for isTTSEnabled()', () => {
            expect(displayQueue.isTTSEnabled()).toBe(true);
        });

        it('should NOT send TTS text when processing chat message (chat TTS is disabled by design)', async () => {
            const chatItem = {
                type: 'chat',
                platform: 'youtube',
                data: {
                    username: 'TestUser',
                    message: 'Hello world'
                }
            };

            await displayQueue.handleChatMessageTTS(chatItem);

            const ttsCallsOnly = mockOBSManager.call.mock.calls.filter(call =>
                call[0] === 'SetInputSettings' && call[1].inputName === 'tts txt'
            );

            expect(ttsCallsOnly.length).toBe(0);
            expect(mockOBSManager.call).not.toHaveBeenCalledWith('SetInputSettings',
                expect.objectContaining({
                    inputName: 'tts txt'
                })
            );
        });
    });

    describe('when ttsEnabled is undefined (edge case)', () => {
        beforeEach(() => {
            const config = {
                chat: {
                    sourceName: 'chat msg txt',
                    sceneName: 'v efx statusbar',
                    groupName: 'statusbar chat grp',
                    platformLogos: {
                        youtube: 'youtube-img'
                    }
                },
                obs: {
                    ttsTxt: 'tts txt'
                }
            };
            displayQueue = new DisplayQueue(mockOBSManager, config, baseConstants, null);
        });

        it('should return false for isTTSEnabled() when config is undefined', () => {
            expect(displayQueue.isTTSEnabled()).toBe(false);
        });

        it('should NOT send TTS text when config is undefined', async () => {
            const chatItem = {
                type: 'chat',
                platform: 'youtube',
                data: {
                    username: 'TestUser',
                    message: 'Hello world'
                }
            };

            await displayQueue.handleChatMessageTTS(chatItem);

            const ttsCallsOnly = mockOBSManager.call.mock.calls.filter(call =>
                call[0] === 'SetInputSettings' && call[1].inputName === 'tts txt'
            );

            expect(ttsCallsOnly.length).toBe(0);
        });
    });
});
