
const { initializeTestLogging } = require('./helpers/test-setup');
const { createMockOBSManager, createMockLogger } = require('./helpers/mock-factories');
const { setupAutomatedCleanup } = require('./helpers/mock-lifecycle');

// Initialize logging for tests FIRST
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

const { ViewerCountSystem } = require('../src/utils/viewer-count');

describe('Viewer Count Initialization', () => {
    let mockPlatforms;
    let mockObsManager;
    let viewerCountSystem;
    let mockLogger;

    beforeEach(() => {
        // Platform map used by ViewerCountSystem dependency injection
        mockPlatforms = {
            tiktok: { getViewerCount: jest.fn() },
            twitch: { getViewerCount: jest.fn() },
            youtube: { getViewerCount: jest.fn() }
        };

        // Use factory to create mock OBS manager
        mockObsManager = createMockOBSManager('connected');

        mockLogger = createMockLogger('info');
        viewerCountSystem = new ViewerCountSystem({ platforms: mockPlatforms, logger: mockLogger });
    });

    test('should initialize all platform counts to 0 internally', () => {
        // Act & Assert: Check internal counts are 0
        expect(viewerCountSystem.counts.tiktok).toBe(0);
        expect(viewerCountSystem.counts.twitch).toBe(0);
        expect(viewerCountSystem.counts.youtube).toBe(0);
    });

    test('should initialize observers when initialized', async () => {
        // Arrange: Create a mock observer
        const mockObserver = {
            getObserverId: jest.fn().mockReturnValue('test-observer'),
            initialize: jest.fn().mockResolvedValue()
        };
        viewerCountSystem.addObserver(mockObserver);

        // Act: Initialize the system
        await viewerCountSystem.initialize();

        // Assert: Observer should be initialized
        expect(mockObserver.initialize).toHaveBeenCalledTimes(1);
    });

    test('should handle observer initialization errors gracefully', async () => {
        // Arrange: Create a mock observer that throws during initialization
        const mockObserver = {
            getObserverId: jest.fn().mockReturnValue('failing-observer'),
            initialize: jest.fn().mockRejectedValue(new Error('Observer init failed'))
        };
        viewerCountSystem.addObserver(mockObserver);

        // Act: Initialize the system (should not throw)
        await expect(viewerCountSystem.initialize()).resolves.not.toThrow();

        // Assert: Observer initialization was attempted
        expect(mockObserver.initialize).toHaveBeenCalledTimes(1);
    });

    test('should handle multiple observers during initialization', async () => {
        // Arrange: Create multiple mock observers
        const mockObserver1 = {
            getObserverId: jest.fn().mockReturnValue('observer-1'),
            initialize: jest.fn().mockResolvedValue()
        };
        const mockObserver2 = {
            getObserverId: jest.fn().mockReturnValue('observer-2'),
            initialize: jest.fn().mockResolvedValue()
        };
        
        viewerCountSystem.addObserver(mockObserver1);
        viewerCountSystem.addObserver(mockObserver2);

        // Act: Initialize the system
        await viewerCountSystem.initialize();

        // Assert: Both observers should be initialized
        expect(mockObserver1.initialize).toHaveBeenCalledTimes(1);
        expect(mockObserver2.initialize).toHaveBeenCalledTimes(1);
    });

    // Manual cleanup removed - handled by setupAutomatedCleanup()
});
