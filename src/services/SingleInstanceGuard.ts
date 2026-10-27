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

const getLockDirectoryStats = async (lockPath: string) => {
    try {
        return await fsp.stat(lockPath);
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
    const directory = await getLockDirectoryStats(lockPath);
    const owner = await readJsonFile<Partial<SingleInstanceMetadata>>(path.join(lockPath, METADATA_FILE));
    const heartbeat = await readHeartbeat(lockPath);
    const directoryAgeMs = directory ? now() - directory.mtimeMs : null;
    const pid = typeof owner?.pid === 'number' ? owner.pid : null;
    const heartbeatFresh = heartbeat !== null && now() - heartbeat <= staleMs;
    const ownerIsAlive = pid !== null && isProcessAlive(pid);
    const directoryIsFresh = directoryAgeMs === null || directoryAgeMs <= staleMs;
    const isIncompleteLock = heartbeat === null;

    return {
        active: ownerIsAlive || heartbeatFresh || (isIncompleteLock && directoryIsFresh),
        owner,
        heartbeat,
        directory
    };
}

// These checks bound cooperating contenders; filesystem rename is not a compare-and-swap.
// Validate again after moving so an unexpected replacement is never recursively deleted.
const moveOwnedLock = (lockPath: string, destination: string, directory: fs.Stats | null, matchesOwner: (owner: Partial<SingleInstanceMetadata> | null) => boolean, heartbeat?: number | null): boolean => {
    const matchesDirectory = (candidate: fs.Stats) => directory !== null
        && candidate.dev === directory.dev && candidate.ino === directory.ino;
    const readOwner = (directoryPath: string): Partial<SingleInstanceMetadata> | null => {
        try {
            return JSON.parse(fs.readFileSync(path.join(directoryPath, METADATA_FILE), 'utf8')) as Partial<SingleInstanceMetadata>;
        } catch {
            return null;
        }
    };
    try {
        if (!matchesDirectory(fs.statSync(lockPath)) || !matchesOwner(readOwner(lockPath))) return false;
        if (heartbeat !== undefined) {
            let currentHeartbeat: number | null = null;
            try {
                const value = Number.parseInt(fs.readFileSync(path.join(lockPath, HEARTBEAT_FILE), 'utf8'), 10);
                if (Number.isFinite(value)) currentHeartbeat = value;
            } catch {
                // Missing/unreadable heartbeat is part of the observed stale state.
            }
            if (currentHeartbeat !== heartbeat) return false;
        }
        fs.renameSync(lockPath, destination);
    } catch (error) {
        if (getErrorCode(error) === 'ENOENT') return false;
        throw error;
    }
    if (!matchesDirectory(fs.statSync(destination)) || !matchesOwner(readOwner(destination))) {
        throw new Error(`Stream Sync lock changed during rename; preserved for recovery at ${destination}`);
    }
    return true;
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

    let directory: fs.Stats | null = null;
    const tryAcquire = async () => {
        await fsp.mkdir(lockPath, { mode: 0o700 });
        directory = fs.statSync(lockPath);
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
                const stalePath = `${lockPath}.stale-${process.pid}-${instanceId}`;
                if (moveOwnedLock(lockPath, stalePath, existing.directory,
                    (owner) => JSON.stringify(owner) === JSON.stringify(existing.owner), existing.heartbeat)) {
                    await fsp.rm(stalePath, { recursive: true, force: true });
                }
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

    // Keep the acquired file open: later ticks cannot follow a replacement lock path.
    const heartbeatFd = fs.openSync(path.join(lockPath, HEARTBEAT_FILE), 'r+');
    let released = false;
    let heartbeatTimer: ReturnType<typeof safeSetInterval> | null = safeSetInterval(() => {
        try {
            const value = String(now());
            fs.writeSync(heartbeatFd, value, 0, 'utf8');
            fs.ftruncateSync(heartbeatFd, Buffer.byteLength(value));
        } catch (error) {
            logger?.warn?.('Failed to update Stream Sync instance heartbeat', 'single-instance', {
                lockPath,
                error: error instanceof Error ? error.message : String(error)
            });
        }
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
            fs.closeSync(heartbeatFd);
            const releasePath = `${lockPath}.release-${process.pid}-${instanceId}`;
            if (moveOwnedLock(lockPath, releasePath, directory, (owner) => owner?.instanceId === instanceId)) {
                fs.rmSync(releasePath, { recursive: true, force: true });
            }
        } catch {
            // Best-effort process-exit cleanup. Stale lock recovery handles failures.
        }
    };

    if (registerProcessCleanup) {
        process.once('exit', releaseSync);
    }

    const release = async () => {
        if (released) return;
        released = true;
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
        if (registerProcessCleanup) process.removeListener('exit', releaseSync);
        fs.closeSync(heartbeatFd);
        const releasePath = `${lockPath}.release-${process.pid}-${instanceId}`;
        if (moveOwnedLock(lockPath, releasePath, directory, (owner) => owner?.instanceId === instanceId)) {
            await fsp.rm(releasePath, { recursive: true, force: true });
        }
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
