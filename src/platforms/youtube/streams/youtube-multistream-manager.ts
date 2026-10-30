import { YOUTUBE } from '../../../core/endpoints';
import { PlatformEvents } from '../../../interfaces/PlatformEvents';
import type { UnknownRecord } from '../../../utils/record-contracts';
type PlatformEventType = Extract<(typeof PlatformEvents)[keyof typeof PlatformEvents], string>;

interface LoggerLike {
    debug: (message: string, scope: string) => void;
    info: (message: string, scope: string) => void;
    warn: (message: string, scope: string) => void;
}

interface ConnectionManagerLike {
    getConnectionCount: () => number;
    getAllVideoIds: () => string[];
    hasConnection: (videoId: string) => boolean;
}

interface YouTubeMultiStreamPlatform {
    config: {
        maxStreams: number;
        streamPollingInterval: number;
        fullCheckInterval: number;
    };
    connectionManager: ConnectionManagerLike;
    logger: LoggerLike;
    monitoringInterval: number | ReturnType<typeof setInterval> | null;
    monitoringIntervalStart?: number;
    lastFullStreamCheck: number | null;
    lastYouTubeVideoIdsUpdateTime?: number;
    checkMultiStream: (options?: { throwOnError?: boolean }) => Promise<void>;
    getActiveYouTubeVideoIds: () => string[];
    getLiveVideoIds: () => Promise<string[]>;
    connectToYouTubeStream: (videoId: string) => Promise<boolean>;
    disconnectFromYouTubeStream: (
        videoId: string,
        reason: string,
        options?: { requestImmediateRefresh?: boolean; source?: string }
    ) => Promise<void>;
    _logMultiStreamStatus: (includeDetails?: boolean, includeActiveStreamsList?: boolean) => void;
    _handleProcessingError: (message: string, error: unknown, category: string) => void;
    _handleConnectionErrorLogging: (message: string, error: unknown, category: string) => void;
    _handleError: (error: unknown, context: string) => void;
    _emitPlatformEvent: (type: PlatformEventType, payload: UnknownRecord) => void;
}

interface MultiStreamManagerOptions {
    platform?: YouTubeMultiStreamPlatform;
    safeSetInterval?: (callback: () => void, intervalMs: number) => number | ReturnType<typeof setInterval>;
    validateTimeout?: (value: number, fallbackValue: number, fieldName: string) => number;
    now?: () => number;
}

interface CheckMultiStreamOptions {
    throwOnError?: boolean;
}

interface YouTubeMultiStreamManager {
    startMonitoring: () => Promise<void>;
    checkMultiStream: (options?: CheckMultiStreamOptions) => Promise<void>;
    requestImmediateRefresh: (context?: UnknownRecord) => Promise<void>;
    isCheckInProgress: () => boolean;
    logStatus: (includeDetails?: boolean, includeActiveStreamsList?: boolean) => void;
}

const toErrorMessage = (error: unknown): string => (
    error instanceof Error ? error.message : String(error)
);

function createYouTubeMultiStreamManager(options: MultiStreamManagerOptions = {}): YouTubeMultiStreamManager {
    const {
        platform,
        safeSetInterval,
        validateTimeout,
        now
    } = options;

    if (!platform) {
        throw new Error('YouTube multistream manager requires platform instance');
    }

    if (typeof safeSetInterval !== 'function') {
        throw new Error('YouTube multistream manager requires safeSetInterval function');
    }

    if (typeof validateTimeout !== 'function') {
        throw new Error('YouTube multistream manager requires validateTimeout function');
    }

    if (typeof now !== 'function') {
        throw new Error('YouTube multistream manager requires now function');
    }

const startMonitoring = async (): Promise<void> => {
        if (platform.monitoringInterval) {
            platform.logger.debug(
                `Cleaning up existing monitoring interval: ${platform.monitoringInterval}`,
                'youtube'
            );
            clearInterval(platform.monitoringInterval);
            platform.monitoringInterval = null;
        }

        const pollInterval = validateTimeout(
            platform.config.streamPollingInterval * 1000,
            platform.config.streamPollingInterval * 1000,
            'streamPollingInterval'
        );

        platform.logger.info(`Starting multi-stream monitoring (interval: ${pollInterval}ms)`, 'youtube');

        platform.monitoringInterval = safeSetInterval(() => {
            platform.checkMultiStream();
        }, pollInterval);

        platform.monitoringIntervalStart = now();

        try {
            await platform.checkMultiStream({ throwOnError: true });
        } catch (error: unknown) {
            platform._handleProcessingError(
                `Initial multi-stream check failed: ${toErrorMessage(error)}`,
                error,
                'multi-stream-check'
            );
        }
    };

    let currentCheckPromise: Promise<void> | null = null;
    let immediateRefreshPromise: Promise<void> | null = null;

const runCheckMultiStream = async (throwOnError: boolean): Promise<void> => {
        try {
            const maxStreams = platform.config.maxStreams;
            const currentConnections = platform.connectionManager.getConnectionCount();
            const activeStreams = platform.getActiveYouTubeVideoIds();
            const currentTimeMs = now();

            if (maxStreams > 0 && currentConnections >= maxStreams && activeStreams.length > 0) {
                const timeSinceLastFullCheck = platform.lastFullStreamCheck
                    ? (currentTimeMs - platform.lastFullStreamCheck)
                    : Infinity;

                const fullCheckInterval = validateTimeout(
                    platform.config.fullCheckInterval,
                    platform.config.fullCheckInterval,
                    'fullCheckInterval'
                );

                if (timeSinceLastFullCheck < fullCheckInterval) {
                    platform.logger.debug(
                        `Skipping check: Already connected to ${currentConnections}/${maxStreams} active streams. ` +
                        `Next full check in ${Math.round((fullCheckInterval - timeSinceLastFullCheck) / 1000)}s`,
                        'youtube'
                    );

                    platform._logMultiStreamStatus();
                    return;
                }

                platform.logger.debug(
                    `Performing periodic full check (at capacity with ${activeStreams.length} active streams)`,
                    'youtube'
                );

                platform.lastFullStreamCheck = currentTimeMs;

                const videoIds = await platform.getLiveVideoIds();

                if (videoIds.length === 0 && platform.connectionManager.getConnectionCount() > 0) {
                    platform.logger.warn('Stream detection failed, preserving existing connections', 'youtube');
                    return;
                }

                const connectedVideoIds = platform.connectionManager.getAllVideoIds();
                const omittedConnectedVideoIds = connectedVideoIds.filter((videoId: string) =>
                    !videoIds.includes(videoId)
                );

                if (omittedConnectedVideoIds.length > 0) {
                    platform.logger.warn(
                        `Stream detection omitted ${omittedConnectedVideoIds.length} connected stream(s); preserving existing connections`,
                        'youtube'
                    );
                } else {
                    platform.logger.debug(`All ${activeStreams.length} streams still live, no changes needed`, 'youtube');
                }

                platform._logMultiStreamStatus();
                return;
            }

            const videoIds = await platform.getLiveVideoIds();


            if (videoIds.length > 0) {
                platform.logger.debug('Detected live streams:', 'youtube');
                videoIds.forEach((streamId: string, index: number) => {
                    const streamUrl = `${YOUTUBE.BASE}/watch?v=${streamId}`;
                    platform.logger.debug(`  ${index + 1}. ${streamId} - ${streamUrl}`, 'youtube');
                });
            }

            platform.lastYouTubeVideoIdsUpdateTime = currentTimeMs;

            const newStreamCandidates = videoIds.filter((id: string) =>
                !platform.connectionManager.hasConnection(id)
            );
            const availableSlots = maxStreams > 0
                ? Math.max(maxStreams - platform.connectionManager.getConnectionCount(), 0)
                : Number.POSITIVE_INFINITY;
            const newStreamIds = Number.isFinite(availableSlots)
                ? newStreamCandidates.slice(0, availableSlots)
                : newStreamCandidates;

            if (newStreamCandidates.length > newStreamIds.length) {
                platform.logger.warn(
                    `Deferring ${newStreamCandidates.length - newStreamIds.length} detected stream(s); maxStreams limit reached`,
                    'youtube'
                );
            }

            for (const videoId of newStreamIds) {
                try {
                    await platform.connectToYouTubeStream(videoId);
                } catch (error: unknown) {
                    platform._handleConnectionErrorLogging(
                        `Failed to connect to stream ${videoId}: ${toErrorMessage(error)}`,
                        error,
                        'stream-connect'
                    );
                }
            }

            if (videoIds.length === 0 && platform.connectionManager.getConnectionCount() > 0) {
                platform.logger.warn('Stream detection failed, preserving existing connections', 'youtube');
                return;
            }

            const omittedConnectedVideoIds = platform.connectionManager.getAllVideoIds().filter((videoId: string) =>
                !videoIds.includes(videoId)
            );

            if (omittedConnectedVideoIds.length > 0) {
                platform.logger.warn(
                    `Stream detection omitted ${omittedConnectedVideoIds.length} connected stream(s); preserving existing connections`,
                    'youtube'
                );
            }

            platform._logMultiStreamStatus(true, true);
        } catch (error: unknown) {
            platform._handleProcessingError(
                `Error in checkMultiStream: ${toErrorMessage(error)}`,
                error,
                'checkMultiStream'
            );
            platform._handleError(error, 'checkMultiStream');
            if (throwOnError) {
                throw error;
            }
        }
    };

const checkMultiStream = async (options: CheckMultiStreamOptions = {}): Promise<void> => {
        const throwOnError = options.throwOnError === true;

        if (currentCheckPromise) {
            if (throwOnError) {
                await currentCheckPromise;
            }
            return;
        }

        currentCheckPromise = runCheckMultiStream(throwOnError);
        try {
            await currentCheckPromise;
        } finally {
            currentCheckPromise = null;
        }
    };

const requestImmediateRefresh = async (context: UnknownRecord = {}): Promise<void> => {
        if (immediateRefreshPromise) {
            return immediateRefreshPromise;
        }

        immediateRefreshPromise = (async () => {
            const source = typeof context.source === 'string' ? context.source : 'unknown';
            platform.logger.debug(`Requesting immediate multi-stream refresh (source: ${source})`, 'youtube');

            if (currentCheckPromise) {
                try {
                    await currentCheckPromise;
                } catch {
                    // Follow-up immediate refresh still runs even if previous check errored.
                }
            }

            await checkMultiStream({ throwOnError: true });
        })();

        try {
            await immediateRefreshPromise;
        } finally {
            immediateRefreshPromise = null;
        }
    };

const isCheckInProgress = (): boolean => currentCheckPromise !== null;

const logStatus = (includeDetails = false, includeActiveStreamsList = false): void => {
        const storedConnections = platform.connectionManager.getAllVideoIds();
        const readyConnections = platform.getActiveYouTubeVideoIds();

        if (storedConnections.length > 0) {
            platform.logger.debug(
                `Multi-stream status: ${readyConnections.length} ready, ${storedConnections.length} total connections`,
                'youtube'
            );

            if (includeDetails && storedConnections.length > readyConnections.length) {
                const pendingConnections = storedConnections.filter((id) => !readyConnections.includes(id));
                pendingConnections.forEach((streamId: string) => {
                    platform.logger.debug(`Waiting for stream to start: ${streamId}`, 'youtube');
                });
            }

            if (includeActiveStreamsList && readyConnections.length > 0) {
                platform.logger.debug('Active streams:', 'youtube');
                readyConnections.forEach((streamId: string, index: number) => {
                    const streamUrl = `${YOUTUBE.BASE}/watch?v=${streamId}`;
                    platform.logger.debug(`  ${index + 1}. ${streamId} - ${streamUrl}`, 'youtube');
                });
            }
        } else {
            platform.logger.debug('No YouTube connections established', 'youtube');
        }
    };

    return {
        startMonitoring,
        checkMultiStream,
        requestImmediateRefresh,
        isCheckInProgress,
        logStatus
    };
}

export { createYouTubeMultiStreamManager };
