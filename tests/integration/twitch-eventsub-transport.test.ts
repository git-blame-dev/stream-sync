import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// Isolate the transport from the test preload's global ws mock.
const script = `
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(process.cwd() + '/package.json');
const { WebSocket, WebSocketServer } = require('ws');
const { createTwitchEventSubWsLifecycle } = require('./src/platforms/twitch/connections/ws-lifecycle.ts');
const { safeSetTimeout, safeDelay, validateTimeout } = require('./src/utils/timeout-validator.ts');

    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected synthetic TCP server');
    const port = address.port;
    class SyntheticPeerConnection extends WebSocket {
        constructor(_url, options) {
            super('ws://127.0.0.1:' + port, options);
        }
    }
    try {
        for (const abrupt of [false, true]) {
            const lifecycle = createTwitchEventSubWsLifecycle({ WebSocketCtor: SyntheticPeerConnection,
                safeSetTimeout, safeDelay, validateTimeout });
            let losses = 0;
            let reconnects = 0;
            let closeCode;
            let resolveLoss = () => {};
            const lost = new Promise(resolve => { resolveLoss = resolve; });
            const state = {
                _isConnected: false, subscriptionsReady: false, isInitialized: true,
                retryAttempts: 0, maxRetryAttempts: 10, retryDelay: 5000,
                _setupEventSubscriptions: async () => ({ failures: [] }),
                _scheduleReconnect: () => { reconnects++; },
                emit: (name, payload) => {
                    if (name !== 'eventSubDisconnected') return;
                    losses++;
                    closeCode = payload.code;
                    resolveLoss();
                }
            };
            try {
                const incoming = once(server, 'connection');
                const connected = lifecycle.connectWebSocket(state);
                const [peer] = await incoming;
                peer.send(JSON.stringify({ metadata: { message_type: 'session_welcome' },
                    payload: { session: { id: 'synthetic-session', keepalive_timeout_seconds: 30 } } }));
                await connected;
                const pong = once(peer, 'pong');
                peer.ping(Buffer.from('synthetic-ping'));
                const [payload] = await pong;
                assert.equal(payload.toString(), 'synthetic-ping');
                assert.equal(state.subscriptionsReady, true);
                if (abrupt) peer.terminate();
                else peer.close(1000, 'synthetic-close');
                await lost;
                assert.equal(closeCode, abrupt ? 1006 : 1000);
                assert.equal(losses, 1);
                assert.equal(reconnects, 1);
                assert.equal(state.subscriptionsReady, false);
            } finally {
                lifecycle.dispose(state);
            }
        }
    } finally {
        for (const peer of server.clients) peer.terminate();
        server.close();
    }
`;

for (const runtime of ['bun', 'node']) {
    test(`${runtime} EventSub transport automatically answers Ping and reports graceful and abrupt loss once`, () => {
        const args = runtime === 'bun' ? ['--no-env-file', '--eval', script]
            : ['--import', 'tsx', '--input-type=module', '--eval', script];
        const result = spawnSync(runtime, args, { cwd: path.resolve(__dirname, '../..'),
            env: { ...process.env, NODE_ENV: 'test' }, encoding: 'utf8', timeout: 5000 });
        expect({ status: result.status, error: result.error?.message, stderr: result.stderr }).toEqual({
            status: 0, error: undefined, stderr: ''
        });
    }, 10000);
}
