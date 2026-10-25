import { spawn as defaultSpawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { logger as defaultLogger } from '../core/logging';
import type { AppLogger } from '../core/logger/types';

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
    ttsMethod?: string;
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

type LeaseReleasePayload = {
    active_clients?: unknown;
    active_jobs?: unknown;
    should_shutdown?: unknown;
};

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

function defaultDelay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
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
    private hasAcquiredLease: boolean = false;

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
        if (this.config?.obs?.ttsMethod !== 'neural-tts') {
            return;
        }

        const root = validateNeuralTtsEndpoint(
            typeof this.config.obs.neuralTtsEndpoint === 'string'
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

        const command = typeof this.config.obs.neuralTtsCommand === 'string'
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
        this.logger.info('Neural TTS service ready and lease acquired', 'NeuralTtsProcessManager');
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
        } catch {
            if (this.spawnedByUs && this.childProcess) {
                this.terminateChildProcess();
            }
            return;
        }

        const releaseInfo = await this.releaseLease(root);
        this.hasAcquiredLease = false;

        const activeClients = typeof releaseInfo?.active_clients === 'number' ? releaseInfo.active_clients : 0;
        const activeJobs = typeof releaseInfo?.active_jobs === 'number' ? releaseInfo.active_jobs : 0;
        const shouldShutdown = releaseInfo?.should_shutdown;

        const otherConsumerActive =
            shouldShutdown === false ||
            activeClients > 0 ||
            activeJobs > 0;

        if (!this.spawnedByUs || otherConsumerActive) {
            this.logger.info(
                'Keeping Neural TTS service alive for external session or other active consumers',
                'NeuralTtsProcessManager',
                {
                    spawnedByUs: this.spawnedByUs,
                    activeClients,
                    activeJobs,
                    shouldShutdown: shouldShutdown ?? null
                }
            );
            return;
        }

        this.logger.info('Shutting down Neural TTS service (no other active consumers)...', 'NeuralTtsProcessManager');
        const shutdownAccepted = await this.requestShutdown(root);
        if (shutdownAccepted) {
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
        try {
            const response = await this.fetch(`${root}/v1/lease/acquire`, {
                method: 'POST',
                redirect: 'error',
                signal: AbortSignal.timeout(this.probeTimeoutMs),
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ client_id: this.clientId })
            });
            this.hasAcquiredLease = true;
            if (!response.ok && response.status !== 404) {
                this.logger.warn(
                    `Neural TTS lease acquire returned HTTP ${response.status}`,
                    'NeuralTtsProcessManager'
                );
            }
        } catch (error) {
            this.logger.warn(
                `Failed to acquire Neural TTS lease: ${getErrorMessage(error)}`,
                'NeuralTtsProcessManager'
            );
        }
    }

    private async releaseLease(root: string): Promise<LeaseReleasePayload | null> {
        try {
            const response = await this.fetch(`${root}/v1/lease/release`, {
                method: 'POST',
                redirect: 'error',
                signal: AbortSignal.timeout(this.probeTimeoutMs),
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ client_id: this.clientId })
            });
            if (!response.ok) {
                return null;
            }
            const body = await response.json().catch(() => null);
            return body && typeof body === 'object' ? (body as LeaseReleasePayload) : null;
        } catch {
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
            return true;
        } catch {
            return true;
        }
    }
}
