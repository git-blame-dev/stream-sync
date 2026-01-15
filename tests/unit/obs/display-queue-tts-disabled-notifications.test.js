const { describe, test, expect, afterEach, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, requireActual, resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

describe('DisplayQueue notification TTS disabled', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        restoreAllMocks();
process.env.NODE_ENV = originalEnv;
    
        restoreAllModuleMocks();});

    function setupQueue() {
        process.env.NODE_ENV = 'test';

        const updateCalls = [];

        mockModule('../../../src/obs/sources', () => {
            const instance = {
                updateTextSource: createMockFn((_, text) => {
                    updateCalls.push(text);
                    return Promise.resolve();
                }),
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

        mockModule('../../../src/utils/message-tts-handler', () => ({
            createTTSStages: createMockFn(() => [
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
            type: 'platform:paypiggy',
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
