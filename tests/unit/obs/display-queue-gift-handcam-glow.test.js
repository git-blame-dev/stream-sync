const { describe, expect, it, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { createRuntimeConstantsFixture } = require('../../helpers/runtime-constants-fixture');

const { DisplayQueue } = require('../../../src/obs/display-queue');
const { EventEmitter } = require('events');

describe('DisplayQueue gift effects handcam glow', () => {
    let originalNodeEnv;

    beforeEach(() => {
        originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'test';
    });

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        restoreAllMocks();
    });

    function createQueue(handcamEnabled = true) {
        const runtimeConstants = createRuntimeConstantsFixture({
            HANDCAM_GLOW_CONFIG: {
                ENABLED: handcamEnabled,
                DEFAULT_MAX_SIZE: 10,
                DEFAULT_RAMP_UP_DURATION: 1,
                DEFAULT_HOLD_DURATION: 2,
                DEFAULT_RAMP_DOWN_DURATION: 1,
                DEFAULT_TOTAL_STEPS: 5,
                DEFAULT_INCREMENT_PERCENT: 20,
                DEFAULT_EASING_ENABLED: true,
                DEFAULT_ANIMATION_INTERVAL: 100,
                SOURCE_NAME: 'testSource',
                SCENE_NAME: 'testScene',
                FILTER_NAME: 'testFilter'
            }
        });

        const mockSourcesManager = {
            updateTextSource: createMockFn().mockResolvedValue(),
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
            isConnected: () => true
        };

        const queue = new DisplayQueue(
            obsManager,
            {
                ttsEnabled: true,
                chat: {},
                notification: {},
                obs: { ttsTxt: 'testTtsTxt' },
                handcam: { enabled: handcamEnabled }
            },
            { PRIORITY_LEVELS: { CHAT: 1, GIFT: 5 } },
            new EventEmitter(),
            runtimeConstants
        );

        queue.sourcesManager = mockSourcesManager;
        return { queue, mockSourcesManager, obsManager };
    }

    it('processes gift notification effects without errors when handcam enabled', async () => {
        const { queue, mockSourcesManager } = createQueue(true);

        await expect(queue.handleNotificationEffects({
            type: 'platform:gift',
            platform: 'tiktok',
            data: {
                username: 'testGifter',
                displayMessage: 'sent a gift',
                ttsMessage: 'testGifter sent a gift',
                giftType: 'rose',
                giftCount: 1,
                amount: 1,
                currency: 'coins'
            }
        })).resolves.toBeUndefined();

        expect(mockSourcesManager.updateTextSource).toHaveBeenCalled();
    });

    it('updates TTS text source for gift notifications', async () => {
        const { queue, mockSourcesManager } = createQueue(true);

        await queue.handleNotificationEffects({
            type: 'platform:gift',
            platform: 'tiktok',
            data: {
                username: 'testGifter',
                ttsMessage: 'testGifter sent a rose',
                displayMessage: 'sent a rose'
            }
        });

        expect(mockSourcesManager.updateTextSource).toHaveBeenCalledWith(
            'testTtsTxt',
            'testGifter sent a rose'
        );
    });

    it('processes gift notification without handcam glow when disabled', async () => {
        const { queue, mockSourcesManager } = createQueue(false);

        await expect(queue.handleNotificationEffects({
            type: 'platform:gift',
            platform: 'tiktok',
            data: {
                username: 'testGifter',
                ttsMessage: 'testGifter sent a gift',
                displayMessage: 'sent a gift'
            }
        })).resolves.toBeUndefined();

        expect(mockSourcesManager.updateTextSource).toHaveBeenCalled();
    });
});
