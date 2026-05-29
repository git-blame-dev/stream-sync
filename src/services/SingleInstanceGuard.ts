import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getSystemTimestampISO } from '../utils/timestamp';
import { safeSetInterval } from '../utils/timeout-validator';

type LoggerLike = {
    debug?: (message: string, scope?: string, payload?: unknown) => void;
    info?: (message: string, scope?: string, payload?: unknown) => void;
    warn?: (message: string, scope?: string, payload?: unknown) => void;
};

type SingleInstanceMetadata = {
    instanceId: string;
    pid: number;
    ppid: number;
    hostname: string;
    platform: NodeJS.Platform;
    cwd: string;
    command: string;
    startedAt: string;
};

type SingleInstanceGuard = {
    lockPath: string;
    metadata: SingleInstanceMetadata;
    release: () => Promise<void>;
};

type SingleInstanceGuardOptions = {
    lockPath?: string;
    staleMs?: number;
    heartbeatMs?: number;
    now?: () => number;
    isProcessAlive?: (pid: number) => boolean;
    logger?: LoggerLike;
    registerProcessCleanup?: boolean;
};

const DEFAULT_STALE_MS = 2 * 60 * 1000;
const DEFAULT_HEARTBEAT_MS = 15 * 1000;
const METADATA_FILE = 'owner.json';
const HEARTBEAT_FILE = 'heartbeat';

class StreamSyncAlreadyRunningError extends Error {
    code = 'STREAM_SYNC_ALREADY_RUNNING';
    lockPath: string;
    owner: Partial<SingleInstanceMetadata> | null;

    constructor(lockPath: string, owner: Partial<SingleInstanceMetadata> | null) {
        const ownerSummary = owner?.pid
            ? ` pid ${owner.pid}${owner.hostname ? ` on ${owner.hostname}` : ''}`
            : '';
        super(`Another Stream Sync instance appears to be running${ownerSummary}. Lock: ${lockPath}`);
        this.name = 'StreamSyncAlreadyRunningError';
        this.lockPath = lockPath;
        this.owner = owner;
    }
}

const getDefaultLockPath = () => {
    const userPart = typeof process.getuid === 'function' ? `uid-${process.getuid()}` : os.userInfo().username;
    return path.join(os.tmpdir(), `stream-sync-${userPart}.lock`);
};

const getErrorCode = (error: unknown): string | null => {
    if (!error || typeof error !== 'object') {
        return null;
    }
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
};

const defaultIsProcessAlive = (pid: number): boolean => {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return getErrorCode(error) === 'EPERM';
    }
};

const readJsonFile = async <T>(filePath: string): Promise<T | null> => {
    try {
        return JSON.parse(await fsp.readFile(filePath, 'utf8')) as T;
    } catch {
        return null;
    }
};

const readHeartbeat = async (lockPath: string): Promise<number | null> => {
    try {
        const value = Number.parseInt(await fsp.readFile(path.join(lockPath, HEARTBEAT_FILE), 'utf8'), 10);
        return Number.isFinite(value) ? value : null;
    } catch {
        return null;
    }
};

const getLockDirectoryAgeMs = async (lockPath: string, now: () => number): Promise<number | null> => {
    try {
        const stats = await fsp.stat(lockPath);
        return now() - stats.mtimeMs;
    } catch {
        return null;
    }
};

const writeOwnerFiles = async (lockPath: string, metadata: SingleInstanceMetadata, now: () => number) => {
    await fsp.writeFile(path.join(lockPath, METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    await fsp.writeFile(path.join(lockPath, HEARTBEAT_FILE), String(now()), 'utf8');
};

const createMetadata = (instanceId: string): SingleInstanceMetadata => ({
    instanceId,
    pid: process.pid,
    ppid: process.ppid,
    hostname: os.hostname(),
    platform: process.platform,
    cwd: process.cwd(),
    command: process.argv.join(' '),
    startedAt: getSystemTimestampISO()
});

async function isExistingLockActive({
    lockPath,
    staleMs,
    now,
    isProcessAlive
}: {
    lockPath: string;
    staleMs: number;
    now: () => number;
    isProcessAlive: (pid: number) => boolean;
}) {
    const owner = await readJsonFile<Partial<SingleInstanceMetadata>>(path.join(lockPath, METADATA_FILE));
    const heartbeat = await readHeartbeat(lockPath);
    const directoryAgeMs = await getLockDirectoryAgeMs(lockPath, now);
    const pid = typeof owner?.pid === 'number' ? owner.pid : null;
    const heartbeatFresh = heartbeat !== null && now() - heartbeat <= staleMs;
    const ownerIsAlive = pid !== null && isProcessAlive(pid);
    const directoryIsFresh = directoryAgeMs === null || directoryAgeMs <= staleMs;
    const isPendingLock = owner === null && heartbeat === null;
    const ownerHasFreshIncompleteLock = ownerIsAlive && heartbeat === null && directoryIsFresh;

    return {
        active: heartbeatFresh || ownerHasFreshIncompleteLock || (isPendingLock && directoryIsFresh),
        owner
    };
}

const removeStaleLock = async (lockPath: string, instanceId: string) => {
    const stalePath = `${lockPath}.stale-${process.pid}-${instanceId}`;
    await fsp.rename(lockPath, stalePath);
    await fsp.rm(stalePath, { recursive: true, force: true });
};

async function acquireSingleInstanceGuard(options: SingleInstanceGuardOptions = {}): Promise<SingleInstanceGuard> {
    const lockPath = options.lockPath || getDefaultLockPath();
    const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
    const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    const now = options.now || (() => Date.now());
    const isProcessAlive = options.isProcessAlive || defaultIsProcessAlive;
    const logger = options.logger;
    const instanceId = crypto.randomUUID();
    const metadata = createMetadata(instanceId);
    const registerProcessCleanup = options.registerProcessCleanup !== false;

    const tryAcquire = async () => {
        await fsp.mkdir(lockPath, { mode: 0o700 });
        await writeOwnerFiles(lockPath, metadata, now);
    };

    let acquired = false;
    for (let attempt = 0; attempt < 3 && !acquired; attempt++) {
        try {
            await tryAcquire();
            acquired = true;
        } catch (error) {
            if (getErrorCode(error) !== 'EEXIST') {
                throw error;
            }

            const existing = await isExistingLockActive({ lockPath, staleMs, now, isProcessAlive });
            if (existing.active) {
                throw new StreamSyncAlreadyRunningError(lockPath, existing.owner);
            }

            logger?.warn?.('Removing stale Stream Sync instance lock', 'single-instance', {
                lockPath,
                ownerPid: existing.owner?.pid ?? null
            });
            try {
                await removeStaleLock(lockPath, instanceId);
            } catch (staleRemoveError) {
                if (getErrorCode(staleRemoveError) !== 'ENOENT') {
                    throw staleRemoveError;
                }
            }
        }
    }

    if (!acquired) {
        const existing = await isExistingLockActive({ lockPath, staleMs, now, isProcessAlive });
        throw new StreamSyncAlreadyRunningError(lockPath, existing.owner);
    }

    let released = false;
    let heartbeatTimer: ReturnType<typeof safeSetInterval> | null = safeSetInterval(() => {
        void fsp.writeFile(path.join(lockPath, HEARTBEAT_FILE), String(now()), 'utf8').catch((error) => {
            logger?.warn?.('Failed to update Stream Sync instance heartbeat', 'single-instance', {
                lockPath,
                error: error instanceof Error ? error.message : String(error)
            });
        });
    }, heartbeatMs);
    if (heartbeatTimer && typeof heartbeatTimer.unref === 'function') {
        heartbeatTimer.unref();
    }

    const releaseSync = () => {
        if (released) {
            return;
        }
        released = true;
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
        try {
            const rawOwner = fs.readFileSync(path.join(lockPath, METADATA_FILE), 'utf8');
            const owner = JSON.parse(rawOwner) as Partial<SingleInstanceMetadata>;
            if (owner.instanceId !== instanceId) {
                return;
            }
            fs.rmSync(lockPath, { recursive: true, force: true });
        } catch {
            // Best-effort process-exit cleanup. Stale lock recovery handles failures.
        }
    };

    if (registerProcessCleanup) {
        process.once('exit', releaseSync);
    }

    const release = async () => {
        if (released) {
            return;
        }
        released = true;
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
        const owner = await readJsonFile<Partial<SingleInstanceMetadata>>(path.join(lockPath, METADATA_FILE));
        if (owner?.instanceId !== instanceId) {
            return;
        }
        await fsp.rm(lockPath, { recursive: true, force: true });
    };

    logger?.debug?.('Acquired Stream Sync single-instance lock', 'single-instance', {
        lockPath,
        pid: metadata.pid
    });

    return {
        lockPath,
        metadata,
        release
    };
}

export {
    acquireSingleInstanceGuard,
    StreamSyncAlreadyRunningError
};

export type {
    SingleInstanceGuard,
    SingleInstanceGuardOptions,
    SingleInstanceMetadata
};
