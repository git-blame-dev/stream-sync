const { describe, test, afterEach, expect } = require('bun:test');

const { restoreAllMocks } = require('../helpers/bun-mock-utils');
const { AppRuntime } = require('../../src/main');
const { createAppRuntimeTestDependencies } = require('../helpers/runtime-test-harness');

const testConfig = {
    general: {
        streamDetectionEnabled: false,
        streamRetryInterval: 15,
        streamMaxRetries: 3,
        continuousMonitoringInterval: 60000,
        ttsEnabled: false,
        chatMsgTxt: 'test-chat-source',
        chatMsgScene: 'test-scene'
    },
    platform: {
        youtube: {
            enabled: true,
            apiKey: 'test-youtube-api-key',
            enableViewerCount: true,
            enableNotifications: true
        },
        twitch: { enabled: false },
        tiktok: { enabled: false }
    },
    obs: {
        websocket: { enabled: false },
        notificationTxt: 'test-notification-source',
        notificationScene: 'test-scene'
    },
    viewerCount: { updateInterval: 30000, aggregateMode: 'sum' },
    handcam: { enabled: false },
    gifts: { enabled: false }
};

const buildAppRuntimeDependencies = (options = {}) => (
    createAppRuntimeTestDependencies({
        configSnapshot: testConfig,
        ...options
    })
);

describe('AppRuntime stream-status viewer count routing', () => {
    afterEach(async () => {
        restoreAllMocks();
        if (runtime && typeof runtime.stop === 'function') {
            await runtime.stop();
        }
        runtime = null;
    });

    let runtime;

    test('updates viewer count system when stream-status platform:event arrives', async () => {
        const harness = buildAppRuntimeDependencies();
        const { dependencies, eventBus } = harness;
        const updates = [];

        runtime = new AppRuntime(testConfig, dependencies);
        runtime.viewerCountSystem.updateStreamStatus = async (platform, isLive) => {
            updates.push({ platform, isLive });
        };

        eventBus.emit('platform:event', {
            platform: 'youtube',
            type: 'platform:stream-status',
            data: { isLive: true, timestamp: new Date().toISOString() }
        });

        await Promise.resolve();

        expect(updates).toEqual([{ platform: 'youtube', isLive: true }]);
    });

    test('ignores stream-status events without boolean isLive', async () => {
        const harness = buildAppRuntimeDependencies();
        const { dependencies, eventBus } = harness;
        const updates = [];

        runtime = new AppRuntime(testConfig, dependencies);
        runtime.viewerCountSystem.updateStreamStatus = async (platform, isLive) => {
            updates.push({ platform, isLive });
        };

        eventBus.emit('platform:event', {
            platform: 'youtube',
            type: 'platform:stream-status',
            data: { isLive: 'not-boolean', timestamp: new Date().toISOString() }
        });

        await Promise.resolve();

        expect(updates).toEqual([]);
    });
});
