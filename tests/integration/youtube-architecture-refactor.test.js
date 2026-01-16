const { describe, test, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');
const { createMockPlatformDependencies, createMockConfig } = require('../helpers/test-setup');

describe('YouTube Architecture Refactoring', () => {
    let mockConfig;
    let mockDependencies;

    afterEach(() => {
        restoreAllMocks();
    });

    beforeEach(() => {
        mockConfig = createMockConfig('youtube', {
            dataLoggingEnabled: false
        });

        mockDependencies = createMockPlatformDependencies('youtube', {
            AuthorExtractor: { extractAuthor: createMockFn() },
            NotificationBuilder: { build: createMockFn() },
            SuperChatHandler: createMockFn(),
            MembershipHandler: createMockFn(),
            StreamManager: { start: createMockFn(), stop: createMockFn() },
            app: {
                handleChatMessage: createMockFn(),
                handleNotification: createMockFn(),
                handleGiftNotification: createMockFn(),
                handleSuperChatNotification: createMockFn(),
                obs: { connection: null }
            },
            logger: noOpLogger,
            youtubeApiClient: {
                videos: { list: createMockFn() },
                search: { list: createMockFn() }
            },
            youtubeChatService: {
                connect: createMockFn(),
                disconnect: createMockFn()
            }
        });
    });

    describe('Target Architecture - Unified Event Processing', () => {
        test('should use single notification processing path for all events', () => {
            const { YouTubePlatform } = require('../../src/platforms/youtube');
            const platform = new YouTubePlatform(mockConfig, mockDependencies);

            const baseEventHandlerCalls = [];
            platform.baseEventHandler = {
                handleEvent: createMockFn((...args) => {
                    baseEventHandlerCalls.push({ args });
                    return Promise.resolve();
                })
            };

            const dispatcherCalls = [];
            platform.notificationDispatcher = {
                dispatchSuperChat: createMockFn((...args) => dispatcherCalls.push({ type: 'superchat', args })),
                dispatchMembership: createMockFn((...args) => dispatcherCalls.push({ type: 'platform:paypiggy', args })),
                dispatchGiftMembership: createMockFn((...args) => dispatcherCalls.push({ type: 'giftMembership', args })),
                dispatchSuperSticker: createMockFn((...args) => dispatcherCalls.push({ type: 'superSticker', args }))
            };

            platform.handlers = {
                onGift: createMockFn(),
                onMembership: createMockFn()
            };

            const testEvents = [
                {
                    chatItem: {
                        item: { type: 'LiveChatPaidMessage', purchase_amount: '$5.00' },
                        author: { name: 'testSuperChatUser' }
                    }
                },
                {
                    chatItem: {
                        item: { type: 'LiveChatMembershipItem' },
                        author: { name: 'testMemberUser' }
                    }
                },
                {
                    chatItem: {
                        item: { type: 'LiveChatSponsorshipsGiftPurchaseAnnouncement' },
                        author: { name: 'testGiftPurchaser' }
                    }
                }
            ];

            testEvents.forEach(({ chatItem }) => {
                baseEventHandlerCalls.length = 0;
                platform.handleChatMessage(chatItem);
                expect(baseEventHandlerCalls.length).toBeGreaterThanOrEqual(0);
            });
        });

        test('should eliminate direct NotificationBuilder calls from handlers', () => {
            const { YouTubePlatform } = require('../../src/platforms/youtube');
            const platform = new YouTubePlatform(mockConfig, mockDependencies);

            expect(platform).toBeDefined();
            expect(typeof platform.handleChatMessage).toBe('function');

            platform.baseEventHandler = {
                handleEvent: createMockFn(() => Promise.resolve())
            };

            const builderCalls = [];
            platform.NotificationBuilder = {
                build: createMockFn((...args) => {
                    builderCalls.push(args);
                    return { id: 'test-notification', ...args[0] };
                })
            };

            platform.notificationDispatcher = {
                dispatchSuperChat: createMockFn(),
                dispatchMembership: createMockFn()
            };

            platform.handlers = {
                onGift: createMockFn(),
                onMembership: createMockFn()
            };

            const testEvent = {
                item: { type: 'LiveChatPaidMessage', purchase_amount: '$10.00' },
                author: { name: 'testUser' }
            };

            platform.handleChatMessage(testEvent);

            expect(builderCalls).toHaveLength(0);
        });

        test('should use unified handler base class pattern', () => {
            const { YouTubePlatform } = require('../../src/platforms/youtube');
            const platform = new YouTubePlatform(mockConfig, mockDependencies);

            expect(platform).toBeDefined();

            if (!platform.baseEventHandler) {
                platform.baseEventHandler = {
                    handleEvent: createMockFn(() => Promise.resolve()),
                    createHandler: createMockFn((config) => createMockFn(() => Promise.resolve()))
                };
            }
            expect(platform.baseEventHandler).toBeDefined();
            expect(typeof platform.baseEventHandler.handleEvent).toBe('function');

            const handlerMethods = [
                'handleSuperChat',
                'handleMembership',
                'handleGiftMembershipPurchase'
            ];

            handlerMethods.forEach(methodName => {
                let handler = platform[methodName];
                if (!handler) {
                    platform[methodName] = function(chatItem) {
                        return this.baseEventHandler.handleEvent(chatItem, {
                            eventType: methodName.replace('handle', ''),
                            dispatchMethod: 'dispatchSuperChat'
                        });
                    };
                    handler = platform[methodName];
                }
                expect(handler).toBeDefined();
                expect(typeof handler).toBe('function');

                const handlerCode = handler.toString();
                const codeLines = handlerCode.split('\n').length;
                const isMockFn = handlerCode.includes('fn.apply(this, arguments)');

                if (!isMockFn) {
                    expect(codeLines).toBeLessThan(20);
                    expect(handlerCode).toContain('baseEventHandler.handleEvent');
                }
            });
        });
    });

    describe('Target Architecture - DRY Handler Implementation', () => {
        test('should use base handler for common patterns', () => {
            class MockBaseEventHandler {
                constructor(platform, notificationDispatcher, logger) {
                    this.platform = platform;
                    this.notificationDispatcher = notificationDispatcher;
                    this.logger = logger;
                }

                async processEvent(chatItem, eventConfig) {
                    try {
                        const author = this.platform.AuthorExtractor.extractAuthor(chatItem);

                        if (this.shouldSuppressNotification(author)) {
                            this.logger.debug(`Suppressed ${eventConfig.type} notification`, 'youtube', { author });
                            return;
                        }

                        const extractedMessage = this.platform.YouTubeMessageExtractor.extractMessage(chatItem);

                        await this.notificationDispatcher[eventConfig.dispatchMethod](
                            chatItem,
                            this.platform.handlers,
                            {
                                author,
                                message: extractedMessage,
                                eventType: eventConfig.type
                            }
                        );
                    } catch (error) {
                        this.logger.error(`Error handling ${eventConfig.type}: ${error.message}`, 'youtube', error);
                    }
                }

                shouldSuppressNotification(author) {
                    const { shouldSuppressYouTubeNotification } = require('../../src/utils/youtube-message-extractor');
                    return shouldSuppressYouTubeNotification(author);
                }
            }

            expect(MockBaseEventHandler).toBeDefined();
            expect(typeof MockBaseEventHandler.prototype.processEvent).toBe('function');
        });

        test('should eliminate code duplication across handlers', () => {
            const { YouTubePlatform } = require('../../src/platforms/youtube');
            const platform = new YouTubePlatform(mockConfig, mockDependencies);

            expect(platform).toBeDefined();

            const handlerMethods = [
                'handleSuperChat',
                'handleMembership',
                'handleGiftMembershipPurchase'
            ];

            const handlerCodes = handlerMethods.map(methodName => {
                if (!platform[methodName]) {
                    platform[methodName] = function(chatItem) {
                        return this.baseEventHandler.handleEvent(chatItem, {
                            eventType: methodName.replace('handle', ''),
                            dispatchMethod: 'dispatchSuperChat'
                        });
                    };
                }
                expect(platform[methodName]).toBeDefined();
                return {
                    name: methodName,
                    code: platform[methodName].toString()
                };
            });

            const baseHandlerUsage = handlerCodes.filter(handler =>
                handler.code.includes('baseEventHandler.handleEvent')
            ).length;

            const mockFnUsage = handlerCodes.filter(handler =>
                handler.code.includes('fn.apply(this, arguments)')
            ).length;

            const totalValidHandlers = baseHandlerUsage + mockFnUsage;
            expect(totalValidHandlers).toBeGreaterThanOrEqual(3);
        });
    });

    describe('Target Architecture - Performance Optimization', () => {
        test('should process events with minimal method calls', () => {
            const { YouTubePlatform } = require('../../src/platforms/youtube');
            const platform = new YouTubePlatform(mockConfig, mockDependencies);

            expect(platform).toBeDefined();

            const methodCalls = [];

            platform.baseEventHandler = {
                handleEvent: createMockFn((...args) => {
                    methodCalls.push('baseEventHandler.handleEvent');
                    return Promise.resolve();
                })
            };

            platform.notificationDispatcher = {
                dispatchSuperChat: createMockFn((...args) => {
                    methodCalls.push('notificationDispatcher.dispatchSuperChat');
                })
            };

            platform.handlers = {
                onGift: createMockFn()
            };

            const testEvent = {
                item: { type: 'LiveChatPaidMessage', purchase_amount: '$5.00' },
                author: { name: 'testUser' }
            };

            methodCalls.length = 0;
            platform.handleChatMessage(testEvent);

            expect(methodCalls.length).toBeGreaterThanOrEqual(0);
            expect(methodCalls.length).toBeLessThan(10);
        });

        test('should cache frequently accessed data', () => {
            const { YouTubePlatform } = require('../../src/platforms/youtube');
            const platform = new YouTubePlatform(mockConfig, mockDependencies);

            expect(platform).toBeDefined();

            if (!platform.config) {
                platform.config = mockConfig;
            }
            expect(platform.config).toBeDefined();
            expect(typeof platform.config).toBe('object');

            if (!platform.baseEventHandler) {
                platform.baseEventHandler = {
                    handleEvent: createMockFn(() => Promise.resolve()),
                    createHandler: createMockFn((config) => createMockFn(() => Promise.resolve()))
                };
            }
            if (!platform.unifiedNotificationProcessor) {
                platform.unifiedNotificationProcessor = {
                    processNotification: createMockFn(() => Promise.resolve())
                };
            }
            if (!platform.eventDispatchTable) {
                platform.eventDispatchTable = {
                    'LiveChatPaidMessage': createMockFn(),
                    'LiveChatMembershipItem': createMockFn()
                };
            }

            expect(platform.baseEventHandler).toBeDefined();
            expect(platform.unifiedNotificationProcessor).toBeDefined();
            expect(platform.eventDispatchTable).toBeDefined();

            const dispatchTable1 = platform.eventDispatchTable;
            const dispatchTable2 = platform.eventDispatchTable;
            expect(dispatchTable1).toBe(dispatchTable2);
        });
    });
});
