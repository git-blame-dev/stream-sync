const { describe, test, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { useFakeTimers, useRealTimers, runOnlyPendingTimers } = require('../../helpers/bun-timers');

const createDetectorConfig = (overrides = {}) => ({
    streamDetectionEnabled: true,
    streamRetryInterval: 1,
    streamMaxRetries: -1,
    continuousMonitoringInterval: 1,
    ...overrides
});

describe('StreamDetector behavior', () => {
    let StreamDetector;
    let mockHttpClient;
    let mockErrorHandler;

    beforeEach(() => {
        useFakeTimers();
        StreamDetector = require('../../../src/utils/stream-detector').StreamDetector;
        mockHttpClient = {
            get: createMockFn()
        };
        mockErrorHandler = {
            handleEventProcessingError: createMockFn(),
            logOperationalError: createMockFn()
        };
    });

    afterEach(() => {
        restoreAllMocks();
        useRealTimers();
    });

    function createDetector(config, extraServices = {}) {
        return new StreamDetector(config, {
            logger: noOpLogger,
            httpClient: mockHttpClient,
            createPlatformErrorHandler: () => mockErrorHandler,
            ...extraServices
        });
    }

    it('connects immediately when detection is disabled', async () => {
        const detector = createDetector(createDetectorConfig({
            streamDetectionEnabled: false
        }));
        const connectCallback = createMockFn().mockResolvedValue(true);
        const statusCallback = createMockFn();

        const result = await detector.startStreamDetection('youtube', { username: 'testChannel' }, connectCallback, statusCallback);

        expect(connectCallback).toHaveBeenCalledTimes(1);
        expect(result).toBe(true);
        expect(detector.monitoringIntervals.size).toBe(0);
        expect(statusCallback).not.toHaveBeenCalled();
    });

    it('retries after detection error and routes through platform error handler', async () => {
        const detector = createDetector(createDetectorConfig({
            streamRetryInterval: 1
        }));

        detector.checkStreamStatus = createMockFn().mockRejectedValue(new Error('detect failed'));
        const connectCallback = createMockFn();
        const statusCallback = createMockFn();

        const startPromise = detector.startStreamDetection('youtube', { username: 'testChan' }, connectCallback, statusCallback);

        await Promise.resolve();
        expect(detector.checkStreamStatus).toHaveBeenCalledTimes(1);
        expect(mockErrorHandler.handleEventProcessingError).toHaveBeenCalledTimes(1);
        expect(statusCallback).toHaveBeenCalledWith('error', expect.stringContaining('detect failed'));

        runOnlyPendingTimers();
        await Promise.resolve();

        expect(detector.checkStreamStatus).toHaveBeenCalledTimes(2);
        await startPromise;
    });

    it('runs continuous monitoring callbacks on status change', async () => {
        const detector = createDetector(createDetectorConfig({
            continuousMonitoringInterval: 1
        }));
        const connectCallback = createMockFn().mockResolvedValue(true);
        const statusCallback = createMockFn();

        detector.platformConfigs.set('youtube', { username: 'testChan', streamDetectionMethod: 'youtubei' });
        detector.platformCallbacks.set('youtube', { connectCallback, statusCallback });
        detector.platformStreamStatus.set('youtube', false);

        detector.checkStreamStatus = createMockFn()
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false);

        detector.startContinuousMonitoring('youtube');

        runOnlyPendingTimers();
        await Promise.resolve();

        expect(connectCallback).toHaveBeenCalledTimes(1);
        expect(statusCallback).toHaveBeenCalledWith('live', expect.stringContaining('Stream started'));

        runOnlyPendingTimers();
        await Promise.resolve();

        expect(statusCallback).toHaveBeenCalledWith('offline', expect.stringContaining('Stream ended'));
        detector.stopContinuousMonitoring('youtube');
    });

    it('does not fall back to scraping when youtubei detection fails', async () => {
        const detector = createDetector(createDetectorConfig());
        detector._getYoutubeDetectionService = createMockFn().mockRejectedValue(new Error('youtubei boom'));

        const result = await detector._checkYouTubeStreamStatus({
            username: 'testCreator',
            streamDetectionMethod: 'youtubei'
        });

        expect(detector._getYoutubeDetectionService).toHaveBeenCalled();
        expect(mockHttpClient.get).not.toHaveBeenCalled();
        expect(result).toBe(false);
    });

    it('uses TikTok connection state instead of scraping', async () => {
        const detector = createDetector(createDetectorConfig());
        const result = await detector._checkTikTokStreamStatus({
            username: 'testAlice',
            connection: {
                isConnected: () => true
            }
        });

        expect(result).toBe(true);
        expect(mockHttpClient.get).not.toHaveBeenCalled();
    });

    it('skips continuous check when platform config is missing', async () => {
        const warnCalled = { value: false };
        const trackingLogger = {
            debug: () => {},
            info: () => {},
            warn: () => { warnCalled.value = true; },
            error: () => {}
        };
        const detector = new StreamDetector(createDetectorConfig(), {
            logger: trackingLogger,
            httpClient: mockHttpClient,
            createPlatformErrorHandler: () => mockErrorHandler
        });
        detector.checkStreamStatus = createMockFn();

        await detector._performContinuousCheck('youtube');

        expect(warnCalled.value).toBe(true);
        expect(detector.checkStreamStatus).not.toHaveBeenCalled();
    });
});
