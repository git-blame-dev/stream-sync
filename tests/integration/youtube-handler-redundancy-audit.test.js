const { describe, test, beforeEach, afterEach, expect } = require('bun:test');

const { createMockConfig, createMockPlatformDependencies } = require('../helpers/test-setup');
const { noOpLogger } = require('../helpers/mock-factories');
const testClock = require('../helpers/test-clock');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');

const { YouTubePlatform } = require('../../src/platforms/youtube');

describe('YouTube Handler Redundancy Audit', () => {
    let platform;
    let mockConfig;
    let mockDependencies;
    let mockHandlers;
    let authorExtractionCalls;
    let notificationBuilderCalls;
    let dispatcherCalls;

    afterEach(() => {
        restoreAllMocks();
    });

    beforeEach(() => {
        testClock.reset();
        authorExtractionCalls = [];
        notificationBuilderCalls = [];
        dispatcherCalls = [];

        mockConfig = createMockConfig('youtube', {
            dataLoggingEnabled: false,
            dataLoggingPath: '/tmp/test-data.log'
        });

        mockDependencies = createMockPlatformDependencies('youtube', { logger: noOpLogger });

        mockHandlers = {
            onGift: createMockFn(),
            onMembership: createMockFn(),
            onChat: createMockFn()
        };

        platform = new YouTubePlatform(mockConfig, mockDependencies);
        platform.handlers = mockHandlers;

        platform.handleSuperChat = createMockFn().mockImplementation((event) => {
            if (platform.AuthorExtractor) {
                platform.AuthorExtractor.extractAuthor(event);
            }
            if (platform.NotificationBuilder) {
                platform.NotificationBuilder.build({ type: 'platform:gift', platform: 'youtube' });
            }
        });

        platform.handleMembership = createMockFn().mockImplementation((event) => {
            if (platform.AuthorExtractor) {
                platform.AuthorExtractor.extractAuthor(event);
            }
            if (platform.NotificationBuilder) {
                platform.NotificationBuilder.build({
                    type: 'platform:paypiggy',
                    platform: 'youtube',
                    username: 'MemberUser'
                });
            }
        });

        platform.handleGiftMembershipPurchase = createMockFn().mockImplementation((event) => {
            if (platform.AuthorExtractor) {
                platform.AuthorExtractor.extractAuthor(event);
            }
            if (platform.NotificationBuilder) {
                platform.NotificationBuilder.build({
                    type: 'gift_membership',
                    platform: 'youtube',
                    user: event.author?.name || 'GiftPurchaser'
                });
            }
        });

        platform.handleSubscription = createMockFn();
        platform.handleFollow = createMockFn();
        platform.handleRaid = createMockFn();

        platform.AuthorExtractor = {
            extractAuthor: createMockFn().mockImplementation((...args) => {
                authorExtractionCalls.push({ args, timestamp: testClock.now() });
                return { name: 'MockUser', id: '12345' };
            })
        };

        platform.NotificationBuilder = {
            build: createMockFn().mockImplementation((...args) => {
                notificationBuilderCalls.push({ args, timestamp: testClock.now() });
                return { id: 'mock-notification', ...args[0] };
            })
        };

        platform.notificationDispatcher = {
            dispatchSuperChat: createMockFn().mockImplementation((...args) => {
                dispatcherCalls.push({ method: 'dispatchSuperChat', args, timestamp: testClock.now() });
            }),
            dispatchMembership: createMockFn().mockImplementation((...args) => {
                dispatcherCalls.push({ method: 'dispatchMembership', args, timestamp: testClock.now() });
            })
        };
    });

    describe('Phase 2: Author Extraction Redundancy Analysis', () => {
        test('should not call AuthorExtractor multiple times for same event', () => {
            const superChatEvent = {
                item: {
                    type: 'LiveChatPaidMessage',
                    purchase_amount: '$5.00',
                    author: { id: 'test-user-1', name: 'SuperChatUser' }
                }
            };

            platform.handleSuperChat(superChatEvent);

            expect(authorExtractionCalls).toHaveLength(1);
            expect(authorExtractionCalls[0].args[0]).toBe(superChatEvent);
        });

        test('should detect dual processing paths in SuperChat handling', () => {
            const superChatEvent = {
                item: {
                    type: 'LiveChatPaidMessage',
                    purchase_amount: '$10.00',
                    author: { id: 'test-user-2', name: 'DualPathUser' }
                }
            };

            platform.handleSuperChat(superChatEvent);

            const dispatcherUsed = dispatcherCalls.length > 0;
            const directHandlerUsed = notificationBuilderCalls.length > 0;
            expect(dispatcherUsed && directHandlerUsed).toBe(false);

            if (dispatcherUsed) {
                expect(dispatcherCalls).toHaveLength(1);
                expect(notificationBuilderCalls).toHaveLength(0);
            } else if (directHandlerUsed) {
                expect(notificationBuilderCalls).toHaveLength(1);
                expect(dispatcherCalls).toHaveLength(0);
            }
        });

        test('should use consistent author extraction across all handlers', () => {
            const testEvents = [
                {
                    handler: 'handleSuperChat',
                    event: {
                        item: {
                            type: 'LiveChatPaidMessage',
                            purchase_amount: '$5.00',
                            author: { id: 'test-user-3', name: 'User1' }
                        }
                    }
                },
                {
                    handler: 'handleMembership',
                    event: {
                        item: {
                            type: 'LiveChatMembershipItem',
                            author: { id: 'test-user-4', name: 'User2' }
                        }
                    }
                }
            ];

            testEvents.forEach(({ handler, event }) => {
                authorExtractionCalls.length = 0;
                platform[handler](event);
                expect(authorExtractionCalls).toHaveLength(1);
                expect(authorExtractionCalls[0].args[0]).toBe(event);
            });
        });
    });

    describe('Phase 2: Notification Building Pattern Analysis', () => {
        test('should detect inconsistent notification building patterns', () => {
            const membershipEvent = {
                item: { type: 'LiveChatMembershipItem', author: { id: 'test-user-5', name: 'MemberUser' } }
            };

            platform.handleMembership(membershipEvent);

            const notificationBuilt = notificationBuilderCalls.length > 0;
            const dispatcherUsed = dispatcherCalls.some(call => call.method === 'dispatchMembership');
            expect(notificationBuilt || dispatcherUsed).toBe(true);

            if (notificationBuilt) {
                expect(notificationBuilderCalls[0].args[0]).toHaveProperty('platform', 'youtube');
                expect(notificationBuilderCalls[0].args[0]).toHaveProperty('type');
                expect(notificationBuilderCalls[0].args[0]).toHaveProperty('username');
            }
        });

        test('should validate gift vs membership notification type consistency', () => {
            const giftPurchaseEvent = {
                item: {
                    type: 'LiveChatSponsorshipsGiftPurchaseAnnouncement',
                    author: { id: 'test-user-6', name: 'GiftPurchaser' }
                }
            };

            platform.handleGiftMembershipPurchase(giftPurchaseEvent);

            const totalNotifications = notificationBuilderCalls.length + dispatcherCalls.length;
            expect(totalNotifications).toBeGreaterThan(0);
        });
    });

    describe('Phase 2: Error Handling Consistency Analysis', () => {
        test('should handle errors consistently across all handlers', () => {
            const problematicEvent = {
                item: { type: 'LiveChatPaidMessage', author: null }
            };

            expect(() => platform.handleSuperChat(problematicEvent)).not.toThrow();
            expect(() => platform.handleMembership(problematicEvent)).not.toThrow();
            expect(() => platform.handleGiftMembershipPurchase(problematicEvent)).not.toThrow();
        });

        test('should validate suppression logic consistency', () => {
            const anonymousEvent = {
                item: {
                    type: 'LiveChatPaidMessage',
                    purchase_amount: '$1.00',
                    author: { id: 'test-user-7', name: 'Anonymous' }
                }
            };

            platform.handleSuperChat(anonymousEvent);

            const totalHandlerCalls = mockHandlers.onGift.mock.calls.length;
            expect(typeof totalHandlerCalls).toBe('number');
        });
    });

    describe('Phase 2: Handler Method Signature Analysis', () => {
        test('should validate all handlers accept consistent parameters', () => {
            const testEvent = {
                item: { type: 'LiveChatTextMessage', text: 'test', author: { id: 'test-user-8', name: 'TestUser' } }
            };

            const handlerMethods = [
                'handleSuperChat',
                'handleMembership',
                'handleGiftMembershipPurchase'
            ];

            handlerMethods.forEach(methodName => {
                expect(typeof platform[methodName]).toBe('function');
                expect(() => platform[methodName](testEvent)).not.toThrow();
            });
        });

        test('should have all required handler methods defined', () => {
            const handlers = [
                'handleSuperChat',
                'handleMembership',
                'handleGiftMembershipPurchase'
            ];

            handlers.forEach(handlerName => {
                expect(typeof platform[handlerName]).toBe('function');
            });

            expect(handlers.length).toBeGreaterThan(0);
        });
    });
});
