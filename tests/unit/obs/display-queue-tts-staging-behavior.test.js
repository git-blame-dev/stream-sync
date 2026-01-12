const { createRuntimeConstantsFixture } = require('../../helpers/runtime-constants-fixture');
const { PlatformEvents } = require('../../../src/interfaces/PlatformEvents');

describe('DisplayQueue notification TTS staging', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        jest.resetModules();
        process.env.NODE_ENV = originalEnv;
    });

    function setupDisplayQueue({ ttsStages, recordedTexts, recordedDelays }) {
        process.env.NODE_ENV = 'development';
        const runtimeConstants = createRuntimeConstantsFixture();

        jest.doMock('../../../src/obs/sources', () => {
            const instance = {
                updateTextSource: jest.fn((_, text) => {
                    recordedTexts.push(text);
                    return Promise.resolve();
                }),
                setSourceVisibility: jest.fn(),
                setPlatformLogoVisibility: jest.fn(),
                hideAllDisplays: jest.fn(),
                updateChatMsgText: jest.fn(),
                setNotificationPlatformLogoVisibility: jest.fn(),
                setGroupSourceVisibility: jest.fn(),
                setSourceFilterVisibility: jest.fn(),
                getGroupSceneItemId: jest.fn(),
                setChatDisplayVisibility: jest.fn(),
                setNotificationDisplayVisibility: jest.fn(),
                getSceneItemId: jest.fn()
            };
            return {
                OBSSourcesManager: class {},
                createOBSSourcesManager: () => instance,
                getDefaultSourcesManager: () => instance
            };
        });

        jest.doMock('../../../src/utils/timeout-validator', () => {
            const actual = jest.requireActual('../../../src/utils/timeout-validator');
            return {
                ...actual,
                safeDelay: jest.fn((ms) => {
                    recordedDelays.push(ms);
                    return Promise.resolve();
                })
            };
        });

        jest.doMock('../../../src/utils/message-tts-handler', () => ({
            createTTSStages: jest.fn(() => ttsStages)
        }));

        const { DisplayQueue } = require('../../../src/obs/display-queue');
        const { EventEmitter } = require('events');

        const eventBus = new EventEmitter();
        eventBus.subscribe = (event, handler) => {
            eventBus.on(event, handler);
            return () => eventBus.off(event, handler);
        };
        const obsManager = {
            isReady: jest.fn().mockResolvedValue(true),
            call: jest.fn().mockResolvedValue({}),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn()
        };

        const queue = new DisplayQueue(
            obsManager,
            {
                ttsEnabled: true,
                chat: {},
                notification: {},
                obs: { ttsTxt: 'tts txt' },
                handcam: { enabled: false }
            },
            {
                PRIORITY_LEVELS: { CHAT: 1 },
                CHAT_MESSAGE_DURATION: 4500,
                CHAT_TRANSITION_DELAY: 200,
                NOTIFICATION_CONFIGS: {
                    follow: { commandKey: 'follows' }
                }
            },
            eventBus,
            runtimeConstants
        );

        return { queue, eventBus };
    }

    it('waits for VFX completion before playing follow TTS', async () => {
        const recordedTexts = [];
        const recordedDelays = [];
        const capturedVfx = [];

        const { queue, eventBus } = setupDisplayQueue({
            ttsStages: [
                { type: 'primary', text: 'Thanks for the follow', delay: 0 },
                { type: 'name', text: 'Follower spotlight', delay: 250 }
            ],
            recordedTexts,
            recordedDelays
        });

        eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload) => capturedVfx.push(payload));

        const processing = queue.handleNotificationEffects({
            type: 'follow',
            platform: 'twitch',
            data: {
                username: 'Follower',
                userId: 'user-1',
                displayMessage: 'Follower just followed!'
            },
            vfxConfig: {
                commandKey: 'follows',
                command: '!follow',
                filename: 'follow.mp4',
                mediaSource: 'VFX Top',
                vfxFilePath: '/tmp/vfx',
                duration: 5000
            }
        });

        await Promise.resolve();
        expect(recordedTexts).toEqual([]);

        eventBus.emit(PlatformEvents.VFX_EFFECT_COMPLETED, {
            commandKey: 'follows',
            filename: 'follow.mp4',
            command: '!follow',
            mediaSource: 'VFX Top'
        });

        await processing;

        expect(recordedTexts).toEqual(['Thanks for the follow', 'Follower spotlight']);
        expect(recordedDelays).toEqual(expect.arrayContaining([10000, 250]));
        expect(capturedVfx).toHaveLength(1);
        expect(capturedVfx[0]).toEqual(
            expect.objectContaining({
                commandKey: 'follows',
                username: 'Follower',
                platform: 'twitch'
            })
        );
    });

    it('plays gift TTS without waiting for VFX completion', async () => {
        const recordedTexts = [];
        const recordedDelays = [];
        const capturedVfx = [];

        const { queue, eventBus } = setupDisplayQueue({
            ttsStages: [
                { type: 'primary', text: 'Gift incoming', delay: 0 },
                { type: 'message', text: 'Message payload', delay: 800 }
            ],
            recordedTexts,
            recordedDelays
        });

        eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload) => capturedVfx.push(payload));

        await queue.handleNotificationEffects({
            type: 'platform:gift',
            platform: 'tiktok',
            data: {
                username: 'Gifter',
                userId: 'user-1',
                displayMessage: 'Gifter sent a rose',
                giftType: 'rose',
                giftCount: 2,
                amount: 20,
                currency: 'coins'
            },
            vfxConfig: {
                commandKey: 'gifts',
                command: '!money',
                filename: 'money.mp4',
                mediaSource: 'VFX Top',
                vfxFilePath: '/tmp/vfx',
                duration: 5000
            }
        });

        expect(recordedTexts).toEqual(['Gift incoming', 'Message payload']);
        expect(recordedDelays).toEqual(expect.arrayContaining([2000, 800]));
        expect(capturedVfx).toHaveLength(1);
        expect(capturedVfx[0]).toEqual(
            expect.objectContaining({
                commandKey: 'gifts',
                username: 'Gifter',
                platform: 'tiktok'
            })
        );
    });

    it('falls back to timeout when no completion event arrives', async () => {
        const recordedTexts = [];
        const recordedDelays = [];

        const { queue } = setupDisplayQueue({
            ttsStages: [
                { type: 'primary', text: 'Standard message', delay: 0 }
            ],
            recordedTexts,
            recordedDelays
        });

        await queue.handleNotificationEffects({
            type: 'greeting',
            platform: 'youtube',
            data: {
                username: 'Viewer',
                userId: 'viewer-1',
                displayMessage: 'Hello there'
            },
            vfxConfig: {
                commandKey: 'greetings',
                command: '!hello',
                filename: 'hello.mp4',
                mediaSource: 'VFX Top',
                vfxFilePath: '/tmp/vfx',
                duration: 5000
            }
        });

        expect(recordedTexts).toEqual(['Standard message']);
        expect(recordedDelays).toEqual(expect.arrayContaining([10000]));
    });

    it('does not emit VFX or wait when no vfxConfig is provided for non-gift notifications', async () => {
        const recordedTexts = [];
        const recordedDelays = [];
        const capturedVfx = [];

        const { queue, eventBus } = setupDisplayQueue({
            ttsStages: [
                { type: 'primary', text: 'No VFX config', delay: 0 }
            ],
            recordedTexts,
            recordedDelays
        });

        eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload) => capturedVfx.push(payload));

        await queue.handleNotificationEffects({
            type: 'greeting',
            platform: 'twitch',
            data: {
                username: 'Viewer',
                displayMessage: 'Hello'
            }
            // No vfxConfig provided
        });

        expect(capturedVfx).toHaveLength(0);
        expect(recordedTexts).toEqual(['No VFX config']);
        expect(recordedDelays).toEqual([]); // no VFX wait, no stage delay
    });

    it('skips VFX emission for gifts without vfxConfig and plays TTS without waiting', async () => {
        const recordedTexts = [];
        const recordedDelays = [];
        const capturedVfx = [];

        const { queue, eventBus } = setupDisplayQueue({
            ttsStages: [
                { type: 'primary', text: 'Gift without VFX config', delay: 0 }
            ],
            recordedTexts,
            recordedDelays
        });

        eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload) => capturedVfx.push(payload));

        await queue.handleNotificationEffects({
            type: 'platform:gift',
            platform: 'tiktok',
            data: {
                username: 'Gifter',
                userId: 'gift-1',
                displayMessage: 'Gifted',
                giftType: 'rose',
                giftCount: 1,
                amount: 1,
                currency: 'coins'
            }
            // No vfxConfig provided
        });

        expect(capturedVfx).toHaveLength(0);
        expect(recordedTexts).toEqual(['Gift without VFX config']);
        expect(recordedDelays).toEqual([]); // no VFX wait, no gift lead delay, no stage delay
    });
});
