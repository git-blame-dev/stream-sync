
const { DisplayQueue } = require('../../../src/obs/display-queue');
const EventEmitter = require('events');

// Mock the goals module
jest.mock('../../../src/obs/goals', () => {
    const processDonationGoal = jest.fn();
    return {
        OBSGoalsManager: class {},
        createOBSGoalsManager: () => ({ processDonationGoal }),
        getDefaultGoalsManager: () => ({ processDonationGoal })
    };
});

describe('Cross-Platform Goal Calculation', () => {
    let displayQueue;
    let mockOBSManager;
    let mockConfig;
    let mockConstants;
    
    beforeEach(() => {
        jest.clearAllMocks();

        mockOBSManager = new EventEmitter();
        mockOBSManager.call = jest.fn().mockResolvedValue({});
        mockOBSManager.isConnected = jest.fn().mockReturnValue(true);
        mockOBSManager.isReady = jest.fn().mockResolvedValue(true);

        mockConfig = {
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

        displayQueue = new DisplayQueue(mockOBSManager, mockConfig, mockConstants);
        const goalTotals = {};
        displayQueue.goalsManager = {
            processDonationGoal: jest.fn(async (platform, amount) => {
                goalTotals[platform] = (goalTotals[platform] || 0) + amount;
            })
        };
        displayQueue.__goalTotals = goalTotals;
    });
    
    afterEach(() => {
        if (displayQueue) {
            displayQueue.stop();
        }
    });
    
    describe('TikTok gifts should use total amount correctly', () => {
        it('should use the total TikTok amount for goal tracking', async () => {
            mockConfig.goals.enabled = true;
            
            const tiktokGift = {
                type: 'platform:gift',
                data: {
                    username: 'TikTokUser',
                    displayName: 'TikTokUser',
                    giftType: 'Rose',
                    giftCount: 5,   // Number of gifts
                    amount: 50,     // Total amount
                    currency: 'coins',
                    displayMessage: 'TikTokUser sent 5 Rose',
                    platform: 'tiktok'
                },
                platform: 'tiktok',
                priority: 3
            };
            
            displayQueue.addItem(tiktokGift);
            await displayQueue.processQueue();

            // Should use the total amount directly
            expect(displayQueue.__goalTotals.tiktok).toBe(50);
        });
        
        it('should use TikTok total amount derived from repeat count', async () => {
            mockConfig.goals.enabled = true;
            
            const tiktokDiamonds = {
                type: 'platform:gift',
                data: {
                    username: 'TikTokDiamondUser',
                    displayName: 'TikTokDiamondUser',
                    giftType: 'Diamond',
                    giftCount: 3,  // Normalized from repeatCount by platform layer
                    amount: 300,   // Total amount
                    currency: 'coins',
                    displayMessage: 'TikTokDiamondUser sent 3 Diamond',
                    platform: 'tiktok'
                },
                platform: 'tiktok',
                priority: 3
            };
            
            displayQueue.addItem(tiktokDiamonds);
            await displayQueue.processQueue();

            // Should multiply: 100 diamonds × 3 repeats = 300
            expect(displayQueue.__goalTotals.tiktok).toBe(300);
        });
    });
    
    describe('YouTube donations should use total amount correctly', () => {
        it('should use the total YouTube amount for goal tracking', async () => {
            mockConfig.goals.enabled = true;
            
            const youtubeDonation = {
                type: 'platform:gift',
                data: {
                    username: 'YouTubeUser',
                    displayName: 'YouTubeUser',
                    giftType: 'Donation',
                    giftCount: 2,
                    amount: 10,      // Total amount
                    currency: 'USD',
                    displayMessage: 'YouTubeUser sent 2 Donation',
                    platform: 'youtube'
                },
                platform: 'youtube',
                priority: 3
            };
            
            displayQueue.addItem(youtubeDonation);
            await displayQueue.processQueue();

            // Should use total amount directly
            expect(displayQueue.__goalTotals.youtube).toBe(10);
        });
    });
    
    describe('Twitch bits should NOT multiply', () => {
        it('should use Twitch bits value directly without multiplication', async () => {
            mockConfig.goals.enabled = true;
            
            const twitchBits = {
                type: 'platform:gift',
                data: {
                    username: 'TwitchUser',
                    displayName: 'TwitchUser',
                    message: 'Cheer100',
                    bits: 100,      // Total bits
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

            // Should use total amount directly
            expect(displayQueue.__goalTotals.twitch).toBe(100);
        });
    });
    
    describe('Edge cases', () => {
        it('should handle gifts with zero or missing values gracefully', async () => {
            mockConfig.goals.enabled = true;
            
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
                        // No gift value fields
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
            
            // First case: 0 × 10 = 0 (should not call processDonationGoal)
            // Second case: 10 × 0 = 0 (should not call processDonationGoal)  
            // Third case: no value fields = 0 (should not call processDonationGoal)
            expect(displayQueue.goalsManager.processDonationGoal).not.toHaveBeenCalled();
        });

        it('should skip goal tracking for error gifts', async () => {
            mockConfig.goals.enabled = true;

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
