const { describe, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { waitForDelay } = require('../../helpers/time-utils');
const { DisplayQueue } = require('../../../src/obs/display-queue');
const EventEmitter = require('events');

describe('DisplayQueue - Twitch Bits Goal Calculation', () => {
    let displayQueue;
    let mockOBSManager;
    let configFixture;
    let mockGoalsManager;

    beforeEach(() => {
        mockOBSManager = new EventEmitter();
        mockOBSManager.call = createMockFn().mockResolvedValue({});
        mockOBSManager.isConnected = createMockFn().mockReturnValue(true);
        mockOBSManager.isReady = createMockFn().mockResolvedValue(true);

        mockGoalsManager = {
            processDonationGoal: createMockFn().mockResolvedValue()
        };

        configFixture = {
            goals: { enabled: true, targetAmount: 1000 },
            timing: { notificationDuration: 5000, lingerChatDuration: 10000 },
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
            }
        };

        const mockSourcesManager = {
            updateTextSource: createMockFn().mockResolvedValue(),
            clearTextSource: createMockFn().mockResolvedValue(),
            setSourceVisibility: createMockFn().mockResolvedValue(),
            setNotificationDisplayVisibility: createMockFn().mockResolvedValue(),
            setChatDisplayVisibility: createMockFn().mockResolvedValue(),
            hideAllDisplays: createMockFn().mockResolvedValue(),
            setPlatformLogoVisibility: createMockFn().mockResolvedValue(),
            setNotificationPlatformLogoVisibility: createMockFn().mockResolvedValue()
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
                    username: 'testUser',
                    displayName: 'testUser',
                    message: 'Corgo100 Corgo100',
                    bits: 200,
                    giftType: 'bits',
                    giftCount: 1,
                    amount: 200,
                    currency: 'bits',
                    platform: 'twitch'
                },
                platform: 'twitch',
                priority: 3
            };

            displayQueue.addItem(bitsEvent);
            await waitForDelay(100);

            expect(mockGoalsManager.processDonationGoal).toHaveBeenCalledWith('twitch', 200);
        });

        it('handles multiple bit cheers without multiplication', async () => {
            const cheers = [
                { username: 'testUser1', bits: 100 },
                { username: 'testUser2', bits: 500 },
                { username: 'testUser3', bits: 50 }
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
                        platform: 'twitch'
                    },
                    platform: 'twitch',
                    priority: 3
                };
                displayQueue.addItem(event);
            }

            await waitForDelay(300);

            expect(mockGoalsManager.processDonationGoal).toHaveBeenCalledTimes(3);
            expect(mockGoalsManager.processDonationGoal).toHaveBeenNthCalledWith(1, 'twitch', 100);
            expect(mockGoalsManager.processDonationGoal).toHaveBeenNthCalledWith(2, 'twitch', 500);
            expect(mockGoalsManager.processDonationGoal).toHaveBeenNthCalledWith(3, 'twitch', 50);
        });

        it('handles single bit cheer correctly', async () => {
            const singleBitEvent = {
                type: 'platform:gift',
                data: {
                    username: 'testSmallCheerer',
                    displayName: 'testSmallCheerer',
                    message: 'Cheer1',
                    bits: 1,
                    giftType: 'bits',
                    giftCount: 1,
                    amount: 1,
                    currency: 'bits',
                    platform: 'twitch'
                },
                platform: 'twitch',
                priority: 3
            };

            displayQueue.addItem(singleBitEvent);
            await waitForDelay(100);

            expect(mockGoalsManager.processDonationGoal).toHaveBeenCalledWith('twitch', 1);
        });
    });

    describe('User experience validation', () => {
        it('displays correct goal progress after bits donation', async () => {
            const bitsEvent = {
                type: 'platform:gift',
                data: {
                    username: 'testGenerousViewer',
                    displayName: 'testGenerousViewer',
                    message: 'Corgo100 Corgo100',
                    bits: 200,
                    giftType: 'bits',
                    giftCount: 1,
                    amount: 200,
                    currency: 'bits',
                    platform: 'twitch'
                },
                platform: 'twitch',
                priority: 3
            };

            displayQueue.addItem(bitsEvent);
            await waitForDelay(100);

            expect(mockGoalsManager.processDonationGoal).toHaveBeenCalledWith('twitch', 200);
        });

        it('handles multi-cheermote scenarios without goal inflation', async () => {
            const realWorldScenario = {
                type: 'platform:gift',
                data: {
                    username: 'testRealUser',
                    displayName: 'testRealUser',
                    message: 'Corgo100 Corgo100',
                    bits: 200,
                    giftType: 'bits',
                    giftCount: 1,
                    amount: 200,
                    currency: 'bits',
                    cheermoteInfo: { type: 'Corgo', count: 2, cleanPrefix: 'Corgo' },
                    platform: 'twitch'
                },
                platform: 'twitch',
                priority: 3
            };

            displayQueue.addItem(realWorldScenario);
            await waitForDelay(100);

            expect(mockGoalsManager.processDonationGoal).toHaveBeenCalledWith('twitch', 200);
        });
    });
});
