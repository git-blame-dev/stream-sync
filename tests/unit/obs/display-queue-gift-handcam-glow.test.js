describe('DisplayQueue gift effects handcam glow', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        jest.resetModules();
        process.env.NODE_ENV = originalEnv;
    });

    it('triggers handcam glow when enabled for gifts', async () => {
        process.env.NODE_ENV = 'test';

        jest.doMock('../../../src/obs/sources', () => {
            const instance = {
                updateTextSource: jest.fn().mockResolvedValue(),
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

        const handcamGlowMock = jest.fn();
        jest.doMock('../../../src/obs/handcam-glow', () => ({
            triggerHandcamGlow: handcamGlowMock
        }));

        jest.doMock('../../../src/utils/message-tts-handler', () => ({
            createTTSStages: jest.fn(() => [
                { type: 'primary', text: 'Gift incoming', delay: 0 }
            ])
        }));

        const { DisplayQueue } = require('../../../src/obs/display-queue');
        const { EventEmitter } = require('events');

        const queue = new DisplayQueue(
            { call: jest.fn().mockResolvedValue({}) },
            {
                ttsEnabled: true,
                chat: {},
                notification: {},
                obs: { ttsTxt: 'tts txt' },
                handcam: { enabled: true }
            },
            { PRIORITY_LEVELS: { CHAT: 1 } },
            new EventEmitter()
        );

        await queue.handleNotificationEffects({
            type: 'gift',
            platform: 'tiktok',
            data: {
                username: 'Gifter',
                displayMessage: 'sent a gift',
                giftType: 'rose',
                giftCount: 1,
                amount: 1,
                currency: 'coins'
            }
        });

        expect(handcamGlowMock).toHaveBeenCalledTimes(1);
    });
});
