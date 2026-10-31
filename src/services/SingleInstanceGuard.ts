import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';

type SingleInstanceGuard = {
    port: number;
    release: () => Promise<void>;
};

type SingleInstanceGuardOptions = {
    port?: number;
};

const HOST = '127.0.0.1';
const DEFAULT_PORT = 3398;

class StreamSyncInstanceUnavailableError extends Error {
    readonly code = 'STREAM_SYNC_INSTANCE_UNAVAILABLE';

    constructor(readonly port: number, cause: Error) {
        super(`Stream Sync instance address ${HOST}:${port} is occupied by Stream Sync or another application.`, { cause });
        this.name = 'StreamSyncInstanceUnavailableError';
    }
}

function acquireSingleInstanceGuard({ port = DEFAULT_PORT }: SingleInstanceGuardOptions = {}): Promise<SingleInstanceGuard> {
    return new Promise((resolve, reject) => {
        const server = createServer(socket => {
            socket.on('error', () => {}).destroy();
        });
        const onError = (error: NodeJS.ErrnoException) => {
            reject(error.code === 'EADDRINUSE' ? new StreamSyncInstanceUnavailableError(port, error) : error);
        };
        server.once('error', onError);
        server.listen({ host: HOST, port, exclusive: true }, () => {
            // Later listener errors must reach the existing fatal-error boundary.
            server.removeListener('error', onError);
            server.unref();
            let releasePromise: Promise<void> | undefined;
            resolve({
                port: (server.address() as AddressInfo).port,
                release: () => releasePromise ??= new Promise<void>((resolveClose, rejectClose) => {
                    server.close(error => error ? rejectClose(error) : resolveClose());
                })
            });
        });
    });
}

export { acquireSingleInstanceGuard, StreamSyncInstanceUnavailableError };
export type { SingleInstanceGuard, SingleInstanceGuardOptions };
