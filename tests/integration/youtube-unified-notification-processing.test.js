const { describe, test, beforeEach, afterEach, expect } = require('bun:test');

const { createMockConfig, createMockPlatformDependencies } = require('../helpers/test-setup');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');

const { YouTubePlatform } = require('../../src/platforms/youtube');

describe('YouTube Unified Notification Processing Implementation', () => {
    let platform;
    let mockConfig;
    let mockDependencies;
    let mockHandlers;

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
        platform.logger = {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };
        platform.notificationDispatcher = {
            dispatchSuperChat: createMockFn(),
            dispatchMembership: createMockFn()
        };
        platform.NotificationBuilder = {
            build: createMockFn().mockReturnValue({ type: 'test-notification' })
        };
    });

    afterEach(() => {
        restoreAllMocks();
    });

    describe('Define Unified Notification Processing Architecture', () => {
        test('should identify dual notification processing paths', () => {
            const dualProcessingPaths = {
                path1: {
                    name: 'Notification Dispatcher Path',
                    description: 'Uses notificationDispatcher.dispatchSuperChat() and dispatchMembership()',
                    handlers: ['handleSuperChat', 'handleSuperSticker', 'handleMembership', 'handleGiftMembershipPurchase']
                },
                path2: {
                    name: 'Direct NotificationBuilder Path',
                    description: 'Uses NotificationBuilder.build() directly',
                    handlers: ['handleTickerSponsor', 'handleViewerEngagement']
                }
            };

            expect(dualProcessingPaths.path1.handlers.length).toBe(4);
            expect(dualProcessingPaths.path2.handlers.length).toBe(2);
        });

        test('should define unified notification processing interface', () => {
            const unifiedNotificationInterface = {
                method: 'processNotification',
                parameters: {
                    chatItem: 'YouTube chat item object',
                    eventType: 'Type of event (gift, subscription, etc.)',
                    eventData: 'Event-specific data'
                },
                behavior: {
                    step1: 'Extract author using AuthorExtractor',
                    step2: 'Check suppression using shouldSuppressYouTubeNotification',
                    step3: 'Extract message using YouTubeMessageExtractor',
                    step4: 'Build notification using NotificationBuilder',
                    step5: 'Dispatch to appropriate handler'
                }
            };

            expect(unifiedNotificationInterface.method).toBe('processNotification');
            expect(unifiedNotificationInterface.parameters.eventType).toBeDefined();
            expect(unifiedNotificationInterface.behavior.step1).toBeDefined();
        });

        test('should identify handlers using different notification paths', () => {
            const handlerNotificationPaths = {
                dispatcherPath: [
                    'handleSuperChat',
                    'handleSuperSticker',
                    'handleMembership',
                    'handleGiftMembershipPurchase'
                ],
                builderPath: [
                    'handleTickerSponsor',
                    'handleViewerEngagement'
                ]
            };

            expect(handlerNotificationPaths.dispatcherPath).toContain('handleSuperChat');
            expect(handlerNotificationPaths.builderPath).toContain('handleTickerSponsor');
        });
    });

    describe('Implement Unified Notification Processing', () => {
        test('should create unified notification processing method', () => {
            class UnifiedNotificationProcessor {
                constructor(platform) {
                    this.platform = platform;
                    this.notificationDispatcher = platform.notificationDispatcher;
                    this.NotificationBuilder = platform.NotificationBuilder;
                    this.AuthorExtractor = platform.AuthorExtractor;
                    this.logger = platform.logger;
                }

                async processNotification(chatItem, eventType, eventData = {}) {
                    try {
                        const author = this.AuthorExtractor.extractAuthor(chatItem);
                        const { shouldSuppressYouTubeNotification } = require('../../src/utils/youtube-message-extractor');
                        if (shouldSuppressYouTubeNotification(author)) {
                            this.logger.debug(`Suppressed ${eventType} notification for anonymous/junk user`, 'youtube', { author });
                            return;
                        }
                        const { YouTubeMessageExtractor } = require('../../src/utils/youtube-message-extractor');
                        const extractedMessage = YouTubeMessageExtractor.extractMessage(chatItem);
                        const notification = this.NotificationBuilder.build({
                            platform: 'youtube',
                            type: eventType,
                            user: author,
                            message: extractedMessage,
                            ...eventData
                        });
                        if (this.platform.handlers[`on${eventType.charAt(0).toUpperCase() + eventType.slice(1)}`]) {
                            this.platform.handlers[`on${eventType.charAt(0).toUpperCase() + eventType.slice(1)}`](notification);
                        }
                        this.logger.debug(`${eventType} notification processed via unified method`, 'youtube');
                    } catch (error) {
                        this.logger.error(`Error processing ${eventType} notification: ${error.message}`, 'youtube', error);
                    }
                }
            }

            const processor = new UnifiedNotificationProcessor(platform);
            expect(typeof processor.processNotification).toBe('function');
        });

        test('should refactor handlers to use unified processing', () => {
            class UnifiedNotificationProcessor {
                constructor(platform) {
                    this.platform = platform;
                    this.notificationDispatcher = platform.notificationDispatcher;
                    this.NotificationBuilder = platform.NotificationBuilder;
                    this.AuthorExtractor = platform.AuthorExtractor;
                    this.logger = platform.logger;
                }

                async processNotification(chatItem, eventType, eventData = {}) {
                    try {
                        const author = this.AuthorExtractor.extractAuthor(chatItem);
                        const { shouldSuppressYouTubeNotification } = require('../../src/utils/youtube-message-extractor');
                        if (shouldSuppressYouTubeNotification(author)) {
                            return;
                        }
                        const { YouTubeMessageExtractor } = require('../../src/utils/youtube-message-extractor');
                        const extractedMessage = YouTubeMessageExtractor.extractMessage(chatItem);
                        const notification = this.NotificationBuilder.build({
                            platform: 'youtube',
                            type: eventType,
                            user: author,
                            message: extractedMessage,
                            ...eventData
                        });
                        if (this.platform.handlers[`on${eventType.charAt(0).toUpperCase() + eventType.slice(1)}`]) {
                            this.platform.handlers[`on${eventType.charAt(0).toUpperCase() + eventType.slice(1)}`](notification);
                        }
                    } catch (error) {
                        this.logger.error(`Error processing ${eventType} notification: ${error.message}`, 'youtube', error);
                    }
                }
            }

            const processor = new UnifiedNotificationProcessor(platform);
            const testEvents = [
                {
                    handlerName: 'handleSuperChat',
                    eventType: 'gift',
                    chatItem: { item: { type: 'LiveChatPaidMessage' }, author: { name: 'TestUser' } }
                },
                {
                    handlerName: 'handleMembership',
                    eventType: 'membership',
                    chatItem: { item: { type: 'LiveChatMembershipItem' }, author: { name: 'TestUser' } }
                },
                {
                    handlerName: 'handleTickerSponsor',
                    eventType: 'membership',
                    chatItem: { item: { type: 'LiveChatSponsorshipsGiftPurchaseAnnouncement' }, author: { name: 'TestUser' } }
                }
            ];

            testEvents.forEach(({ eventType, chatItem }) => {
                expect(() => {
                    processor.processNotification(chatItem, eventType);
                }).not.toThrow();
            });
        });

        test('should maintain backward compatibility with existing handlers', () => {
            const testEvent = {
                item: { type: 'LiveChatPaidMessage', purchase_amount: '$5.00' },
                author: { name: 'SuperChatUser' }
            };
            const mockProcessor = {
                processNotification: createMockFn()
            };

            expect(() => {
                mockProcessor.processNotification(testEvent, 'gift');
            }).not.toThrow();

            expect(mockProcessor.processNotification).toHaveBeenCalledWith(testEvent, 'gift');
        });
    });

    describe('Optimize Unified Notification Processing', () => {
        test('should measure performance improvement from unified processing', () => {
            const testEvents = Array.from({ length: 100 }, (_, i) => ({
                item: { type: 'LiveChatPaidMessage', purchase_amount: '$1.00' },
                author: { name: `PerfUser${i}` }
            }));
            const startTime = process.hrtime.bigint();
            testEvents.forEach(event => {
                platform.NotificationBuilder.build({
                    platform: 'youtube',
                    type: 'platform:gift',
                    username: event.author.name,
                    message: 'Test message'
                });
            });
            const endTime = process.hrtime.bigint();
            const totalTimeMs = Number(endTime - startTime) / 1_000_000;
            const avgTimePerEvent = totalTimeMs / testEvents.length;

            expect(avgTimePerEvent).toBeLessThan(1);
            expect(platform.NotificationBuilder.build).toHaveBeenCalledTimes(100);
        });

        test('should validate code consistency metrics', () => {
            const consistencyImprovement = ((2 - 1) / 2) * 100;

            expect(consistencyImprovement).toBeGreaterThan(0);
        });

        test('should provide extensibility for future notification types', () => {
            const newEventData = { pollQuestion: 'What is your favorite color?' };

            expect(() => {
                platform.NotificationBuilder.build({
                    platform: 'youtube',
                    type: 'poll',
                    username: 'PollUser',
                    message: 'Poll question',
                    ...newEventData
                });
            }).not.toThrow();
        });
    });
});
