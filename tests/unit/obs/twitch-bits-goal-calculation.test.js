
const { describe, test, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

const { DisplayQueue } = require('../../../src/obs/display-queue');
const EventEmitter = require('events');

// Mock the goals module
mockModule('../../../src/obs/goals', () => {
    const processDonationGoal = createMockFn();
    return {
        OBSGoalsManager: class {},
        createOBSGoalsManager: () => ({ processDonationGoal }),
        getDefaultGoalsManager: () => ({ processDonationGoal })
    };
});

const processDonationGoal = require('../../../src/obs/goals').getDefaultGoalsManager().processDonationGoal;

describe('DisplayQueue - Twitch Bits Goal Calculation', () => {
    let displayQueue;
    let mockOBSManager;
    let mockConfig;
    let mockConstants;
    
    beforeEach(() => {
        // Reset mocks
        // Create mock OBS Manager
        mockOBSManager = new EventEmitter();
        mockOBSManager.call = createMockFn().mockResolvedValue({});
        mockOBSManager.isConnected = createMockFn().mockReturnValue(true);
        mockOBSManager.isReady = createMockFn().mockResolvedValue(true);
        
        // Create mock config with goal settings enabled
        mockConfig = {
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
                    twitch: 'TwitchLogo'
                }
            },
            chat: {
                sourceName: 'ChatText',
                sceneName: 'Main Scene',
                groupName: 'ChatGroup',
                platformLogos: {
                    twitch: 'TwitchLogo'
                }
            }
        };
        
        // Create mock constants
        mockConstants = {
            NOTIFICATION_CLEAR_DELAY: 200,
            NOTIFICATION_FADE_DURATION: 1000
        };
        
        // Initialize DisplayQueue with proper constructor params
        displayQueue = new DisplayQueue(mockOBSManager, mockConfig, mockConstants);
    });
    
    afterEach(() => {
        restoreAllMocks();
        if (displayQueue) {
            displayQueue.stop();
        
        restoreAllModuleMocks();}
    });
    
    describe('Twitch bits contribution to goals', () => {
        it('should add exact bits amount to goal without multiplication', async () => {
            // Given: Goals are enabled
            mockConfig.goals.enabled = true;
            
            // When: User sends 200 bits total (e.g., "Corgo100 Corgo100")
            // This mimics how the NotificationManager sends gift items to DisplayQueue
            const bitsEvent = {
                type: 'platform:gift',  // Bits are emitted as gifts at the Twitch boundary
                data: {
                    username: 'TestUser',
                    displayName: 'TestUser',
                    message: 'Corgo100 Corgo100',
                    bits: 200,  // Total bits amount from Twitch
                    giftType: 'bits',
                    giftCount: 1,
                    amount: 200,
                    currency: 'bits',
                    platform: 'twitch'
                },
                platform: 'twitch',
                priority: 3
            };
            
            // Process the bits event
            displayQueue.addItem(bitsEvent);
            
            // Allow queue processing
            await waitForDelay(100);
            
            // Then: processDonationGoal is called with 200
            expect(processDonationGoal).toHaveBeenCalledWith('twitch', 200);
        });
        
        it('should correctly handle multiple bit cheers without multiplication', async () => {
            // Given: Goals are enabled
            mockConfig.goals.enabled = true;
            
            // When: Multiple users send bits
            const cheers = [
                { username: 'User1', bits: 100 },  // Should add 100, not 10,000
                { username: 'User2', bits: 500 },  // Should add 500, not 250,000
                { username: 'User3', bits: 50 }     // Should add 50, not 2,500
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
            
            // Allow queue processing
            await waitForDelay(300);
            
            // Then: processDonationGoal is called with correct amounts
            expect(processDonationGoal).toHaveBeenCalledTimes(3);
            
            expect(processDonationGoal).toHaveBeenNthCalledWith(1, 'twitch', 100);
            expect(processDonationGoal).toHaveBeenNthCalledWith(2, 'twitch', 500);
            expect(processDonationGoal).toHaveBeenNthCalledWith(3, 'twitch', 50);
            
            // Should NOT be called with multiplied amounts
            expect(processDonationGoal).not.toHaveBeenCalledWith('twitch', 10000);
            expect(processDonationGoal).not.toHaveBeenCalledWith('twitch', 250000);
            expect(processDonationGoal).not.toHaveBeenCalledWith('twitch', 2500);
        });
        
        it('should handle single bit cheer correctly', async () => {
            // Given: Goals are enabled
            mockConfig.goals.enabled = true;
            
            // When: User sends a single Cheer1 (1 bit)
                const singleBitEvent = {
                    type: 'platform:gift',
                    data: {
                        username: 'SmallCheerer',
                        displayName: 'SmallCheerer',
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
            
            // Then: processDonationGoal should be called with exactly 1
            expect(processDonationGoal).toHaveBeenCalledWith('twitch', 1);
        });
        
        it('should process bits using the amount field', async () => {
            // Given: Goals are enabled
            mockConfig.goals.enabled = true;
            
            // When: Processing bits with different amounts
            const testCases = [100, 250, 50];
            
            for (let i = 0; i < testCases.length; i++) {
                const bitsAmount = testCases[i];
                clearAllMocks(); // Clear before each test case
                
                const event = {
                    type: 'platform:gift',
                    data: {
                        username: 'TestUser',
                        displayName: 'TestUser',
                        message: `Cheer${bitsAmount}`,
                        bits: bitsAmount,
                        giftType: 'bits',
                        giftCount: 1,
                        amount: bitsAmount,
                        currency: 'bits',
                        platform: 'twitch'
                    },
                    platform: 'twitch',
                    priority: 3
                };
                
                displayQueue.addItem(event);
                await waitForDelay(100);
                
                // Use bits value directly for Twitch
                const expectedCorrectValue = bitsAmount;
                
                expect(processDonationGoal).toHaveBeenCalledWith('twitch', expectedCorrectValue);
            }
        });
    });
    
    describe('User experience validation', () => {
        it('should display correct goal progress to viewers after bits donation', async () => {
            // Given: Goals are enabled
            mockConfig.goals.enabled = true;
            
            // When: User donates 200 bits
            const bitsEvent = {
                type: 'platform:gift',
                data: {
                    username: 'GenerousViewer',
                    displayName: 'GenerousViewer',
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
            
            // Then: processDonationGoal is called with 200
            expect(processDonationGoal).toHaveBeenCalledWith('twitch', 200);
            
            // Verify the calculation that would happen
            const correctAmount = 200;
            const incorrectAmount = 200 * 200;
            
            expect(correctAmount).toBe(200);
            expect(incorrectAmount).toBe(40000);
        });
        
        it('should handle multi-cheermote scenarios without goal inflation', async () => {
            // Given: Goals are enabled
            mockConfig.goals.enabled = true;
            
            // When: User sends "Corgo100 Corgo100" (2 Corgo100 cheermotes = 200 bits total)
            const realWorldScenario = {
                type: 'platform:gift',
                data: {
                    username: 'RealUser',
                    displayName: 'RealUser',
                    message: 'Corgo100 Corgo100',
                    bits: 200,  // Total bits correctly calculated
                    giftType: 'bits',
                    giftCount: 1,
                    amount: 200,
                    currency: 'bits',
                    cheermoteInfo: {
                        type: 'Corgo',
                        count: 2,  // 2 Corgo100 cheermotes
                        cleanPrefix: 'Corgo'
                    },
                    platform: 'twitch'
                },
                platform: 'twitch',
                priority: 3
            };
            
            displayQueue.addItem(realWorldScenario);
            await waitForDelay(100);
            
            // Then: uses 200 (the total bits)
            expect(processDonationGoal).toHaveBeenCalledWith('twitch', 200);
        });
    });
});
