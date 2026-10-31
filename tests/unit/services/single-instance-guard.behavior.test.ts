import { afterEach, describe, expect, it } from 'bun:test';
import { createConnection, createServer } from 'node:net';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import {
    acquireSingleInstanceGuard,
    StreamSyncInstanceUnavailableError
} from '../../../src/services/SingleInstanceGuard';
import type { SingleInstanceGuard } from '../../../src/services/SingleInstanceGuard';

const guards: SingleInstanceGuard[] = [];
const acquire = async (port = 0) => {
    const guard = await acquireSingleInstanceGuard({ port });
    guards.push(guard);
    return guard;
};
afterEach(async () => {
    await Promise.all(guards.splice(0).map(guard => guard.release()));
});

describe('SingleInstanceGuard', () => {
    it('owns an endpoint until release, then permits a successor', async () => {
        const guard = await acquire();
        expect(guard.port).toBeGreaterThan(0);
        await expect(acquire(guard.port)).rejects.toBeInstanceOf(StreamSyncInstanceUnavailableError);
        const releasing = guard.release();
        expect(guard.release()).toBe(releasing);
        await releasing;
        const successor = await acquire(guard.port);
        await guard.release();
        await expect(acquire(successor.port)).rejects.toBeInstanceOf(StreamSyncInstanceUnavailableError);
    });

    it('allows exactly one simultaneous contender to succeed', async () => {
        const previous = await acquire();
        await previous.release();
        const results = await Promise.allSettled([acquire(previous.port), acquire(previous.port)]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
        await expect(acquire(previous.port)).rejects.toBeInstanceOf(StreamSyncInstanceUnavailableError);
    });

    it('reports an unrelated occupant without disrupting it or falling back', async () => {
        const occupant = createServer(socket => socket.destroy());
        occupant.listen({ host: '127.0.0.1', port: 0, exclusive: true });
        await once(occupant, 'listening');
        const port = (occupant.address() as AddressInfo).port;
        try {
            const error = await acquire(port).catch((error: unknown) => error);
            expect(error).toBeInstanceOf(StreamSyncInstanceUnavailableError);
            expect(error).toMatchObject({ code: 'STREAM_SYNC_INSTANCE_UNAVAILABLE', port, cause: { code: 'EADDRINUSE' } });
            expect((error as Error).message).toContain('Stream Sync or another application');
            expect(occupant.listening).toBe(true);
        } finally {
            await new Promise<void>((resolve, reject) => occupant.close(error => error ? reject(error) : resolve()));
        }
        await acquire(port);
    });

    it('preserves non-conflict binding failures', async () => {
        const error = await acquire(-1).catch((error: unknown) => error);
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(StreamSyncInstanceUnavailableError);
        expect((error as Error).message).toContain('port');
    });

    it('closes incoming connections so clients cannot pin release', async () => {
        const guard = await acquire();
        const client = createConnection({ host: '127.0.0.1', port: guard.port });
        const closed = once(client, 'close');
        client.resume();
        try {
            await closed;
            await guard.release();
            await acquire(guard.port);
        } finally {
            client.destroy();
        }
    });
});
