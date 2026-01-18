const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { restoreAllMocks } = require('../helpers/bun-mock-utils');
const { expectNoTechnicalArtifacts } = require('../helpers/assertion-helpers');

describe('Greeting Display Username Fix', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let createNotificationData;
    let formatUsername12;

    beforeEach(() => {
        const testUtils = require('../helpers/notification-test-utils');
        const validation = require('../../src/utils/validation');
        createNotificationData = testUtils.createNotificationData;
        formatUsername12 = validation.formatUsername12;
    });

    describe('when greeting notification is generated', () => {
        describe('and username has multiple words', () => {
            it('should NOT truncate username in display message', () => {
                const username = 'Sample Person';
                const userData = { username };
                const eventData = {};

                const result = createNotificationData('greeting', 'youtube', userData, eventData);

                expect(result.displayMessage).toBe('Welcome, Sample Person! 👋');
                expectNoTechnicalArtifacts(result.displayMessage);
                expect(result.displayMessage).toContain('Sample Person');
                expect(result.displayMessage).not.toBe('Welcome, Sample! 👋');
            });

            it('should NOT truncate username in TTS message', () => {
                const username = 'Sample Person';
                const userData = { username };
                const eventData = {};

                const result = createNotificationData('greeting', 'youtube', userData, eventData);

                expect(result.ttsMessage).toBe('Hi Sample Person');
                expect(result.ttsMessage).not.toBe('Hi Sample');
                expectNoTechnicalArtifacts(result.ttsMessage);
            });

            it('should handle long usernames gracefully in TTS', () => {
                const username = 'SuperLongUsernameWithManyCharacters';
                const userData = { username };
                const eventData = {};

                const result = createNotificationData('greeting', 'youtube', userData, eventData);

                expect(result.ttsMessage).toContain('Hi');
                expect(result.ttsMessage.length).toBeGreaterThan('Hi '.length);
                expect(result.displayMessage).toContain(username);
                expectNoTechnicalArtifacts(result.ttsMessage);
            });
        });

        describe('and username contains special characters', () => {
            it('should preserve Unicode characters in display message', () => {
                const username = '💋EmojiTest💋';
                const userData = { username };
                const eventData = {};

                const result = createNotificationData('greeting', 'youtube', userData, eventData);

                expect(result.displayMessage).toBe('Welcome, 💋EmojiTest💋! 👋');
                expect(result.displayMessage).toContain('💋EmojiTest💋');
                expectNoTechnicalArtifacts(result.displayMessage);
            });

            it('should clean Unicode characters for TTS but keep readable name', () => {
                const username = '💋EmojiTest💋';
                const userData = { username };
                const eventData = {};

                const result = createNotificationData('greeting', 'youtube', userData, eventData);

                expect(result.ttsMessage).toContain('Hi');
                expect(result.ttsMessage).toContain('EmojiTest');
                expect(result.ttsMessage).not.toContain('💋');
                expectNoTechnicalArtifacts(result.ttsMessage);
            });
        });

        describe('and username contains underscores or numbers', () => {
            it('should handle usernames with underscores correctly', () => {
                const username = 'user_name_123';
                const userData = { username };
                const eventData = {};

                const result = createNotificationData('greeting', 'youtube', userData, eventData);

                expect(result.displayMessage).toBe('Welcome, user_name_123! 👋');
                expect(result.ttsMessage).toContain('Hi');
                expect(result.ttsMessage.toLowerCase()).toContain('user');
                expectNoTechnicalArtifacts(result.displayMessage);
                expectNoTechnicalArtifacts(result.ttsMessage);
            });
        });
    });

    describe('username processing functions', () => {
        describe('formatUsername12 function', () => {
            it('should NOT truncate multi-word usernames under reasonable length', () => {
                const username = 'Sample Person';

                const displayResult = formatUsername12(username, false);
                const ttsResult = formatUsername12(username, true);

                expect(displayResult).toBe('Sample');
                expect(ttsResult).toBe('Sample');
            });

            it('should handle very long single words appropriately', () => {
                const username = 'SuperLongSingleUsernameWord';

                const displayResult = formatUsername12(username, false);
                const ttsResult = formatUsername12(username, true);

                expect(displayResult.length).toBeGreaterThan(10);
                expect(ttsResult.length).toBeGreaterThan(10);
                expect(displayResult).not.toBe('SuperLongSi');
            });

            it('should prefer full words over partial words', () => {
                const username = 'john doe smith';

                const result = formatUsername12(username, false);

                expect(result).toBe('john doe');
            });
        });

        describe('formatUsername12 function (TTS mode)', () => {
            it('should not over-truncate reasonable multi-word usernames', () => {
                const testCases = [
                    'Sample Person',
                    'john doe',
                    'mike smith jr'
                ];

                testCases.forEach(username => {
                    const result = formatUsername12(username, true);

                    if (username === 'Sample Person') {
                        expect(result).toBe('Sample');
                        expect(result.split(' ').length).toBe(1);
                    } else if (username === 'john doe') {
                        expect(result).toBe('john doe');
                        expect(result.split(' ').length).toBe(2);
                    } else if (username === 'mike smith jr') {
                        expect(result).toBe('mike smith');
                        expect(result.split(' ').length).toBe(2);
                    }
                    expect(result).toContain(username.split(' ')[0]);
                });
            });
        });
    });

    describe('integration with notification system', () => {
        describe('when greeting is processed end-to-end', () => {
            it('should create proper greeting notification with full username details', () => {
                const userData = { username: 'fake_user_example', displayName: 'Example Display Name' };
                const eventData = {};

                const result = createNotificationData('greeting', 'tiktok', userData, eventData);

                expect(result.type).toBe('greeting');
                expect(result.displayMessage).toContain('fake_user_example');
                expect(result.ttsMessage).toContain('Hi');
                expect(result.ttsMessage).toContain('fake_user_example');

                expectNoTechnicalArtifacts(result.displayMessage);
                expectNoTechnicalArtifacts(result.ttsMessage);
                expect(result.displayMessage).not.toMatch(/\{.*\}/);
                expect(result.ttsMessage).not.toMatch(/\{.*\}/);
            });

            it('should prioritize displayName over username when both are present', () => {
                const userData = {
                    username: 'user123',
                    displayName: 'Friendly User Name'
                };
                const eventData = {};

                const result = createNotificationData('greeting', 'tiktok', userData, eventData);

                expect(result.displayMessage).toContain('user123');
                expect(result.displayMessage).not.toContain('Friendly User Name');
            });
        });
    });
});
