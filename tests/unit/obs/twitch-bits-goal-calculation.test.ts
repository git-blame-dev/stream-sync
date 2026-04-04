const { describe, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { DisplayQueue } = require('../../../src/obs/display-queue.ts');
const EventEmitter = require('events');

describe('DisplayQueue - Twitch Bits Goal Calculation', () => {
    let displayQueue;
    let mockOBSManager;
    let configFixture;
    let mockGoalsManager;
    let recordedGoals;

    beforeEach(() => {
        mockOBSManager = new EventEmitter();
        mockOBSManager.call = createMockFn().mockResolvedValue({});
        mockOBSManager.isConnected = createMockFn().mockReturnValue(true);
        mockOBSManager.isReady = createMockFn().mockResolvedValue(true);

        recordedGoals = [];
        mockGoalsManager = {
            processDonationGoal: createMockFn(async (platform, amount) => {
                recordedGoals.push({ platform, amount });
            })
        };

        configFixture = {
            autoProcess: false,
            maxQueueSize: 100,
            goals: { enabled: true, targetAmount: 1000 },
            timing: { transitionDelay: 200, notificationClearDelay: 500, chatMessageDuration: 4500 },
            notification: {
                sourceName: 'TestNotificationText',
                sceneName: 'TestMainScene',
                groupName: 'TestNotificationGroup',
                platformLogos: { twitch: 'TestTwitchLogo' }
            },
            chat: {
                sourceName: 'TestChatText',
                sceneName: 'TestMainScene',
                groupName: 'TestChatGroup',
                platformLogos: { twitch: 'TestTwitchLogo' }
            },
            handcam: { enabled: false },
            gifts: { giftVideoSource: 'gift-video', giftAudioSource: 'gift-audio' },
            obs: { ttsTxt: 'tts-text' },
            youtube: {},
            twitch: {},
            tiktok: {},
            ttsEnabled: false
        };

        const mockSourcesManager = {
            updateTextSource: createMockFn().mockResolvedValue(),
            clearTextSource: createMockFn().mockResolvedValue(),
            setSourceVisibility: createMockFn().mockResolvedValue(),
            setNotificationDisplayVisibility: createMockFn().mockResolvedValue(),
            setChatDisplayVisibility: createMockFn().mockResolvedValue(),
            hideAllDisplays: createMockFn().mockResolvedValue(),
            setPlatformLogoVisibility: createMockFn().mockResolvedValue(),
            setNotificationPlatformLogoVisibility: createMockFn().mockResolvedValue(),
            setGroupSourceVisibility: createMockFn().mockResolvedValue()
        };

        displayQueue = new DisplayQueue(
            mockOBSManager,
            configFixture,
            {},
            null,
            { goalsManager: mockGoalsManager, sourcesManager: mockSourcesManager, delay: () => Promise.resolve() }
        );
    });

    afterEach(() => {
        if (displayQueue) {
            displayQueue.stop();
        }
    });

    describe('Twitch bits contribution to goals', () => {
        it('adds exact bits amount to goal without multiplication', async () => {
            const bitsEvent = {
                type: 'platform:gift',
                data: {
                    username: 'test-user',
                    displayName: 'test-user',
                    message: 'Corgo100 Corgo100',
                    bits: 200,
                    giftType: 'bits',
                    giftCount: 1,
                    amount: 200,
                    currency: 'bits',
                    displayMessage: 'test-user sent 200 bits',
                    platform: 'twitch'
                },
                platform: 'twitch',
                priority: 3
            };

            displayQueue.addItem(bitsEvent);
            await displayQueue.processQueue();

            expect(recordedGoals).toEqual([{ platform: 'twitch', amount: 200 }]);
        });

        it('handles multiple bit cheers without multiplication', async () => {
            const cheers = [
                { username: 'test-user-1', bits: 100 },
                { username: 'test-user-2', bits: 500 },
                { username: 'test-user-3', bits: 50 }
            ];

            for (const cheer of cheers) {
                const event = {
                    type: 'platform:gift',
                    data: {
                        username: cheer.username,
                        displayName: cheer.username,
                        message: `Cheer${cheer.bits}`,
                        bits: cheer.bits,
                        giftType: 'bits',
                        giftCount: 1,
                        amount: cheer.bits,
                        currency: 'bits',
                        displayMessage: `${cheer.username} sent ${cheer.bits} bits`,
                        platform: 'twitch'
                    },
                    platform: 'twitch',
                    priority: 3
                };
                displayQueue.addItem(event);
            }

            await displayQueue.processQueue();

            expect(recordedGoals).toEqual([
                { platform: 'twitch', amount: 100 },
                { platform: 'twitch', amount: 500 },
                { platform: 'twitch', amount: 50 }
            ]);
        });

        it('handles single bit cheer correctly', async () => {
            const singleBitEvent = {
                type: 'platform:gift',
                data: {
                    username: 'test-small-cheerer',
                    displayName: 'test-small-cheerer',
                    message: 'Cheer1',
                    bits: 1,
                    giftType: 'bits',
                    giftCount: 1,
                    amount: 1,
                    currency: 'bits',
                    displayMessage: 'test-small-cheerer sent 1 bits',
                    platform: 'twitch'
                },
                platform: 'twitch',
                priority: 3
            };

            displayQueue.addItem(singleBitEvent);
            await displayQueue.processQueue();

            expect(recordedGoals).toEqual([{ platform: 'twitch', amount: 1 }]);
        });
    });

    describe('User experience validation', () => {
        it('displays correct goal progress after bits donation', async () => {
            const bitsEvent = {
                type: 'platform:gift',
                data: {
                    username: 'test-generous-viewer',
                    displayName: 'test-generous-viewer',
                    message: 'Corgo100 Corgo100',
                    bits: 200,
                    giftType: 'bits',
                    giftCount: 1,
                    amount: 200,
                    currency: 'bits',
                    displayMessage: 'test-generous-viewer sent 200 bits',
                    platform: 'twitch'
                },
                platform: 'twitch',
                priority: 3
            };

            displayQueue.addItem(bitsEvent);
            await displayQueue.processQueue();

            expect(recordedGoals).toEqual([{ platform: 'twitch', amount: 200 }]);
        });

        it('handles multi-cheermote scenarios without goal inflation', async () => {
            const realWorldScenario = {
                type: 'platform:gift',
                data: {
                    username: 'test-real-user',
                    displayName: 'test-real-user',
                    message: 'Corgo100 Corgo100',
                    bits: 200,
                    giftType: 'bits',
                    giftCount: 1,
                    amount: 200,
                    currency: 'bits',
                    cheermoteInfo: { type: 'Corgo', count: 2, cleanPrefix: 'Corgo' },
                    displayMessage: 'test-real-user sent 200 bits',
                    platform: 'twitch'
                },
                platform: 'twitch',
                priority: 3
            };

            displayQueue.addItem(realWorldScenario);
            await displayQueue.processQueue();

            expect(recordedGoals).toEqual([{ platform: 'twitch', amount: 200 }]);
        });
    });
});
