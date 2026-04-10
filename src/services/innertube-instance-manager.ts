import { logger } from '../core/logging';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { safeSetInterval, validateTimeout } from '../utils/timeout-validator';
import { installYouTubeParserLogAdapter } from '../utils/youtube-parser-log-adapter';
import { installYouTubeTextLogAdapter } from '../utils/youtube-text-log-adapter';

const INNERTUBE_INSTANCE_TTL = 300000;
const INNERTUBE_MIN_TTL = 60000;

const innertubeManagerErrorHandler = createPlatformErrorHandler(logger, 'innertube-manager');

type InnertubeClassLike = {
    create: () => Promise<unknown>;
};

type YouTubeModuleLike = {
    Innertube: InnertubeClassLike;
    [key: string]: unknown;
};

type InnertubeImporter = () => Promise<YouTubeModuleLike>;

type ManagedInstance = {
    session?: {
        close?: () => Promise<void>;
    };
    dispose?: () => Promise<void>;
};

type CachedInstance = {
    instance: ManagedInstance;
    created: number;
    lastAccessed: number;
    healthy: boolean;
    error: unknown;
};

type ManagerOptions = {
    instanceTimeout?: number;
    innertubeImporter?: InnertubeImporter | null;
};

let defaultInnertubeImporter: InnertubeImporter | null = null;

function resolveInstanceTimeout(explicitTimeout?: number) {
    const candidate = explicitTimeout ?? INNERTUBE_INSTANCE_TTL;
    const validatedTimeout = validateTimeout(candidate, INNERTUBE_MIN_TTL, 'innertube-instance-timeout');
    return Math.max(validatedTimeout, INNERTUBE_MIN_TTL);
}

function handleInnertubeManagerError(message: string, error: unknown, eventType = 'innertube') {
    if (error instanceof Error) {
        innertubeManagerErrorHandler.handleEventProcessingError(error, eventType, null, message);
    } else {
        innertubeManagerErrorHandler.logOperationalError(message, 'youtube', error);
    }
}

class InnertubeInstanceManager {
    activeInstances: Map<string, CachedInstance>;
    maxInstances: number;
    instanceTimeout: number;
    cleanupInterval: ReturnType<typeof safeSetInterval> | null;
    disposed: boolean;
    innertubeImporter: InnertubeImporter;

    constructor(options: ManagerOptions = {}) {
        this.activeInstances = new Map();
        this.maxInstances = 2;
        this.instanceTimeout = resolveInstanceTimeout(options.instanceTimeout);
        this.cleanupInterval = null;
        this.disposed = false;
        this.innertubeImporter = options.innertubeImporter
            || defaultInnertubeImporter
            || (() => import('youtubei.js') as Promise<YouTubeModuleLike>);

        this._startCleanupMonitoring();
    }

    async getInstance(identifier = 'default', createFunction: (() => Promise<ManagedInstance>) | null = null) {
        if (this.disposed) {
            throw new Error('InnertubeInstanceManager has been disposed');
        }

        const cached = this._getCachedInstance(identifier);
        if (cached && this._isInstanceHealthy(cached)) {
            logger.debug(`[InnertubeManager] Reusing cached instance: ${identifier}`, 'youtube');
            this._updateInstanceAccess(identifier);
            return cached.instance;
        }

        if (this.activeInstances.size >= this.maxInstances) {
            logger.warn(`[InnertubeManager] Maximum instances reached (${this.maxInstances}), cleaning up oldest`, 'youtube');
            await this._cleanupOldestInstance();
        }

        try {
            logger.debug(`[InnertubeManager] Creating new Innertube instance: ${identifier}`, 'youtube');

            if (!createFunction) {
                const youtubeModule = await this.innertubeImporter();
                installYouTubeTextLogAdapter({ logger });
                installYouTubeParserLogAdapter({ logger, youtubeModule });
                const { Innertube } = youtubeModule;
                const instance = await Innertube.create();
                return this._cacheInstance(identifier, instance as ManagedInstance);
            }

            const instance = await createFunction();
            return this._cacheInstance(identifier, instance);
        } catch (error) {
            handleInnertubeManagerError(`[InnertubeManager] Failed to create Innertube instance: ${identifier}`, error, 'create-instance');
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to create Innertube instance: ${errorMessage}`);
        }
    }

    markInstanceUnhealthy(identifier: string, error: unknown = null) {
        const cached = this.activeInstances.get(identifier);
        if (cached) {
            cached.healthy = false;
            cached.error = error;
            logger.warn(`[InnertubeManager] Marked instance as unhealthy: ${identifier}`, 'youtube', error);
        }
    }

    async disposeInstance(identifier: string) {
        const cached = this.activeInstances.get(identifier);
        if (cached) {
            await this._disposeInstanceSafely(cached.instance);
            this.activeInstances.delete(identifier);
            logger.debug(`[InnertubeManager] Disposed instance: ${identifier}`, 'youtube');
        }
    }

    async cleanup() {
        if (this.disposed) {
            return;
        }

        logger.info('[InnertubeManager] Cleaning up all instances', 'youtube');

        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        const disposePromises = Array.from(this.activeInstances.values()).map((cached) =>
            this._disposeInstanceSafely(cached.instance)
        );

        await Promise.allSettled(disposePromises);
        this.activeInstances.clear();
        this.disposed = true;

        logger.info('[InnertubeManager] Cleanup completed', 'youtube');
    }

    getStats() {
        return {
            activeInstances: this.activeInstances.size,
            maxInstances: this.maxInstances,
            instanceDetails: Array.from(this.activeInstances.entries()).map(([id, cached]) => ({
                identifier: id,
                healthy: cached.healthy,
                lastAccessed: cached.lastAccessed,
                age: Date.now() - cached.created
            }))
        };
    }

    _getCachedInstance(identifier: string) {
        return this.activeInstances.get(identifier);
    }

    _isInstanceHealthy(cached: CachedInstance) {
        if (!cached.healthy) {
            return false;
        }

        const age = Date.now() - cached.created;
        if (age > this.instanceTimeout) {
            return false;
        }

        return true;
    }

    _updateInstanceAccess(identifier: string) {
        const cached = this.activeInstances.get(identifier);
        if (cached) {
            cached.lastAccessed = Date.now();
        }
    }

    _cacheInstance(identifier: string, instance: ManagedInstance) {
        const cached: CachedInstance = {
            instance,
            created: Date.now(),
            lastAccessed: Date.now(),
            healthy: true,
            error: null
        };

        this.activeInstances.set(identifier, cached);
        logger.debug(`[InnertubeManager] Cached new instance: ${identifier}`, 'youtube');

        return instance;
    }

    async _cleanupOldestInstance() {
        let oldest: string | null = null;
        let oldestTime = Date.now();

        for (const [id, cached] of this.activeInstances.entries()) {
            if (cached.lastAccessed < oldestTime) {
                oldest = id;
                oldestTime = cached.lastAccessed;
            }
        }

        if (oldest) {
            await this.disposeInstance(oldest);
        }
    }

    async _disposeInstanceSafely(instance: ManagedInstance) {
        try {
            if (instance && typeof instance.session?.close === 'function') {
                await instance.session.close();
            }
            if (instance && typeof instance.dispose === 'function') {
                await instance.dispose();
            }
        } catch (error) {
            logger.warn('[InnertubeManager] Error during instance disposal', 'youtube', error);
        }
    }

    _startCleanupMonitoring() {
        const cleanupInterval = validateTimeout(30000, 30000);

        this.cleanupInterval = safeSetInterval(() => {
            void this._performPeriodicCleanup();
        }, cleanupInterval);
    }

    async _performPeriodicCleanup() {
        const now = Date.now();
        const expiredInstances: string[] = [];

        for (const [id, cached] of this.activeInstances.entries()) {
            if (!this._isInstanceHealthy(cached) || (now - cached.lastAccessed) > this.instanceTimeout) {
                expiredInstances.push(id);
            }
        }

        for (const id of expiredInstances) {
            await this.disposeInstance(id);
        }

        if (expiredInstances.length > 0) {
            logger.debug(`[InnertubeManager] Cleaned up ${expiredInstances.length} expired instances`, 'youtube');
        }
    }
}

let instance: InnertubeInstanceManager | null = null;

function setInnertubeImporter(importer: InnertubeImporter | null) {
    if (importer && typeof importer !== 'function') {
        throw new Error('Innertube importer must be a function');
    }

    defaultInnertubeImporter = importer || null;
    if (instance) {
        instance.innertubeImporter = defaultInnertubeImporter || (() => import('youtubei.js') as Promise<YouTubeModuleLike>);
    }
}

function getInstance(options: ManagerOptions = {}) {
    if (!instance) {
        instance = new InnertubeInstanceManager({
            ...options,
            innertubeImporter: options.innertubeImporter || defaultInnertubeImporter
        });
    }

    return instance;
}

async function cleanup() {
    if (instance) {
        await instance.cleanup();
        instance = null;
    }
}

function _resetInstance() {
    instance = null;
}

export {
    InnertubeInstanceManager,
    setInnertubeImporter,
    getInstance,
    cleanup,
    _resetInstance
};
