import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { AsyncLocalStorage } from 'node:async_hooks';
import { withOperationDeadline } from '../utils/timeout-wrapper';

const RETIREMENT_TIMEOUT_MS = 5000;

export type InnertubeOperationContext = { signal?: AbortSignal; timeoutMs?: number };
type OwnedFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type InnertubeChatClientOwner<T> = {
    client: T;
    run: <R>(operation: (client: T) => Promise<R>, context?: InnertubeOperationContext) => Promise<R>;
    dispose: () => Promise<void>;
};
type Lifetime = { controller: AbortController; active: Set<Promise<unknown>>; disposal?: Promise<void> };

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    return new Promise<T>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}

type LoggerLike = {
    error: (message: string, scope?: string, payload?: unknown) => void;
    debug?: (message: string, scope?: string, payload?: unknown) => void;
};

type InnertubeInfoClient = {
    getInfo: (videoId: string, options?: Record<string, unknown>) => Promise<unknown>;
};

type InnertubeFactoryLike<TClient extends InnertubeInfoClient> = {
    createWithTimeout: (timeoutMs?: number, config?: Record<string, unknown>) => Promise<TClient>;
    createWithConfig?: (config?: Record<string, unknown>) => Promise<TClient>;
};

type TimeoutWrapper = <T>(promise: Promise<T>, timeoutMs: number, operationName: string) => Promise<T>;

type CachedInnertubeInstance = {
    instance: InnertubeInfoClient;
    created: number;
    lastUsed: number;
};

type ServiceStats = {
    instancesCreated: number;
    cacheHits: number;
    cacheMisses: number;
    errors: number;
    retirementTimeouts: number;
    startTime: number;
};

class InnertubeService<TClient extends InnertubeInfoClient = InnertubeInfoClient> {
    factory: InnertubeFactoryLike<TClient>;
    logger: LoggerLike;
    withTimeout?: TimeoutWrapper;
    errorHandler: ReturnType<typeof createPlatformErrorHandler>;
    instanceCache: Map<string, CachedInnertubeInstance>;
    lastCleanup: number;
    cleanupInterval: number;
    stats: ServiceStats;
    private scopes = new AsyncLocalStorage<AbortSignal>();
    private lifetime: Lifetime = { controller: new AbortController(), active: new Set() };
    private owners = new Set<Lifetime>();
    private metadata: { lifetime: Lifetime; pending: Promise<TClient> } | undefined;
    private externalFetch: OwnedFetch;
    private initializationTimeoutMs: number;
    private requestTimeoutMs: number;
    private creationConfig: Record<string, unknown>;

    constructor(factory: InnertubeFactoryLike<TClient>, dependencies: { logger: LoggerLike; withTimeout?: TimeoutWrapper; cleanupInterval?: number; fetch?: OwnedFetch; initializationTimeoutMs?: number; requestTimeoutMs?: number; creationConfig?: Record<string, unknown> }) {
        this.factory = factory;
        if (!dependencies.logger || typeof dependencies.logger.error !== 'function') {
            throw new Error('InnertubeService requires a logger');
        }

        this.logger = dependencies.logger;
        this.externalFetch = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
        this.initializationTimeoutMs = dependencies.initializationTimeoutMs ?? 10000;
        this.requestTimeoutMs = dependencies.requestTimeoutMs ?? 8000;
        this.creationConfig = dependencies.creationConfig ?? {};
        if (dependencies.withTimeout !== undefined) {
            this.withTimeout = dependencies.withTimeout;
        }
        this.errorHandler = createPlatformErrorHandler(this.logger, 'innertube-service');

        this.instanceCache = new Map();
        this.lastCleanup = Date.now();
        this.cleanupInterval = dependencies.cleanupInterval || 300000;

        this.stats = {
            instancesCreated: 0,
            cacheHits: 0,
            cacheMisses: 0,
            errors: 0,
            retirementTimeouts: 0,
            startTime: Date.now()
        };
    }

    private signal(context: InnertubeOperationContext, lifetime = this.lifetime): AbortSignal {
        return AbortSignal.any([this.lifetime.controller.signal, lifetime.controller.signal,
            AbortSignal.timeout(context.timeoutMs ?? this.requestTimeoutMs),
            ...(context.signal ? [context.signal] : [])]);
    }

    private track<T>(lifetime: Lifetime, pending: Promise<T>): Promise<T> {
        // Register actual completion, never the caller-facing cancellation race.
        lifetime.active.add(pending);
        void pending.finally(() => lifetime.active.delete(pending)).catch(() => {});
        return pending;
    }

    private retire(lifetime: Lifetime): Promise<void> {
        if (!lifetime.disposal) {
            let complete!: () => void;
            lifetime.disposal = new Promise<void>(resolve => { complete = resolve; });
            lifetime.controller.abort(new Error('Innertube owner disposed'));
            void this.join(lifetime).finally(() => {
                this.owners.delete(lifetime);
                complete();
            }).catch(() => {});
        }
        return lifetime.disposal;
    }

    private async join(lifetime: Lifetime): Promise<void> {
        try {
            await withOperationDeadline(async () => { await Promise.allSettled([...lifetime.active]); }, {
                budgetMs: RETIREMENT_TIMEOUT_MS, operationName: 'Innertube retirement'
            });
        } catch {
            this.stats.retirementTimeouts += 1;
            this.errorHandler.logOperationalError(
                `Innertube retirement deadline exceeded after ${RETIREMENT_TIMEOUT_MS}ms; ${lifetime.active.size} operations may still be running`,
                'innertube-service'
            );
        } finally {
            lifetime.active.clear();
        }
    }

    private createOwnedClient(lifetime: Lifetime): Promise<TClient> {
        const fetch: OwnedFetch = (input, init) => {
            const signal = AbortSignal.any([this.lifetime.controller.signal, lifetime.controller.signal,
                AbortSignal.timeout(this.requestTimeoutMs),
                ...(this.scopes.getStore() ? [this.scopes.getStore()!] : []),
                ...(input instanceof Request ? [input.signal] : []), ...(init?.signal ? [init.signal] : [])]);
            signal.throwIfAborted();
            return abortable(this.track(lifetime, this.externalFetch(input, { ...init, signal })), signal);
        };
        const signal = this.signal({ timeoutMs: this.initializationTimeoutMs }, lifetime);
        // The microtask is registered outside caller scope and after the owner is published.
        const pending = this.scopes.run(signal, () => this.track(lifetime, Promise.resolve().then(async () => {
            signal.throwIfAborted();
            const config = { ...this.creationConfig, retrieve_player: false, fetch };
            // Production adapters expose the raw creation promise, not a timeout race.
            const client = await (this.factory.createWithConfig
                ? this.factory.createWithConfig(config)
                : this.factory.createWithTimeout(this.initializationTimeoutMs, config));
            signal.throwIfAborted();
            this.stats.instancesCreated += 1;
            return client;
        })));
        return abortable(pending, signal);
    }

    private sharedClient(): Promise<TClient> {
        this.lifetime.controller.signal.throwIfAborted();
        if (this.metadata) {
            this.stats.cacheHits += 1;
            return this.metadata.pending;
        }
        this.stats.cacheMisses += 1;
        const lifetime: Lifetime = { controller: new AbortController(), active: new Set() };
        this.owners.add(lifetime);
        const pending = this.scopes.exit(() => this.createOwnedClient(lifetime));
        const entry = { lifetime, pending };
        this.metadata = entry;
        void pending.catch(() => {
            if (this.metadata === entry) this.metadata = undefined;
            void this.retire(lifetime);
        });
        return pending;
    }

    // Include all SDK continuations, extraction and fallbacks here; return domain data, not SDK objects.
    withMetadataOperation<T>(context: InnertubeOperationContext, operation: (client: TClient) => Promise<T>): Promise<T> {
        const signal = this.signal(context);
        signal.throwIfAborted();
        const pending = this.sharedClient();
        const work = this.scopes.run(signal, () => this.track(this.lifetime, (async () => {
            const client = await abortable(pending, signal);
            signal.throwIfAborted();
            return await operation(client);
        })()));
        return abortable(work, signal);
    }

    // The setup deadline is not the polling lifetime. Start background work through owner.run().
    async createChatClient(context: InnertubeOperationContext = {}): Promise<InnertubeChatClientOwner<TClient>> {
        const signal = this.signal(context);
        signal.throwIfAborted();
        const lifetime: Lifetime = { controller: new AbortController(), active: new Set() };
        this.owners.add(lifetime);
        try {
            const client = await abortable(this.scopes.exit(() => this.createOwnedClient(lifetime)), signal);
            signal.throwIfAborted();
            return {
                client,
                run: (operation, context) => this.scopes.exit(() => {
                    lifetime.controller.signal.throwIfAborted();
                    this.lifetime.controller.signal.throwIfAborted();
                    // Explicit setup scopes bound all SDK continuations. Omitted
                    // context keeps polling outside any short caller ALS scope.
                    const signal = context === undefined
                        ? lifetime.controller.signal
                        : this.signal(context, lifetime);
                    signal.throwIfAborted();
                    return this.scopes.run(signal, () => abortable(this.track(lifetime, Promise.resolve().then(() => {
                        signal.throwIfAborted();
                        return operation(client);
                    })), signal));
                }),
                dispose: () => this.retire(lifetime)
            };
        } catch (error) {
            void this.retire(lifetime);
            throw error;
        }
    }

    async getSharedInstance(key = 'shared'): Promise<InnertubeInfoClient> {
        try {
            this._periodicCleanup();

            const instance = await this.sharedClient();
            this.lifetime.controller.signal.throwIfAborted();

            this.instanceCache.set(key, {
                instance,
                created: Date.now(),
                lastUsed: Date.now()
            });

            this.logger.debug?.(`[InnertubeService] Cached new instance: ${key}`, 'innertube-service');

            return instance;
        } catch (error) {
            this.stats.errors += 1;
            const errorMessage = error instanceof Error ? error.message : String(error);
            this._logServiceError(`[InnertubeService] Failed to get instance: ${errorMessage}`, error);
            throw new Error(`InnertubeService instance creation failed: ${errorMessage}`);
        }
    }

    async getVideoInfo(videoId: string, options: { instanceKey?: string; timeout?: number; [key: string]: unknown } = {}): Promise<unknown> {
        try {
            return await this.withMetadataOperation(options.timeout === undefined ? {} : { timeoutMs: options.timeout }, async yt => {
                // Transitional API: callers must migrate extraction and fallback into the callback.
                this.instanceCache.set(options.instanceKey || 'shared', { instance: yt, created: Date.now(), lastUsed: Date.now() });
                const { instanceKey: _instanceKey, timeout: _timeout, ...sdkOptions } = options;
                const requestOptions: Record<string, unknown> = { client: 'WEB', ...sdkOptions };
                const info = this.track(this.lifetime, yt.getInfo(videoId, requestOptions));
                if (this.withTimeout) {
                    return await this.withTimeout(
                        info,
                        options.timeout || 8000,
                        'YouTube getInfo call'
                    );
                }
                return await info;
            });
        } catch (error) {
            this.stats.errors += 1;
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.debug?.(`[InnertubeService] getVideoInfo failed for ${videoId}: ${errorMessage}`, 'innertube-service');
            throw error;
        }
    }

    getStats(): ServiceStats & { cachedInstances: number; uptime: number } {
        return {
            ...this.stats,
            cachedInstances: this.instanceCache.size,
            uptime: Date.now() - this.stats.startTime
        };
    }

    cleanup(maxAge = 600000): void {
        const now = Date.now();
        let cleaned = 0;

        for (const [key, cached] of this.instanceCache.entries()) {
            if (now - cached.lastUsed > maxAge) {
                this.instanceCache.delete(key);
                cleaned += 1;
            }
        }

        if (cleaned > 0) {
            this.logger.debug?.(`[InnertubeService] Cleaned up ${cleaned} old instances`, 'innertube-service');
        }

        this.lastCleanup = now;
    }

    dispose(): Promise<void> {
        if (this.lifetime.disposal) return this.lifetime.disposal;
        let complete!: () => void;
        this.lifetime.disposal = new Promise<void>(resolve => { complete = resolve; });
        this.lifetime.controller.abort(new Error('Innertube service disposed'));
        this.instanceCache.clear();
        this.metadata = undefined;
        const retiring = [...this.owners].map(owner => this.retire(owner));
        void Promise.allSettled([...retiring, this.join(this.lifetime)]).then(() => { complete(); });
        return this.lifetime.disposal;
    }

    _periodicCleanup(): void {
        const now = Date.now();
        if (now - this.lastCleanup > this.cleanupInterval) {
            this.cleanup();
        }
    }

    _logServiceError(message: string, error: unknown = null, payload: Record<string, unknown> | null = null): void {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, 'innertube-service', payload, message);
        } else if (this.errorHandler) {
            this.errorHandler.logOperationalError(message, 'innertube-service', payload || error);
        }
    }
}

export { InnertubeService };
