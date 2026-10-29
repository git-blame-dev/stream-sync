import { spawn as defaultSpawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { logger as defaultLogger } from '../core/logging';
import type { AppLogger } from '../core/logger/types';
import { safeSetTimeout } from '../utils/timeout-validator';

const DEFAULT_NEURAL_TTS_ENDPOINT = 'http://127.0.0.1:8765';
const DEFAULT_PROBE_TIMEOUT_MS = 2_000;
const DEFAULT_WARMUP_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 500;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export type NeuralTtsFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type SpawnedProcessLike = {
    kill: (signal?: NodeJS.Signals | number) => boolean;
    unref?: () => void;
    pid?: number | undefined;
    killed?: boolean;
};

export type NeuralTtsSpawn = (
    command: string,
    options: { shell: true; stdio: 'ignore'; detached: false }
) => SpawnedProcessLike | ChildProcess;

export type NeuralTtsObsConfig = {
    ttsChatEnabled?: boolean;
    ttsNotificationsEnabled?: boolean;
    neuralTtsEndpoint?: string;
    neuralTtsCommand?: string;
    [key: string]: unknown;
};

export type NeuralTtsProcessManagerOptions = {
    config: {
        obs?: NeuralTtsObsConfig;
        [key: string]: unknown;
    };
    logger?: AppLogger;
    fetch?: NeuralTtsFetch;
    spawn?: NeuralTtsSpawn;
    delay?: (ms: number) => Promise<void>;
    now?: () => number;
    clientId?: string;
    probeTimeoutMs?: number;
    warmupTimeoutMs?: number;
    pollIntervalMs?: number;
};

type ValidatedLeaseAcquirePayload = {
    active_clients: number;
    active_jobs: number;
};

type ValidatedLeaseReleasePayload = {
    active_clients: number;
    active_jobs: number;
    should_shutdown: boolean;
};

function isValidLeaseAcquirePayload(body: unknown): body is ValidatedLeaseAcquirePayload {
    if (!body || typeof body !== 'object') {
        return false;
    }
    const candidate = body as Record<string, unknown>;
    return (
        typeof candidate.active_clients === 'number' &&
        Number.isInteger(candidate.active_clients) &&
        candidate.active_clients >= 1 &&
        typeof candidate.active_jobs === 'number' &&
        Number.isInteger(candidate.active_jobs) &&
        candidate.active_jobs >= 0
    );
}

function isValidLeaseReleasePayload(body: unknown): body is ValidatedLeaseReleasePayload {
    if (!body || typeof body !== 'object') {
        return false;
    }
    const candidate = body as Record<string, unknown>;
    return (
        typeof candidate.active_clients === 'number' &&
        Number.isInteger(candidate.active_clients) &&
        candidate.active_clients >= 0 &&
        typeof candidate.active_jobs === 'number' &&
        Number.isInteger(candidate.active_jobs) &&
        candidate.active_jobs >= 0 &&
        typeof candidate.should_shutdown === 'boolean'
    );
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

function defaultDelay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        safeSetTimeout(resolve, ms);
    });
}

export function validateNeuralTtsEndpoint(rawEndpoint?: string): string {
    const endpoint = rawEndpoint?.trim() || DEFAULT_NEURAL_TTS_ENDPOINT;
    let baseUrl: URL;
    try {
        baseUrl = new URL(endpoint);
    } catch {
        throw new Error(`Invalid neural TTS endpoint: ${endpoint}`);
    }

    if (baseUrl.protocol !== 'http:' || !LOOPBACK_HOSTS.has(baseUrl.hostname)) {
        throw new Error('Neural TTS endpoint must use HTTP on loopback');
    }

    return baseUrl.toString().replace(/\/$/, '');
}

export class NeuralTtsProcessManager {
    readonly clientId: string;
    private readonly config: NeuralTtsProcessManagerOptions['config'];
    private readonly logger: AppLogger;
    private readonly fetch: NeuralTtsFetch;
    private readonly spawn: NeuralTtsSpawn;
    private readonly delay: (ms: number) => Promise<void>;
    private readonly now: () => number;
    private readonly probeTimeoutMs: number;
    private readonly warmupTimeoutMs: number;
    private readonly pollIntervalMs: number;

    spawnedByUs: boolean = false;
    childProcess: SpawnedProcessLike | ChildProcess | null = null;
    hasAcquiredLease: boolean = false;

    constructor(options: NeuralTtsProcessManagerOptions) {
        this.config = options.config;
        this.logger = options.logger || defaultLogger;
        this.fetch = options.fetch || globalThis.fetch.bind(globalThis);
        this.spawn = options.spawn || ((command, spawnOpts) => defaultSpawn(command, spawnOpts));
        this.delay = options.delay || defaultDelay;
        this.now = options.now || (() => Date.now());
        this.clientId = options.clientId || `stream-sync-${crypto.randomUUID()}`;
        this.probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
        this.warmupTimeoutMs = options.warmupTimeoutMs ?? DEFAULT_WARMUP_TIMEOUT_MS;
        this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    }

    async ensureStarted(): Promise<void> {
        if (this.config?.obs?.ttsNotificationsEnabled === false && this.config?.obs?.ttsChatEnabled !== true) {
            return;
        }

        const root = validateNeuralTtsEndpoint(
            typeof this.config?.obs?.neuralTtsEndpoint === 'string'
                ? this.config.obs.neuralTtsEndpoint
                : undefined
        );

        const initialProbe = await this.probeHealth(root);

        if (initialProbe.reachable) {
            this.spawnedByUs = false;
            this.logger.info('Neural TTS service already running; attaching shared lease', 'NeuralTtsProcessManager');
            await this.acquireLease(root);
            if (!initialProbe.ready) {
                const ready = await this.waitForReady(root);
                if (!ready) {
                    this.logger.warn(
                        `Neural TTS warmup timed out after ${this.warmupTimeoutMs}ms; continuing in degraded mode`,
                        'NeuralTtsProcessManager'
                    );
                }
            }
            return;
        }

        const command = typeof this.config?.obs?.neuralTtsCommand === 'string'
            ? this.config.obs.neuralTtsCommand.trim()
            : '';

        if (!command) {
            this.spawnedByUs = false;
            this.logger.warn(
                'Neural TTS service is not reachable and no neuralTtsCommand is configured; continuing in degraded mode',
                'NeuralTtsProcessManager'
            );
            return;
        }

        this.logger.info('Spawning Neural TTS service...', 'NeuralTtsProcessManager');
        try {
            this.childProcess = this.spawn(command, {
                shell: true,
                stdio: 'ignore',
                detached: false
            });
            this.spawnedByUs = true;
        } catch (error) {
            this.spawnedByUs = false;
            this.childProcess = null;
            this.logger.warn(
                `Failed to spawn Neural TTS command: ${getErrorMessage(error)}; continuing in degraded mode`,
                'NeuralTtsProcessManager'
            );
            return;
        }

        const ready = await this.waitForReady(root);
        if (!ready) {
            this.logger.warn(
                `Neural TTS warmup timed out or failed after ${this.warmupTimeoutMs}ms; continuing in degraded mode`,
                'NeuralTtsProcessManager'
            );
            return;
        }

        await this.acquireLease(root);
        if (this.hasAcquiredLease) {
            this.logger.info('Neural TTS service ready and lease acquired', 'NeuralTtsProcessManager');
        }
    }

    async stop(): Promise<void> {
        if (!this.spawnedByUs && !this.hasAcquiredLease && !this.childProcess) {
            return;
        }

        let root: string;
        try {
            root = validateNeuralTtsEndpoint(
                typeof this.config?.obs?.neuralTtsEndpoint === 'string'
                    ? this.config.obs.neuralTtsEndpoint
                    : undefined
            );
        } catch (error) {
            this.logger.warn(
                `Skipping Neural TTS stop due to invalid endpoint: ${getErrorMessage(error)}; keeping process alive`,
                'NeuralTtsProcessManager'
            );
            return;
        }

        if (!this.hasAcquiredLease) {
            this.logger.warn(
                'Neural TTS lease ownership was not established; keeping service alive without shutdown',
                'NeuralTtsProcessManager',
                {
                    spawnedByUs: this.spawnedByUs
                }
            );
            return;
        }

        this.hasAcquiredLease = false;
        const releaseInfo = await this.releaseLease(root);

        if (
            !this.spawnedByUs ||
            releaseInfo === null ||
            releaseInfo.should_shutdown !== true ||
            releaseInfo.active_clients > 0 ||
            releaseInfo.active_jobs > 0
        ) {
            this.logger.info(
                'Keeping Neural TTS service alive for external session or other active consumers',
                'NeuralTtsProcessManager',
                {
                    spawnedByUs: this.spawnedByUs,
                    activeClients: releaseInfo?.active_clients ?? null,
                    activeJobs: releaseInfo?.active_jobs ?? null,
                    shouldShutdown: releaseInfo?.should_shutdown ?? null
                }
            );
            return;
        }

        this.logger.info('Shutting down Neural TTS service (no other active consumers)...', 'NeuralTtsProcessManager');
        const shutdownAccepted = await this.requestShutdown(root);
        if (shutdownAccepted === true) {
            this.terminateChildProcess();
        }
    }

    private terminateChildProcess(): void {
        if (!this.childProcess) {
            return;
        }
        try {
            this.childProcess.kill('SIGTERM');
        } catch (error) {
            this.logger.debug(
                `Ignored error killing Neural TTS child process: ${getErrorMessage(error)}`,
                'NeuralTtsProcessManager'
            );
        } finally {
            this.childProcess = null;
        }
    }

    private async probeHealth(root: string): Promise<{ reachable: boolean; ready: boolean }> {
        try {
            const response = await this.fetch(`${root}/health`, {
                method: 'GET',
                redirect: 'error',
                signal: AbortSignal.timeout(this.probeTimeoutMs)
            });
            if (response.status === 200) {
                return { reachable: true, ready: true };
            }
            return { reachable: true, ready: false };
        } catch {
            return { reachable: false, ready: false };
        }
    }

    private async waitForReady(root: string): Promise<boolean> {
        const startTime = this.now();
        while (this.now() - startTime <= this.warmupTimeoutMs) {
            const probe = await this.probeHealth(root);
            if (probe.ready) {
                return true;
            }
            if (this.now() - startTime + this.pollIntervalMs > this.warmupTimeoutMs) {
                break;
            }
            await this.delay(this.pollIntervalMs);
        }
        return false;
    }

    private async acquireLease(root: string): Promise<void> {
        this.hasAcquiredLease = false;
        try {
            const response = await this.fetch(`${root}/v1/lease/acquire`, {
                method: 'POST',
                redirect: 'error',
                signal: AbortSignal.timeout(this.probeTimeoutMs),
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ client_id: this.clientId })
            });
            if (!response.ok) {
                this.logger.warn(
                    `Neural TTS lease acquire returned HTTP ${response.status}`,
                    'NeuralTtsProcessManager'
                );
                return;
            }
            const body: unknown = await response.json().catch(() => null);
            if (!isValidLeaseAcquirePayload(body)) {
                this.logger.warn(
                    'Neural TTS lease acquire returned an invalid payload',
                    'NeuralTtsProcessManager'
                );
                return;
            }
            this.hasAcquiredLease = true;
        } catch (error) {
            this.logger.warn(
                `Failed to acquire Neural TTS lease: ${getErrorMessage(error)}`,
                'NeuralTtsProcessManager'
            );
        }
    }

    private async releaseLease(root: string): Promise<ValidatedLeaseReleasePayload | null> {
        try {
            const response = await this.fetch(`${root}/v1/lease/release`, {
                method: 'POST',
                redirect: 'error',
                signal: AbortSignal.timeout(this.probeTimeoutMs),
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ client_id: this.clientId })
            });
            if (!response.ok) {
                this.logger.warn(
                    `Neural TTS lease release returned HTTP ${response.status}`,
                    'NeuralTtsProcessManager'
                );
                return null;
            }
            const body: unknown = await response.json().catch(() => null);
            if (!isValidLeaseReleasePayload(body)) {
                this.logger.warn(
                    'Neural TTS lease release returned an invalid payload',
                    'NeuralTtsProcessManager'
                );
                return null;
            }
            return {
                active_clients: body.active_clients,
                active_jobs: body.active_jobs,
                should_shutdown: body.should_shutdown
            };
        } catch (error) {
            this.logger.warn(
                `Failed to release Neural TTS lease: ${getErrorMessage(error)}`,
                'NeuralTtsProcessManager'
            );
            return null;
        }
    }

    private async requestShutdown(root: string): Promise<boolean> {
        try {
            const response = await this.fetch(`${root}/v1/shutdown`, {
                method: 'POST',
                redirect: 'error',
                signal: AbortSignal.timeout(this.probeTimeoutMs)
            });
            if (response.status === 409) {
                this.logger.info(
                    'Neural TTS shutdown rejected (HTTP 409 Conflict: another client or job became active); keeping process alive',
                    'NeuralTtsProcessManager'
                );
                return false;
            }
            if (!response.ok) {
                this.logger.warn(
                    `Neural TTS shutdown failed with HTTP ${response.status}; keeping process alive`,
                    'NeuralTtsProcessManager'
                );
                return false;
            }
            const body: unknown = await response.json().catch(() => null);
            if (
                !body ||
                typeof body !== 'object' ||
                (body as { shutting_down?: unknown }).shutting_down !== true
            ) {
                this.logger.warn(
                    'Neural TTS shutdown returned an invalid payload; keeping process alive',
                    'NeuralTtsProcessManager'
                );
                return false;
            }
            return true;
        } catch (error) {
            this.logger.warn(
                `Failed to request Neural TTS shutdown: ${getErrorMessage(error)}; keeping process alive`,
                'NeuralTtsProcessManager'
            );
            return false;
        }
    }
}
