import { createPlatformErrorHandler } from './platform-error-handler';
import { getSystemTimestampISO } from './timestamp';

type LoggerLike = {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
};

type InitializationState = {
    timestamp?: string;
    success?: boolean;
    attempt?: number;
    error?: string;
    [key: string]: unknown;
};

type InitializationManagerDeps = {
    createPlatformErrorHandler?: typeof createPlatformErrorHandler;
};

type InitializationConfig = {
    allowReinitialization?: boolean;
    maxAttempts?: number;
};

function resolveErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    const candidate = error as { message?: unknown } | null;
    if (candidate && typeof candidate.message === 'string') {
        return candidate.message;
    }

    return 'Unknown error';
}

class PlatformInitializationManager {
    platformName: string | undefined;
    logger: LoggerLike;
    _createPlatformErrorHandler: typeof createPlatformErrorHandler;
    errorHandler: ReturnType<typeof createPlatformErrorHandler> | null;
    initializationCount: number;
    initializationAttempts: number;
    preventedReinitializations: number;
    initializationState: InitializationState;
    allowReinitialization: boolean;
    maxAttempts: number;

    constructor(platformName: string | undefined, logger: unknown, deps: InitializationManagerDeps = {}) {
        this.platformName = platformName;
        if (!logger || typeof (logger as { error?: unknown }).error !== 'function') {
            throw new Error('PlatformInitializationManager requires a logger');
        }

        this.logger = logger as LoggerLike;
        this._createPlatformErrorHandler = deps.createPlatformErrorHandler ?? createPlatformErrorHandler;
        this.errorHandler = this._createPlatformErrorHandler(this.logger, platformName ?? 'platform-initialization');
        this.initializationCount = 0;
        this.initializationAttempts = 0;
        this.preventedReinitializations = 0;
        this.initializationState = {};
        this.allowReinitialization = false;
        this.maxAttempts = 5;

        this.logger.debug('PlatformInitializationManager created', this.platformName);
    }

    isInitialized(): boolean {
        return this.initializationCount > 0;
    }

    beginInitialization(forceReinitialize = false): boolean {
        if (typeof this.initializationAttempts === 'undefined') {
            this.initializationAttempts = 0;
        }
        if (typeof this.preventedReinitializations === 'undefined') {
            this.preventedReinitializations = 0;
        }
        if (typeof this.initializationCount === 'undefined') {
            this.initializationCount = 0;
        }
        if (!this.initializationState) {
            this.initializationState = {};
        }

        this.initializationAttempts += 1;

        if (this.isInitialized() && !forceReinitialize && !this.allowReinitialization) {
            this.preventedReinitializations += 1;
            this.logger.warn(
                `Already initialized, skipping reinitialization attempt #${this.preventedReinitializations}`,
                this.platformName
            );
            this.logger.debug(
                `Prevented reinitialization attempt ${this.initializationAttempts}`,
                this.platformName
            );
            return false;
        }

        if (this.initializationAttempts > this.maxAttempts) {
            this.handleInitializationError(
                `Maximum initialization attempts (${this.maxAttempts}) exceeded`,
                null,
                { attempt: this.initializationAttempts }
            );
            return false;
        }

        this.logger.info(
            `Beginning initialization attempt ${this.initializationAttempts}`,
            this.platformName
        );

        return true;
    }

    markInitializationSuccess(additionalState: Record<string, unknown> = {}): void {
        this.initializationCount = Math.max(1, this.initializationCount + 1);

        this.initializationState = {
            timestamp: getSystemTimestampISO(),
            success: true,
            attempt: this.initializationAttempts,
            ...additionalState
        };

        this.logger.info(
            `Initialization successful (attempt ${this.initializationAttempts})`,
            this.platformName
        );
    }

    markInitializationFailure(error: unknown, additionalState: Record<string, unknown> = {}): void {
        this.initializationState = {
            timestamp: getSystemTimestampISO(),
            success: false,
            attempt: this.initializationAttempts,
            error: resolveErrorMessage(error),
            ...additionalState
        };

        this.handleInitializationError(
            `Initialization failed (attempt ${this.initializationAttempts}): ${resolveErrorMessage(error)}`,
            error,
            additionalState
        );
    }

    getStatistics(): {
        initializationCount: number;
        initializationAttempts: number;
        preventedReinitializations: number;
        isInitialized: boolean;
        lastInitialization: InitializationState;
        successRate: number;
    } {
        return {
            initializationCount: this.initializationCount,
            initializationAttempts: this.initializationAttempts,
            preventedReinitializations: this.preventedReinitializations,
            isInitialized: this.isInitialized(),
            lastInitialization: this.initializationState,
            successRate: this.initializationAttempts > 0
                ? (this.initializationCount / this.initializationAttempts) * 100
                : 0
        };
    }

    getInitializationState(): InitializationState & {
        isInitialized: boolean;
        totalAttempts: number;
        preventedAttempts: number;
    } {
        return {
            ...this.initializationState,
            isInitialized: this.isInitialized(),
            totalAttempts: this.initializationAttempts,
            preventedAttempts: this.preventedReinitializations
        };
    }

    reset(): void {
        this.initializationCount = 0;
        this.initializationAttempts = 0;
        this.preventedReinitializations = 0;
        this.initializationState = {};

        this.logger.debug('Initialization state reset', this.platformName);
    }

    configure(options: InitializationConfig = {}): void {
        if (typeof options.allowReinitialization === 'boolean') {
            this.allowReinitialization = options.allowReinitialization;
        }

        if (typeof options.maxAttempts === 'number' && options.maxAttempts > 0) {
            this.maxAttempts = options.maxAttempts;
        }

        this.logger.debug('Initialization manager configured', this.platformName, options);
    }

    private handleInitializationError(message: string, error: unknown = null, payload: Record<string, unknown> | null = null): void {
        if (!this.errorHandler) {
            const createHandler = this._createPlatformErrorHandler ?? createPlatformErrorHandler;
            this.errorHandler = createHandler(this.logger, this.platformName ?? 'platform-initialization');
        }

        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, 'initialization', payload, message, this.platformName ?? 'platform-initialization');
            return;
        }

        if (this.errorHandler) {
            this.errorHandler.logOperationalError(message, this.platformName ?? 'platform-initialization', payload);
        }
    }
}

export { PlatformInitializationManager };
