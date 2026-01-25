const { describe, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, spyOn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { createRuntimeConstantsFixture } = require('../../helpers/runtime-constants-fixture');
const { safeDelay, safeSetTimeout } = require('../../../src/utils/timeout-validator');

const { EventEmitter } = require('events');
const { DisplayQueue } = require('../../../src/obs/display-queue');
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
        const runtimeConstants = createRuntimeConstantsFixture({});

        const obsManager = {
            isReady: createMockFn().mockResolvedValue(true),
            call: createMockFn().mockResolvedValue({ success: true }),
            isConnected: () => true
        };

        const baseConfig = {
            autoProcess: false,
            chat: {},
            notification: {},
            obs: { ttsTxt: 'testTts' },
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
            }
        };

        const queue = new DisplayQueue(obsManager, baseConfig, constants, eventBus, runtimeConstants, mockDependencies);
        queue.playGiftVideoAndAudio = createMockFn().mockResolvedValue();
        queue.isTTSEnabled = createMockFn().mockReturnValue(false);

        return queue;
    }

    it('emits VFX_COMMAND_RECEIVED for gift notifications', async () => {
        const eventBus = new EventEmitter();
        const emitSpy = spyOn(eventBus, 'emit');
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
            data: { username: 'testGiftUser', userId: 'testUserId123', displayMessage: 'sent a gift' }
        };

        queue.handleGiftEffects(item, []);

        await safeDelay(2100);

        expect(emitSpy).toHaveBeenCalled();
        const vfxCall = emitSpy.mock.calls.find(c => c[0] === PlatformEvents.VFX_COMMAND_RECEIVED);
        expect(vfxCall).toBeDefined();
        expect(vfxCall[1]).toEqual(expect.objectContaining({
            commandKey: 'gifts',
            username: 'testGiftUser',
            userId: 'testUserId123',
            platform: 'youtube'
        }));
    });

    it('emits VFX_COMMAND_RECEIVED for sequential notifications', async () => {
        const eventBus = new EventEmitter();
        const emitSpy = spyOn(eventBus, 'emit');

        eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload) => {
            safeSetTimeout(() => {
                eventBus.emit(PlatformEvents.VFX_EFFECT_COMPLETED, { correlationId: payload.correlationId });
            }, 10, 50, 'test VFX completion emit');
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
            data: { username: 'testFollowUser', userId: 'testFollowId', displayMessage: 'followed' }
        };

        await queue.handleSequentialEffects(item, []);

        const vfxCall = emitSpy.mock.calls.find(c => c[0] === PlatformEvents.VFX_COMMAND_RECEIVED);
        expect(vfxCall).toBeDefined();
        expect(vfxCall[1]).toEqual(expect.objectContaining({
            commandKey: 'follows',
            username: 'testFollowUser',
            platform: 'twitch',
            userId: 'testFollowId'
        }));
    });

    it('includes context with source and notificationType in VFX payload', async () => {
        const eventBus = new EventEmitter();
        const emitSpy = spyOn(eventBus, 'emit');

        eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload) => {
            safeSetTimeout(() => {
                eventBus.emit(PlatformEvents.VFX_EFFECT_COMPLETED, { correlationId: payload.correlationId });
            }, 10, 50, 'test VFX completion emit');
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
            data: { username: 'testMember', userId: 'testMemberId', displayMessage: 'joined' }
        };

        await queue.handleSequentialEffects(item, []);

        const vfxCall = emitSpy.mock.calls.find(c => c[0] === PlatformEvents.VFX_COMMAND_RECEIVED);
        expect(vfxCall[1].context).toEqual(expect.objectContaining({
            source: 'display-queue',
            notificationType: 'platform:paypiggy'
        }));
    });

    it('skips VFX emit when no vfxConfig provided', async () => {
        const eventBus = new EventEmitter();
        const emitSpy = spyOn(eventBus, 'emit');
        const queue = createQueue(eventBus);

        const item = {
            type: 'platform:follow',
            platform: 'youtube',
            data: { username: 'testUser', userId: 'testId', displayMessage: 'subscribed' }
        };

        await queue.handleSequentialEffects(item, []);

        const vfxCalls = emitSpy.mock.calls.filter(c => c[0] === PlatformEvents.VFX_COMMAND_RECEIVED);
        expect(vfxCalls).toHaveLength(0);
    });
});
