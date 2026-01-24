const { describe, expect, beforeEach, it } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { DisplayQueue } = require('../../../src/obs/display-queue');
const { EventEmitter } = require('events');

describe('DisplayQueue notification TTS disabled', () => {
    let mockOBSManager;
    let mockSourcesManager;
    let updateCalls;
    let queue;
    let testRuntimeConstants;

    beforeEach(() => {
        updateCalls = [];

        mockOBSManager = {
            isReady: createMockFn().mockResolvedValue(true),
            isConnected: createMockFn(() => true),
            call: createMockFn().mockResolvedValue({})
        };

        mockSourcesManager = {
            updateTextSource: createMockFn((_, text) => {
                updateCalls.push(text);
                return Promise.resolve();
            }),
            clearTextSource: createMockFn().mockResolvedValue(),
            setSourceVisibility: createMockFn().mockResolvedValue(),
            setPlatformLogoVisibility: createMockFn().mockResolvedValue(),
            hideAllDisplays: createMockFn().mockResolvedValue(),
            updateChatMsgText: createMockFn().mockResolvedValue(),
            setNotificationPlatformLogoVisibility: createMockFn().mockResolvedValue(),
            setGroupSourceVisibility: createMockFn().mockResolvedValue(),
            setSourceFilterVisibility: createMockFn().mockResolvedValue(),
            getGroupSceneItemId: createMockFn().mockResolvedValue(1),
            setChatDisplayVisibility: createMockFn().mockResolvedValue(),
            setNotificationDisplayVisibility: createMockFn().mockResolvedValue(),
            getSceneItemId: createMockFn().mockResolvedValue(1)
        };

        testRuntimeConstants = {
            CHAT_TRANSITION_DELAY: 0,
            NOTIFICATION_CLEAR_DELAY: 0,
            CHAT_MESSAGE_DURATION: 0,
            PRIORITY_LEVELS: { CHAT: 1, MEMBER: 10 }
        };

        queue = new DisplayQueue(
            mockOBSManager,
            {
                ttsEnabled: false,
                chat: { sourceName: 'chat', sceneName: 'scene', groupName: 'group', platformLogos: {} },
                notification: { sourceName: 'notif', sceneName: 'scene', groupName: 'group', platformLogos: {} },
                obs: { ttsTxt: 'tts txt' },
                youtube: { notificationsEnabled: true }
            },
            testRuntimeConstants,
            new EventEmitter(),
            testRuntimeConstants,
            { sourcesManager: mockSourcesManager }
        );
    });

    it('skips notification TTS when ttsEnabled is false', async () => {
        await queue.handleNotificationEffects({
            type: 'platform:paypiggy',
            platform: 'youtube',
            data: {
                username: 'testMember',
                displayMessage: 'Welcome!',
                ttsMessage: 'Hi member'
            }
        });

        expect(updateCalls).toEqual([]);
    });
});
