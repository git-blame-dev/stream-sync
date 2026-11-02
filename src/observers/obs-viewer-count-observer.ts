import type { AppLogger } from '../core/logger/types';
import { ViewerCountObserver } from './viewer-count-observer';
import { VIEWER_COUNT_CONSTANTS } from '../core/constants';
import { createTextProcessingManager } from '../utils/text-processing';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import type { ViewerCountSnapshot } from '../contracts/viewer-count';
import { withTimeout } from '../utils/timeout-wrapper';

type LoggerLike = Pick<AppLogger<string>, 'debug' | 'info' | 'warn' | 'error'>;

type ObsManagerLike = {
    isConnected: () => boolean;
    call: (requestType: string, requestData: Record<string, unknown>) => Promise<unknown>;
    onConnected?: (listener: () => void) => () => void;
};

type PlatformConfig = {
    viewerCountEnabled?: boolean;
    viewerCountSource?: string;
};

type ObserverDependencies = {
    config?: Record<string, PlatformConfig>;
    getViewerCountSnapshot?: (platform: string) => ViewerCountSnapshot;
};

type ViewerCountUpdate = {
    platform: string;
    count: number;
    previousCount?: number;
    isStreamLive: boolean;
    timestamp?: unknown;
    observationKind?: 'complete';
};

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

class OBSViewerCountObserver extends ViewerCountObserver {
    obsManager: ObsManagerLike;
    logger: LoggerLike;
    config: Record<string, PlatformConfig>;
    textProcessing: { formatViewerCount: (count: number) => string };
    errorHandler: ReturnType<typeof createPlatformErrorHandler>;
    private getViewerCountSnapshot?: ObserverDependencies['getViewerCountSnapshot'];
    private unsubscribeConnected: (() => void) | undefined;
    private disposed = false;
    private writes = new Map<string, { pending?: string; running?: Promise<void> }>();

    constructor(obsManager: ObsManagerLike, logger: LoggerLike, deps: ObserverDependencies = {}) {
        super();
        if (!logger || typeof logger.error !== 'function') {
            throw new Error('OBSViewerCountObserver requires a logger');
        }
        if (!deps.config) {
            throw new Error('OBSViewerCountObserver requires config');
        }
        this.obsManager = obsManager;
        this.logger = logger;
        this.config = deps.config;
        this.getViewerCountSnapshot = deps.getViewerCountSnapshot;
        this.textProcessing = createTextProcessingManager({ logger: this.logger });
        this.errorHandler = createPlatformErrorHandler(logger, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
    }

    override getObserverId() {
        return VIEWER_COUNT_CONSTANTS.OBSERVER.DEFAULT_OBS_OBSERVER_ID;
    }

    override async initialize() {
        if (this.disposed) return;
        this.unsubscribeConnected ??= this.obsManager.onConnected?.(() => {
            void this.initializeObsViewerCounts().catch(error => {
                this._handleObserverError('Failed to restore viewer counts after OBS reconnect', error);
            });
        });
        if (this.obsManager && this.obsManager.isConnected()) {
            await this.initializeObsViewerCounts();
        }
    }

    async initializeObsViewerCounts() {
        const platformNames = VIEWER_COUNT_CONSTANTS.PLATFORM_NAMES;
        
        for (const platformName of platformNames) {
            try {
                const snapshot = this.getViewerCountSnapshot?.(platformName);
                if (!snapshot) continue;
                if (snapshot.hasCompleteObservation && snapshot.latestOutcome === 'complete') {
                    await this.updateObsCount(platformName, snapshot.count);
                } else await this.updateObsText(platformName, '—');
            } catch (error: unknown) {
                this.logger.debug(`Could not initialize ${platformName} viewer count (source may not exist): ${getErrorMessage(error)}`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
            }
        }

    }

    override async onViewerCountUpdate(update: ViewerCountUpdate) {
        const { platform, count, isStreamLive } = update;
        
        if (!isStreamLive && update.observationKind !== 'complete') {
            return;
        }

        try {
            await this.updateObsCount(platform, count);
        } catch (error: unknown) {
            this._handleObserverError(`Failed to update OBS for ${platform}: ${getErrorMessage(error)}`, error, { platform, count });
        }
    }

    override async onStreamStatusChange(_update: unknown) {
        // Stream status is not a viewer observation. The shared owner publishes
        // confirmed offline zero or unavailable through the count callbacks.
    }

    override async onViewerCountUnavailable({ platform }: { platform: string }) {
        await this.updateObsText(platform, '—');
    }

    validateObsUpdateParameters(platformName: unknown, count: unknown) {
        if (typeof platformName !== 'string' || platformName.trim().length === 0) {
            return { valid: false, reason: 'Platform name must be a non-empty string' };
        }
        
        if (typeof count !== 'number' || count < 0 || !Number.isSafeInteger(count)) {
            return { valid: false, reason: 'Count must be a non-negative number' };
        }
        
        return { valid: true };
    }

    isObsSourceMissingError(error: unknown) {
        if (!error || typeof error !== 'object' || typeof (error as { message?: unknown }).message !== 'string') {
            return false;
        }
        
        return (error as { message: string }).message.toLowerCase().includes('not found');
    }

    handleObsUpdateError(error: unknown, sourceName: string, platformName: string) {
        if (this.isObsSourceMissingError(error)) {
            this.logger.debug(`OBS source '${sourceName}' not found for ${platformName}`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
        } else {
            this._handleObserverError(`Failed to update OBS source '${sourceName}': ${getErrorMessage(error)}`, error, { platformName, sourceName });
        }
    }

    async updateObsCount(platformName: string, count: number) {
        const validation = this.validateObsUpdateParameters(platformName, count);
        if (!validation.valid) {
            this.logger.warn(`Invalid parameters for OBS update: ${validation.reason}`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
            return;
        }

        await this.updateObsText(platformName, this.textProcessing.formatViewerCount(count));
    }

    private async updateObsText(platformName: string, text: string) {
        if (this.disposed) return;

        if (!this.obsManager || !this.obsManager.isConnected()) {
            return;
        }

        const platformConfig = this.config[platformName.toLowerCase()];
        if (!platformConfig || !platformConfig.viewerCountEnabled) {
            return;
        }

        const sourceName = platformConfig.viewerCountSource;
        if (!sourceName) {
            this.logger.warn(`'viewerCountSource' not configured for ${platformName}`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
            return;
        }

        let write = this.writes.get(platformName);
        if (!write) {
            write = {};
            this.writes.set(platformName, write);
        }
        write.pending = text;
        if (!write.running) {
            const current = write;
            current.running = (async () => {
                try {
                    while (!this.disposed && current.pending !== undefined && this.obsManager.isConnected()) {
                        const next = current.pending;
                        delete current.pending;
                        try {
                            await this.obsManager.call('SetInputSettings', {
                                inputName: sourceName, inputSettings: { text: next }, overlay: true
                            });
                        } catch (error) { this.handleObsUpdateError(error, sourceName, platformName); }
                    }
                } finally { this.writes.delete(platformName); }
            })();
        }
        await write.running;
    }

    override async cleanup() {
        this.disposed = true;
        this.unsubscribeConnected?.();
        this.unsubscribeConnected = undefined;
        await withTimeout(Promise.allSettled([...this.writes.values()].map(write => write.running)), 5000,
            'Viewer count OBS writes did not settle').catch(() => {});
        this.writes.clear();
    }

    _handleObserverError(message: string, error: unknown, payload: Record<string, unknown> | null = null) {
        if (!this.errorHandler && this.logger) {
            this.errorHandler = createPlatformErrorHandler(this.logger, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
        }

        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, 'viewer-count', payload, message, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
            return;
        }

        if (this.errorHandler) {
            this.errorHandler.logOperationalError(message, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER, payload);
        }
    }

}

export { OBSViewerCountObserver };
