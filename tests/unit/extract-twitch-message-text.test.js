
const { 
    initializeTestLogging,
    createTestUser, 
    TEST_TIMEOUTS 
} = require('../helpers/test-setup');

const { 
    createMockLogger
} = require('../helpers/mock-factories');

const { 
    setupAutomatedCleanup 
} = require('../helpers/mock-lifecycle');
const testClock = require('../helpers/test-clock');

// Initialize logging FIRST
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

const { extractTwitchMessageText } = require('../../src/utils/message-normalization');

describe('extractTwitchMessageText', () => {
    describe('when message contains only cheermotes', () => {
        describe('and fragments are properly structured', () => {
            it('should return empty string for cheermote-only messages', () => {
                // Arrange
                const twitchMessage = {
                    text: "uni1 uni1 uni1 uni1 uni1 uni1 uni1 uni1",
                    fragments: [
                        {"type": "cheermote", "text": "uni1", "cheermote": {"prefix": "uni", "bits": 1, "tier": 1}},
                        {"type": "text", "text": " "},
                        {"type": "cheermote", "text": "uni1", "cheermote": {"prefix": "uni", "bits": 1, "tier": 1}},
                        {"type": "text", "text": " "},
                        {"type": "cheermote", "text": "uni1", "cheermote": {"prefix": "uni", "bits": 1, "tier": 1}},
                        {"type": "text", "text": " "},
                        {"type": "cheermote", "text": "uni1", "cheermote": {"prefix": "uni", "bits": 1, "tier": 1}},
                        {"type": "text", "text": " "},
                        {"type": "cheermote", "text": "uni1", "cheermote": {"prefix": "uni", "bits": 1, "tier": 1}},
                        {"type": "text", "text": " "},
                        {"type": "cheermote", "text": "uni1", "cheermote": {"prefix": "uni", "bits": 1, "tier": 1}},
                        {"type": "text", "text": " "},
                        {"type": "cheermote", "text": "uni1", "cheermote": {"prefix": "uni", "bits": 1, "tier": 1}},
                        {"type": "text", "text": " "},
                        {"type": "cheermote", "text": "uni1", "cheermote": {"prefix": "uni", "bits": 1, "tier": 1}}
                    ]
                };

                // Act
                const result = extractTwitchMessageText(twitchMessage);

                // Assert
                expect(result).toBe('');
            });

            it('should return empty string for single cheermote messages', () => {
                // Arrange
                const twitchMessage = {
                    text: "Cheer100",
                    fragments: [
                        {"type": "cheermote", "text": "Cheer100", "cheermote": {"prefix": "Cheer", "bits": 100, "tier": 5}}
                    ]
                };

                // Act
                const result = extractTwitchMessageText(twitchMessage);

                // Assert
                expect(result).toBe('');
            });
        });
    });

    describe('when message contains cheermotes and text', () => {
        describe('and both types are properly structured', () => {
            it('should extract only the text content', () => {
                // Arrange
                const twitchMessage = {
                    text: "ShowLove100 Great stream! Keep it up!",
                    fragments: [
                        {"type": "cheermote", "text": "ShowLove100", "cheermote": {"prefix": "ShowLove", "bits": 100, "tier": 5}},
                        {"type": "text", "text": " Great stream! Keep it up!"}
                    ]
                };

                // Act
                const result = extractTwitchMessageText(twitchMessage);

                // Assert
                expect(result).toBe('Great stream! Keep it up!');
            });

            it('should handle multiple text fragments between cheermotes', () => {
                // Arrange
                const twitchMessage = {
                    text: "Cheer50 Hello Cheer50 World Cheer50",
                    fragments: [
                        {"type": "cheermote", "text": "Cheer50", "cheermote": {"prefix": "Cheer", "bits": 50, "tier": 3}},
                        {"type": "text", "text": " Hello "},
                        {"type": "cheermote", "text": "Cheer50", "cheermote": {"prefix": "Cheer", "bits": 50, "tier": 3}},
                        {"type": "text", "text": " World "},
                        {"type": "cheermote", "text": "Cheer50", "cheermote": {"prefix": "Cheer", "bits": 50, "tier": 3}}
                    ]
                };

                // Act
                const result = extractTwitchMessageText(twitchMessage);

                // Assert
                expect(result).toBe('Hello  World');
            });

            it('should preserve text content with special characters and emojis', () => {
                // Arrange
                const twitchMessage = {
                    text: "Cheer1000 Amazing stream! 🎉🔥 Thanks for the content 💖",
                    fragments: [
                        {"type": "cheermote", "text": "Cheer1000", "cheermote": {"prefix": "Cheer", "bits": 1000, "tier": 8}},
                        {"type": "text", "text": " Amazing stream! 🎉🔥 Thanks for the content 💖"}
                    ]
                };

                // Act
                const result = extractTwitchMessageText(twitchMessage);

                // Assert
                expect(result).toBe('Amazing stream! 🎉🔥 Thanks for the content 💖');
            });
        });
    });

    describe('when message is plain text only', () => {
        describe('and input is a string', () => {
            it('should return empty string for string input', () => {
                // Arrange
                const plainMessage = "This is just a regular chat message";

                // Act
                const result = extractTwitchMessageText(plainMessage);

                // Assert
                expect(result).toBe('');
            });

            it('should return empty string for trimmed string input', () => {
                // Arrange
                const plainMessage = "  This has whitespace  ";

                // Act
                const result = extractTwitchMessageText(plainMessage);

                // Assert
                expect(result).toBe('');
            });
        });

        describe('and input is object without fragments', () => {
            it('should return empty string when no fragments exist', () => {
                // Arrange
                const twitchMessage = {
                    text: "Simple message without fragments"
                };

                // Act
                const result = extractTwitchMessageText(twitchMessage);

                // Assert
                expect(result).toBe('');
            });

            it('should return empty string for empty fragments array', () => {
                // Arrange
                const twitchMessage = {
                    text: "Message with empty fragments",
                    fragments: []
                };

                // Act
                const result = extractTwitchMessageText(twitchMessage);

                // Assert
                expect(result).toBe('');
            });
        });
    });

    describe('when handling edge cases', () => {
        describe('and input is null or undefined', () => {
            it('should return empty string for null input', () => {
                // Act
                const result = extractTwitchMessageText(null);

                // Assert
                expect(result).toBe('');
            });

            it('should return empty string for undefined input', () => {
                // Act
                const result = extractTwitchMessageText(undefined);

                // Assert
                expect(result).toBe('');
            });
        });

        describe('and input has malformed structure', () => {
            it('should return empty string when fragments are not arrays', () => {
                // Arrange
                const malformedMessage = {
                    text: "Fallback text",
                    fragments: "not-an-array"
                };

                // Act
                const result = extractTwitchMessageText(malformedMessage);

                // Assert
                expect(result).toBe('');
            });

            it('should handle missing text fields in fragments', () => {
                // Arrange
                const malformedMessage = {
                    text: "Original text",
                    fragments: [
                        {"type": "text"}, // Missing text field
                        {"type": "text", "text": " valid text"}
                    ]
                };

                // Act
                const result = extractTwitchMessageText(malformedMessage);

                // Assert
                expect(result).toBe('valid text');
            });

            it('should handle fragments with unknown types', () => {
                // Arrange
                const messageWithUnknownTypes = {
                    text: "Original text",
                    fragments: [
                        {"type": "unknown", "text": "should be ignored"},
                        {"type": "text", "text": "should be included"},
                        {"type": "emote", "text": "should be ignored"}
                    ]
                };

                // Act
                const result = extractTwitchMessageText(messageWithUnknownTypes);

                // Assert
                expect(result).toBe('should be included');
            });
        });

        describe('and input has empty content', () => {
            it('should return empty string for completely empty message', () => {
                // Arrange
                const emptyMessage = {
                    text: "",
                    fragments: []
                };

                // Act
                const result = extractTwitchMessageText(emptyMessage);

                // Assert
                expect(result).toBe('');
            });

            it('should return empty string for whitespace-only text fragments', () => {
                // Arrange
                const whitespaceMessage = {
                    text: "   ",
                    fragments: [
                        {"type": "text", "text": " "},
                        {"type": "text", "text": "  "}
                    ]
                };

                // Act
                const result = extractTwitchMessageText(whitespaceMessage);

                // Assert
                expect(result).toBe('');
            });
        });
    });

    describe('when processing real-world EventSub data', () => {
        describe('and data matches official Twitch EventSub format', () => {
            it('should handle the exact structure from debug logs', () => {
                const actualEventSubMessage = {
                    text: "uni1 uni1 uni1 uni1 uni1 uni1 uni1 uni1",
                    fragments: [
                        {"type": "cheermote", "text": "uni1", "cheermote": {"prefix": "uni", "bits": 1, "tier": 1}, "emote": null, "mention": null},
                        {"type": "text", "text": " ", "cheermote": null, "emote": null, "mention": null},
                        {"type": "cheermote", "text": "uni1", "cheermote": {"prefix": "uni", "bits": 1, "tier": 1}, "emote": null, "mention": null},
                        {"type": "text", "text": " ", "cheermote": null, "emote": null, "mention": null},
                        {"type": "cheermote", "text": "uni1", "cheermote": {"prefix": "uni", "bits": 1, "tier": 1}, "emote": null, "mention": null},
                        {"type": "text", "text": " ", "cheermote": null, "emote": null, "mention": null},
                        {"type": "cheermote", "text": "uni1", "cheermote": {"prefix": "uni", "bits": 1, "tier": 1}, "emote": null, "mention": null},
                        {"type": "text", "text": " ", "cheermote": null, "emote": null, "mention": null},
                        {"type": "cheermote", "text": "uni1", "cheermote": {"prefix": "uni", "bits": 1, "tier": 1}, "emote": null, "mention": null},
                        {"type": "text", "text": " ", "cheermote": null, "emote": null, "mention": null},
                        {"type": "cheermote", "text": "uni1", "cheermote": {"prefix": "uni", "bits": 1, "tier": 1}, "emote": null, "mention": null},
                        {"type": "text", "text": " ", "cheermote": null, "emote": null, "mention": null},
                        {"type": "cheermote", "text": "uni1", "cheermote": {"prefix": "uni", "bits": 1, "tier": 1}, "emote": null, "mention": null},
                        {"type": "text", "text": " ", "cheermote": null, "emote": null, "mention": null},
                        {"type": "cheermote", "text": "uni1", "cheermote": {"prefix": "uni", "bits": 1, "tier": 1}, "emote": null, "mention": null}
                    ]
                };

                // Act
                const result = extractTwitchMessageText(actualEventSubMessage);

                // Assert
                expect(result).toBe(''); // Should be empty since only spaces between cheermotes
            });

            it('should handle common cheermote prefixes correctly', () => {
                // Arrange
                const commonCheermotes = [
                    'Cheer', 'uni', 'ShowLove', 'Party', 'SeemsGood', 
                    'Pride', 'Kappa', 'FrankerZ', 'SwiftRage', 'Kreygasm'
                ];

                commonCheermotes.forEach(prefix => {
                    const message = {
                        text: `${prefix}100 Thanks for the stream!`,
                        fragments: [
                            {"type": "cheermote", "text": `${prefix}100`, "cheermote": {"prefix": prefix, "bits": 100, "tier": 5}},
                            {"type": "text", "text": " Thanks for the stream!"}
                        ]
                    };

                    // Act
                    const result = extractTwitchMessageText(message);

                    // Assert
                    expect(result).toBe('Thanks for the stream!');
                });
            });
        });
    });

    describe('performance and reliability', () => {
        it('should process large fragment arrays efficiently', () => {
            // Arrange - Create a message with many fragments
            const fragments = [];
            for (let i = 0; i < 100; i++) {
                fragments.push(
                    {"type": "cheermote", "text": "Cheer1", "cheermote": {"prefix": "Cheer", "bits": 1, "tier": 1}},
                    {"type": "text", "text": ` text${i} `}
                );
            }

            const largeMessage = {
                text: "Large message with many fragments",
                fragments: fragments
            };

            // Act
            const startTime = testClock.now();
            const result = extractTwitchMessageText(largeMessage);
            const simulatedDurationMs = 25;
            testClock.advance(simulatedDurationMs);
            const endTime = testClock.now();

            // Assert
            expect(result).toContain('text0');
            expect(result).toContain('text99');
            expect(endTime - startTime).toBeLessThan(100); // Should complete within 100ms
        }, TEST_TIMEOUTS.FAST);

        it('should handle deeply nested or complex fragment structures', () => {
            // Arrange
            const complexMessage = {
                text: "Complex message",
                fragments: [
                    {
                        "type": "text", 
                        "text": "Start ",
                        "extra_data": { "nested": { "deeply": "ignored" } }
                    },
                    {
                        "type": "cheermote", 
                        "text": "Cheer500",
                        "cheermote": { "prefix": "Cheer", "bits": 500, "tier": 7 },
                        "metadata": { "lots": "of", "extra": "fields" }
                    },
                    {
                        "type": "text", 
                        "text": " End"
                    }
                ]
            };

            // Act
            const result = extractTwitchMessageText(complexMessage);

            // Assert
            expect(result).toBe('Start  End');
        });
    });
});
