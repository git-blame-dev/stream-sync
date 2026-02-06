const { describe, expect, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { initializeTestLogging } = require('../../helpers/test-setup');

initializeTestLogging();

const { DisplayQueue } = require('../../../src/obs/display-queue');
const { createMockOBSManager } = require('../../helpers/mock-factories');
const { PRIORITY_LEVELS } = require('../../../src/core/constants');

describe('DisplayQueue control', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const constants = {
        PRIORITY_LEVELS,
        CHAT_MESSAGE_DURATION: 4500,
        CHAT_TRANSITION_DELAY: 200,
        NOTIFICATION_CLEAR_DELAY: 100
    };

    const createConfig = (overrides = {}) => ({
        autoProcess: false,
        maxQueueSize: 3,
        chat: { sourceName: 'chat', sceneName: 'scene', groupName: 'group', platformLogos: {} },
        notification: { sourceName: 'notification', sceneName: 'scene', groupName: 'group', platformLogos: {} },
        ...overrides
    });

    const createMockDependencies = () => ({
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
        delay: () => Promise.resolve()
    });

    const createQueue = (configOverrides = {}) => {
        const config = createConfig(configOverrides);
        const queue = new DisplayQueue(createMockOBSManager('connected'), config, constants, null, createMockDependencies());
        queue.getDuration = createMockFn().mockReturnValue(0);
        return queue;
    };

    describe('platform validation', () => {
        it('rejects items without platform', () => {
            const queue = createQueue();

            expect(() => {
                queue.addItem({ type: 'platform:gift', data: { username: 'test-user' } });
            }).toThrow('platform');
        });
    });

    describe('priority mapping', () => {
        it('falls back to chat priority when constants are missing', () => {
            const queue = new DisplayQueue(createMockOBSManager('connected'), createConfig(), {}, null, createMockDependencies());

            expect(queue.getTypePriority('platform:gift')).toBe(PRIORITY_LEVELS.CHAT);
            expect(queue.getTypePriority('unknown')).toBe(PRIORITY_LEVELS.CHAT);
        });
    });

    describe('delegation helpers', () => {
        it('delegates TTS helpers to the effects module', async () => {
            const queue = createQueue();
            const ttsUpdates = [];

            queue.effects = {
                isTTSEnabled: () => true,
                setTTSText: async (text) => {
                    ttsUpdates.push(text);
                }
            };

            expect(queue.isTTSEnabled()).toBe(true);

            await queue.setTTSText('test-tts');

            expect(ttsUpdates).toEqual(['test-tts']);
        });
    });

    describe('maxQueueSize enforcement', () => {
        it('rejects items when queue is at maxQueueSize capacity', () => {
            const queue = createQueue({ maxQueueSize: 2 });

            queue.addItem({ type: 'platform:gift', platform: 'twitch', data: { username: 'test-user-1', giftType: 'Rose', giftCount: 1, amount: 10, currency: 'coins' } });
            queue.addItem({ type: 'platform:gift', platform: 'twitch', data: { username: 'test-user-2', giftType: 'Rose', giftCount: 1, amount: 10, currency: 'coins' } });

            expect(queue.queue.length).toBe(2);

            expect(() => {
                queue.addItem({ type: 'platform:gift', platform: 'twitch', data: { username: 'test-user-3', giftType: 'Rose', giftCount: 1, amount: 10, currency: 'coins' } });
            }).toThrow();
        });
    });

    describe('chat item replacement', () => {
        it('replaces earlier chat entries with the latest message', () => {
            const queue = createQueue();

            queue.addItem({ type: 'chat', platform: 'twitch', data: { username: 'test-user', message: 'first' } });
            queue.addItem({ type: 'chat', platform: 'twitch', data: { username: 'test-user', message: 'second' } });

            expect(queue.queue.length).toBe(1);
            expect(queue.lastChatItem.data.message).toBe('second');
        });
    });

    describe('processChatMessage autoProcess respect', () => {
        it('does not auto-process when autoProcess is false', async () => {
            const queue = createQueue({ autoProcess: false });
            let processed = false;
            queue.displayItem = createMockFn(async () => { processed = true; });

            await queue.processChatMessage({
                type: 'chat',
                platform: 'twitch',
                data: { username: 'test-user', message: 'hello' }
            });

            expect(queue.queue.length).toBe(1);
            expect(processed).toBe(false);
        });

        it('rejects non-chat items', async () => {
            const queue = createQueue({ autoProcess: false });

            await expect(queue.processChatMessage({
                type: 'platform:gift',
                platform: 'twitch',
                data: {
                    username: 'test-user',
                    giftType: 'rose',
                    giftCount: 1,
                    amount: 1,
                    currency: 'coins'
                }
            })).rejects.toThrow('Invalid chat item');
        });

        it('auto-processes chat when autoProcess is true', async () => {
            const queue = createQueue({ autoProcess: true });
            let processed = false;
            queue.processQueue = createMockFn(async () => {
                processed = true;
            });

            await queue.processChatMessage({
                type: 'chat',
                platform: 'twitch',
                data: { username: 'test-user', message: 'hello' }
            });

            expect(processed).toBe(true);
        });
    });

    describe('auto-process behavior', () => {
        it('starts processing when autoProcess is enabled and idle', () => {
            const queue = createQueue({ autoProcess: true });
            let processed = false;
            queue.processQueue = createMockFn(async () => {
                processed = true;
            });

            queue.addItem({
                type: 'platform:gift',
                platform: 'twitch',
                data: { username: 'test-user', giftType: 'rose', giftCount: 1, amount: 1, currency: 'coins' }
            });

            expect(processed).toBe(true);
        });
    });

    describe('processQueue readiness', () => {
        it('clears retry flag when OBS is not ready and queue is empty', async () => {
            const queue = new DisplayQueue({ isReady: async () => false }, createConfig(), constants, null, createMockDependencies());

            await queue.processQueue();

            expect(queue.isRetryScheduled).toBe(false);
            expect(queue.isProcessing).toBe(false);
        });
    });

    describe('display routing', () => {
        it('routes chat and non-chat items to the correct display handlers', async () => {
            const queue = createQueue();
            const routed = [];

            queue.displayChatItem = createMockFn(async () => {
                routed.push('chat');
            });
            queue.displayNotificationItem = createMockFn(async () => {
                routed.push('notification');
            });

            await queue.displayItem({
                type: 'chat',
                platform: 'twitch',
                data: { username: 'test-user', message: 'hello' }
            });
            await queue.displayItem({
                type: 'platform:gift',
                platform: 'twitch',
                data: {
                    username: 'test-user',
                    giftType: 'rose',
                    giftCount: 1,
                    amount: 1,
                    currency: 'coins'
                }
            });

            expect(routed).toEqual(['chat', 'notification']);
        });
    });

    describe('notification effects gating', () => {
        it('skips notification effects when renderer declines display', async () => {
            const queue = createQueue();
            let effectsHandled = false;
            queue.renderer = {
                displayNotificationItem: async () => false
            };
            queue.handleNotificationEffects = async () => {
                effectsHandled = true;
            };

            await queue.displayNotificationItem({
                type: 'platform:follow',
                platform: 'twitch',
                data: { username: 'test-user', displayMessage: 'test-user followed' }
            });

            expect(effectsHandled).toBe(false);
        });
    });

    describe('processQueue flow', () => {
        it('processes queued items, hides after display, and shows lingering chat', async () => {
            const config = createConfig({
                timing: { transitionDelay: 0, notificationClearDelay: 0 }
            });
            const queue = new DisplayQueue({ isReady: async () => true }, config, constants, null, createMockDependencies());
            const displayed = [];
            const hidden = [];

            queue.delay = async () => {};
            queue.getDuration = () => 0;
            queue.displayChatItem = async (item) => {
                displayed.push(item.type);
            };
            queue.displayNotificationItem = async (item) => {
                displayed.push(item.type);
            };
            queue.hideCurrentDisplay = async (item) => {
                hidden.push(item.type);
            };
            queue.displayLingeringChat = async () => {
                displayed.push('lingering');
            };

            queue.addItem({
                type: 'chat',
                platform: 'twitch',
                priority: 10,
                data: { username: 'test-user', message: 'hello' }
            });
            queue.addItem({
                type: 'platform:follow',
                platform: 'twitch',
                priority: 5,
                data: { username: 'test-user', displayMessage: 'followed' }
            });

            await queue.processQueue();

            expect(displayed).toEqual(['chat', 'platform:follow', 'lingering']);
            expect(hidden).toEqual(['chat', 'platform:follow']);
            expect(queue.isProcessing).toBe(false);
        });
    });

    describe('stop() behavior', () => {
        it('clears all state when stopping', async () => {
            const queue = createQueue();
            queue.currentDisplay = { type: 'platform:gift', data: { username: 'test-user' } };
            queue.isProcessing = true;
            queue.queue.push({ type: 'chat', data: { username: 'test-user', message: 'test' } });

            await queue.stop();

            expect(queue.currentDisplay).toBe(null);
            expect(queue.isProcessing).toBe(false);
            expect(queue.queue.length).toBe(0);
        });

        it('aborts active processing loop when stop is called', async () => {
            const queue = createQueue();
            const processed = [];
            let itemCount = 0;

            queue.displayItem = createMockFn(async (item) => {
                processed.push(item.data.username);
                itemCount++;
                if (itemCount === 1) {
                    queue.stop();
                }
            });

            queue.addItem({ type: 'platform:gift', platform: 'twitch', data: { username: 'test-user-1', giftType: 'Rose', giftCount: 1, amount: 10, currency: 'coins' } });
            queue.addItem({ type: 'platform:gift', platform: 'twitch', data: { username: 'test-user-2', giftType: 'Rose', giftCount: 1, amount: 10, currency: 'coins' } });
            queue.addItem({ type: 'platform:gift', platform: 'twitch', data: { username: 'test-user-3', giftType: 'Rose', giftCount: 1, amount: 10, currency: 'coins' } });

            await queue.processQueue();

            expect(processed.length).toBe(1);
        });
    });

    describe('clearQueue behavior', () => {
        it('clears queue even when state is unset', () => {
            const queue = createQueue();
            queue.state = null;
            queue.queue = [{ type: 'chat', data: { username: 'test-user', message: 'hello' } }];
            queue.isRetryScheduled = true;
            queue.isProcessing = true;
            queue.currentDisplay = { type: 'chat', data: { username: 'test-user', message: 'hello' } };

            queue.clearQueue();

            expect(queue.queue.length).toBe(0);
            expect(queue.isRetryScheduled).toBe(false);
            expect(queue.isProcessing).toBe(false);
            expect(queue.currentDisplay).toBe(null);
        });
    });
});
