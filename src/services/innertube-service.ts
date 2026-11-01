import type { AppLogger } from '../core/logger/types';
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
export type InnertubeChatClientCreation<T> = {
    ready: Promise<InnertubeChatClientOwner<T>>;
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

type LoggerLike = Pick<AppLogger<string>, 'error'> & Partial<Pick<AppLogger<string>, 'debug'>>;

type InnertubeInfoClient = {
    getInfo: (videoId: string, options?: Record<string, unknown>) => Promise<unknown>;
};

type InnertubeFactoryLike<TClient extends InnertubeInfoClient> = {
    createWithTimeout: (timeoutMs?: number, config?: Record<string, unknown>) => Promise<TClient>;
    createWithConfig?: (config?: Record<string, unknown>) => Promise<TClient>;
};

type ServiceStats = {
    instancesCreated: number;
    metadataReuses: number;
    metadataInitializations: number;
    retirementTimeouts: number;
    startTime: number;
};

class InnertubeService<TClient extends InnertubeInfoClient = InnertubeInfoClient> {
    factory: InnertubeFactoryLike<TClient>;
    logger: LoggerLike;
    errorHandler: ReturnType<typeof createPlatformErrorHandler>;
    stats: ServiceStats;
    private scopes = new AsyncLocalStorage<AbortSignal>();
    private lifetime: Lifetime = { controller: new AbortController(), active: new Set() };
    private owners = new Set<Lifetime>();
    private metadata: { lifetime: Lifetime; pending: Promise<TClient> } | undefined;
    private externalFetch: OwnedFetch;
    private initializationTimeoutMs: number;
    private requestTimeoutMs: number;
    private creationConfig: Record<string, unknown>;

    constructor(factory: InnertubeFactoryLike<TClient>, dependencies: { logger: LoggerLike; fetch?: OwnedFetch; initializationTimeoutMs?: number; requestTimeoutMs?: number; creationConfig?: Record<string, unknown> }) {
        this.factory = factory;
        if (!dependencies.logger || typeof dependencies.logger.error !== 'function') {
            throw new Error('InnertubeService requires a logger');
        }

        this.logger = dependencies.logger;
        this.externalFetch = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
        this.initializationTimeoutMs = dependencies.initializationTimeoutMs ?? 10000;
        this.requestTimeoutMs = dependencies.requestTimeoutMs ?? 8000;
        this.creationConfig = dependencies.creationConfig ?? {};
        this.errorHandler = createPlatformErrorHandler(this.logger, 'innertube-service');

        this.stats = {
            instancesCreated: 0,
            metadataReuses: 0,
            metadataInitializations: 0,
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
            this.stats.metadataReuses += 1;
            return this.metadata.pending;
        }
        this.stats.metadataInitializations += 1;
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
        return this.beginChatClient(context).ready;
    }

    beginChatClient(context: InnertubeOperationContext = {}): InnertubeChatClientCreation<TClient> {
        const signal = this.signal(context);
        signal.throwIfAborted();
        const lifetime: Lifetime = { controller: new AbortController(), active: new Set() };
        this.owners.add(lifetime);
        const dispose = () => this.retire(lifetime);
        const creationSignal = AbortSignal.any([signal, lifetime.controller.signal]);
        const ready = (async (): Promise<InnertubeChatClientOwner<TClient>> => {
            try {
                const client = await abortable(this.scopes.exit(() => this.createOwnedClient(lifetime)), creationSignal);
                creationSignal.throwIfAborted();
                return {
                    client,
                    run: <R>(operation: (client: TClient) => Promise<R>, context?: InnertubeOperationContext): Promise<R> => this.scopes.exit(() => {
                        lifetime.controller.signal.throwIfAborted();
                        this.lifetime.controller.signal.throwIfAborted();
                        // Explicit setup scopes bound all SDK continuations. Omitted
                        // context keeps polling outside any short caller ALS scope.
                        const signal = context === undefined
                            ? lifetime.controller.signal
                            : this.signal(context, lifetime);
                        signal.throwIfAborted();
                        return this.scopes.run(signal, () => {
                            if (context !== undefined) return abortable(this.track(lifetime, Promise.resolve().then(() => {
                                signal.throwIfAborted();
                                return operation(client);
                            })), signal);

                            let complete!: (result: R | PromiseLike<R>) => void;
                            let fail!: (error: unknown) => void;
                            const completion = this.track(lifetime, new Promise<R>((resolve, reject) => {
                                complete = resolve;
                                fail = reject;
                            }));
                            const caller = abortable(completion, signal);
                            // SDK event preludes (notably filter selection) must
                            // run before the emitter continues. Publish completion
                            // first so synchronous disposal still joins async tails.
                            try { void Promise.resolve(operation(client)).then(complete, fail); }
                            catch (error) { fail(error); }
                            return caller;
                        });
                    }),
                    dispose
                };
            } catch (error) {
                void dispose();
                throw error;
            }
        })();
        // A caller may retire the handle without awaiting readiness. Observe the
        // rejection independently while preserving the ordinary rejecting promise.
        void ready.catch(() => {});
        return { ready, dispose };
    }

    getStats(): ServiceStats & { uptime: number } {
        return {
            ...this.stats,
            uptime: Date.now() - this.stats.startTime
        };
    }

    dispose(): Promise<void> {
        if (this.lifetime.disposal) return this.lifetime.disposal;
        let complete!: () => void;
        this.lifetime.disposal = new Promise<void>(resolve => { complete = resolve; });
        this.lifetime.controller.abort(new Error('Innertube service disposed'));
        this.metadata = undefined;
        const retiring = [...this.owners].map(owner => this.retire(owner));
        void Promise.allSettled([...retiring, this.join(this.lifetime)]).then(() => { complete(); });
        return this.lifetime.disposal;
    }
}

export { InnertubeService };
