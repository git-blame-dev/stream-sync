import { describe, test, expect } from 'bun:test';
import { createRequire } from 'node:module';

const load = createRequire(__filename);
const EventEmitter = load('events');
const { DisplayQueue } = load('../../src/obs/display-queue.ts');
const { PRIORITY_LEVELS } = load('../../src/core/constants');
const { PlatformEvents } = load('../../src/interfaces/PlatformEvents');

type QueueAction = {
    type: string;
    source?: string;
    username?: string;
    message?: string;
    text?: string;
    group?: string;
    visible?: boolean;
    scene?: string;
    platform?: string;
};

describe('DisplayQueue gift flow (smoke E2E)', () => {
    test('processes a gift notification end-to-end', async () => {
        const emitter = new EventEmitter();
        const eventBus = {
            emit: (event, payload) => emitter.emit(event, payload),
            subscribe: (event, handler) => {
                emitter.on(event, handler);
                return () => emitter.off(event, handler);
            }
        };

        const vfxEvents: unknown[] = [];
        emitter.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload) => {
            vfxEvents.push(payload);
            queueMicrotask(() => {
                emitter.emit(PlatformEvents.VFX_EFFECT_COMPLETED, { correlationId: payload.correlationId });
            });
        });

        const actions: QueueAction[] = [];
        const sourcesManager = {
            updateChatMsgText: async (source, username, message) => {
                actions.push({ type: 'chatText', source, username, message });
            },
            updateTextSource: async (source, text) => {
                actions.push({ type: 'text', source, text });
            },
            clearTextSource: async (source) => {
                actions.push({ type: 'clearText', source });
            },
            setGroupSourceVisibility: async (source, group, visible) => {
                actions.push({ type: 'groupVisibility', source, group, visible });
            },
            setChatDisplayVisibility: async (visible, scene) => {
                actions.push({ type: 'chatDisplay', visible, scene });
            },
            setNotificationDisplayVisibility: async (visible, scene) => {
                actions.push({ type: 'notificationDisplay', visible, scene });
            },
            setPlatformLogoVisibility: async (platform) => {
                actions.push({ type: 'platformLogo', platform });
            },
            setNotificationPlatformLogoVisibility: async (platform) => {
                actions.push({ type: 'notificationLogo', platform });
            }
        };

        const obsCalls: Array<{ method: string; payload: unknown }> = [];
        const obsManager = {
            isReady: async () => true,
            call: async (method, payload) => {
                obsCalls.push({ method, payload });
                return {};
            }
        };

        const goalCalls: Array<{ platform: string; amount: number }> = [];
        const goalsManager = {
            processDonationGoal: async (platform, amount) => {
                goalCalls.push({ platform, amount });
            }
        };

        const config = {
            autoProcess: false,
            maxQueueSize: 10,
            timing: { transitionDelay: 0, notificationClearDelay: 0, chatMessageDuration: 0 },
            chat: { sourceName: 'chat-source', sceneName: 'chat-scene', groupName: 'chat-group', platformLogos: {} },
            notification: { sourceName: 'notif-source', sceneName: 'notif-scene', groupName: 'notif-group', platformLogos: {} },
            obs: { ttsTxt: 'tts-source' },
            gifts: { giftVideoSource: 'gift-video', giftAudioSource: 'gift-audio' },
            handcam: { enabled: false },
            ttsEnabled: true,
            tiktok: { messagesEnabled: true }
        };

        const queue = new DisplayQueue(obsManager, config, { PRIORITY_LEVELS }, eventBus, {
            sourcesManager,
            goalsManager,
            delay: async () => {}
        });
        queue.getDuration = () => 0;

        queue.addItem({
            type: 'platform:gift',
            platform: 'tiktok',
            vfxConfig: {
                commandKey: 'gifts',
                command: '!gift',
                filename: 'gift.mp4',
                mediaSource: 'vfx top',
                vfxFilePath: '/tmp/vfx'
            },
            data: {
                username: 'test-user',
                userId: 'test-user-id',
                giftType: 'rose',
                giftCount: 1,
                amount: 100,
                currency: 'coins',
                displayMessage: 'test-user sent a gift',
                ttsMessage: 'test-user sent a gift'
            }
        });

        await queue.processQueue();

        expect(queue.queue).toHaveLength(0);
        expect(goalCalls).toEqual([{ platform: 'tiktok', amount: 100 }]);
        expect(vfxEvents).toHaveLength(1);
        expect(vfxEvents[0]).toEqual(expect.objectContaining({
            commandKey: 'gifts',
            username: 'test-user',
            platform: 'tiktok'
        }));

        const notificationText = actions.find(action => action.type === 'text' && action.source === 'notif-source');
        const ttsText = actions.find(action => action.type === 'text' && action.source === 'tts-source');

        expect(notificationText?.text).toBe('test-user sent a gift');
        expect(ttsText?.text).toBe('test-user sent a gift');
        expect(actions.some(action => action.type === 'notificationDisplay' && action.visible === true)).toBe(true);
        expect(obsCalls.length).toBe(2);
    });
});
