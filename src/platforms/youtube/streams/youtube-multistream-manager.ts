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
            clearInterval(platform.monitoringInterval);
            platform.monitoringInterval = null;
        }

        const pollInterval = validateTimeout(
            platform.config.streamPollingInterval * 1000,
            platform.config.streamPollingInterval * 1000,
            'streamPollingInterval'
        );

        platform.logger.debug(`Starting multi-stream monitoring (interval: ${pollInterval}ms)`, 'youtube');

        platform.monitoringInterval = safeSetInterval(() => {
            platform.checkMultiStream();
        }, pollInterval);

        platform.monitoringIntervalStart = now();

        try {
            await platform.checkMultiStream({ throwOnError: true });
        } catch {
            // checkMultiStream owns the failure report; monitoring stays active.
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

                    return;
                }

                platform.lastFullStreamCheck = currentTimeMs;

                const videoIds = await platform.getLiveVideoIds();

                if (videoIds.length === 0 && platform.connectionManager.getConnectionCount() > 0) {
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
                }

                return;
            }

            const videoIds = await platform.getLiveVideoIds();

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

        } catch (error: unknown) {
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

const requestImmediateRefresh = async (_context: UnknownRecord = {}): Promise<void> => {
        if (immediateRefreshPromise) {
            return immediateRefreshPromise;
        }

        immediateRefreshPromise = (async () => {

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

    return {
        startMonitoring,
        checkMultiStream,
        requestImmediateRefresh,
        isCheckInProgress
    };
}

export { createYouTubeMultiStreamManager };
