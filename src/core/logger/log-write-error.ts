type LogWriteFailure = 'filesystem' | 'capacity' | 'configuration' | 'unavailable';
const FILESYSTEM_CODES = new Set(['EACCES', 'EPERM', 'ENOSPC', 'EDQUOT', 'ENOENT', 'ENOTDIR', 'EISDIR', 'EEXIST', 'EROFS', 'EMFILE', 'ENFILE', 'EIO']);

export class LogWriteError extends Error {
    constructor(readonly failure: LogWriteFailure, readonly code?: string, message = 'Log write failed') {
        super(message);
        this.name = 'LogWriteError';
    }
}

export function classifyLogWriteError(error: unknown): { failure: LogWriteFailure; code?: string } {
    if (error instanceof LogWriteError) return { failure: error.failure, ...(error.code ? { code: error.code } : {}) };
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    return typeof code === 'string' && FILESYSTEM_CODES.has(code)
        ? { failure: 'filesystem', code } : { failure: 'unavailable' };
}
