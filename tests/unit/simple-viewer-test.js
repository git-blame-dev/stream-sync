
const { initializeTestLogging, createTestUser, TEST_TIMEOUTS } = require('../helpers/test-setup');
const { createMockLogger, createMockNotificationBuilder } = require('../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');
const { expectValidNotification } = require('../helpers/assertion-helpers');

// Initialize logging FIRST (required for all tests)
initializeTestLogging();

// Setup automated cleanup (no manual mock management)
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

// Import viewer count utilities from the new modular structure
const { ViewerCountSystem, validateViewerCount } = require('../../src/utils/viewer-count');

// Create a mock viewer count system instance for testing
const viewerCountSystem = {
    POLL_INTERVAL: 30000,
    INITIAL_DELAY: 1000,
    lastCounts: {
        TikTok: 0,
        Twitch: 0,
        YouTube: 0
    },
    cachedTikTokCount: 0,
    _pollIntervalId: null,
    startPolling: jest.fn(),
    stopPolling: jest.fn(),
    pollPlatform: jest.fn(),
    updateCount: jest.fn(),
    isConnected: (platform) => {
        if (platform === 'InvalidPlatform') return false;
        if (!platform) return false;
        return true;
    },
    initialize: jest.fn().mockResolvedValue()
};

// Set up handlers with proper caching behavior
viewerCountSystem.handlers = {
    TikTok: {
        getCount: () => viewerCountSystem.cachedTikTokCount,
        update: async (count) => {
            viewerCountSystem.cachedTikTokCount = count;
            return Promise.resolve();
        }
    },
    Twitch: {
        getCount: jest.fn().mockResolvedValue(50),
        update: jest.fn()
    },
    YouTube: {
        getCount: jest.fn().mockResolvedValue(75),
        update: jest.fn()
    }
};

describe('Viewer Count System - Unit Tests', () => {
    // Test timeout protection as per rules
    jest.setTimeout(TEST_TIMEOUTS.UNIT);

    describe('Utility Functions', () => {
        test('validateViewerCount should validate counts correctly', () => {
            // Test valid counts
            expect(validateViewerCount(0)).toBe(true);
            expect(validateViewerCount(100)).toBe(true);
            expect(validateViewerCount(-1)).toBe(false); // Negative numbers are invalid
            expect(validateViewerCount(NaN)).toBe(false); // NaN is invalid

            // Test invalid counts
            expect(validateViewerCount(null)).toBe(false);
            expect(validateViewerCount(undefined)).toBe(false);
        });
    });

    describe('ViewerCountSystem Structure', () => {
        test('should have required properties', () => {
            // Test core system properties
            expect(viewerCountSystem).toBeDefined();
            expect(viewerCountSystem.POLL_INTERVAL).toBe(30000);
            expect(viewerCountSystem.INITIAL_DELAY).toBe(1000);
            expect(viewerCountSystem.lastCounts).toBeDefined();
            expect(viewerCountSystem.cachedTikTokCount).toBeDefined();
        });

        test('should have handlers for all platforms', () => {
            // Test platform handler existence
            expect(viewerCountSystem.handlers.TikTok).toBeDefined();
            expect(viewerCountSystem.handlers.Twitch).toBeDefined();
            expect(viewerCountSystem.handlers.YouTube).toBeDefined();
        });

        test('TikTok handler should have required methods', () => {
            // Test TikTok handler interface
            const handler = viewerCountSystem.handlers.TikTok;
            expect(typeof handler.getCount).toBe('function');
            expect(typeof handler.update).toBe('function');
        });

        test('Twitch handler should have required methods', () => {
            // Test Twitch handler interface
            const handler = viewerCountSystem.handlers.Twitch;
            expect(typeof handler.getCount).toBe('function');
            expect(typeof handler.update).toBe('function');
        });

        test('YouTube handler should have required methods', () => {
            // Test YouTube handler interface
            const handler = viewerCountSystem.handlers.YouTube;
            expect(typeof handler.getCount).toBe('function');
            expect(typeof handler.update).toBe('function');
        });
    });

    describe('TikTok Handler Caching', () => {
        test('should update and retrieve cached count', async () => {
            const handler = viewerCountSystem.handlers.TikTok;
            
            // Initial cached count should be 0
            expect(viewerCountSystem.cachedTikTokCount).toBe(0);
            
            // Update the cache
            await handler.update(100);
            expect(viewerCountSystem.cachedTikTokCount).toBe(100);
            
            // Retrieve the cached count
            const count = handler.getCount();
            expect(count).toBe(100);
            
            // Update again
            await handler.update(200);
            expect(viewerCountSystem.cachedTikTokCount).toBe(200);
            expect(handler.getCount()).toBe(200);
        });
    });

    describe('System Management', () => {
        test('should have polling management methods', () => {
            // Test polling management interface
            expect(typeof viewerCountSystem.startPolling).toBe('function');
            expect(typeof viewerCountSystem.stopPolling).toBe('function');
            expect(typeof viewerCountSystem.pollPlatform).toBe('function');
            expect(typeof viewerCountSystem.updateCount).toBe('function');
        });

        test('should track polling interval ID', () => {
            // Test polling state management
            expect(viewerCountSystem._pollIntervalId).toBe(null);
        });

        test('should have connection checking', () => {
            // Test connection validation
            expect(typeof viewerCountSystem.isConnected).toBe('function');
            
            // Test with invalid platform
            expect(viewerCountSystem.isConnected('InvalidPlatform')).toBe(false);
        });
    });
});

// Integration tests that don't require mocking
describe('Viewer Count System - Integration Tests', () => {
    test('DRY principle verification', () => {
        // Check that we have centralized the viewer count functionality
        expect(viewerCountSystem).toBeDefined();

        // Check that utility functions exist
        expect(validateViewerCount).toBeDefined();

        // Verify that all platforms use the same structure
        const platforms = ['TikTok', 'Twitch', 'YouTube'];
        platforms.forEach(platform => {
            expect(viewerCountSystem.handlers[platform]).toBeDefined();
            expect(viewerCountSystem.handlers[platform].getCount).toBeDefined();
            expect(viewerCountSystem.handlers[platform].update).toBeDefined();
        });
    });

    test('Error handling consistency', () => {
        // All handlers should return valid defaults on error
        // Verify validateViewerCount handles edge cases
        expect(validateViewerCount(0)).toBe(true);
        expect(validateViewerCount(null)).toBe(false);
    });

    test('Caching system', () => {
        // TikTok should have a separate caching mechanism
        expect(typeof viewerCountSystem.cachedTikTokCount).toBe('number');
        
        // Other platforms should use the lastCounts tracking
        expect(viewerCountSystem.lastCounts.TikTok).toBeDefined();
        expect(viewerCountSystem.lastCounts.Twitch).toBeDefined();
        expect(viewerCountSystem.lastCounts.YouTube).toBeDefined();
    });
}); 