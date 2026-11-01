import type { AppLogger } from '../core/logger/types';
import { logger } from '../core/logging';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { createRetrySystem } from '../utils/retry-system';
import { safeDelay, safeSetTimeout } from '../utils/timeout-validator';
import { getOBSConnectionManager } from './connection';
import { getDefaultSourcesManager } from './sources';

type EffectsLogger = Pick<AppLogger<string>, 'debug' | 'warn'>;

type ObsManagerLike = {
    ensureConnected: () => Promise<void>;
    call: (requestType: string, payload?: Record<string, unknown>) => Promise<unknown>;
    addEventListener?: (eventName: string, handler: (event?: Record<string, unknown>) => void) => void;
    removeEventListener?: (eventName: string, handler: (event?: Record<string, unknown>) => void) => void;
};

type ObsManagerWithEvents = ObsManagerLike & {
    addEventListener: (eventName: string, handler: (event?: Record<string, unknown>) => void) => void;
    removeEventListener: (eventName: string, handler: (event?: Record<string, unknown>) => void) => void;
};

type SourcesManagerLike = {
    setSourceFilterEnabled?: (sourceName: string, filterName: string, enabled: boolean) => Promise<unknown> | unknown;
    getSourceFilterSettings?: (sourceName: string, filterName: string) => Promise<unknown> | unknown;
    setSourceFilterSettings?: (sourceName: string, filterName: string, settings: Record<string, unknown>) => Promise<unknown> | unknown;
};

type RetrySystemLike = {
    delay?: (ms: number, minMs: number, context: string) => Promise<void>;
};

type EffectsDependencies = {
    logger?: EffectsLogger;
    sourcesManager?: SourcesManagerLike;
    eventBus?: unknown;
    retrySystem?: RetrySystemLike;
    delay?: (ms: number, minMs: number, context: string) => Promise<void>;
};

function hasObsEventListeners(obsManager: ObsManagerLike): obsManager is ObsManagerWithEvents {
    return typeof obsManager.addEventListener === 'function' && typeof obsManager.removeEventListener === 'function';
}

type MediaWaiter = { promise: Promise<void>; cancel: (reason?: Error) => void };
type MediaRequest = {
    cancelled: Promise<never>;
    reason?: Error;
    cancel: (reason: Error) => void;
    waiter?: MediaWaiter;
};

function cancellationError(message: string): Error {
    return Object.assign(new Error(message), { name: 'AbortError' });
}

class OBSEffectsManager {
    private disposed = false;
    private readonly requests = new Map<string, MediaRequest>();
    private readonly waiters = new Set<MediaWaiter>();
    obsManager: ObsManagerLike;
    logger: EffectsLogger;
    log: EffectsLogger;
    sourcesManager: SourcesManagerLike | undefined;
    eventBus: unknown;
    retrySystem: RetrySystemLike;
    ensureOBSConnected: () => Promise<void>;
    obsCall: (requestType: string, payload: Record<string, unknown>) => Promise<unknown>;
    setSourceFilterEnabled?: (sourceName: string, filterName: string, enabled: boolean) => Promise<unknown> | unknown;
    getSourceFilterSettings?: (sourceName: string, filterName: string) => Promise<unknown> | unknown;
    setSourceFilterSettings?: (sourceName: string, filterName: string, settings: Record<string, unknown>) => Promise<unknown> | unknown;
    delay: (ms: number, minMs: number, context: string) => Promise<void>;
    errorHandler: ReturnType<typeof createPlatformErrorHandler>;

    constructor(obsManager: ObsManagerLike, dependencies: EffectsDependencies = {}) {
        if (!obsManager) {
            throw new Error('OBSEffectsManager requires OBSConnectionManager instance');
        }

        this.obsManager = obsManager;

        this.logger = dependencies.logger || logger;
        this.log = this.logger;
        this.sourcesManager = dependencies.sourcesManager;
        this.eventBus = dependencies.eventBus;
        this.retrySystem = dependencies.retrySystem ?? (createRetrySystem({ logger: this.logger }) as RetrySystemLike);

        this.ensureOBSConnected = this.obsManager.ensureConnected.bind(this.obsManager);
        this.obsCall = this.obsManager.call.bind(this.obsManager);

        if (this.sourcesManager) {
            if (this.sourcesManager.setSourceFilterEnabled) {
                this.setSourceFilterEnabled = this.sourcesManager.setSourceFilterEnabled.bind(this.sourcesManager);
            }
            if (this.sourcesManager.getSourceFilterSettings) {
                this.getSourceFilterSettings = this.sourcesManager.getSourceFilterSettings.bind(this.sourcesManager);
            }
            if (this.sourcesManager.setSourceFilterSettings) {
                this.setSourceFilterSettings = this.sourcesManager.setSourceFilterSettings.bind(this.sourcesManager);
            }
        }

        this.delay = dependencies.delay || this.retrySystem.delay || safeDelay;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'obs-effects');
    }

    private assertActive() {
        if (this.disposed) throw cancellationError('OBS effects manager is disposed');
    }

    private beginRequest(source: string): MediaRequest {
        this.assertActive();
        this.requests.get(source)?.cancel(cancellationError(`OBS media request superseded: ${source}`));
        let reject!: (reason: Error) => void;
        const cancelled = new Promise<never>((_resolve, rejectPromise) => { reject = rejectPromise; });
        // Cancellation may precede the next await; always observe it immediately.
        void cancelled.catch(() => {});
        const request: MediaRequest = {
            cancelled,
            cancel: reason => {
                if (request.reason) return;
                request.reason = reason;
                request.waiter?.cancel(reason);
                reject(reason);
            }
        };
        this.requests.set(source, request);
        return request;
    }

    private awaitRequest<T>(request: MediaRequest, operation: Promise<T>): Promise<T> {
        return Promise.race([operation, request.cancelled]);
    }

    private assertRequest(request: MediaRequest) {
        this.assertActive();
        if (request.reason) throw request.reason;
    }

    private finishRequest(source: string, request: MediaRequest) {
        request.waiter?.cancel();
        if (this.requests.get(source) === request) this.requests.delete(source);
    }

    /** Permanently close admission and settle all locally owned requests/waits. */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        const reason = cancellationError('OBS effects manager is disposed');
        for (const request of this.requests.values()) request.cancel(reason);
        this.requests.clear();
        for (const waiter of this.waiters) waiter.cancel(reason);
    }

    async playMediaInOBS(commandConfig: { mediaSource?: string; filename?: string; vfxFilePath?: string }, waitForCompletion = true) {
        if (!commandConfig || !commandConfig.mediaSource || !commandConfig.filename || !commandConfig.vfxFilePath) {
            throw new Error('No media config provided with source, filename, and vfxFilePath');
        }
        const source = commandConfig.mediaSource;
        const request = this.beginRequest(source);
        try {
            await this.awaitRequest(request, this.ensureOBSConnected());
            this.assertRequest(request);
            const filePath = `${commandConfig.vfxFilePath}/${commandConfig.filename}.mp4`;
            this.logger.debug(`Playing media: ${commandConfig.filename} in source: ${source} from path: ${filePath}`, 'obs-effects');
            await this.awaitRequest(request, this.obsCall('SetInputSettings', {
                inputName: source,
                inputSettings: { local_file: filePath, looping: false },
                overlay: false
            }));
            this.assertRequest(request);

            // Arm immediately before dispatch: completion can precede the trigger acknowledgement.
            // The 10s event budget starts here, not at acknowledgement. It does not time out RPCs.
            // OBS exposes source identity, not playback identity: delayed old ends remain ambiguous.
            if (waitForCompletion) request.waiter = this.createMediaWaiter(source, 10000);
            await this.awaitRequest(request, this.obsCall('TriggerMediaInputAction', {
                inputName: source,
                mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART'
            }));
            this.assertRequest(request);
            if (request.waiter) {
                await this.awaitRequest(request, request.waiter.promise);
                this.assertRequest(request);
            }

        } catch (error) {
            if (!request.reason) this._handleEffectsError(`[VFX] Failed to play media: ${commandConfig.filename}`, error, { command: commandConfig });
            throw error;
        } finally {
            this.finishRequest(source, request);
        }
    }

    async waitForMediaCompletion(mediaSourceName: string, timeoutMs = 10000) {
        this.assertActive();
        if (!this.obsManager) {
            this.logger.warn('No OBS manager available, skipping wait', 'obs-effects');
            return;
        }
        return this.createMediaWaiter(mediaSourceName, timeoutMs).promise;
    }

    private createMediaWaiter(source: string, timeoutMs: number): MediaWaiter {
        this.assertActive();
        const obs = this.obsManager;
        if (!hasObsEventListeners(obs)) {
            throw new Error('OBS manager requires event listener support to wait for media completion');
        }
        let resolve!: () => void;
        let reject!: (reason: Error) => void;
        const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
        // A trigger may still be awaiting acknowledgement when disposal rejects this waiter.
        void promise.catch(() => {});
        let settled = false;
        let timer: ReturnType<typeof safeSetTimeout> | undefined;
        const settle = (reason?: Error) => {
            if (settled) return;
            settled = true;
            if (timer !== undefined) clearTimeout(timer);
            obs.removeEventListener('MediaInputPlaybackEnded', onEnd);
            this.waiters.delete(waiter);
            if (reason) reject(reason); else resolve();
        };
        const onEnd = (data?: Record<string, unknown>) => {
            if (data?.inputName === source) settle();
        };
        const waiter: MediaWaiter = { promise, cancel: settle };
        this.waiters.add(waiter);
        obs.addEventListener('MediaInputPlaybackEnded', onEnd);
        timer = safeSetTimeout(() => {
            this.logger.warn(`Media completion wait timed out: ${source}`, 'obs-effects', { timeoutMs });
            settle();
        }, timeoutMs);
        return waiter;
    }

    async triggerMediaAction(inputName: string, mediaAction: string) {
        const request = this.beginRequest(inputName);
        try {
            await this.awaitRequest(request, this.ensureOBSConnected());
            this.assertRequest(request);
            await this.awaitRequest(request, this.obsCall('TriggerMediaInputAction', { inputName, mediaAction }));
            this.assertRequest(request);
            this.logger.debug(`Successfully triggered action on: ${inputName}`, 'obs-effects');
        } catch (error) {
            if (!request.reason) this._handleEffectsError(`[Media] Error triggering action on ${inputName}`, error, { inputName, mediaAction });
            throw error;
        } finally {
            this.finishRequest(inputName, request);
        }
    }

    _handleEffectsError(message: string, error: unknown, payload: Record<string, unknown> | null = null) {
        if (!this.errorHandler && this.logger) {
            this.errorHandler = createPlatformErrorHandler(this.logger, 'obs-effects');
        }

        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, 'obs-effects', payload, message, 'obs-effects');
            return;
        }

        if (this.errorHandler) {
            this.errorHandler.logOperationalError(message, 'obs-effects', payload);
        }
    }
}

function createOBSEffectsManager(obsManager: ObsManagerLike, dependencies: EffectsDependencies = {}) {
    return new OBSEffectsManager(obsManager, dependencies);
}

let defaultInstance: OBSEffectsManager | null = null;
function getDefaultEffectsManager() {
    if (!defaultInstance) {
        defaultInstance = createOBSEffectsManager(
            getOBSConnectionManager(),
            {
                logger,
                sourcesManager: getDefaultSourcesManager()
            }
        );
    }
    return defaultInstance;
}

function resetDefaultEffectsManager() {
    defaultInstance = null;
}

export {
    OBSEffectsManager,
    getDefaultEffectsManager,
    resetDefaultEffectsManager
};
