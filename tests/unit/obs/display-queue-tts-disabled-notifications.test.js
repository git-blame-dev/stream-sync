describe('DisplayQueue notification TTS disabled', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        jest.resetModules();
        process.env.NODE_ENV = originalEnv;
    });

    function setupQueue() {
        process.env.NODE_ENV = 'test';

        const updateCalls = [];

        jest.doMock('../../../src/obs/sources', () => {
            const instance = {
                updateTextSource: jest.fn((_, text) => {
                    updateCalls.push(text);
                    return Promise.resolve();
                }),
                setSourceVisibility: jest.fn(),
                setPlatformLogoVisibility: jest.fn(),
                hideAllDisplays: jest.fn(),
                updateChatMsgText: jest.fn(),
                setNotificationPlatformLogoVisibility: jest.fn(),
                setGroupSourceVisibility: jest.fn(),
                setSourceFilterVisibility: jest.fn(),
                getGroupSceneItemId: jest.fn(),
                setChatDisplayVisibility: jest.fn(),
                setNotificationDisplayVisibility: jest.fn(),
                getSceneItemId: jest.fn()
            };
            return {
                OBSSourcesManager: class {},
                createOBSSourcesManager: () => instance,
                getDefaultSourcesManager: () => instance
            };
        });

        jest.doMock('../../../src/utils/timeout-validator', () => {
            const actual = jest.requireActual('../../../src/utils/timeout-validator');
            return {
                ...actual,
                safeDelay: jest.fn().mockResolvedValue()
            };
        });

        jest.doMock('../../../src/utils/message-tts-handler', () => ({
            createTTSStages: jest.fn(() => [
                { type: 'primary', text: 'Primary TTS', delay: 0 }
            ])
        }));

        const { DisplayQueue } = require('../../../src/obs/display-queue');
        const { EventEmitter } = require('events');

        const queue = new DisplayQueue(
            {},
            {
                ttsEnabled: false,
                chat: {},
                notification: {},
                obs: { ttsTxt: 'tts txt' }
            },
            { PRIORITY_LEVELS: { CHAT: 1 } },
            new EventEmitter()
        );

        return { queue, updateCalls };
    }

    it('skips notification TTS when ttsEnabled is false', async () => {
        const { queue, updateCalls } = setupQueue();

        await queue.handleNotificationEffects({
            type: 'paypiggy',
            platform: 'youtube',
            data: {
                username: 'Member',
                displayMessage: 'Welcome!',
                ttsMessage: 'Hi member'
            }
        });

        expect(updateCalls).toEqual([]);
    });

});
