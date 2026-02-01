const { describe, test, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { ViewerCountSystem } = require('../../src/utils/viewer-count');
const { OBSViewerCountObserver } = require('../../src/observers/obs-viewer-count-observer');
const { createOBSConnectionManager } = require('../../src/obs/connection');
const { noOpLogger } = require('../helpers/mock-factories');
const { createConfigFixture } = require('../helpers/config-fixture');

describe('OBS Connection Lifecycle Integration', () => {
    let viewerCountSystem, obsManager, obsObserver;
    let mockPlatforms;
    let mockOBSWebSocket;
    let testConfig;

    beforeEach(async () => {
        testConfig = createConfigFixture();
        mockOBSWebSocket = createMockOBSWebSocket();

        obsManager = createOBSConnectionManager({
            mockOBS: mockOBSWebSocket,
            isTestEnvironment: true,
            testConnectionBehavior: true,
            config: {
                address: 'ws://localhost:4455',
                password: 'testPassword123',
                enabled: true,
                connectionTimeoutMs: testConfig.obs?.connectionTimeoutMs || 10000
            }
        });

        mockPlatforms = {
            youtube: createStreamingPlatformMock('youtube', 1500),
            twitch: createStreamingPlatformMock('twitch', 2500),
            tiktok: createStreamingPlatformMock('tiktok', 800)
        };

        viewerCountSystem = new ViewerCountSystem({ platforms: mockPlatforms, config: testConfig, logger: noOpLogger });
        obsObserver = new OBSViewerCountObserver(obsManager, noOpLogger);

        await viewerCountSystem.initialize();
    });

    afterEach(async () => {
        if (viewerCountSystem?.isPolling) {
            viewerCountSystem.stopPolling();
        }

        if (viewerCountSystem) {
            await viewerCountSystem.cleanup();
        }

        clearAllMocks();
        restoreAllMocks();
    });

    describe('OBS Observer System', () => {
        test('initializes and registers observer correctly', async () => {
            expect(viewerCountSystem).toBeDefined();
            expect(obsObserver).toBeDefined();
            expect(obsManager).toBeDefined();

            viewerCountSystem.addObserver(obsObserver);

            expect(viewerCountSystem.observers.size).toBe(1);
            expect(viewerCountSystem.observers.has('obs-viewer-count-observer')).toBe(true);
        });
    });
});

function createMockOBSWebSocket() {
    return {
        connected: false,
        call: createMockFn().mockResolvedValue({}),
        connect: createMockFn().mockResolvedValue({ obsWebSocketVersion: '5.0.0', negotiatedRpcVersion: 1 }),
        disconnect: createMockFn().mockResolvedValue(),
        on: createMockFn(),
        off: createMockFn(),
        once: createMockFn(),
        addEventListener: createMockFn(),
        removeEventListener: createMockFn(),
        setConnected(connected) {
            this.connected = connected;
        }
    };
}

function createStreamingPlatformMock(platformName, initialViewerCount) {
    return {
        getViewerCount: createMockFn().mockResolvedValue(initialViewerCount),
        isEnabled: createMockFn(() => true),
        isConnected: createMockFn(() => true),
        platform: platformName
    };
}
