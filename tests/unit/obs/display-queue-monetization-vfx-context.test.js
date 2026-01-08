
jest.mock('../../../src/core/logging', () => ({
    logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }
}));

const { EventEmitter } = require('events');
const { DisplayQueue } = require('../../../src/obs/display-queue');
const constants = require('../../../src/core/constants');

const baseConfig = {
    autoProcess: false,
    chat: {},
    notification: {},
    obs: {},
    ttsEnabled: false
};

const createQueue = (eventBus) => {
    const obsManager = {
        isReady: jest.fn().mockResolvedValue(true),
        call: jest.fn().mockResolvedValue({ success: true })
    };
    const queue = new DisplayQueue(obsManager, baseConfig, constants, eventBus);
    // Skip OBS side effects and TTS for these unit assertions
    queue.playGiftVideoAndAudio = jest.fn().mockResolvedValue();
    queue.isTTSEnabled = jest.fn().mockReturnValue(false);
    return queue;
};

describe('DisplayQueue monetization VFX context', () => {
    let eventBus;
    let emitSpy;

    beforeEach(() => {
        eventBus = new EventEmitter();
        emitSpy = jest.spyOn(eventBus, 'emit');
    });

    it('emits VFX with userId for gift notifications', async () => {
        const queue = createQueue(eventBus);
        const item = {
            type: 'gift',
            platform: 'youtube',
            vfxConfig: {
                commandKey: 'gifts',
                command: '!gift',
                filename: 'gift.mp4',
                mediaSource: 'vfx top',
                vfxFilePath: '/tmp/vfx',
                duration: 5000
            },
            data: { username: 'GiftHero', userId: 'gift-1', displayMessage: 'GiftHero sent a gift' }
        };

        await queue.handleGiftEffects(item, []);

        expect(emitSpy).toHaveBeenCalledTimes(1);
        const [eventName, payload] = emitSpy.mock.calls[0];
        expect(eventName).toBe('vfx:command');
        expect(payload).toEqual(expect.objectContaining({
            commandKey: 'gifts',
            username: 'GiftHero',
            platform: 'youtube',
            userId: 'gift-1',
            context: expect.objectContaining({ source: 'display-queue' })
        }));
    });

    it('emits VFX for follow notifications with correct context', async () => {
        const queue = createQueue(eventBus);
        const item = {
            type: 'follow',
            platform: 'twitch',
            vfxConfig: {
                commandKey: 'follows',
                command: '!follow',
                filename: 'follow.mp4',
                mediaSource: 'vfx top',
                vfxFilePath: '/tmp/vfx',
                duration: 5000
            },
            data: { username: 'FollowHero', userId: 'follow-1', displayMessage: 'FollowHero followed' }
        };

        await queue.handleSequentialEffects(item, []);

        expect(emitSpy).toHaveBeenCalledTimes(1);
        const [eventName, payload] = emitSpy.mock.calls[0];
        expect(eventName).toBe('vfx:command');
        expect(payload).toEqual(expect.objectContaining({
            commandKey: 'follows',
            username: 'FollowHero',
            platform: 'twitch',
            userId: 'follow-1',
            context: expect.objectContaining({ source: 'display-queue', notificationType: 'follow' })
        }));
    });

    it('emits gift VFX with standard delay metadata', async () => {
        jest.useFakeTimers();
        try {
            const queue = createQueue(eventBus);
            const item = {
                type: 'gift',
                platform: 'tiktok',
                vfxConfig: {
                    commandKey: 'gifts',
                    command: '!gift',
                    filename: 'gift.mp4',
                    mediaSource: 'vfx top',
                    vfxFilePath: '/tmp/vfx',
                    duration: 5000
                },
                data: {
                    username: 'DelayHero',
                    userId: 'gift-delay-1',
                    displayMessage: 'DelayHero sent a gift',
                    giftType: 'Rose',
                    giftCount: 1,
                    amount: 10,
                    currency: 'coins'
                }
            };

            const pending = queue.handleGiftEffects(item, []);

            jest.advanceTimersByTime(2000);
            await Promise.resolve();
            await pending;

            expect(emitSpy).toHaveBeenCalledTimes(1);
            const [eventName, payload] = emitSpy.mock.calls[0];
            expect(eventName).toBe('vfx:command');
            expect(payload.context).toEqual(expect.objectContaining({
                notificationType: 'gift',
                delayApplied: 2000
            }));
            expect(payload.commandKey).toBe('gifts');
        } finally {
            jest.useRealTimers();
        }
    });

    const standardFlows = [
        { type: 'gift', giftType: 'Super Chat', giftCount: 1, amount: 5, currency: 'USD', commandKey: 'gifts', platform: 'youtube' },
        { type: 'gift', giftType: 'Super Sticker', giftCount: 1, amount: 3, currency: 'USD', commandKey: 'gifts', platform: 'youtube' },
        { type: 'giftpaypiggy', commandKey: 'gifts', platform: 'twitch' },
        { type: 'gift', giftType: 'bits', giftCount: 1, amount: 100, currency: 'bits', commandKey: 'gifts', platform: 'twitch' },
        { type: 'envelope', commandKey: 'gifts', platform: 'tiktok' },
        { type: 'paypiggy', commandKey: 'paypiggies', platform: 'tiktok' }
    ];

    test.each(standardFlows)('emits VFX with userId for %s', async ({ type, commandKey, platform, giftType, giftCount, amount, currency }) => {
        const queue = createQueue(eventBus);
        const item = {
            type,
            platform,
            vfxConfig: {
                commandKey,
                command: `!${type}`,
                filename: `${type}.mp4`,
                mediaSource: 'vfx top',
                vfxFilePath: '/tmp/vfx',
                duration: 5000
            },
            data: {
                username: 'MonoUser',
                userId: `${type}-user`,
                displayMessage: 'MonoUser sent something',
                ...(giftType ? { giftType } : {}),
                ...(giftCount ? { giftCount } : {}),
                ...(amount !== undefined ? { amount } : {}),
                ...(currency ? { currency } : {})
            }
        };

        await queue.handleSequentialEffects(item, []);

        expect(emitSpy).toHaveBeenCalledTimes(1);
        const [eventName, payload] = emitSpy.mock.calls[0];
        expect(eventName).toBe('vfx:command');
        expect(payload).toEqual(expect.objectContaining({
            commandKey,
            username: 'MonoUser',
            platform,
            userId: `${type}-user`,
            context: expect.objectContaining({ source: 'display-queue' })
        }));
    });
});
