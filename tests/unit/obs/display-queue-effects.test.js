const { describe, expect, it } = require('bun:test');

const { DisplayQueueEffects } = require('../../../src/obs/display-queue-effects');

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
});
