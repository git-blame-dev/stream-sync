
jest.mock('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: jest.fn(() => ({
        handleEventProcessingError: jest.fn(),
        logOperationalError: jest.fn()
    }))
}));

let mockHttpClient;

const createDetectorConfig = (overrides = {}) => ({
    streamDetectionEnabled: true,
    streamRetryInterval: 1,
    streamMaxRetries: -1,
    continuousMonitoringInterval: 1,
    ...overrides
});

describe('StreamDetector behavior', () => {
    let StreamDetector;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        jest.useFakeTimers();
        StreamDetector = require('../../../src/utils/stream-detector').StreamDetector;
        mockHttpClient = require('../../../src/utils/http-client').createHttpClient();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('connects immediately when detection is disabled', async () => {
        const detector = new StreamDetector(createDetectorConfig({
            streamDetectionEnabled: false
        }), { httpClient: mockHttpClient });
        const connectCallback = jest.fn().mockResolvedValue(true);
        const statusCallback = jest.fn();

        const result = await detector.startStreamDetection('youtube', { username: 'channel' }, connectCallback, statusCallback);

        expect(connectCallback).toHaveBeenCalledTimes(1);
        expect(result).toBe(true);
        expect(detector.monitoringIntervals.size).toBe(0);
        expect(statusCallback).not.toHaveBeenCalled();
    });

    it('retries after detection error and routes through platform error handler', async () => {
        const { createPlatformErrorHandler } = require('../../../src/utils/platform-error-handler');
        const detector = new StreamDetector(createDetectorConfig({
            streamRetryInterval: 1 // seconds -> 1000ms
        }), { httpClient: mockHttpClient });
        const errorHandler = createPlatformErrorHandler.mock.results.at(-1)?.value;

        detector.checkStreamStatus = jest.fn().mockRejectedValue(new Error('detect failed'));
        const connectCallback = jest.fn();
        const statusCallback = jest.fn();

        const startPromise = detector.startStreamDetection('youtube', { username: 'chan' }, connectCallback, statusCallback);

        await Promise.resolve(); // allow initial async flow
        expect(detector.checkStreamStatus).toHaveBeenCalledTimes(1);
        expect(errorHandler.handleEventProcessingError).toHaveBeenCalledTimes(1);
        expect(statusCallback).toHaveBeenCalledWith('error', expect.stringContaining('detect failed'));

        // Run the scheduled retry
        jest.runOnlyPendingTimers();
        await Promise.resolve();

        expect(detector.checkStreamStatus).toHaveBeenCalledTimes(2);
        await startPromise;
    });

    it('runs continuous monitoring callbacks on status change', async () => {
        const detector = new StreamDetector(createDetectorConfig({
            continuousMonitoringInterval: 1
        }), { httpClient: mockHttpClient });
        const connectCallback = jest.fn().mockResolvedValue(true);
        const statusCallback = jest.fn();

        detector.platformConfigs.set('youtube', { username: 'chan', streamDetectionMethod: 'youtubei' });
        detector.platformCallbacks.set('youtube', { connectCallback, statusCallback });
        detector.platformStreamStatus.set('youtube', false);

        detector.checkStreamStatus = jest.fn()
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false);

        detector.startContinuousMonitoring('youtube');

        // First interval tick: goes live and connects
        jest.runOnlyPendingTimers();
        await Promise.resolve();

        expect(connectCallback).toHaveBeenCalledTimes(1);
        expect(statusCallback).toHaveBeenCalledWith('live', expect.stringContaining('Stream started'));

        // Second tick: offline
        jest.runOnlyPendingTimers();
        await Promise.resolve();

        expect(statusCallback).toHaveBeenCalledWith('offline', expect.stringContaining('Stream ended'));
        detector.stopContinuousMonitoring('youtube');
    });

    it('does not fall back to scraping when youtubei detection fails', async () => {
        const detector = new StreamDetector(createDetectorConfig(), { httpClient: mockHttpClient });
        detector._getYoutubeDetectionService = jest.fn().mockRejectedValue(new Error('youtubei boom'));
        mockHttpClient.get.mockResolvedValue({ data: 'no live markers here' });

        const result = await detector._checkYouTubeStreamStatus({
            username: 'creator',
            streamDetectionMethod: 'youtubei'
        });

        expect(detector._getYoutubeDetectionService).toHaveBeenCalled();
        expect(mockHttpClient.get).not.toHaveBeenCalled();
        expect(result).toBe(false);
    });

    it('uses TikTok connection state instead of scraping', async () => {
        const detector = new StreamDetector(createDetectorConfig(), { httpClient: mockHttpClient });
        const result = await detector._checkTikTokStreamStatus({
            username: 'alice',
            connection: {
                isConnected: () => true
            }
        });

        expect(result).toBe(true);
        expect(mockHttpClient.get).not.toHaveBeenCalled();
    });

    it('skips continuous check when platform config is missing', async () => {
        const detector = new StreamDetector(createDetectorConfig(), { httpClient: mockHttpClient });
        detector.logger = { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() };
        detector.checkStreamStatus = jest.fn();

        await detector._performContinuousCheck('youtube');

        expect(detector.logger.warn).toHaveBeenCalled();
        expect(detector.checkStreamStatus).not.toHaveBeenCalled();
    });
});
