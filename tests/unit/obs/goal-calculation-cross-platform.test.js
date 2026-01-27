const { describe, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { DisplayQueue } = require('../../../src/obs/display-queue');
const EventEmitter = require('events');

describe('Cross-Platform Goal Calculation', () => {
    let displayQueue;
    let mockOBSManager;
    let configFixture;
    let mockConstants;
    
    beforeEach(() => {
        mockOBSManager = new EventEmitter();
        mockOBSManager.call = createMockFn().mockResolvedValue({});
        mockOBSManager.isConnected = createMockFn().mockReturnValue(true);
        mockOBSManager.isReady = createMockFn().mockResolvedValue(true);

        configFixture = {
            autoProcess: false,
            goals: {
                enabled: true,
                targetAmount: 1000
            },
            timing: {
                notificationDuration: 5000,
                lingerChatDuration: 10000
            },
            notification: {
                sourceName: 'NotificationText',
                sceneName: 'Main Scene',
                groupName: 'NotificationGroup',
                platformLogos: {
                    twitch: 'TwitchLogo',
                    youtube: 'YoutubeLogo',
                    tiktok: 'TiktokLogo'
                }
            },
            chat: {
                sourceName: 'ChatText',
                sceneName: 'Main Scene',
                groupName: 'ChatGroup',
                platformLogos: {
                    twitch: 'TwitchLogo',
                    youtube: 'YoutubeLogo',
                    tiktok: 'TiktokLogo'
                }
            }
        };
        
        mockConstants = {
            NOTIFICATION_CLEAR_DELAY: 200,
            NOTIFICATION_FADE_DURATION: 1000
        };

        const goalTotals = {};
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
                processDonationGoal: createMockFn(async (platform, amount) => {
                    goalTotals[platform] = (goalTotals[platform] || 0) + amount;
                }),
                processPaypiggyGoal: createMockFn().mockResolvedValue({ success: true }),
                initializeGoalDisplay: createMockFn().mockResolvedValue()
            }
        };

        displayQueue = new DisplayQueue(mockOBSManager, configFixture, mockConstants, null, mockDependencies);
        displayQueue.__goalTotals = goalTotals;
    });
    
    afterEach(() => {
        restoreAllMocks();
        if (displayQueue) {
            displayQueue.stop();
        }
    });
    
    describe('TikTok gifts should use total amount correctly', () => {
        it('should use the total TikTok amount for goal tracking', async () => {
            configFixture.goals.enabled = true;
            
            const tiktokGift = {
                type: 'platform:gift',
                data: {
                    username: 'TikTokUser',
                    displayName: 'TikTokUser',
                    giftType: 'Rose',
                    giftCount: 5,
                    amount: 50,
                    currency: 'coins',
                    displayMessage: 'TikTokUser sent 5 Rose',
                    platform: 'tiktok'
                },
                platform: 'tiktok',
                priority: 3
            };
            
            displayQueue.addItem(tiktokGift);
            await displayQueue.processQueue();

            expect(displayQueue.__goalTotals.tiktok).toBe(50);
        });
        
        it('should use TikTok total amount derived from repeat count', async () => {
            configFixture.goals.enabled = true;
            
            const tiktokDiamonds = {
                type: 'platform:gift',
                data: {
                    username: 'TikTokDiamondUser',
                    displayName: 'TikTokDiamondUser',
                    giftType: 'Diamond',
                    giftCount: 3,
                    amount: 300,
                    currency: 'coins',
                    displayMessage: 'TikTokDiamondUser sent 3 Diamond',
                    platform: 'tiktok'
                },
                platform: 'tiktok',
                priority: 3
            };
            
            displayQueue.addItem(tiktokDiamonds);
            await displayQueue.processQueue();

            expect(displayQueue.__goalTotals.tiktok).toBe(300);
        });
    });
    
    describe('YouTube donations should use total amount correctly', () => {
        it('should use the total YouTube amount for goal tracking', async () => {
            configFixture.goals.enabled = true;
            
            const youtubeDonation = {
                type: 'platform:gift',
                data: {
                    username: 'YouTubeUser',
                    displayName: 'YouTubeUser',
                    giftType: 'Donation',
                    giftCount: 2,
                    amount: 10,
                    currency: 'USD',
                    displayMessage: 'YouTubeUser sent 2 Donation',
                    platform: 'youtube'
                },
                platform: 'youtube',
                priority: 3
            };
            
            displayQueue.addItem(youtubeDonation);
            await displayQueue.processQueue();

            expect(displayQueue.__goalTotals.youtube).toBe(10);
        });
    });
    
    describe('Twitch bits should NOT multiply', () => {
        it('should use Twitch bits value directly without multiplication', async () => {
            configFixture.goals.enabled = true;
            
            const twitchBits = {
                type: 'platform:gift',
                data: {
                    username: 'TwitchUser',
                    displayName: 'TwitchUser',
                    message: 'Cheer100',
                    bits: 100,
                    giftType: 'bits',
                    giftCount: 1,
                    amount: 100,
                    currency: 'bits',
                    displayMessage: 'TwitchUser sent 100 bits',
                    platform: 'twitch'
                },
                platform: 'twitch',
                priority: 3
            };
            
            displayQueue.addItem(twitchBits);
            await displayQueue.processQueue();

            expect(displayQueue.__goalTotals.twitch).toBe(100);
        });
    });
    
    describe('Edge cases', () => {
        it('should handle gifts with zero or missing values gracefully', async () => {
            configFixture.goals.enabled = true;
            
            const edgeCases = [
                {
                    type: 'platform:gift',
                    data: {
                        username: 'User1',
                        giftType: 'Rose',
                        giftCount: 10,
                        amount: 0,
                        currency: 'coins',
                        displayMessage: 'User1 sent 10 Rose',
                        platform: 'tiktok'
                    },
                    platform: 'tiktok'
                },
                {
                    type: 'platform:gift',
                    data: {
                        username: 'User2',
                        giftType: 'Rose',
                        giftCount: 0,
                        amount: 10,
                        currency: 'coins',
                        displayMessage: 'User2 sent 0 Rose',
                        platform: 'tiktok'
                    },
                    platform: 'tiktok'
                },
                {
                    type: 'platform:gift',
                    data: {
                        username: 'User3',
                        displayMessage: 'User3 sent a gift',
                        platform: 'youtube'
                    },
                    platform: 'youtube'
                }
            ];
            
            for (const gift of edgeCases) {
                displayQueue.addItem(gift);
                await displayQueue.processQueue();
            }

            expect(displayQueue.goalsManager.processDonationGoal).not.toHaveBeenCalled();
        });

        it('should skip goal tracking for error gifts', async () => {
            configFixture.goals.enabled = true;

            const errorGift = {
                type: 'platform:gift',
                data: {
                    username: 'Unknown User',
                    giftType: 'Unknown gift',
                    giftCount: 0,
                    amount: 100,
                    currency: 'bits',
                    displayMessage: 'Error processing gift',
                    isError: true,
                    platform: 'twitch'
                },
                platform: 'twitch',
                priority: 3
            };

            displayQueue.addItem(errorGift);
            await displayQueue.processQueue();

            expect(displayQueue.goalsManager.processDonationGoal).not.toHaveBeenCalled();
        });
    });
});
