const { describe, test, expect, afterEach, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, requireActual, resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

describe('DisplayQueue gift effects handcam glow', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        restoreAllMocks();
process.env.NODE_ENV = originalEnv;
    
        restoreAllModuleMocks();});

    it('triggers handcam glow when enabled for gifts', async () => {
        process.env.NODE_ENV = 'test';

        mockModule('../../../src/obs/sources', () => {
            const instance = {
                updateTextSource: createMockFn().mockResolvedValue(),
                setSourceVisibility: createMockFn(),
                setPlatformLogoVisibility: createMockFn(),
                hideAllDisplays: createMockFn(),
                updateChatMsgText: createMockFn(),
                setNotificationPlatformLogoVisibility: createMockFn(),
                setGroupSourceVisibility: createMockFn(),
                setSourceFilterVisibility: createMockFn(),
                getGroupSceneItemId: createMockFn(),
                setChatDisplayVisibility: createMockFn(),
                setNotificationDisplayVisibility: createMockFn(),
                getSceneItemId: createMockFn()
            };
            return {
                OBSSourcesManager: class {},
                createOBSSourcesManager: () => instance,
                getDefaultSourcesManager: () => instance
            };
        });

        mockModule('../../../src/utils/timeout-validator', () => {
            const actual = requireActual('../../../src/utils/timeout-validator');
            return {
                ...actual,
                safeDelay: createMockFn().mockResolvedValue()
            };
        });

        const handcamGlowMock = createMockFn();
        mockModule('../../../src/obs/handcam-glow', () => ({
            triggerHandcamGlow: handcamGlowMock
        }));

        mockModule('../../../src/utils/message-tts-handler', () => ({
            createTTSStages: createMockFn(() => [
                { type: 'primary', text: 'Gift incoming', delay: 0 }
            ])
        }));

        const { DisplayQueue } = require('../../../src/obs/display-queue');
        const { EventEmitter } = require('events');

        const queue = new DisplayQueue(
            { call: createMockFn().mockResolvedValue({}) },
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
            type: 'platform:gift',
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
