const { describe, expect, it, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { createRuntimeConstantsFixture } = require('../../helpers/runtime-constants-fixture');
const { safeDelay, safeSetTimeout } = require('../../../src/utils/timeout-validator');
const { PlatformEvents } = require('../../../src/interfaces/PlatformEvents');

const { DisplayQueue } = require('../../../src/obs/display-queue');
const { EventEmitter } = require('events');

describe('DisplayQueue notification TTS staging', () => {
    let originalNodeEnv;

    beforeEach(() => {
        originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'test';
    });

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        restoreAllMocks();
    });

    function createQueue() {
        const runtimeConstants = createRuntimeConstantsFixture({});
        const recordedTexts = [];

        const mockSourcesManager = {
            updateTextSource: createMockFn((source, text) => {
                recordedTexts.push(text);
                return Promise.resolve();
            }),
            setSourceVisibility: createMockFn().mockResolvedValue(),
            setNotificationDisplayVisibility: createMockFn().mockResolvedValue(),
            setChatDisplayVisibility: createMockFn().mockResolvedValue(),
            hideAllDisplays: createMockFn().mockResolvedValue(),
            setPlatformLogoVisibility: createMockFn().mockResolvedValue(),
            setNotificationPlatformLogoVisibility: createMockFn().mockResolvedValue(),
            setGroupSourceVisibility: createMockFn().mockResolvedValue(),
            setSourceFilterVisibility: createMockFn().mockResolvedValue()
        };

        const obsManager = {
            call: createMockFn().mockResolvedValue({}),
            isConnected: () => true,
            isReady: createMockFn().mockResolvedValue(true)
        };

        const eventBus = new EventEmitter();
        eventBus.subscribe = (event, handler) => {
            eventBus.on(event, handler);
            return () => eventBus.off(event, handler);
        };

        const queue = new DisplayQueue(
            obsManager,
            {
                ttsEnabled: true,
                chat: {},
                notification: {},
                obs: { ttsTxt: 'testTts' },
                handcam: { enabled: false }
            },
            {
                PRIORITY_LEVELS: { CHAT: 1, GIFT: 5 },
                CHAT_MESSAGE_DURATION: 4500,
                CHAT_TRANSITION_DELAY: 200
            },
            eventBus,
            runtimeConstants
        );

        queue.sourcesManager = mockSourcesManager;
        queue.playGiftVideoAndAudio = createMockFn().mockResolvedValue();

        return { queue, eventBus, mockSourcesManager, recordedTexts };
    }

    it('emits VFX and updates TTS for gift notifications', async () => {
        const { queue, eventBus } = createQueue();
        const capturedVfx = [];

        eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload) => capturedVfx.push(payload));

        queue.handleGiftEffects({
            type: 'platform:gift',
            platform: 'tiktok',
            vfxConfig: {
                commandKey: 'gifts',
                command: '!money',
                filename: 'money.mp4',
                mediaSource: 'VFX Top',
                vfxFilePath: '/tmp/vfx',
                duration: 5000
            },
            data: {
                username: 'testGifter',
                userId: 'testGifterId',
                displayMessage: 'sent a rose',
                ttsMessage: 'testGifter sent a rose',
                giftType: 'rose',
                giftCount: 2,
                amount: 20,
                currency: 'coins'
            }
        }, []);

        await safeDelay(2100);

        expect(capturedVfx).toHaveLength(1);
        expect(capturedVfx[0]).toEqual(expect.objectContaining({
            commandKey: 'gifts',
            username: 'testGifter',
            platform: 'tiktok'
        }));
    });

    it('waits for VFX completion before playing TTS for sequential notifications', async () => {
        const { queue, eventBus, mockSourcesManager } = createQueue();
        const capturedVfx = [];

        eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload) => {
            capturedVfx.push(payload);
            safeSetTimeout(() => {
                eventBus.emit(PlatformEvents.VFX_EFFECT_COMPLETED, { correlationId: payload.correlationId });
            }, 10, 50, 'test VFX completion emit');
        });

        await queue.handleSequentialEffects({
            type: 'platform:follow',
            platform: 'twitch',
            vfxConfig: {
                commandKey: 'follows',
                command: '!follow',
                filename: 'follow.mp4',
                mediaSource: 'VFX Top',
                vfxFilePath: '/tmp/vfx',
                duration: 5000
            },
            data: {
                username: 'testFollower',
                userId: 'testFollowerId',
                displayMessage: 'just followed!',
                ttsMessage: 'testFollower just followed'
            }
        }, [{ type: 'primary', text: 'testFollower just followed', delay: 0 }]);

        expect(capturedVfx).toHaveLength(1);
        expect(mockSourcesManager.updateTextSource).toHaveBeenCalledWith('testTts', 'testFollower just followed');
    });

    it('skips VFX when no vfxConfig provided', async () => {
        const { queue, eventBus, mockSourcesManager } = createQueue();
        const capturedVfx = [];

        eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload) => capturedVfx.push(payload));

        await queue.handleSequentialEffects({
            type: 'greeting',
            platform: 'twitch',
            data: {
                username: 'testViewer',
                displayMessage: 'Hello',
                ttsMessage: 'Hello from testViewer'
            }
        }, [{ type: 'primary', text: 'Hello from testViewer', delay: 0 }]);

        expect(capturedVfx).toHaveLength(0);
        expect(mockSourcesManager.updateTextSource).toHaveBeenCalledWith('testTts', 'Hello from testViewer');
    });

    it('processes multiple TTS stages sequentially', async () => {
        const { queue, eventBus, mockSourcesManager } = createQueue();

        eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload) => {
            safeSetTimeout(() => {
                eventBus.emit(PlatformEvents.VFX_EFFECT_COMPLETED, { correlationId: payload.correlationId });
            }, 10, 50, 'test VFX completion emit');
        });

        const ttsStages = [
            { type: 'primary', text: 'Stage one', delay: 0 },
            { type: 'message', text: 'Stage two', delay: 0 }
        ];

        await queue.handleSequentialEffects({
            type: 'platform:paypiggy',
            platform: 'youtube',
            vfxConfig: {
                commandKey: 'paypiggies',
                command: '!member',
                filename: 'member.mp4',
                mediaSource: 'VFX Top',
                vfxFilePath: '/tmp/vfx',
                duration: 5000
            },
            data: {
                username: 'testMember',
                userId: 'testMemberId',
                displayMessage: 'joined membership'
            }
        }, ttsStages);

        expect(mockSourcesManager.updateTextSource).toHaveBeenCalledTimes(2);
        const calls = mockSourcesManager.updateTextSource.mock.calls;
        expect(calls[0][1]).toBe('Stage one');
        expect(calls[1][1]).toBe('Stage two');
    });

    it('continues TTS when VFX config is partial and buildVfxMatch throws', async () => {
        const { queue, recordedTexts } = createQueue();

        await queue.handleSequentialEffects({
            type: 'platform:gift',
            platform: 'tiktok',
            vfxConfig: { commandKey: 'gifts' },
            data: {
                username: 'testGifter',
                userId: 'testGifterId',
                displayMessage: 'sent a gift',
                ttsMessage: 'testGifter sent a gift'
            }
        }, [{ type: 'primary', text: 'testGifter sent a gift', delay: 0 }]);

        expect(recordedTexts).toContain('testGifter sent a gift');
    });
});
