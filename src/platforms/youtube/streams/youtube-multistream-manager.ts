const { PlatformEvents } = require('../../../interfaces/PlatformEvents');
const { YOUTUBE } = require('../../../core/endpoints');

function createYouTubeMultiStreamManager(options = {}) {
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

    const startMonitoring = async () => {
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
        } catch (error) {
            platform._handleProcessingError(
                `Initial multi-stream check failed: ${error.message}`,
                error,
                'multi-stream-check'
            );
            throw error;
        }
    };

    const checkMultiStream = async (options = {}) => {
        const throwOnError = options.throwOnError === true;
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
                const limitedVideoIds = maxStreams > 0 && videoIds.length > maxStreams
                    ? videoIds.slice(0, maxStreams)
                    : videoIds;

                if (limitedVideoIds.length === 0 && platform.connectionManager.getConnectionCount() > 0) {
                    platform.logger.warn('Stream detection failed, preserving existing connections', 'youtube');
                    return;
                }

                let anyChanges = false;
                for (const videoId of platform.connectionManager.getAllVideoIds()) {
                    if (!limitedVideoIds.includes(videoId)) {
                        platform.logger.info(`Stream ended, disconnecting: ${videoId}`, 'youtube');
                        await platform.disconnectFromYouTubeStream(videoId, 'stream limit exceeded');
                        anyChanges = true;
                    }
                }

                if (!anyChanges) {
                    platform.logger.debug(`All ${activeStreams.length} streams still live, no changes needed`, 'youtube');
                }

                platform._logMultiStreamStatus();
                return;
            }

            let videoIds = await platform.getLiveVideoIds();

            if (maxStreams > 0 && videoIds.length > maxStreams) {
                platform.logger.debug(`Limiting to maxStreams=${maxStreams} (found ${videoIds.length})`, 'youtube');
                videoIds = videoIds.slice(0, maxStreams);
            }

            platform.checkStreamShortageAndWarn(videoIds.length, maxStreams);

            if (videoIds.length > 0) {
                platform.logger.info('Detected live streams:', 'youtube');
                videoIds.forEach((streamId, index) => {
                    const streamUrl = `${YOUTUBE.BASE}/watch?v=${streamId}`;
                    platform.logger.debug(`  ${index + 1}. ${streamId} - ${streamUrl}`, 'youtube');
                });
            }

            platform.lastYouTubeVideoIdsUpdateTime = currentTimeMs;

            const previousVideoIds = platform.getActiveYouTubeVideoIds().filter(
                (id) => platform.connectionManager.hasConnection(id)
            );

            const newStreamIds = videoIds.filter((id) => !previousVideoIds.includes(id));

            for (const videoId of videoIds) {
                const hasExistingConnection = platform.connectionManager.hasConnection(videoId);
                if (!hasExistingConnection) {
                    try {
                        await platform.connectToYouTubeStream(videoId);
                    } catch (error) {
                        platform._handleConnectionErrorLogging(
                            `Failed to connect to stream ${videoId}: ${error.message}`,
                            error,
                            'stream-connect'
                        );
                    }
                }
            }

            if (newStreamIds.length > 0) {
                const streamDetectedEvent = {
                    platform: 'youtube',
                    eventType: 'stream-detected',
                    newStreamIds,
                    allStreamIds: videoIds,
                    detectionTime: now(),
                    connectionCount: platform.connectionManager.getConnectionCount()
                };

                platform._emitPlatformEvent(PlatformEvents.STREAM_DETECTED, streamDetectedEvent);
            }

            if (videoIds.length === 0 && platform.connectionManager.getConnectionCount() > 0) {
                platform.logger.warn('Stream detection failed, preserving existing connections', 'youtube');
                return;
            }

            for (const videoId of platform.connectionManager.getAllVideoIds()) {
                if (!videoIds.includes(videoId)) {
                    platform.logger.debug(`Stream ended, disconnecting: ${videoId}`, 'youtube');
                    await platform.disconnectFromYouTubeStream(videoId, 'stream no longer live');
                }
            }

            platform._logMultiStreamStatus(true, true);
        } catch (error) {
            platform._handleProcessingError(
                `Error in checkMultiStream: ${error.message}`,
                error,
                'checkMultiStream'
            );
            platform._handleError(error, 'checkMultiStream');
            if (throwOnError) {
                throw error;
            }
        }
    };

    const checkStreamShortageAndWarn = (availableCount, maxStreams) => {
        const currentTimeMs = now();
        const isShortage = maxStreams > 0 && availableCount < maxStreams;
        const warningThrottleMs = validateTimeout(
            platform.config.fullCheckInterval,
            platform.config.fullCheckInterval,
            'fullCheckInterval'
        );

        if (isShortage) {
            const shouldWarn = !platform.shortageState.lastWarningTime ||
                (currentTimeMs - platform.shortageState.lastWarningTime) >= warningThrottleMs;

            if (shouldWarn) {
                platform.logger.warn(
                    `Stream shortage detected: found ${availableCount}/${maxStreams} streams. Some content may be missed.`,
                    'youtube'
                );
                platform.shortageState.lastWarningTime = currentTimeMs;
            } else {
                platform.logger.info(
                    `Stream status: ${availableCount}/${maxStreams} streams available (shortage persists)`,
                    'youtube'
                );
            }

            platform.shortageState.isInShortage = true;
            platform.shortageState.lastKnownAvailable = availableCount;
            platform.shortageState.lastKnownRequired = maxStreams;
        } else if (platform.shortageState.isInShortage) {
            platform.logger.info(
                `Stream shortage resolved: ${availableCount}/${maxStreams} streams available`,
                'youtube'
            );
            platform.shortageState.isInShortage = false;
            platform.shortageState.lastWarningTime = null;
        }
    };

    const logStatus = (includeDetails = false, includeActiveStreamsList = false) => {
        const storedConnections = platform.connectionManager.getAllVideoIds();
        const readyConnections = platform.getActiveYouTubeVideoIds();

        if (storedConnections.length > 0) {
            platform.logger.info(
                `Multi-stream status: ${readyConnections.length} ready, ${storedConnections.length} total connections`,
                'youtube'
            );

            if (includeDetails && storedConnections.length > readyConnections.length) {
                const pendingConnections = storedConnections.filter((id) => !readyConnections.includes(id));
                pendingConnections.forEach((streamId) => {
                    platform.logger.info(`Waiting for stream to start: ${streamId}`, 'youtube');
                });
            }

            if (includeActiveStreamsList && readyConnections.length > 0) {
                platform.logger.info('Active streams:', 'youtube');
                readyConnections.forEach((streamId, index) => {
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
        checkStreamShortageAndWarn,
        logStatus
    };
}

module.exports = {
    createYouTubeMultiStreamManager
};
