import { expect, spyOn, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { Socket } from 'node:net';
import { join } from 'node:path';
import { createProductionDependencies } from '../../src/main';
import { secrets } from '../../src/core/secrets';
import { StreamElementsPlatform } from '../../src/platforms/streamelements';
import { PlatformLifecycleService } from '../../src/services/PlatformLifecycleService';
import { archiveIdentity } from '../../src/utils/log-retention';
import { createMainPresentationFixture } from '../helpers/main-presentation-fixture';
import { captureStderr, captureStdout } from '../helpers/output-capture';
import testClock from '../helpers/test-clock';

class SubscriberSocket extends EventEmitter {
    static readonly OPEN = 1;
    static sockets: SubscriberSocket[] = [];
    readyState = 1;
    private resolveClosed!: () => void;
    readonly closed = new Promise<void>(resolve => { this.resolveClosed = resolve; });
    constructor(readonly url: string) {
        super();
        SubscriberSocket.sockets.push(this);
        queueMicrotask(() => this.emit('open'));
    }
    send(frame: string) {
        const request = JSON.parse(frame);
        expect(request).toMatchObject({ type: 'subscribe', data: { topic: 'channel.activities' } });
        queueMicrotask(() => this.emit('message', JSON.stringify({ type: 'response', nonce: request.nonce, error: null })));
    }
    close() { this.readyState = 3; this.emit('close', 1000, 'synthetic close'); this.resolveClosed(); }
}

async function withSubscriberFixture(run: (h: Awaited<ReturnType<typeof createMainPresentationFixture>>) => Promise<void>) {
    const stdout = captureStdout(), stderr = captureStderr();
    testClock.reset();
    const originalToken = secrets.streamelements.jwtToken;
    const originalEnvToken = process.env.STREAMELEMENTS_JWT_TOKEN;
    process.env.STREAMELEMENTS_JWT_TOKEN = 'synthetic-subscriber-token';
    secrets.streamelements.jwtToken = 'synthetic-subscriber-token';
    SubscriberSocket.sockets = [];
    const network = spyOn(Socket.prototype, 'connect').mockImplementation(() => { throw new Error('Unexpected external network access in synthetic subscriber test'); });
    let h: Awaited<ReturnType<typeof createMainPresentationFixture>> | undefined;
    try {
        h = await createMainPresentationFixture({ WebSocketCtor: SubscriberSocket });
        // Fail before startup if production composition loses its external boundary.
        const factory = createProductionDependencies({ WebSocketCtor: SubscriberSocket }, undefined).dependencyFactory;
        expect(factory.createStreamelementsDependencies).toBeFunction();
        const boundary = factory.createStreamelementsDependencies!({}, { WebSocketCtor: SubscriberSocket }) as { WebSocketCtor?: unknown };
        expect(boundary.WebSocketCtor).toBe(SubscriberSocket);
        h.config.streamelements.enabled = true;
        h.config.streamelements.dataLoggingEnabled = true;
        await run(h);
        expect(network).not.toHaveBeenCalled();
    } finally {
        try { await h?.dispose(); }
        finally {
            if (originalEnvToken === undefined) delete process.env.STREAMELEMENTS_JWT_TOKEN;
            else process.env.STREAMELEMENTS_JWT_TOKEN = originalEnvToken;
            secrets.streamelements.jwtToken = originalToken;
            testClock.useRealTime();
            network.mockRestore(); stdout.restore(); stderr.restore();
        }
    }
}

test('production subscriber composition preserves configured retention and drains accepted capture on shutdown', async () => withSubscriberFixture(async h => {
    const root = join(h.dir, 'raw');
    const filename = join(root, 'streamelements-data-log.ndjson');
    const archive = join(root, `archive-${archiveIdentity('streamelements-data-log.ndjson')}.${testClock.now() - 3 * 86_400_000}.00000000-0000-4000-8000-000000000001.log`);
    const excessArchive = join(root, `archive-${archiveIdentity('streamelements-data-log.ndjson')}.${testClock.now() - 4 * 86_400_000}.00000000-0000-4000-8000-000000000002.log`);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const appending = new Promise<void>(resolve => { entered = resolve; });
    const nativeAppend = fs.appendFile;
    const append = spyOn(fs, 'appendFile').mockImplementation(async (...args) => {
        if (String(args[0]) === filename) { entered(); await gate; }
        return nativeAppend(...args);
    });
    try {
        h.config.streamelements.dataLoggingPath = root;
        h.config.logging.rawArchiveMaxAgeDays = 7;
        h.config.logging.rawArchiveMaxBytes = 65_536;
        await fs.mkdir(root);
        await fs.writeFile(archive, 'synthetic retained archive');
        await fs.writeFile(excessArchive, 'x'.repeat(65_536));
        expect((await h.start()).success).toBe(true);
        const platform = (h.runtime.platformLifecycleService as PlatformLifecycleService).getPlatform('streamelements');
        expect(platform).toBeInstanceOf(StreamElementsPlatform);
        expect((platform as unknown as StreamElementsPlatform).isConnected()).toBe(true);
        expect(SubscriberSocket.sockets).toHaveLength(1);
        const socket = SubscriberSocket.sockets[0]!;
        const frame = { type: 'message', topic: 'channel.activities', data: {
            type: 'follow', provider: 'youtube', data: { displayName: 'Synthetic Subscriber', providerId: 'synthetic-subscriber' },
        } };
        socket.emit('message', JSON.stringify(frame));
        await appending;
        expect(await fs.readFile(archive, 'utf8')).toBe('synthetic retained archive');
        await expect(fs.stat(excessArchive)).rejects.toMatchObject({ code: 'ENOENT' });
        let stopped = false;
        const shutdown = h.runtime.shutdown().then(() => { stopped = true; });
        // The socket close proves shutdown has retired ingress before checking its drain.
        await socket.closed;
        for (let turn = 0; turn < 100; turn++) await Promise.resolve();
        expect(socket.readyState).toBe(3);
        expect(stopped).toBe(false);
        release();
        await shutdown;
        expect(stopped).toBe(true);
        expect(JSON.parse((await fs.readFile(filename, 'utf8')).trim())).toMatchObject({ platform: 'streamelements', eventType: 'follow', payload: frame });
        expect(await fs.readFile(archive, 'utf8')).toBe('synthetic retained archive');
        expect(socket.eventNames()).toHaveLength(0);
    } finally {
        release();
        append.mockRestore();
    }
}));

test('enabled subscriber survives an obstructed capture root and persists after the root is repaired', async () => withSubscriberFixture(async h => {
    const obstruction = join(h.dir, 'synthetic-capture-obstruction');
    const root = join(obstruction, 'raw');
    const filename = join(root, 'streamelements-data-log.ndjson');
    await fs.writeFile(obstruction, 'synthetic regular file');
    h.config.streamelements.dataLoggingPath = root;
    expect((await h.start()).success).toBe(true);
    expect(h.runtime.isStarted).toBe(true);
    const platform = (h.runtime.platformLifecycleService as PlatformLifecycleService).getPlatform('streamelements');
    if (!(platform instanceof StreamElementsPlatform)) throw new Error('Expected production subscriber platform');
    expect(platform.isConnected()).toBe(true);
    const diagnostic = spyOn(h.runtime.logger, 'error').mockImplementation(() => {});
    try {
        await expect(platform.logRawPlatformData('follow', { displayName: 'Synthetic blocked subscriber' })).resolves.toBeUndefined();
        expect(diagnostic).toHaveBeenCalledWith('Error logging platform data: Raw event capture write failed', 'streamelements-platform');
        expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(obstruction);
        expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('ENOTDIR');
        expect(h.runtime.isStarted).toBe(true);
        expect(platform.isConnected()).toBe(true);
        await fs.unlink(obstruction);
        await fs.mkdir(root, { recursive: true });
        const payload = { displayName: 'Synthetic recovered subscriber', providerId: 'synthetic-recovered-id' };
        await platform.logRawPlatformData('follow', payload);
        const records = (await fs.readFile(filename, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({ platform: 'streamelements', eventType: 'follow', payload });
        expect(diagnostic).toHaveBeenCalledTimes(1);
        expect(h.runtime.isStarted).toBe(true);
        expect(platform.isConnected()).toBe(true);
    } finally { diagnostic.mockRestore(); }
}));
