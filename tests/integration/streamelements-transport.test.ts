import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// A separate process exercises the real ws implementation outside the test preload's mock.
const script = `
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
const require = createRequire(process.cwd() + '/package.json');
const { WebSocket, WebSocketServer } = require('ws');
const { StreamElementsPlatform } = require('./src/platforms/streamelements.ts');
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
await once(server, 'listening');
const address = server.address();
assert(address && typeof address !== 'string');
const clients = [];
class LocalWebSocket extends WebSocket {
    constructor() { super('ws://127.0.0.1:' + address.port); clients.push(this); }
}
const platform = () => new StreamElementsPlatform({ enabled: true, jwtToken: 'test-only-jwt' }, {
    logger, WebSocketCtor: LocalWebSocket,
    retrySystem: { incrementRetryCount() { return 10000; }, resetRetryCount() {} }
});
try {
    const adapter = platform();
    const incoming = once(server, 'connection');
    const events = [];
    adapter.on('platform:event', event => events.push(event));
    const pending = adapter.initialize();
    const [peer] = await incoming;
    const [raw] = await once(peer, 'message');
    const request = JSON.parse(raw.toString());
    assert.equal(request.type, 'subscribe');
    assert.deepEqual(request.data, { topic: 'channel.activities', token: 'test-only-jwt', token_type: 'jwt' });
    assert.equal(adapter.isConnected(), false);
    peer.send(JSON.stringify({ type: 'response', nonce: request.nonce, data: {
        topic: 'channel.activities', message: 'successfully subscribed to topic', room: 'test-room'
    } }));
    assert.deepEqual(await pending, { state: 'ready' });
    const pong = once(peer, 'pong');
    peer.ping(Buffer.from('test-only-heartbeat'));
    assert.equal((await pong)[0].toString(), 'test-only-heartbeat');
    const emitted = once(adapter, 'platform:event');
    peer.send(JSON.stringify({ type: 'message', topic: 'channel.activities', data: {
        type: 'follow', provider: 'youtube', data: { username: 'test-only-viewer', providerId: 'test-only-id' }
    } }));
    const [event] = await emitted;
    assert.equal(event.data.username, 'test-only-viewer');
    assert.equal(event.platform, 'youtube');
    assert.equal(events.length, 1);
    const closed = once(peer, 'close');
    await adapter.disconnect();
    await closed;
    assert.equal(adapter.isConnected(), false);

    // Exercise the real subscription deadline, then acknowledge a fresh replacement.
    const recovering = new StreamElementsPlatform({ enabled: true, jwtToken: 'test-only-jwt' }, {
        logger, WebSocketCtor: LocalWebSocket,
        retrySystem: { incrementRetryCount() { return 10; }, resetRetryCount() {} }
    });
    const stalledPeer = once(server, 'connection');
    const replacementPeer = new Promise(resolve => {
        let seen = 0;
        const listener = peer => {
            if (++seen === 2) { server.off('connection', listener); resolve(peer); }
        };
        server.on('connection', listener);
    });
    const timedOut = recovering.initialize();
    const [stalled] = await stalledPeer;
    const [firstFrame] = await once(stalled, 'message');
    const firstNonce = JSON.parse(firstFrame.toString()).nonce;
    const stalledClosed = once(stalled, 'close');
    assert.equal((await timedOut).state, 'recovering');
    await stalledClosed;
    const replacement = await replacementPeer;
    const [replacementFrame] = await once(replacement, 'message');
    const replacementNonce = JSON.parse(replacementFrame.toString()).nonce;
    assert.notEqual(replacementNonce, firstNonce);
    const reconnected = new Promise(resolve => recovering.on('platform:event', resolve));
    replacement.send(JSON.stringify({ type: 'response', nonce: replacementNonce, error: null }));
    replacement.send(JSON.stringify({ type: 'message', topic: 'channel.activities', data: {
        type: 'follow', provider: 'youtube', data: { username: 'test-only-after-timeout' }
    } }));
    assert.equal((await reconnected).data.username, 'test-only-after-timeout');
    assert.equal(recovering.isConnected(), true);
    await recovering.disconnect();

    // Observe the remote TCP socket closing while the HTTP upgrade is held.
    const heldServer = createServer();
    let resolveUpgrade;
    const upgrading = new Promise(resolve => { resolveUpgrade = resolve; });
    heldServer.on('upgrade', (_request, transport) => resolveUpgrade(transport));
    heldServer.listen(0, '127.0.0.1');
    await once(heldServer, 'listening');
    const heldPort = heldServer.address().port;
    let cancelledSocket;
    let lateOpens = 0;
    class HeldWebSocket extends WebSocket {
        constructor() {
            super('ws://127.0.0.1:' + heldPort);
            cancelledSocket = this;
            this.on('open', () => lateOpens++);
            clients.push(this);
        }
    }
    const cancelled = new StreamElementsPlatform({ enabled: true, jwtToken: 'test-only-jwt' }, {
        logger, WebSocketCtor: HeldWebSocket,
        retrySystem: { incrementRetryCount() { throw new Error('Cancellation must not retry'); }, resetRetryCount() {} }
    });
    const cancellation = cancelled.initialize().catch(error => error);
    const heldTransport = await upgrading;
    heldTransport.resume();
    heldTransport.on('end', () => heldTransport.end());
    const cancelledClosed = once(heldTransport, 'close');
    await cancelled.disconnect();
    assert.match((await cancellation).message, /cancelled/);
    await cancelledClosed;
    assert.equal(heldTransport.destroyed, true);
    assert.equal(cancelled.getStatus().hasConnection, false);
    assert.notEqual(cancelledSocket.readyState, WebSocket.OPEN);
    assert.equal(lateOpens, 0);
    await new Promise(resolve => heldServer.close(resolve));

} finally {
    for (const client of clients) client.terminate();
    for (const peer of server.clients) peer.terminate();
    await new Promise(resolve => server.close(resolve));
}
`;

for (const runtime of ['bun', 'node']) {
    test(`${runtime} Astro transport acknowledges, answers control ping, delivers subscribers, recovers after timeout and cancels safely`, () => {
        const args = runtime === 'bun' ? ['--no-env-file', '--eval', script]
            : ['--import', 'tsx', '--input-type=module', '--eval', script];
        const result = spawnSync(runtime, args, {
            cwd: path.resolve(__dirname, '../..'), env: { ...process.env, NODE_ENV: 'test' },
            encoding: 'utf8', timeout: 20000
        });
        expect({ status: result.status, error: result.error?.message, stderr: result.stderr }).toEqual({
            status: 0, error: undefined, stderr: ''
        });
    }, 25000);
}
