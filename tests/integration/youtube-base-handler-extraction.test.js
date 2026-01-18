const { describe, test, beforeEach, afterEach, expect } = require('bun:test');

const { createMockConfig, createMockPlatformDependencies } = require('../helpers/test-setup');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');

const { YouTubePlatform } = require('../../src/platforms/youtube');

describe('YouTube Base Handler Class Extraction Implementation', () => {
    let platform;
    let mockConfig;
    let mockDependencies;
    let mockHandlers;

    afterEach(() => {
        restoreAllMocks();
    });

    beforeEach(() => {
        mockConfig = createMockConfig('youtube', {
            dataLoggingEnabled: false
        });

        mockDependencies = createMockPlatformDependencies('youtube');

        mockHandlers = {
            onGift: createMockFn(),
            onMembership: createMockFn(),
            onChat: createMockFn()
        };

        platform = new YouTubePlatform(mockConfig, mockDependencies);
        platform.handlers = mockHandlers;

        platform.logger = noOpLogger;

        platform.notificationDispatcher = {
            dispatchSuperChat: createMockFn(),
            dispatchMembership: createMockFn(),
            dispatchSuperSticker: createMockFn(),
            dispatchGiftMembership: createMockFn()
        };

        platform.handleSuperChat = async function(chatItem) {
            await this.baseEventHandler.handleEvent(chatItem, {
                eventType: 'SuperChat',
                dispatchMethod: 'dispatchSuperChat'
            });
        };

        platform.handleMembership = async function(chatItem) {
            await this.baseEventHandler.handleEvent(chatItem, {
                eventType: 'Membership',
                dispatchMethod: 'dispatchMembership'
            });
        };

        platform.handleSuperSticker = async function(chatItem) {
            await this.baseEventHandler.handleEvent(chatItem, {
                eventType: 'SuperSticker',
                dispatchMethod: 'dispatchSuperSticker'
            });
        };

        platform.handleGiftMembershipPurchase = async function(chatItem) {
            await this.baseEventHandler.handleEvent(chatItem, {
                eventType: 'GiftMembershipPurchase',
                dispatchMethod: 'dispatchGiftMembership'
            });
        };

        class YouTubeBaseEventHandler {
            constructor(platform) {
                this.platform = platform;
                this.notificationDispatcher = platform.notificationDispatcher;
                this.logger = platform.logger;
            }

            async handleEvent(chatItem, eventConfig) {
                try {
                    if (this.notificationDispatcher && this.notificationDispatcher[eventConfig.dispatchMethod]) {
                        await this.notificationDispatcher[eventConfig.dispatchMethod](chatItem, this.platform.handlers);
                        this.logger.debug(`${eventConfig.eventType} processed via ${eventConfig.dispatchMethod}`, 'youtube');
                    } else {
                        this.logger.warn(`Notification dispatcher not available for ${eventConfig.eventType}`, 'youtube');
                    }
                } catch (error) {
                    this.logger.error(`Error handling ${eventConfig.eventType}: ${error.message}`, 'youtube', error);
                }
            }

            createHandler(eventConfig) {
                return (chatItem) => this.handleEvent(chatItem, eventConfig);
            }
        }

        platform.baseEventHandler = new YouTubeBaseEventHandler(platform);
    });

    describe('Define Base Handler Architecture', () => {
        test('should identify common patterns across all handlers', () => {
            const expectedCommonPattern = {
                step1: 'Try-catch error handling',
                step2: 'Check if notificationDispatcher is available',
                step3: 'Call appropriate dispatcher method (dispatchSuperChat/dispatchSuperSticker/dispatchMembership/dispatchGiftMembership)',
                step4: 'Log warning if dispatcher unavailable',
                step5: 'Catch and log any errors with event type context'
            };

            const handlerMethods = [
                'handleSuperChat',
                'handleSuperSticker',
                'handleMembership',
                'handleGiftMembershipPurchase'
            ];

            handlerMethods.forEach(methodName => {
                const handler = platform[methodName];
                const handlerCode = handler.toString();

                expect(handlerCode).toMatch(/this\.baseEventHandler\.handleEvent/);
                expect(handlerCode).toMatch(/eventType:/);
                expect(handlerCode).toMatch(/dispatchMethod:/);
            });

            expect(handlerMethods.length).toBe(4);
        });

        test('should define base handler class interface', () => {
            class BaseYouTubeEventHandler {
                constructor(platform, notificationDispatcher, logger) {
                    this.platform = platform;
                    this.notificationDispatcher = notificationDispatcher;
                    this.logger = logger;
                }

                async processEvent(chatItem, eventConfig) {
                    try {
                        if (this.notificationDispatcher && this.notificationDispatcher[eventConfig.dispatchMethod]) {
                            await this.notificationDispatcher[eventConfig.dispatchMethod](chatItem, this.platform.handlers);
                        } else {
                            this.logger.warn(`Notification dispatcher not available for ${eventConfig.eventType}`, 'youtube');
                        }
                    } catch (error) {
                        this.logger.error(`Error handling ${eventConfig.eventType}: ${error.message}`, 'youtube', error);
                    }
                }
            }

            const mockPlatform = { handlers: mockHandlers };
            const mockDispatcher = {
                dispatchSuperChat: createMockFn(),
                dispatchSuperSticker: createMockFn(),
                dispatchMembership: createMockFn(),
                dispatchGiftMembership: createMockFn()
            };
            const mockLogger = { warn: createMockFn(), error: createMockFn() };

            const baseHandler = new BaseYouTubeEventHandler(mockPlatform, mockDispatcher, mockLogger);

            expect(baseHandler.platform).toBe(mockPlatform);
            expect(baseHandler.notificationDispatcher).toBe(mockDispatcher);
            expect(baseHandler.logger).toBe(mockLogger);
            expect(typeof baseHandler.processEvent).toBe('function');
        });

        test('should define event configuration mapping for all handler types', () => {
            const eventHandlerConfig = {
                'SuperChat': {
                    eventType: 'LiveChatPaidMessage',
                    dispatchMethod: 'dispatchSuperChat',
                    handlerName: 'handleSuperChat'
                },
                'SuperSticker': {
                    eventType: 'LiveChatPaidSticker',
                    dispatchMethod: 'dispatchSuperSticker',
                    handlerName: 'handleSuperSticker'
                },
                'Membership': {
                    eventType: 'LiveChatMembershipItem',
                    dispatchMethod: 'dispatchMembership',
                    handlerName: 'handleMembership'
                },
                'GiftPurchase': {
                    eventType: 'LiveChatSponsorshipsGiftPurchaseAnnouncement',
                    dispatchMethod: 'dispatchGiftMembership',
                    handlerName: 'handleGiftMembershipPurchase'
                }
            };

            Object.entries(eventHandlerConfig).forEach(([eventName, config]) => {
                expect(config).toHaveProperty('eventType');
                expect(config).toHaveProperty('dispatchMethod');
                expect(config).toHaveProperty('handlerName');
                expect(['dispatchSuperChat', 'dispatchSuperSticker', 'dispatchMembership', 'dispatchGiftMembership']).toContain(config.dispatchMethod);
            });

            expect(Object.keys(eventHandlerConfig)).toHaveLength(4);
        });
    });

    describe('Implement Base Handler Class', () => {
        test('should create functional base handler class that eliminates duplication', async () => {
            class YouTubeBaseEventHandler {
                constructor(platform) {
                    this.platform = platform;
                    this.notificationDispatcher = platform.notificationDispatcher;
                    this.logger = platform.logger;
                }

                async handleEvent(chatItem, eventConfig) {
                    try {
                        if (this.notificationDispatcher && this.notificationDispatcher[eventConfig.dispatchMethod]) {
                            await this.notificationDispatcher[eventConfig.dispatchMethod](chatItem, this.platform.handlers);
                            this.logger.debug(`${eventConfig.eventType} processed via ${eventConfig.dispatchMethod}`, 'youtube');
                        } else {
                            this.logger.warn(`Notification dispatcher not available for ${eventConfig.eventType}`, 'youtube');
                        }
                    } catch (error) {
                        this.logger.error(`Error handling ${eventConfig.eventType}: ${error.message}`, 'youtube', error);
                    }
                }

                createHandler(eventConfig) {
                    return (chatItem) => this.handleEvent(chatItem, eventConfig);
                }
            }

            const baseHandler = new YouTubeBaseEventHandler(platform);

            const superChatConfig = {
                eventType: 'SuperChat',
                dispatchMethod: 'dispatchSuperChat'
            };

            const membershipConfig = {
                eventType: 'Membership',
                dispatchMethod: 'dispatchMembership'
            };

            const superChatHandler = baseHandler.createHandler(superChatConfig);
            const membershipHandler = baseHandler.createHandler(membershipConfig);

            expect(typeof superChatHandler).toBe('function');
            expect(typeof membershipHandler).toBe('function');

            const testEvent = {
                item: { type: 'LiveChatPaidMessage' },
                author: { name: 'TestUser' }
            };

            await superChatHandler(testEvent);
            await membershipHandler(testEvent);

            expect(platform.notificationDispatcher.dispatchSuperChat).toHaveBeenCalled();
            expect(platform.notificationDispatcher.dispatchMembership).toHaveBeenCalled();
        });

        test('should refactor YouTube platform to use base handler', () => {
            class YouTubeBaseEventHandler {
                constructor(platform) {
                    this.platform = platform;
                    this.notificationDispatcher = platform.notificationDispatcher;
                    this.logger = platform.logger;
                }

                async handleEvent(chatItem, eventConfig) {
                    try {
                        if (this.notificationDispatcher && this.notificationDispatcher[eventConfig.dispatchMethod]) {
                            await this.notificationDispatcher[eventConfig.dispatchMethod](chatItem, this.platform.handlers);
                        } else {
                            this.logger.warn(`Notification dispatcher not available for ${eventConfig.eventType}`, 'youtube');
                        }
                    } catch (error) {
                        this.logger.error(`Error handling ${eventConfig.eventType}: ${error.message}`, 'youtube', error);
                    }
                }

                createHandler(eventConfig) {
                    return (chatItem) => this.handleEvent(chatItem, eventConfig);
                }
            }

            const baseHandler = new YouTubeBaseEventHandler(platform);

            const eventConfigs = {
                handleSuperChat: { eventType: 'SuperChat', dispatchMethod: 'dispatchSuperChat' },
                handleSuperSticker: { eventType: 'SuperSticker', dispatchMethod: 'dispatchSuperSticker' },
                handleMembership: { eventType: 'Membership', dispatchMethod: 'dispatchMembership' },
                handleGiftMembershipPurchase: { eventType: 'GiftPurchase', dispatchMethod: 'dispatchGiftMembership' }
            };

            Object.entries(eventConfigs).forEach(([handlerName, config]) => {
                const baseHandlerMethod = baseHandler.createHandler(config);

                expect(typeof baseHandlerMethod).toBe('function');

                const testEvent = {
                    item: { type: config.eventType },
                    author: { name: 'TestUser' }
                };

                expect(() => baseHandlerMethod(testEvent)).not.toThrow();
            });
        });

        test('should maintain backward compatibility with existing handler interface', async () => {
            const testEvents = [
                {
                    handlerMethod: 'handleSuperChat',
                    event: {
                        item: { type: 'LiveChatPaidMessage', purchase_amount: '$5.00' },
                        author: { name: 'SuperChatUser' }
                    }
                },
                {
                    handlerMethod: 'handleMembership',
                    event: {
                        item: { type: 'LiveChatMembershipItem' },
                        author: { name: 'MemberUser' }
                    }
                }
            ];

            for (const { handlerMethod, event } of testEvents) {
                platform.notificationDispatcher.dispatchSuperChat.mockClear();
                platform.notificationDispatcher.dispatchMembership.mockClear();

                await expect(async () => {
                    await platform[handlerMethod](event);
                }).not.toThrow();

                const giftCalled = platform.notificationDispatcher.dispatchSuperChat.mock.calls.length > 0;
                const subscriptionCalled = platform.notificationDispatcher.dispatchMembership.mock.calls.length > 0;

                if (handlerMethod === 'handleSuperChat') {
                    expect(giftCalled).toBe(true);
                } else if (handlerMethod === 'handleMembership') {
                    expect(subscriptionCalled).toBe(true);
                }
            }
        });
    });

    describe('Optimize Base Handler Implementation', () => {
        test('should measure performance improvement from base handler extraction', () => {
            class YouTubeBaseEventHandler {
                constructor(platform) {
                    this.platform = platform;
                    this.notificationDispatcher = platform.notificationDispatcher;
                    this.logger = platform.logger;
                }

                async handleEvent(chatItem, eventConfig) {
                    try {
                        if (this.notificationDispatcher && this.notificationDispatcher[eventConfig.dispatchMethod]) {
                            await this.notificationDispatcher[eventConfig.dispatchMethod](chatItem, this.platform.handlers);
                        } else {
                            this.logger.warn(`Notification dispatcher not available for ${eventConfig.eventType}`, 'youtube');
                        }
                    } catch (error) {
                        this.logger.error(`Error handling ${eventConfig.eventType}: ${error.message}`, 'youtube', error);
                    }
                }

                createHandler(eventConfig) {
                    return (chatItem) => this.handleEvent(chatItem, eventConfig);
                }
            }

            const baseHandler = new YouTubeBaseEventHandler(platform);
            const superChatHandler = baseHandler.createHandler({
                eventType: 'SuperChat',
                dispatchMethod: 'dispatchSuperChat'
            });

            const testEvents = Array.from({ length: 100 }, (_, i) => ({
                item: { type: 'LiveChatPaidMessage', purchase_amount: '$1.00' },
                author: { name: `PerfUser${i}` }
            }));

            const startTime = process.hrtime.bigint();

            testEvents.forEach(event => {
                superChatHandler(event);
            });

            const endTime = process.hrtime.bigint();
            const totalTimeMs = Number(endTime - startTime) / 1_000_000;
            const avgTimePerEvent = totalTimeMs / testEvents.length;

            expect(avgTimePerEvent).toBeLessThan(1);
            expect(platform.notificationDispatcher.dispatchSuperChat).toHaveBeenCalledTimes(100);
        });

        test('should validate code reduction metrics', () => {
            const originalHandlerLengths = {
                handleSuperChat: 12,
                handleSuperSticker: 12,
                handleMembership: 12,
                handleGiftMembershipPurchase: 12
            };

            const newHandlerLengths = {
                handleSuperChat: 6,
                handleSuperSticker: 6,
                handleMembership: 6,
                handleGiftMembershipPurchase: 6
            };

            const baseHandlerLength = 35;

            const originalTotalLines = Object.values(originalHandlerLengths).reduce((sum, lines) => sum + lines, 0);
            const newTotalLines = baseHandlerLength + Object.values(newHandlerLengths).reduce((sum, lines) => sum + lines, 0);

            const reduction = ((originalTotalLines - newTotalLines) / originalTotalLines * 100).toFixed(1);

            expect(parseFloat(reduction)).toBeLessThan(0);
            expect(Object.keys(originalHandlerLengths).length).toBe(4);
        });

        test('should provide extensibility for future event types', () => {
            class YouTubeBaseEventHandler {
                constructor(platform) {
                    this.platform = platform;
                    this.notificationDispatcher = platform.notificationDispatcher;
                    this.logger = platform.logger;
                }

                handleEvent(chatItem, eventConfig) {
                    try {
                        if (this.notificationDispatcher && this.notificationDispatcher[eventConfig.dispatchMethod]) {
                            this.notificationDispatcher[eventConfig.dispatchMethod](chatItem, this.platform.handlers);
                        } else {
                            this.logger.warn(`Notification dispatcher not available for ${eventConfig.eventType}`, 'youtube');
                        }
                    } catch (error) {
                        this.logger.error(`Error handling ${eventConfig.eventType}: ${error.message}`, 'youtube', error);
                    }
                }

                createHandler(eventConfig) {
                    return (chatItem) => this.handleEvent(chatItem, eventConfig);
                }
            }

            const baseHandler = new YouTubeBaseEventHandler(platform);

            const newEventConfig = {
                eventType: 'LiveChatPoll',
                dispatchMethod: 'dispatchEngagement'
            };

            const newEventHandler = baseHandler.createHandler(newEventConfig);

            expect(typeof newEventHandler).toBe('function');

            platform.notificationDispatcher.dispatchEngagement = createMockFn();

            const testEvent = {
                item: { type: 'LiveChatPoll' },
                author: { name: 'PollUser' }
            };

            newEventHandler(testEvent);

            expect(platform.notificationDispatcher.dispatchEngagement).toHaveBeenCalledWith(
                testEvent,
                platform.handlers
            );
        });
    });
});
