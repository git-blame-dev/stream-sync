import type { AppLogger } from '../core/logger/types';
import { VIEWER_COUNT_CONSTANTS } from '../core/constants';
import { safeSetInterval } from './timeout-validator';
import { withTimeout } from './timeout-wrapper';
import { createPlatformErrorHandler } from './platform-error-handler';
import { validateLoggerInterface } from './dependency-validator';
import type { ViewerCountObservation, ViewerCountSnapshot } from '../contracts/viewer-count';

type ViewerCountLogger = Pick<AppLogger<string>, 'debug' | 'info' | 'warn'>;

type ViewerCountPlatform = {
    readonly viewerCountIsEventDriven?: boolean;
    getViewerCount?: () => Promise<unknown> | unknown;
    getViewerCountObservation?: () => Promise<ViewerCountObservation>;
    getViewerMembershipGeneration?: () => number;
};

type ViewerCountObserver = {
    getObserverId: () => string;
    onViewerCountUpdate?: (update: ViewerCountUpdate) => Promise<unknown> | unknown;
    onStreamStatusChange?: (statusUpdate: StreamStatusUpdate) => Promise<unknown> | unknown;
    onViewerCountUnavailable?: (update: { platform: string }) => Promise<unknown> | unknown;
    initialize?: () => Promise<unknown> | unknown;
    cleanup?: () => Promise<unknown> | unknown;
};

type ViewerCountUpdate = {
    platform: string;
    count: number;
    previousCount: number;
    isStreamLive: boolean;
    timestamp: Date;
    observationKind?: 'complete';
};

type StreamStatusUpdate = {
    platform: string;
    isLive: boolean;
    wasLive: boolean;
    timestamp: Date;
};

type ViewerCountDependencies = {
    logger?: ViewerCountLogger;
    config?: {
        general?: {
            viewerCountPollingIntervalMs?: number;
        };
        youtube?: { enabled?: boolean };
        twitch?: { enabled?: boolean };
    };
    platformProvider?: () => Record<string, ViewerCountPlatform>;
    getPlatforms?: () => Record<string, ViewerCountPlatform>;
    platforms?: Record<string, ViewerCountPlatform>;
    timeProvider?: {
        now: () => number;
        createDate?: (timestampMs: number) => Date;
    };
};

function getErrorMessage(error: unknown) {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

const DEFAULT_TIME_PROVIDER = {
    now: () => Date.now(),
    createDate: (timestampMs: number) => new Date(timestampMs)
};

const resolveTimeProvider = (timeProvider?: ViewerCountDependencies['timeProvider']) => {
    if (!timeProvider) {
        return DEFAULT_TIME_PROVIDER;
    }
    if (typeof timeProvider.now !== 'function') {
        throw new Error('ViewerCountSystem timeProvider.now must be a function');
    }
    const boundNow = timeProvider.now.bind(timeProvider);
    const createDate = typeof timeProvider.createDate === 'function'
        ? timeProvider.createDate.bind(timeProvider)
        : (timestampMs: number) => new Date(timestampMs);
    return {
        now: boundNow,
        createDate
    };
};

class ViewerCountSystem {
    logger: ViewerCountLogger;
    platformProvider: () => Record<string, ViewerCountPlatform>;
    pollingIntervalMs: number | undefined;
    private youtubePollingEnabled: boolean;
    private twitchPollingEnabled: boolean;
    timeProvider: { now: () => number; createDate: (timestampMs: number) => Date };
    isPolling: boolean;
    pollingInterval: number | undefined | null;
    pollingHandles: Record<string, ReturnType<typeof setInterval>>;
    observers: Map<string, ViewerCountObserver>;
    private counts: Record<string, number>;
    private observations: Record<string, Omit<ViewerCountSnapshot, 'count'>> = {};
    private activePolls: Set<string>;
    private pollGenerations: Map<string, number>;
    private statusRevisions = new Map<string, number>();
    streamStatus: Record<string, boolean>;
    statusChangeHistory: Map<string, Array<{ timestamp: number; from: boolean; to: boolean; reason: string }>>;
    lastStatusUpdate: Map<string, number>;
    pollingStats: {
        totalPolls: number;
        successfulPolls: number;
        startTime: number;
    };
    _errorHandler: ReturnType<typeof createPlatformErrorHandler> | null;

    constructor(dependencies: ViewerCountDependencies = {}) {
        if (!dependencies.logger) {
            throw new Error('ViewerCountSystem requires logger dependency');
        }
        validateLoggerInterface(dependencies.logger);
        this.logger = dependencies.logger;
        this.platformProvider = this._createPlatformProvider(dependencies);
        if (!dependencies.config) {
            throw new Error('ViewerCountSystem requires config');
        }
        if (!dependencies.config.general) {
            throw new Error('ViewerCountSystem requires config.general');
        }
        this.pollingIntervalMs = dependencies.config.general.viewerCountPollingIntervalMs;
        this.youtubePollingEnabled = dependencies.config.youtube?.enabled === true;
        this.twitchPollingEnabled = dependencies.config.twitch?.enabled === true;
        this.timeProvider = resolveTimeProvider(dependencies.timeProvider);
        this.isPolling = false;
        this.pollingInterval = null;
        this.pollingHandles = {};

        this.observers = new Map();

        this.counts = {
            tiktok: VIEWER_COUNT_CONSTANTS.VIEWER_COUNT_ZERO,
            twitch: VIEWER_COUNT_CONSTANTS.VIEWER_COUNT_ZERO,
            youtube: VIEWER_COUNT_CONSTANTS.VIEWER_COUNT_ZERO
        };
        this.activePolls = new Set();
        this.pollGenerations = new Map();

        this.streamStatus = this._initializeStreamStatus();

        this.statusChangeHistory = new Map();
        this.lastStatusUpdate = new Map();

        this.pollingStats = {
            totalPolls: 0,
            successfulPolls: 0,
            startTime: this._now()
        };

        this._errorHandler = null;
    }

    _getErrorHandler() {
        if (!this._errorHandler) {
            this._errorHandler = createPlatformErrorHandler(this.logger, 'viewer-count');
        }
        return this._errorHandler;
    }

    _now() {
        return this.timeProvider.now();
    }

    _createDate(timestampMs: number) {
        return this.timeProvider.createDate(timestampMs);
    }

    _handleViewerCountError(message: string, error: unknown = null, eventType = 'viewer-count', eventData: unknown = null) {
        const err = error instanceof Error ? error : new Error(message);
        const handler = this._getErrorHandler();

        if (handler) {
            const payload = eventData && typeof eventData === 'object'
                ? (eventData as Record<string, unknown>)
                : null;
            handler.handleEventProcessingError(err, eventType, payload, message, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.VIEWER_COUNT);
        }
    }

    _initializeStreamStatus(): Record<string, boolean> {
        return { tiktok: false, twitch: true, youtube: false };
    }

    _trackStatusChange(platform: string, wasLive: boolean, isLive: boolean) {
        const change = {
            timestamp: this._now(),
            from: wasLive,
            to: isLive,
            reason: this._getStatusChangeReason(wasLive, isLive)
        };

        if (!this.statusChangeHistory.has(platform)) {
            this.statusChangeHistory.set(platform, []);
        }

        const history = this.statusChangeHistory.get(platform);
        if (!history) {
            return;
        }
        history.push(change);

        if (history.length > 2) {
            history.splice(0, history.length - 2);
        }

        this.lastStatusUpdate.set(platform, change.timestamp);


    }

    _getStatusChangeReason(wasLive: boolean, isLive: boolean) {
        if (!wasLive && isLive) return 'stream_started';
        if (wasLive && !isLive) return 'stream_ended';
        if (wasLive && isLive) return 'stream_continued';
        return 'stream_remained_offline';
    }

    addObserver(observer: ViewerCountObserver) {
        if (!validateObserverInterface(observer)) {
            throw new Error(VIEWER_COUNT_CONSTANTS.ERROR_MESSAGES.MISSING_OBSERVER_INTERFACE);
        }

        const observerId = observer.getObserverId();
        if (typeof observerId !== 'string' || observerId.trim().length === 0) {
            throw new Error('Observer ID must be a non-empty string');
        }

        this.observers.set(observerId, observer);
    }

    removeObserver(observerId: string) {
        if (this.observers.has(observerId)) {
            this.observers.delete(observerId);
        }
    }

    async notifyObservers(platform: string, count: number, previousCount: number) {
        const update = {
            platform,
            count,
            previousCount,
            isStreamLive: this.isStreamLive(platform),
            ...(this.observations[platform]?.hasCompleteObservation ? { observationKind: 'complete' as const } : {}),
            timestamp: this._createDate(this._now())
        };

        const notificationPromises: Array<Promise<unknown>> = [];
        for (const [observerId, observer] of this.observers) {
            try {
                if (typeof observer.onViewerCountUpdate === 'function') {
                    notificationPromises.push(Promise.resolve(observer.onViewerCountUpdate(update)));
                }
            } catch (error) {
                this._handleViewerCountError(`Error notifying observer ${observerId}: ${getErrorMessage(error)}`, error, 'observer-update', { observerId });
            }
        }

        await Promise.allSettled(notificationPromises);
    }

    async notifyStreamStatusChange(platform: string, isLive: boolean, wasLive: boolean) {
        const statusUpdate = {
            platform,
            isLive,
            wasLive,
            timestamp: this._createDate(this._now())
        };

        const notificationPromises: Array<Promise<unknown>> = [];
        for (const [observerId, observer] of this.observers) {
            try {
                if (typeof observer.onStreamStatusChange === 'function') {
                    notificationPromises.push(Promise.resolve(observer.onStreamStatusChange(statusUpdate)));
                }
            } catch (error) {
                this._handleViewerCountError(`Error notifying observer ${observerId} of status change: ${getErrorMessage(error)}`, error, 'observer-status', { observerId });
            }
        }

        await Promise.allSettled(notificationPromises);
    }

    async updateStreamStatus(platform: string, isLive: boolean, options: { countUnavailable?: boolean } = {}) {
        const platformKey = this._normalizePlatformName(platform);
        if (!Object.hasOwn(this.streamStatus, platformKey)) {
            this.logger.warn(`Unknown platform for status update: ${platform}`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.VIEWER_COUNT);
            return;
        }
        const wasLive = this.streamStatus[platformKey] ?? false;

        const revision = (this.statusRevisions.get(platformKey) ?? 0) + 1;
        this.statusRevisions.set(platformKey, revision);
        // Retire pre-transition polls before observers can yield to a newer status.
        // YouTube observations remain authoritative even while chat is offline.
        if ((wasLive !== isLive || (platformKey === 'twitch' && options.countUnavailable)) && !(platformKey === 'youtube'
            && this._hasObservationCapability(this._getPlatforms()[platformKey]))) {
            this._invalidatePlatformPoll(platformKey);
        }
        this.streamStatus[platformKey] = isLive;
        this._trackStatusChange(platformKey, wasLive, isLive);
        const countUnavailable = options.countUnavailable || (!wasLive && isLive
            && this._getPlatforms()[platformKey]?.viewerCountIsEventDriven);
        // Invalidate the old observation before status observers can yield to a
        // fresh room-user event. The later status continuation must not erase it.
        const invalidation = countUnavailable ? this._markUnavailable(platformKey) : undefined;
        if (options.countUnavailable && platformKey !== 'twitch') this.stopPlatformPolling(platformKey);

        if (wasLive !== isLive) {
            this.logger.info(`Stream status changed for ${platformKey}: ${isLive ? 'LIVE' : 'OFFLINE'}`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.VIEWER_COUNT);

            await this.notifyStreamStatusChange(platformKey, isLive, wasLive);
        }

        if (this.statusRevisions.get(platformKey) !== revision) return;
        if (invalidation) {
            await invalidation;
            if (platformKey === 'twitch' && this.isPolling && this.statusRevisions.get(platformKey) === revision) {
                this.startPlatformPolling(platformKey);
            }
            return;
        }
        await this._optimizePollingForStatusChange(platformKey, isLive, !wasLive && isLive);
    }

    async _optimizePollingForStatusChange(platformKey: string, isLive: boolean, becameLive = false) {
        if (this._getPlatforms()[platformKey]?.viewerCountIsEventDriven && isLive) {
            return;
        }
        if (platformKey === 'youtube' && becameLive && this.isPolling && this.pollingHandles[platformKey]) {
            void this.pollPlatform(platformKey);
        }
        if (platformKey === 'youtube' && this._hasObservationCapability(this._getPlatforms()[platformKey])) {
            if (this.isPolling) this.startPlatformPolling(platformKey);
            return;
        }
        if (platformKey === 'twitch') {
            // EventSub can miss stream.online while disconnected. Keep the same
            // bounded Helix cadence offline so viewer observations can recover.
            if (!isLive) await this.updateViewerCount(platformKey, VIEWER_COUNT_CONSTANTS.VIEWER_COUNT_ZERO);
            if (this.isPolling) this.startPlatformPolling(platformKey);
            return;
        }
        if (isLive && this.isPolling) {
            this.startPlatformPolling(platformKey);
        } else if (!isLive) {
            this.stopPlatformPolling(platformKey);
            await this.updateViewerCount(platformKey, VIEWER_COUNT_CONSTANTS.VIEWER_COUNT_ZERO);
        }
    }

    isStreamLive(platform: string) {
        return this.streamStatus[this._normalizePlatformName(platform)] === true;
    }

    getViewerCount(platform: string) {
        const key = this._normalizePlatformName(platform);
        return Object.hasOwn(this.counts, key) ? this.counts[key] : undefined;
    }

    getViewerCounts() {
        return Object.freeze({ ...this.counts });
    }

    getViewerCountSnapshot(platform: string): ViewerCountSnapshot {
        const key = this._normalizePlatformName(platform);
        return { count: this.getViewerCount(key) ?? 0, hasCompleteObservation: false, lastCompleteAt: null,
            latestOutcome: 'unknown', ...this.observations[key] };
    }

    async updateViewerCount(platform: string, count: unknown, observation?: { membershipGeneration?: number; isCurrent: () => boolean }) {
        const platformKey = this._normalizePlatformName(platform);
        if (!Object.hasOwn(this.counts, platformKey)) {
            this.logger.warn(`Unknown platform for viewer count update: ${platform}`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.VIEWER_COUNT);
            return false;
        }
        if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
            this.logger.warn(`Invalid viewer count for ${platformKey}: ${JSON.stringify(count)}`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.VIEWER_COUNT);
            return false;
        }

        const previousCount = this.counts[platformKey] ?? VIEWER_COUNT_CONSTANTS.VIEWER_COUNT_ZERO;
        const completedAt = this._now();
        if (observation && !observation.isCurrent()) return false;
        this.counts[platformKey] = count;
        this.observations[platformKey] = { hasCompleteObservation: true, lastCompleteAt: completedAt,
            latestOutcome: 'complete', ...(observation?.membershipGeneration === undefined ? {} : { membershipGeneration: observation.membershipGeneration }) };
        if (count !== previousCount) this.logger.info(`${platformKey} viewer count: ${count}`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.VIEWER_COUNT);
        await this.notifyObservers(platformKey, count, previousCount);
        return true;
    }

    async initialize() {
        await this.initializeObservers();

        return Promise.resolve();
    }

    async initializeObservers() {
        const initializationPromises: Array<Promise<unknown>> = [];

        for (const [observerId, observer] of this.observers) {
            try {
                if (typeof observer.initialize === 'function') {
                    initializationPromises.push(Promise.resolve(observer.initialize()));
                }
            } catch (error) {
                this._handleViewerCountError(`Error initializing observer ${observerId}: ${getErrorMessage(error)}`, error, 'observer-init', { observerId });
            }
        }

        await Promise.allSettled(initializationPromises);
    }

    startPolling() {
        if (this.isPolling) {
            this.logger.warn('Polling is already active.', VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.VIEWER_COUNT);
            return;
        }

        this.pollingInterval = this.pollingIntervalMs;
        const intervalMs = this.pollingInterval ?? 0;
        const pollingIntervalSeconds = intervalMs / VIEWER_COUNT_CONSTANTS.MS_PER_SECOND;

        if (intervalMs <= 0) {
            this.logger.warn('Polling interval is zero or negative. Viewer count polling disabled.', VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.VIEWER_COUNT);
            return;
        }

        this.isPolling = true;
        this.logger.debug(`Starting stream-aware viewer count polling every ${pollingIntervalSeconds} seconds`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.VIEWER_COUNT);

        const platforms = this._getPlatforms();
        const platformNames = Object.keys(platforms);

        for (const platformName of platformNames) {
            const isLive = this.isStreamLive(platformName);

            if (isLive || platformName === 'twitch' || (platformName === 'youtube' && this._hasObservationCapability(platforms[platformName]))) {
                this.startPlatformPolling(platformName);
            }
        }
        // Registration and chat initialization may still be pending. Reserve the
        // existing polling cadence for enabled platforms independently.
        if (this.youtubePollingEnabled && !this.pollingHandles.youtube) this.startPlatformPolling('youtube');
        if (this.twitchPollingEnabled && !this.pollingHandles.twitch) this.startPlatformPolling('twitch');
    }

    startPlatformPolling(platformName: string) {
        const platformKey = this._normalizePlatformName(platformName);
        // TikTok room-user events are the observations; rereading their cache
        // would falsely renew freshness without receiving new platform data.
        if (this._getPlatforms()[platformKey]?.viewerCountIsEventDriven) return;

        if (this.pollingHandles[platformKey]) {
            return;
        }

        this.logger.debug(`Starting viewer count polling for ${platformKey} (interval: ${this.pollingInterval}ms)`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.VIEWER_COUNT);

        void this.pollPlatform(platformKey);

        this.pollingHandles[platformKey] = safeSetInterval(
            () => {
                void this.pollPlatform(platformKey);
            },
            this.pollingInterval
        );
    }

    stopPlatformPolling(platformName: string) {
        const platformKey = this._normalizePlatformName(platformName);
        this._invalidatePlatformPoll(platformKey);
        const handle = this.pollingHandles[platformKey];
        if (handle) {
            clearInterval(handle);
            delete this.pollingHandles[platformKey];
            this._runCleanupDiagnostic(() => this.logger.debug(`Stopping viewer count polling for ${platformKey}`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.VIEWER_COUNT));
        }
    }

    isPlatformEligibleForPolling(platformName: string) {
        const validation = this.validatePlatformForPolling(platformName);
        return validation.valid;
    }

    getPollingEfficiency() {
        const { totalPolls, successfulPolls, startTime } = this.pollingStats;
        const runtime = this._now() - startTime;

        return {
            successRate: totalPolls > 0 ? (successfulPolls / totalPolls) * 100 : 0,
            totalPolls,
            successfulPolls,
            failedPolls: totalPolls - successfulPolls,
            runtime,
            pollsPerMinute: runtime > 0 ? (totalPolls / (runtime / 60000)) : 0,
            averageInterval: totalPolls > 0 ? runtime / totalPolls : 0
        };
    }

    getStreamStatusHistory(platform: string) {
        return this.statusChangeHistory.get(platform.toLowerCase()) || [];
    }

    getSystemStatus() {
        const efficiency = this.getPollingEfficiency();

        return {
            isPolling: this.isPolling,
            pollingInterval: this.pollingInterval,
            streamStatus: { ...this.streamStatus },
            viewerCounts: { ...this.counts },
            efficiency,
            observerCount: this.observers.size,
            activePollingPlatforms: Object.keys(this.pollingHandles),
            lastStatusUpdates: Object.fromEntries(this.lastStatusUpdate),
            memoryUsage: this._getMemoryUsage()
        };
    }

    _performMemoryCleanup() {

        for (const handle of Object.values(this.pollingHandles)) {
            if (handle) {
                clearInterval(handle as ReturnType<typeof setInterval>);
            }
        }
        this.pollingHandles = {};

        this.observers.clear();
        this.statusChangeHistory.clear();
        this.lastStatusUpdate.clear();

        Object.keys(this.counts).forEach(platform => {
            this.counts[platform] = VIEWER_COUNT_CONSTANTS.VIEWER_COUNT_ZERO;
        });
        this.observations = {};

        this.pollingStats = {
            totalPolls: 0,
            successfulPolls: 0,
            startTime: this._now()
        };
    }

    _getMemoryUsage() {
        return {
            observerCount: this.observers.size,
            activePollingHandles: Object.keys(this.pollingHandles).length,
            statusHistorySize: (Array.from(this.statusChangeHistory.values()) as Array<{ length: number }>)
                .reduce((total: number, history) => total + history.length, 0),
        };
    }

    _normalizePlatformName(platform: string) {
        return platform.trim().toLowerCase();
    }

    _getPollGeneration(platform: string) {
        return this.pollGenerations.get(platform) ?? 0;
    }

    _invalidatePlatformPoll(platform: string) {
        this.pollGenerations.set(platform, this._getPollGeneration(platform) + 1);
    }

    _createPlatformProvider(dependencies: ViewerCountDependencies) {
        if (dependencies && typeof dependencies.platformProvider === 'function') {
            return dependencies.platformProvider;
        }

        if (dependencies && typeof dependencies.getPlatforms === 'function') {
            const getPlatforms = dependencies.getPlatforms;
            return () => getPlatforms();
        }

        if (dependencies && dependencies.platforms && typeof dependencies.platforms === 'object') {
            const platforms = dependencies.platforms;
            return () => platforms;
        }

        return () => ({});
    }

    _getPlatforms(): Record<string, ViewerCountPlatform> {
        try {
            const platforms = this.platformProvider ? this.platformProvider() : {};
            if (platforms && typeof platforms === 'object') {
                return platforms;
            }
        } catch (error) {
            this._handleViewerCountError(
                'Failed to resolve platforms for viewer count system',
                error,
                'platform-resolution'
            );
        }

        return {};
    }

    stopPolling() {
        const wasPolling = this.isPolling;
        this.isPolling = false;

        const platformNames = new Set([
            ...Object.keys(this.pollingHandles),
            ...this.activePolls
        ]);
        for (const platformName of platformNames) {
            this.stopPlatformPolling(platformName);
        }
        this.pollingHandles = {};

        if (wasPolling) {
            this._runCleanupDiagnostic(() => this.logger.debug('Polling stopped.', VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.VIEWER_COUNT));
        }
    }

    validatePlatformForPolling(platformName: string): { valid: false; reason: string } | { valid: true; platform: ViewerCountPlatform } {
        const platformKey = this._normalizePlatformName(platformName);
        const platforms = this._getPlatforms();
        const platform = platforms[platformKey];

        if (!platform) {
            return { valid: false, reason: `No platform found for ${platformKey}` };
        }
        if (platform.viewerCountIsEventDriven) return { valid: false, reason: 'Viewer counts are event driven' };

        if (platformKey === 'youtube' && this._hasObservationCapability(platform)) return { valid: true, platform };
        if (typeof platform.getViewerCount !== 'function') {
            return { valid: false, reason: `No getViewerCount method for ${platformKey}` };
        }

        if (platformKey !== 'twitch' && !this.isStreamLive(platformKey)) {
            return { valid: false, reason: `Stream offline for ${platformKey}` };
        }

        return { valid: true, platform };
    }

    private _hasObservationCapability(platform: ViewerCountPlatform | undefined): platform is ViewerCountPlatform & {
        getViewerCountObservation: () => Promise<ViewerCountObservation>;
        getViewerMembershipGeneration: () => number;
    } {
        return typeof platform?.getViewerCountObservation === 'function' && typeof platform.getViewerMembershipGeneration === 'function';
    }

    async pollPlatform(platformName: string) {
        const platformKey = this._normalizePlatformName(platformName);
        if (this.activePolls.has(platformKey)) {
            return;
        }

        const validation = this.validatePlatformForPolling(platformKey);

        if (!validation.valid) {
            const reasonText = typeof validation.reason === 'string' ? validation.reason : 'Viewer count polling validation failed';
            if (Object.hasOwn(this.counts, platformKey) && !reasonText.includes('offline') && !reasonText.includes('event driven')) {
                await this._markUnavailable(platformKey);
            }
            const waitingForRegistration = ((platformKey === 'youtube' && this.youtubePollingEnabled)
                || (platformKey === 'twitch' && this.twitchPollingEnabled)) && reasonText.includes('No platform found');
            if (!waitingForRegistration && !reasonText.includes('offline')) {
                this.logger.warn(reasonText, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.VIEWER_COUNT);
            }
            return;
        }

        const pollGeneration = this._getPollGeneration(platformKey);
        this.activePolls.add(platformKey);
        this.pollingStats.totalPolls++;

        try {
            const platform = validation.platform;
            const isSamePoll = () => pollGeneration === this._getPollGeneration(platformKey)
                && this._getPlatforms()[platformKey] === platform;
            if (platformKey === 'youtube' && this._hasObservationCapability(platform)) {
                const observation = await platform.getViewerCountObservation();
                const isCurrent = () => isSamePoll() && platform.getViewerMembershipGeneration() === observation.membershipGeneration;
                if (observation.kind === 'complete') {
                    if (await this.updateViewerCount(platformKey, observation.count, {
                        membershipGeneration: observation.membershipGeneration, isCurrent
                    })) this.pollingStats.successfulPolls++;
                    else if (isSamePoll()) await this._markUnavailable(platformKey);
                } else if (isSamePoll()) {
                    await this._markUnavailable(platformKey);
                }
                return;
            }
            if (!platform || typeof platform.getViewerCount !== 'function') {
                this.logger.warn(`No getViewerCount method for ${platformKey}`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.VIEWER_COUNT);
                return;
            }

            const count = await platform.getViewerCount();

            if (!isSamePoll() || (platformKey !== 'twitch' && !this.isStreamLive(platformKey))) {
                this.logger.debug(`Discarding stale viewer count poll for ${platformKey}`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.VIEWER_COUNT);
                return;
            }

            if (count !== null && count !== undefined) {
                if (await this.updateViewerCount(platformKey, count, { isCurrent: () => isSamePoll() && (platformKey === 'twitch' || this.isStreamLive(platformKey)) })) {
                    this.pollingStats.successfulPolls++;
                } else if (isSamePoll()) await this._markUnavailable(platformKey);
            } else {
                await this._markUnavailable(platformKey);
                this.logger.warn(`${platformKey} returned null/undefined viewer count`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.VIEWER_COUNT);
            }
        } catch (error) {
            if (pollGeneration === this._getPollGeneration(platformKey)
                && this._getPlatforms()[platformKey] === validation.platform) await this._markUnavailable(platformKey);
            this._handleViewerCountError(`Failed to poll ${platformKey}: ${getErrorMessage(error)}`, error, 'polling', { platform: platformKey });
        } finally {
            this.activePolls.delete(platformKey);
        }
    }

    private _runCleanupDiagnostic(diagnostic: () => void) {
        try {
            diagnostic();
        } catch {
            // Diagnostics cannot prevent retiring polling or other observers.
        }
    }

    private async _markUnavailable(platformKey: string): Promise<void> {
        this.observations[platformKey] = { hasCompleteObservation: false, lastCompleteAt: null,
            ...this.observations[platformKey], latestOutcome: 'unavailable' };
        const notifications = [...this.observers.values()].map(async observer => {
            await observer.onViewerCountUnavailable?.({ platform: platformKey });
        });
        await Promise.allSettled(notifications);
    }

    async cleanup() {
        for (const platform of Object.keys(this.streamStatus)) {
            this.statusRevisions.set(platform, (this.statusRevisions.get(platform) ?? 0) + 1);
        }
        this.stopPolling();


        const cleanupPromises: Array<Promise<unknown>> = [];
        const observerEntries = Array.from(this.observers.entries()) as Array<[string, { cleanup?: () => Promise<unknown> | unknown }]>;

        for (const [observerId, observer] of observerEntries) {
            try {
                if (typeof observer.cleanup === 'function') {
                    cleanupPromises.push(
                        Promise.resolve(observer.cleanup()).catch(error => {
                            this._runCleanupDiagnostic(() => this._handleViewerCountError(`Observer cleanup failed for ${observerId}: ${getErrorMessage(error)}`, error, 'observer-cleanup', { observerId }));
                        })
                    );
                }
            } catch (error) {
                this._runCleanupDiagnostic(() => this._handleViewerCountError(`Error initiating cleanup for observer ${observerId}: ${getErrorMessage(error)}`, error, 'observer-cleanup', { observerId }));
            }
        }

        // Wait for observer cleanups with timeout to prevent hanging
        try {
            await withTimeout(Promise.allSettled(cleanupPromises), 5000, {
                errorMessage: 'Observer cleanup timed out'
            });
        } catch (error) {
            this._runCleanupDiagnostic(() => this.logger.warn(`Observer cleanup timed out or failed: ${getErrorMessage(error)}`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.VIEWER_COUNT));
        }

        this._performMemoryCleanup();
    }
}

function validateObserverInterface(observer: unknown) {
    if (!observer || typeof observer !== 'object') {
        return false;
    }

    return typeof (observer as { getObserverId?: unknown }).getObserverId === 'function';
}

export { ViewerCountSystem };
