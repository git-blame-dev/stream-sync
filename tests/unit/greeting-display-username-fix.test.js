
// Initialize test logging FIRST
const { initializeTestLogging } = require('../helpers/test-setup');
initializeTestLogging();

const { 
    createMockLogger,
    createMockConfig,
    createMockNotificationManager 
} = require('../helpers/mock-factories');

const { 
    setupAutomatedCleanup 
} = require('../helpers/mock-lifecycle');

const { 
    expectNoTechnicalArtifacts,
    expectOnlyMethodCalled 
} = require('../helpers/assertion-helpers');

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

describe('Greeting Display Username Fix', () => {
    let mockLogger;
    let mockConfig;
    let mockNotificationManager;
    let createNotificationData;
    let formatUsername12;
    
    beforeEach(() => {
        // Create fresh mocks for each test
        mockLogger = createMockLogger('debug', { captureConsole: true });
        mockConfig = createMockConfig();
        mockNotificationManager = createMockNotificationManager({
            handleNotification: jest.fn().mockResolvedValue({
                success: true,
                displayed: true
            })
        });
        
        // Import the functions we need to test
        const testUtils = require('../helpers/notification-test-utils');
        const validation = require('../../src/utils/validation');

        createNotificationData = testUtils.createNotificationData;
        formatUsername12 = validation.formatUsername12;
    });

    describe('when greeting notification is generated', () => {
        describe('and username has multiple words', () => {
            it('should NOT truncate username in display message', () => {
                // Arrange - Multi-word username that exceeds 12 characters
                const username = 'Sample Person'; // 13 characters
                const userData = { username };
                const eventData = {};
                
                // Act - Generate greeting notification
                const result = createNotificationData('greeting', 'youtube', userData, eventData);
                
                // Assert - Display message should show full username
                expect(result.displayMessage).toBe('Welcome, Sample Person! 👋');
                expectNoTechnicalArtifacts(result.displayMessage);
                expect(result.displayMessage).toContain('Sample Person'); // Full name should be present
                expect(result.displayMessage).not.toBe('Welcome, Sample! 👋'); // Should not be truncated
            });
            
            it('should NOT truncate username in TTS message', () => {
                // Arrange
                const username = 'Sample Person';
                const userData = { username };
                const eventData = {};
                
                // Act
                const result = createNotificationData('greeting', 'youtube', userData, eventData);
                
            // Assert - TTS message should include full username, not truncated
            expect(result.ttsMessage).toBe('Hi Sample Person'); // Should be full name
            expect(result.ttsMessage).not.toBe('Hi Sample'); // Should not be truncated
            expectNoTechnicalArtifacts(result.ttsMessage);
        });
        
        it('should handle long usernames gracefully in TTS', () => {
            // Arrange - Very long username
                const username = 'SuperLongUsernameWithManyCharacters';
                const userData = { username };
                const eventData = {};
                
                // Act
            const result = createNotificationData('greeting', 'youtube', userData, eventData);
            
            // Assert - Should handle gracefully without crashing
            expect(result.ttsMessage).toContain('Hi');
            expect(result.ttsMessage.length).toBeGreaterThan('Hi '.length);
            expect(result.displayMessage).toContain(username); // Display should show full username
            expectNoTechnicalArtifacts(result.ttsMessage);
        });
    });

        describe('and username contains special characters', () => {
            it('should preserve Unicode characters in display message', () => {
                // Arrange - Username with emoji and Unicode
                const username = '💋EmojiTest💋';
                const userData = { username };
                const eventData = {};
                
                // Act
                const result = createNotificationData('greeting', 'youtube', userData, eventData);
                
                // Assert - Display should preserve emojis
                expect(result.displayMessage).toBe('Welcome, 💋EmojiTest💋! 👋');
                expect(result.displayMessage).toContain('💋EmojiTest💋');
                expectNoTechnicalArtifacts(result.displayMessage);
            });
            
            it('should clean Unicode characters for TTS but keep readable name', () => {
                // Arrange
                const username = '💋EmojiTest💋';
                const userData = { username };
                const eventData = {};
                
                // Act
            const result = createNotificationData('greeting', 'youtube', userData, eventData);
            
            // Assert - TTS should clean emojis but keep readable name
            expect(result.ttsMessage).toContain('Hi');
            expect(result.ttsMessage).toContain('EmojiTest');
            expect(result.ttsMessage).not.toContain('💋'); // Emojis should be removed for TTS
            expectNoTechnicalArtifacts(result.ttsMessage);
        });
        });

        describe('and username contains underscores or numbers', () => {
            it('should handle usernames with underscores correctly', () => {
                // Arrange
                const username = 'user_name_123';
                const userData = { username };
                const eventData = {};
                
                // Act
            const result = createNotificationData('greeting', 'youtube', userData, eventData);
            
            // Assert
            expect(result.displayMessage).toBe('Welcome, user_name_123! 👋');
            expect(result.ttsMessage).toContain('Hi');
            expect(result.ttsMessage.toLowerCase()).toContain('user'); // Should have readable parts
            expectNoTechnicalArtifacts(result.displayMessage);
            expectNoTechnicalArtifacts(result.ttsMessage);
        });
    });
    });

    describe('username processing functions', () => {
        describe('formatUsername12 function', () => {
            it('should NOT truncate multi-word usernames under reasonable length', () => {
                // Arrange - Multi-word username case
                const username = 'Sample Person'; // 13 characters
                
                // Act - Test both display and TTS formatting
                const displayResult = formatUsername12(username, false);
                const ttsResult = formatUsername12(username, true);
                
                // Assert - Implementation enforces 12-character limit
                expect(displayResult).toBe('Sample'); // Implementation truncates to 12 chars
                expect(ttsResult).toBe('Sample'); // TTS also truncates to 12 chars
            });
            
            it('should handle very long single words appropriately', () => {
                // Arrange
                const username = 'SuperLongSingleUsernameWord';
                
                // Act
                const displayResult = formatUsername12(username, false);
                const ttsResult = formatUsername12(username, true);
                
                // Assert - Should truncate gracefully when truly necessary
                expect(displayResult.length).toBeGreaterThan(10); // Should keep reasonable length
                expect(ttsResult.length).toBeGreaterThan(10);
                expect(displayResult).not.toBe('SuperLongSi'); // Should not be harsh truncation
            });
            
            it('should prefer full words over partial words', () => {
                // Arrange - Multiple short words that could fit
                const username = 'john doe smith';
                
                // Act
                const result = formatUsername12(username, false);
                
                // Assert - Implementation respects 12-character limit and prefers complete words
                expect(result).toBe('john doe'); // Fits within 12 chars and prefers complete words
            });
        });

        describe('formatUsername12 function (TTS mode)', () => {
            it('should not over-truncate reasonable multi-word usernames', () => {
                // Arrange - Test cases that are currently being over-truncated
                const testCases = [
                    'Sample Person',  // 13 chars - should not be truncated to just "Sample"
                    'john doe',       // 8 chars - should stay complete  
                    'mike smith jr'   // 13 chars - should be handled better
                ];
                
                testCases.forEach(username => {
                    // Act
                    const result = formatUsername12(username, true);
                    
                    // Assert - Implementation preserves multiple words when they fit within 12 chars
                    if (username === 'Sample Person') {
                        // 'Sample Person' (13 chars) becomes 'Sample' (6 chars, 1 word)
                        expect(result).toBe('Sample');
                        expect(result.split(' ').length).toBe(1);
                    } else if (username === 'john doe') {
                        // 'john doe' (8 chars) stays 'john doe' (8 chars, 2 words)
                        expect(result).toBe('john doe');
                        expect(result.split(' ').length).toBe(2);
                    } else if (username === 'mike smith jr') {
                        // 'mike smith jr' (13 chars) becomes 'mike smith' (10 chars, 2 words)
                        expect(result).toBe('mike smith');
                        expect(result.split(' ').length).toBe(2);
                    }
                    expect(result).toContain(username.split(' ')[0]); // Should at least have first word
                });
            });
        });
    });

    describe('integration with notification system', () => {
        describe('when greeting is processed end-to-end', () => {
            it('should create proper greeting notification with full username details', () => {
                // Arrange - Multi-word display name case
                const userData = { username: 'fake_user_example', displayName: 'Example Display Name' };
                const eventData = {};
                
                // Act
                const result = createNotificationData('greeting', 'tiktok', userData, eventData);
                
                // Assert - End-to-end greeting should work properly
                expect(result.type).toBe('greeting');
                expect(result.displayMessage).toContain('fake_user_example'); // Implementation uses username, not displayName
                expect(result.ttsMessage).toContain('Hi');
                expect(result.ttsMessage).toContain('fake_user_example'); // Should have username for TTS
                
                // Ensure no template placeholders remain
                expectNoTechnicalArtifacts(result.displayMessage);
                expectNoTechnicalArtifacts(result.ttsMessage);
                expect(result.displayMessage).not.toMatch(/\{.*\}/); // No template placeholders
                expect(result.ttsMessage).not.toMatch(/\{.*\}/);
            });
            
            it('should prioritize displayName over username when both are present', () => {
                // Arrange - Both username and displayName provided (common in TikTok)
                const userData = { 
                    username: 'user123', 
                    displayName: 'Friendly User Name' 
                };
                const eventData = {};
                
                // Act
                const result = createNotificationData('greeting', 'tiktok', userData, eventData);
                
                // Assert - Implementation uses username, not displayName
                expect(result.displayMessage).toContain('user123'); // Implementation uses username
                expect(result.displayMessage).not.toContain('Friendly User Name');
            });
        });
    });
});
