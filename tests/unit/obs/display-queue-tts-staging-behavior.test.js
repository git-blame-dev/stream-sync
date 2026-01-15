const { describe, test, expect, afterEach, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, requireActual, resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

const { createRuntimeConstantsFixture } = require('../../helpers/runtime-constants-fixture');
const { PlatformEvents } = require('../../../src/interfaces/PlatformEvents');

describe('DisplayQueue notification TTS staging', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        restoreAllMocks();
process.env.NODE_ENV = originalEnv;
    
        restoreAllModuleMocks();});

    function setupDisplayQueue({ ttsStages, recordedTexts, recordedDelays }) {
        process.env.NODE_ENV = 'development';
        const runtimeConstants = createRuntimeConstantsFixture();

        mockModule('../../../src/obs/sources', () => {
            const instance = {
                updateTextSource: createMockFn((_, text) => {
                    recordedTexts.push(text);
                    return Promise.resolve();
                }),
                setSourceVisibility: createMockFn(),
                setPlatformLogoVisibility: createMockFn(),
                hideAllDisplays: createMockFn(),
                updateChatMsgText: createMockFn(),
                setNotificationPlatformLogoVisibility: createMockFn(),
                setGroupSourceVisibility: createMockFn(),
                setSourceFilterVisibility: createMockFn(),
                getGroupSceneItemId: createMockFn(),
                setChatDisplayVisibility: createMockFn(),
                setNotificationDisplayVisibility: createMockFn(),
                getSceneItemId: createMockFn()
            };
            return {
                OBSSourcesManager: class {},
                createOBSSourcesManager: () => instance,
                getDefaultSourcesManager: () => instance
            };
        });

        mockModule('../../../src/utils/timeout-validator', () => {
            const actual = requireActual('../../../src/utils/timeout-validator');
            return {
                ...actual,
                safeDelay: createMockFn((ms) => {
                    recordedDelays.push(ms);
                    return Promise.resolve();
                })
            };
        });

        mockModule('../../../src/utils/message-tts-handler', () => ({
            createTTSStages: createMockFn(() => ttsStages)
        }));

        const { DisplayQueue } = require('../../../src/obs/display-queue');
        const { EventEmitter } = require('events');

        const eventBus = new EventEmitter();
        eventBus.subscribe = (event, handler) => {
            eventBus.on(event, handler);
            return () => eventBus.off(event, handler);
        };
        const obsManager = {
            isReady: createMockFn().mockResolvedValue(true),
            call: createMockFn().mockResolvedValue({}),
            addEventListener: createMockFn(),
            removeEventListener: createMockFn()
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
            type: 'platform:follow',
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
