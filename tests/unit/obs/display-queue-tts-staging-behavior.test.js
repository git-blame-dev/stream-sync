const { describe, expect, it, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { safeSetTimeout } = require('../../../src/utils/timeout-validator');
const { PlatformEvents } = require('../../../src/interfaces/PlatformEvents');
const { PRIORITY_LEVELS } = require('../../../src/core/constants');

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
        const recordedTexts = [];

        const mockSourcesManager = {
            updateTextSource: createMockFn((source, text) => {
                recordedTexts.push(text);
                return Promise.resolve();
            }),
            clearTextSource: createMockFn().mockResolvedValue(),
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

        const mockGoalsManager = {
            processDonationGoal: createMockFn().mockResolvedValue({ success: true }),
            processPaypiggyGoal: createMockFn().mockResolvedValue({ success: true }),
            initializeGoalDisplay: createMockFn().mockResolvedValue()
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
                PRIORITY_LEVELS,
                CHAT_MESSAGE_DURATION: 4500,
                CHAT_TRANSITION_DELAY: 200
            },
            eventBus,
            { sourcesManager: mockSourcesManager, goalsManager: mockGoalsManager, delay: async () => {} }
        );

        queue.effects.playGiftVideoAndAudio = createMockFn().mockResolvedValue();

        return { queue, eventBus, mockSourcesManager, recordedTexts };
    }

    it('emits VFX and updates TTS for gift notifications', async () => {
        const { queue, eventBus } = createQueue();
        const capturedVfx = [];

        eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload) => capturedVfx.push(payload));

        await queue.effects.handleGiftEffects({
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
                username: 'test-gifter',
                userId: 'test-gifter-id',
                displayMessage: 'sent a rose',
                ttsMessage: 'test-gifter sent a rose',
                giftType: 'rose',
                giftCount: 2,
                amount: 20,
                currency: 'coins'
            }
        }, []);

        expect(capturedVfx).toHaveLength(1);
        expect(capturedVfx[0]).toEqual(expect.objectContaining({
            commandKey: 'gifts',
            username: 'test-gifter',
            platform: 'tiktok'
        }));
    });

    it('waits for VFX completion before playing TTS for sequential notifications', async () => {
        const { queue, eventBus, recordedTexts } = createQueue();
        const capturedVfx = [];

        eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload) => {
            capturedVfx.push(payload);
            safeSetTimeout(() => {
                eventBus.emit(PlatformEvents.VFX_EFFECT_COMPLETED, { correlationId: payload.correlationId });
            }, 1, 'test VFX completion emit');
        });

        await queue.effects.handleSequentialEffects({
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
                username: 'test-follower',
                userId: 'test-follower-id',
                displayMessage: 'just followed!',
                ttsMessage: 'test-follower just followed'
            }
        }, [{ type: 'primary', text: 'test-follower just followed', delay: 0 }]);

        expect(capturedVfx).toHaveLength(1);
        expect(recordedTexts).toContain('test-follower just followed');
    });

    it('skips VFX when no vfxConfig provided', async () => {
        const { queue, eventBus, recordedTexts } = createQueue();
        const capturedVfx = [];

        eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload) => capturedVfx.push(payload));

        await queue.effects.handleSequentialEffects({
            type: 'greeting',
            platform: 'twitch',
            data: {
                username: 'test-viewer',
                displayMessage: 'Hello',
                ttsMessage: 'Hello from test-viewer'
            }
        }, [{ type: 'primary', text: 'Hello from test-viewer', delay: 0 }]);

        expect(capturedVfx).toHaveLength(0);
        expect(recordedTexts).toContain('Hello from test-viewer');
    });

    it('processes multiple TTS stages sequentially', async () => {
        const { queue, eventBus, recordedTexts } = createQueue();

        eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload) => {
            safeSetTimeout(() => {
                eventBus.emit(PlatformEvents.VFX_EFFECT_COMPLETED, { correlationId: payload.correlationId });
            }, 1, 'test VFX completion emit');
        });

        const ttsStages = [
            { type: 'primary', text: 'Stage one', delay: 0 },
            { type: 'message', text: 'Stage two', delay: 0 }
        ];

        await queue.effects.handleSequentialEffects({
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
                username: 'test-member',
                userId: 'test-member-id',
                displayMessage: 'joined membership'
            }
        }, ttsStages);

        expect(recordedTexts).toEqual(['Stage one', 'Stage two']);
    });

    it('continues TTS when VFX config is partial and buildVfxMatch throws', async () => {
        const { queue, recordedTexts } = createQueue();

        await queue.effects.handleSequentialEffects({
            type: 'platform:gift',
            platform: 'tiktok',
            vfxConfig: { commandKey: 'gifts' },
            data: {
                username: 'test-gifter',
                userId: 'test-gifter-id',
                displayMessage: 'sent a gift',
                ttsMessage: 'test-gifter sent a gift'
            }
        }, [{ type: 'primary', text: 'test-gifter sent a gift', delay: 0 }]);

        expect(recordedTexts).toContain('test-gifter sent a gift');
    });
});
