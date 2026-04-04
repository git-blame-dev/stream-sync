const { describe, expect, it } = require('bun:test');

const { DisplayQueueEffects } = require('../../../src/obs/display-queue-effects.ts');
const { waitForDelay } = require('../../helpers/time-utils');

describe('DisplayQueueEffects', () => {
    it('runs TTS stages for non-gift notifications', async () => {
        const ttsUpdates = [];
        const sourcesManager = {
            clearTextSource: async () => {},
            updateTextSource: async (_source, text) => {
                ttsUpdates.push(text);
            }
        };
        const effects = new DisplayQueueEffects({
            config: { ttsEnabled: true, obs: { ttsTxt: 'tts' }, handcam: { enabled: false } },
            sourcesManager,
            obsManager: { call: async () => ({}) },
            goalsManager: { processDonationGoal: async () => {} },
            delay: async () => {},
            handleDisplayQueueError: () => {},
            extractUsername: (data) => data?.username ?? null
        });

        await effects.handleNotificationEffects({
            type: 'platform:follow',
            platform: 'tiktok',
            data: {
                username: 'test-user',
                ttsMessage: 'hello',
                isComment: true,
                message: 'hi'
            }
        });

        expect(ttsUpdates[0]).toBe('hello');
        expect(ttsUpdates[1]).toContain('says');
    });

    it('plays gift media, triggers handcam glow, and tracks goals', async () => {
        const obsCalls = [];
        const goalCalls = [];
        let handcamTriggered = false;
        const effects = new DisplayQueueEffects({
            config: {
                ttsEnabled: false,
                obs: { ttsTxt: 'tts' },
                handcam: { enabled: true },
                gifts: { giftVideoSource: 'gift-video', giftAudioSource: 'gift-audio' }
            },
            sourcesManager: { clearTextSource: async () => {}, updateTextSource: async () => {} },
            obsManager: {
                call: async (method, payload) => {
                    obsCalls.push({ method, payload });
                    return {};
                }
            },
            goalsManager: {
                processDonationGoal: async (platform, amount) => {
                    goalCalls.push({ platform, amount });
                }
            },
            triggerHandcamGlow: () => {
                handcamTriggered = true;
            },
            delay: async () => {},
            handleDisplayQueueError: () => {},
            extractUsername: (data) => data?.username ?? null
        });

        await effects.handleNotificationEffects({
            type: 'platform:gift',
            platform: 'tiktok',
            data: {
                username: 'test-user',
                userId: 'test-user-id',
                giftType: 'rose',
                giftCount: 1,
                amount: 100,
                currency: 'coins'
            }
        });

        expect(handcamTriggered).toBe(true);
        expect(goalCalls).toEqual([{ platform: 'tiktok', amount: 100 }]);
        expect(obsCalls.length).toBe(2);
    });

    it('skips VFX and continues TTS when sequential VFX match build fails', async () => {
        const ttsUpdates = [];
        const emittedVfx = [];
        const effects = new DisplayQueueEffects({
            config: {
                ttsEnabled: true,
                obs: { ttsTxt: 'tts' },
                handcam: { enabled: false }
            },
            sourcesManager: {
                clearTextSource: async () => {},
                updateTextSource: async (_source, text) => {
                    ttsUpdates.push(text);
                }
            },
            obsManager: { call: async () => ({}) },
            goalsManager: { processDonationGoal: async () => {} },
            eventBus: { emit: (_event, payload) => emittedVfx.push(payload) },
            delay: async () => {},
            handleDisplayQueueError: () => {},
            extractUsername: (data) => data?.username ?? null
        });

        const result = await effects.handleSequentialEffects({
            type: 'platform:follow',
            platform: 'tiktok',
            vfxConfig: { commandKey: 'test-cmd' },
            data: { username: 'test-user', userId: 'test-user-id' }
        }, [{ type: 'primary', text: 'test-tts-text', delay: 0 }]);

        expect(result).toBeNull();
        expect(emittedVfx).toHaveLength(0);
        expect(ttsUpdates).toContain('test-tts-text');
    });

    it('continues gift effects when VFX config is partial', async () => {
        const ttsUpdates = [];
        const emittedVfx = [];
        const effects = new DisplayQueueEffects({
            config: {
                ttsEnabled: true,
                obs: { ttsTxt: 'tts' },
                handcam: { enabled: false },
                gifts: { giftVideoSource: 'gift-video', giftAudioSource: 'gift-audio' }
            },
            sourcesManager: {
                clearTextSource: async () => {},
                updateTextSource: async (_source, text) => {
                    ttsUpdates.push(text);
                }
            },
            obsManager: { call: async () => ({}) },
            goalsManager: { processDonationGoal: async () => {} },
            eventBus: { emit: (event, payload) => emittedVfx.push({ event, payload }) },
            delay: async () => {},
            handleDisplayQueueError: () => {},
            extractUsername: (data) => data?.username ?? null
        });

        await effects.handleGiftEffects({
            type: 'platform:gift',
            platform: 'tiktok',
            vfxConfig: { commandKey: 'gifts' },
            data: { username: 'test-user', userId: 'test-user-id' }
        }, [{ type: 'primary', text: 'test-gift-tts', delay: 0 }]);

        expect(ttsUpdates).toContain('test-gift-tts');
        expect(emittedVfx).toHaveLength(0);
    });

    it('emits tiktok gift animation effect and sets hold duration', async () => {
        const emittedEvents = [];
        const effects = new DisplayQueueEffects({
            config: {
                ttsEnabled: false,
                obs: { ttsTxt: 'tts' },
                handcam: { enabled: false },
                gifts: { giftVideoSource: 'gift-video', giftAudioSource: 'gift-audio' },
                gui: { enableOverlay: true, enableDock: false, showGifts: true }
            },
            sourcesManager: { clearTextSource: async () => {}, updateTextSource: async () => {} },
            obsManager: { call: async () => ({}) },
            goalsManager: { processDonationGoal: async () => {} },
            eventBus: { emit: (eventName, payload) => emittedEvents.push({ eventName, payload }) },
            delay: async () => {},
            handleDisplayQueueError: () => {},
            extractUsername: (data) => data?.username ?? null,
            giftAnimationResolver: {
                resolveFromNotificationData: async () => ({
                    mediaFilePath: '/tmp/test-animation.mp4',
                    mediaContentType: 'video/mp4',
                    durationMs: 4500,
                    animationConfig: {
                        profileName: 'portrait',
                        sourceWidth: 960,
                        sourceHeight: 864,
                        renderWidth: 480,
                        renderHeight: 854,
                        rgbFrame: [0, 0, 480, 854],
                        aFrame: [480, 0, 480, 854]
                    }
                })
            }
        });

        const item = {
            type: 'platform:gift',
            platform: 'tiktok',
            data: {
                username: 'test-user',
                userId: 'test-user-id',
                giftType: 'Corgi',
                giftCount: 1,
                amount: 299,
                currency: 'coins'
            }
        };

        await effects.handleGiftEffects(item, []);

        const animationEvent = emittedEvents.find((entry) => entry.eventName === 'display:gift-animation');
        expect(animationEvent).toBeDefined();
        expect(animationEvent.payload.durationMs).toBe(4500);
        expect(item.holdDurationMs).toBe(4500);
    });

    it('does not resolve animation for non-tiktok gifts', async () => {
        let resolveCallCount = 0;
        const effects = new DisplayQueueEffects({
            config: {
                ttsEnabled: false,
                obs: { ttsTxt: 'tts' },
                handcam: { enabled: false },
                gifts: { giftVideoSource: 'gift-video', giftAudioSource: 'gift-audio' },
                gui: { enableOverlay: true, enableDock: false, showGifts: true }
            },
            sourcesManager: { clearTextSource: async () => {}, updateTextSource: async () => {} },
            obsManager: { call: async () => ({}) },
            goalsManager: { processDonationGoal: async () => {} },
            eventBus: { emit: () => {} },
            delay: async () => {},
            handleDisplayQueueError: () => {},
            extractUsername: (data) => data?.username ?? null,
            giftAnimationResolver: {
                resolveFromNotificationData: async () => {
                    resolveCallCount += 1;
                    return null;
                }
            }
        });

        await effects.handleGiftEffects({
            type: 'platform:gift',
            platform: 'twitch',
            data: {
                username: 'test-user',
                userId: 'test-user-id',
                giftType: 'Rose',
                giftCount: 1,
                amount: 1,
                currency: 'coins'
            }
        }, []);

        expect(resolveCallCount).toBe(0);
    });

    it('does not resolve animation when gui gift animations are disabled', async () => {
        let resolveCallCount = 0;
        const emittedEvents = [];
        const effects = new DisplayQueueEffects({
            config: {
                ttsEnabled: false,
                obs: { ttsTxt: 'tts' },
                handcam: { enabled: false },
                gifts: { giftVideoSource: 'gift-video', giftAudioSource: 'gift-audio' },
                gui: { enableOverlay: false, enableDock: false, showGifts: true }
            },
            sourcesManager: { clearTextSource: async () => {}, updateTextSource: async () => {} },
            obsManager: { call: async () => ({}) },
            goalsManager: { processDonationGoal: async () => {} },
            eventBus: { emit: (eventName, payload) => emittedEvents.push({ eventName, payload }) },
            delay: async () => {},
            handleDisplayQueueError: () => {},
            extractUsername: (data) => data?.username ?? null,
            giftAnimationResolver: {
                resolveFromNotificationData: async () => {
                    resolveCallCount += 1;
                    return null;
                }
            }
        });

        await effects.handleGiftEffects({
            type: 'platform:gift',
            platform: 'tiktok',
            data: {
                username: 'test-user',
                userId: 'test-user-id',
                giftType: 'Rose',
                giftCount: 1,
                amount: 1,
                currency: 'coins'
            }
        }, []);

        expect(resolveCallCount).toBe(0);
        expect(emittedEvents.find((entry) => entry.eventName === 'display:gift-animation')).toBeUndefined();
    });

    it('starts gift media effects before animation resolution settles', async () => {
        const obsCalls = [];
        let resolveAnimation;
        const effects = new DisplayQueueEffects({
            config: {
                ttsEnabled: false,
                obs: { ttsTxt: 'tts' },
                handcam: { enabled: false },
                gifts: { giftVideoSource: 'gift-video', giftAudioSource: 'gift-audio' },
                gui: { enableOverlay: true, enableDock: false, showGifts: true }
            },
            sourcesManager: { clearTextSource: async () => {}, updateTextSource: async () => {} },
            obsManager: {
                call: async (method) => {
                    obsCalls.push(method);
                    return {};
                }
            },
            goalsManager: { processDonationGoal: async () => {} },
            eventBus: { emit: () => {} },
            delay: async () => {},
            handleDisplayQueueError: () => {},
            extractUsername: (data) => data?.username ?? null,
            giftAnimationResolver: {
                resolveFromNotificationData: () => new Promise((resolve) => {
                    resolveAnimation = resolve;
                })
            }
        });

        const handlePromise = effects.handleGiftEffects({
            type: 'platform:gift',
            platform: 'tiktok',
            data: {
                username: 'test-user',
                userId: 'test-user-id',
                giftType: 'Corgi',
                giftCount: 1,
                amount: 299,
                currency: 'coins'
            }
        }, []);

        await waitForDelay(1);

        expect(obsCalls).toContain('TriggerMediaInputAction');

        resolveAnimation(null);
        await handlePromise;
    });

    it('does not finish gift effects before animation hold resolution completes', async () => {
        let resolveAnimation;
        let settled = false;
        const effects = new DisplayQueueEffects({
            config: {
                ttsEnabled: false,
                obs: { ttsTxt: 'tts' },
                handcam: { enabled: false },
                gifts: { giftVideoSource: 'gift-video', giftAudioSource: 'gift-audio' },
                gui: { enableOverlay: true, enableDock: false, showGifts: true }
            },
            sourcesManager: { clearTextSource: async () => {}, updateTextSource: async () => {} },
            obsManager: { call: async () => ({}) },
            goalsManager: { processDonationGoal: async () => {} },
            eventBus: { emit: () => {} },
            delay: async () => {},
            handleDisplayQueueError: () => {},
            extractUsername: (data) => data?.username ?? null,
            giftAnimationResolver: {
                resolveFromNotificationData: () => new Promise((resolve) => {
                    resolveAnimation = resolve;
                })
            }
        });

        const item = {
            type: 'platform:gift',
            platform: 'tiktok',
            data: {
                username: 'test-user',
                userId: 'test-user-id',
                giftType: 'Corgi',
                giftCount: 1,
                amount: 299,
                currency: 'coins'
            }
        };

        const handlePromise = effects.handleGiftEffects(item, []).then(() => {
            settled = true;
        });

        await waitForDelay(1);
        expect(settled).toBe(false);

        resolveAnimation({
            mediaFilePath: '/tmp/test-animation.mp4',
            mediaContentType: 'video/mp4',
            durationMs: 4200,
            animationConfig: {
                profileName: 'portrait',
                sourceWidth: 960,
                sourceHeight: 864,
                renderWidth: 480,
                renderHeight: 854,
                rgbFrame: [0, 0, 480, 854],
                aFrame: [480, 0, 480, 854]
            }
        });

        await handlePromise;
        expect(item.holdDurationMs).toBe(4200);
    });
});
