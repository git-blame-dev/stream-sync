const { describe, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { safeSetTimeout } = require('../../../src/utils/timeout-validator');
const { EventEmitter } = require('events');
const { DisplayQueue } = require('../../../src/obs/display-queue.ts');
const constants = require('../../../src/core/constants');
const { PlatformEvents } = require('../../../src/interfaces/PlatformEvents');

describe('DisplayQueue monetization VFX context', () => {
    let originalNodeEnv;

    beforeEach(() => {
        originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'test';
    });

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        restoreAllMocks();
    });

    function createQueue(eventBus) {
        const obsManager = {
            isReady: createMockFn().mockResolvedValue(true),
            call: createMockFn().mockResolvedValue({ success: true }),
            isConnected: () => true
        };

        const baseConfig = {
            autoProcess: false,
            maxQueueSize: 100,
            chat: { sourceName: 'chat', sceneName: 'scene', groupName: 'group', platformLogos: {} },
            notification: { sourceName: 'notification', sceneName: 'scene', groupName: 'group', platformLogos: {} },
            timing: { transitionDelay: 200, notificationClearDelay: 500, chatMessageDuration: 4500 },
            handcam: { enabled: false },
            gifts: { giftVideoSource: 'gift-video', giftAudioSource: 'gift-audio' },
            obs: { ttsTxt: 'testTts' },
            youtube: {},
            twitch: {},
            tiktok: {},
            ttsEnabled: false
        };

        const mockDependencies = {
            sourcesManager: {
                updateTextSource: createMockFn().mockResolvedValue(),
                clearTextSource: createMockFn().mockResolvedValue(),
                setSourceVisibility: createMockFn().mockResolvedValue(),
                setNotificationDisplayVisibility: createMockFn().mockResolvedValue(),
                setChatDisplayVisibility: createMockFn().mockResolvedValue(),
                hideAllDisplays: createMockFn().mockResolvedValue(),
                setPlatformLogoVisibility: createMockFn().mockResolvedValue(),
                setNotificationPlatformLogoVisibility: createMockFn().mockResolvedValue()
            },
            goalsManager: {
                processDonationGoal: createMockFn().mockResolvedValue({ success: true }),
                processPaypiggyGoal: createMockFn().mockResolvedValue({ success: true }),
                initializeGoalDisplay: createMockFn().mockResolvedValue()
            },
            delay: async () => {}
        };

        const queue = new DisplayQueue(obsManager, baseConfig, constants, eventBus, mockDependencies);
        queue.effects.playGiftVideoAndAudio = createMockFn().mockResolvedValue();

        return queue;
    }

    it('emits VFX_COMMAND_RECEIVED for gift notifications', async () => {
        const eventBus = new EventEmitter();
        const capturedVfx = [];
        const queue = createQueue(eventBus);

        const item = {
            type: 'platform:gift',
            platform: 'youtube',
            vfxConfig: {
                commandKey: 'gifts',
                command: '!gift',
                filename: 'gift.mp4',
                mediaSource: 'vfx top',
                vfxFilePath: '/tmp/vfx',
                duration: 5000
            },
            data: { username: 'test-gift-user', userId: 'test-user-id-123', displayMessage: 'sent a gift' }
        };

        eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload) => {
            capturedVfx.push(payload);
            safeSetTimeout(() => {
                eventBus.emit(PlatformEvents.VFX_EFFECT_COMPLETED, { correlationId: payload.correlationId });
            }, 1, 'test gift VFX completion emit');
        });

        await queue.effects.handleGiftEffects(item, []);

        expect(capturedVfx).toHaveLength(1);
        expect(capturedVfx[0]).toEqual(expect.objectContaining({
            commandKey: 'gifts',
            username: 'test-gift-user',
            userId: 'test-user-id-123',
            platform: 'youtube'
        }));
    });

    it('emits VFX_COMMAND_RECEIVED for sequential notifications', async () => {
        const eventBus = new EventEmitter();
        const capturedVfx = [];

        eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload) => {
            capturedVfx.push(payload);
            safeSetTimeout(() => {
                eventBus.emit(PlatformEvents.VFX_EFFECT_COMPLETED, { correlationId: payload.correlationId });
            }, 1, 'test VFX completion emit');
        });

        const queue = createQueue(eventBus);

        const item = {
            type: 'platform:follow',
            platform: 'twitch',
            vfxConfig: {
                commandKey: 'follows',
                command: '!follow',
                filename: 'follow.mp4',
                mediaSource: 'vfx top',
                vfxFilePath: '/tmp/vfx',
                duration: 5000
            },
            data: { username: 'test-follow-user', userId: 'test-follow-id', displayMessage: 'followed' }
        };

        await queue.effects.handleSequentialEffects(item, []);

        expect(capturedVfx).toHaveLength(1);
        expect(capturedVfx[0]).toEqual(expect.objectContaining({
            commandKey: 'follows',
            username: 'test-follow-user',
            platform: 'twitch',
            userId: 'test-follow-id'
        }));
    });

    it('includes context with source and notificationType in VFX payload', async () => {
        const eventBus = new EventEmitter();
        const capturedVfx = [];

        eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload) => {
            capturedVfx.push(payload);
            safeSetTimeout(() => {
                eventBus.emit(PlatformEvents.VFX_EFFECT_COMPLETED, { correlationId: payload.correlationId });
            }, 1, 'test VFX completion emit');
        });

        const queue = createQueue(eventBus);

        const item = {
            type: 'platform:paypiggy',
            platform: 'tiktok',
            vfxConfig: {
                commandKey: 'paypiggies',
                command: '!member',
                filename: 'member.mp4',
                mediaSource: 'vfx top',
                vfxFilePath: '/tmp/vfx',
                duration: 5000
            },
            data: { username: 'test-member', userId: 'test-member-id', displayMessage: 'joined' }
        };

        await queue.effects.handleSequentialEffects(item, []);

        expect(capturedVfx).toHaveLength(1);
        expect(capturedVfx[0].context).toEqual(expect.objectContaining({
            source: 'display-queue',
            notificationType: 'platform:paypiggy'
        }));
    });

    it('skips VFX emit when no vfxConfig provided', async () => {
        const eventBus = new EventEmitter();
        const capturedVfx = [];
        eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload) => capturedVfx.push(payload));
        const queue = createQueue(eventBus);

        const item = {
            type: 'platform:follow',
            platform: 'youtube',
            data: { username: 'test-user', userId: 'test-id', displayMessage: 'subscribed' }
        };

        await queue.effects.handleSequentialEffects(item, []);

        expect(capturedVfx).toHaveLength(0);
    });
});
