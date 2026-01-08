
const { ViewerCountSystem } = require('../../src/utils/viewer-count');
const { OBSViewerCountObserver } = require('../../src/observers/obs-viewer-count-observer');
const { createOBSConnectionManager } = require('../../src/obs/connection');

// Test utilities
const { createMockConfig } = require('../helpers/test-setup');
const { expectNoTechnicalArtifacts } = require('../helpers/behavior-validation');
const { createSilentLogger } = require('../helpers/test-logger');

describe('OBS Connection Lifecycle Integration', () => {
    let viewerCountSystem, obsManager, obsObserver;
    let mockPlatforms;
    let mockOBSWebSocket;
    
    beforeEach(async () => {
        // Create mock OBS WebSocket that simulates real connection behavior
        mockOBSWebSocket = createMockOBSWebSocket();
        
        // Create OBS manager with controlled connection behavior
        obsManager = createOBSConnectionManager({
            mockOBS: mockOBSWebSocket,
            isTestEnvironment: true,
            testConnectionBehavior: true,
            config: {
                address: 'ws://localhost:4455',
                password: 'test-password',
                enabled: true
            }
        });
        
        mockPlatforms = {
            youtube: createStreamingPlatformMock('youtube', 1500),
            twitch: createStreamingPlatformMock('twitch', 2500),
            tiktok: createStreamingPlatformMock('tiktok', 800)
        };
        
        // Initialize viewer count system
        viewerCountSystem = new ViewerCountSystem({ platforms: mockPlatforms });
        obsObserver = new OBSViewerCountObserver(obsManager, createSilentLogger());
        
        await viewerCountSystem.initialize();
    });
    
    afterEach(async () => {
        if (viewerCountSystem?.isPolling) {
            viewerCountSystem.stopPolling();
        }
        
        if (viewerCountSystem) {
            await viewerCountSystem.cleanup();
        }
        
        jest.clearAllMocks();
    });

    describe('OBS Disconnection Behavior Tests', () => {
        test('should initialize OBS observer system correctly', async () => {
            // Given: Basic system setup
            expect(viewerCountSystem).toBeDefined();
            expect(obsObserver).toBeDefined();
            expect(obsManager).toBeDefined();
            
            // When: Adding observer to system
            viewerCountSystem.addObserver(obsObserver);
            
            // Then: Observer should be registered
            expect(viewerCountSystem.observers.size).toBe(1);
            expect(viewerCountSystem.observers.has('obs-viewer-count-observer')).toBe(true);
        });

    });
});

// ================================================================================================
// HELPER FUNCTIONS
// ================================================================================================

function createMockOBSWebSocket() {
    const mock = {
        connected: false,
        call: jest.fn().mockResolvedValue({}),
        connect: jest.fn().mockResolvedValue({ obsWebSocketVersion: '5.0.0', negotiatedRpcVersion: 1 }),
        disconnect: jest.fn().mockResolvedValue(),
        on: jest.fn(),
        off: jest.fn(),
        once: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        
        // Simulation methods
        setConnected: function(connected) {
            this.connected = connected;
        }
    };
    
    return mock;
}

function createStreamingPlatformMock(platformName, initialViewerCount) {
    return {
        getViewerCount: jest.fn().mockResolvedValue(initialViewerCount),
        isEnabled: jest.fn().mockReturnValue(true),
        isConnected: jest.fn().mockReturnValue(true),
        platform: platformName
    };
}
