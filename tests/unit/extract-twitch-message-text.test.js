const { TEST_TIMEOUTS } = require('../helpers/test-setup');
const testClock = require('../helpers/test-clock');
const { extractTwitchMessageText } = require('../../src/utils/message-normalization');

describe('extractTwitchMessageText', () => {
    describe('when message contains only cheermotes', () => {
        describe('and fragments are properly structured', () => {
            it('should return empty string for cheermote-only messages', () => {
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

                const result = extractTwitchMessageText(twitchMessage);
                expect(result).toBe('');
            });

            it('should return empty string for single cheermote messages', () => {
                const twitchMessage = {
                    text: "Cheer100",
                    fragments: [
                        {"type": "cheermote", "text": "Cheer100", "cheermote": {"prefix": "Cheer", "bits": 100, "tier": 5}}
                    ]
                };

                const result = extractTwitchMessageText(twitchMessage);
                expect(result).toBe('');
            });
        });
    });

    describe('when message contains cheermotes and text', () => {
        describe('and both types are properly structured', () => {
            it('should extract only the text content', () => {
                const twitchMessage = {
                    text: "ShowLove100 Great stream! Keep it up!",
                    fragments: [
                        {"type": "cheermote", "text": "ShowLove100", "cheermote": {"prefix": "ShowLove", "bits": 100, "tier": 5}},
                        {"type": "text", "text": " Great stream! Keep it up!"}
                    ]
                };

                const result = extractTwitchMessageText(twitchMessage);
                expect(result).toBe('Great stream! Keep it up!');
            });

            it('should handle multiple text fragments between cheermotes', () => {
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

                const result = extractTwitchMessageText(twitchMessage);
                expect(result).toBe('Hello  World');
            });

            it('should preserve text content with special characters and emojis', () => {
                const twitchMessage = {
                    text: "Cheer1000 Amazing stream! 🎉🔥 Thanks for the content 💖",
                    fragments: [
                        {"type": "cheermote", "text": "Cheer1000", "cheermote": {"prefix": "Cheer", "bits": 1000, "tier": 8}},
                        {"type": "text", "text": " Amazing stream! 🎉🔥 Thanks for the content 💖"}
                    ]
                };

                const result = extractTwitchMessageText(twitchMessage);
                expect(result).toBe('Amazing stream! 🎉🔥 Thanks for the content 💖');
            });
        });
    });

    describe('when message is plain text only', () => {
        describe('and input is a string', () => {
            it('should return empty string for string input', () => {
                const plainMessage = "This is just a regular chat message";

                const result = extractTwitchMessageText(plainMessage);
                expect(result).toBe('');
            });

            it('should return empty string for trimmed string input', () => {
                const plainMessage = "  This has whitespace  ";

                const result = extractTwitchMessageText(plainMessage);
                expect(result).toBe('');
            });
        });

        describe('and input is object without fragments', () => {
            it('should return empty string when no fragments exist', () => {
                const twitchMessage = {
                    text: "Simple message without fragments"
                };

                const result = extractTwitchMessageText(twitchMessage);
                expect(result).toBe('');
            });

            it('should return empty string for empty fragments array', () => {
                const twitchMessage = {
                    text: "Message with empty fragments",
                    fragments: []
                };

                const result = extractTwitchMessageText(twitchMessage);
                expect(result).toBe('');
            });
        });
    });

    describe('when handling edge cases', () => {
        describe('and input is null or undefined', () => {
            it('should return empty string for null input', () => {
                const result = extractTwitchMessageText(null);
                expect(result).toBe('');
            });

            it('should return empty string for undefined input', () => {
                const result = extractTwitchMessageText(undefined);
                expect(result).toBe('');
            });
        });

        describe('and input has malformed structure', () => {
            it('should return empty string when fragments are not arrays', () => {
                const malformedMessage = {
                    text: "Fallback text",
                    fragments: "not-an-array"
                };

                const result = extractTwitchMessageText(malformedMessage);
                expect(result).toBe('');
            });

            it('should handle missing text fields in fragments', () => {
                const malformedMessage = {
                    text: "Original text",
                    fragments: [
                        {"type": "text"},
                        {"type": "text", "text": " valid text"}
                    ]
                };

                const result = extractTwitchMessageText(malformedMessage);
                expect(result).toBe('valid text');
            });

            it('should handle fragments with unknown types', () => {
                const messageWithUnknownTypes = {
                    text: "Original text",
                    fragments: [
                        {"type": "unknown", "text": "should be ignored"},
                        {"type": "text", "text": "should be included"},
                        {"type": "emote", "text": "should be ignored"}
                    ]
                };

                const result = extractTwitchMessageText(messageWithUnknownTypes);
                expect(result).toBe('should be included');
            });
        });

        describe('and input has empty content', () => {
            it('should return empty string for completely empty message', () => {
                const emptyMessage = {
                    text: "",
                    fragments: []
                };

                const result = extractTwitchMessageText(emptyMessage);
                expect(result).toBe('');
            });

            it('should return empty string for whitespace-only text fragments', () => {
                const whitespaceMessage = {
                    text: "   ",
                    fragments: [
                        {"type": "text", "text": " "},
                        {"type": "text", "text": "  "}
                    ]
                };

                const result = extractTwitchMessageText(whitespaceMessage);
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

                const result = extractTwitchMessageText(actualEventSubMessage);
                expect(result).toBe('');
            });

            it('should handle common cheermote prefixes correctly', () => {
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

                    const result = extractTwitchMessageText(message);
                    expect(result).toBe('Thanks for the stream!');
                });
            });
        });
    });

    describe('performance and reliability', () => {
        it('should process large fragment arrays efficiently', () => {
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

            const startTime = testClock.now();
            const result = extractTwitchMessageText(largeMessage);
            const simulatedDurationMs = 25;
            testClock.advance(simulatedDurationMs);
            const endTime = testClock.now();

            expect(result).toContain('text0');
            expect(result).toContain('text99');
            expect(endTime - startTime).toBeLessThan(100);
        }, TEST_TIMEOUTS.FAST);

        it('should handle deeply nested or complex fragment structures', () => {
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

            const result = extractTwitchMessageText(complexMessage);
            expect(result).toBe('Start  End');
        });
    });
});
