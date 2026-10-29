import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createEventBus } from '../../src/core/EventBus';
import { createGuiTransportService } from '../../src/services/gui/gui-transport-service';

async function run() {
const directory = process.argv[2];
const mode = process.argv[3];
assert.ok(directory);
assert.ok(mode === 'abort' || mode === 'stop');
const media = path.join(directory, 'synthetic-media.mp4');
const descriptor = fs.openSync(media, 'w');
fs.ftruncateSync(descriptor, 64 * 1024 * 1024);
fs.closeSync(descriptor);
const sources: fs.ReadStream[] = [];
const nativeRead = fs.createReadStream;
fs.createReadStream = ((...args: Parameters<typeof fs.createReadStream>) => {
    const source = nativeRead(...args);
    if (args[0] === media) sources.push(source);
    return source;
}) as typeof fs.createReadStream;
const quiet = { debug() {}, info() {}, warn() {}, error() {} };
const eventBus = createEventBus();
const sockets = new Set<import('node:net').Socket>();
const closedResponses: string[] = [];
const service = createGuiTransportService({
    config: { gui: { enableDock: true, host: '127.0.0.1', port: 0 } },
    logger: quiet, eventBus, runtimeAssetRoots: [directory],
    createServer(handler) {
        const server = http.createServer((req,res) => { res.once('close',()=>closedResponses.push(req.url || '')); handler(req,res); });
        server.on('connection', socket => {
            sockets.add(socket);
            socket.once('close', () => sockets.delete(socket));
        });
        return server;
    }
});
const requests: http.ClientRequest[] = [];
const responses: http.IncomingMessage[] = [];
try {
    await service.start();
    const address = service.getAddress();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const assetUrl = await new Promise<string>((resolve, reject) => {
        const request = http.get(`${base}/gui/events`, response => {
            let text = '';
            response.on('data', chunk => {
                text += String(chunk);
                const match = /"assetUrl":"([^"]+)"/.exec(text);
                if (match?.[1]) resolve(match[1]);
            });
            eventBus.emit('display:gift-animation', {
                playbackId: 'synthetic-media-lifetime', durationMs: 1,
                mediaFilePath: media, mediaContentType: 'video/mp4', animationConfig: {}
            });
        });
        requests.push(request);
        request.once('error', reject);
    });
    for (const range of [undefined, 'bytes=1048576-']) {
        await new Promise<void>((resolve, reject) => {
            const request = http.get(`${base}${assetUrl}`, { headers: range ? { Range: range } : {} }, response => {
                responses.push(response);
                assert.equal(response.statusCode, range ? 206 : 200);
                response.once('data', () => { response.pause(); resolve(); });
                response.on('error', () => {});
            });
            requests.push(request);
            request.once('error', reject);
        });
    }
    assert.equal(sources.length, 2);
    const closed = sources.map(source => new Promise<void>((resolve, reject) => {
        const signal = AbortSignal.timeout(1500);
        const expired = () => reject(new Error('Runtime media source did not close: '+JSON.stringify({closedResponses,bytesRead:source.bytesRead,destroyed:source.destroyed,closed:source.closed,sockets:sockets.size})));
        signal.addEventListener('abort', expired, { once: true });
        source.once('close', () => {
            signal.removeEventListener('abort', expired);
            resolve();
        });
    }));
    const allClosed = Promise.all(closed);
    // Attach before any retirement; a close is the observable resource-release contract.
    if (mode === 'abort') {
        responses.forEach(response => response.destroy());
        requests.slice(1).forEach(request => { request.socket?.destroy(); request.destroy(); });
        await allClosed;
    } else {
        await Promise.all([allClosed, service.stop()]);
        assert.equal(service.isActive(), false);
        await service.stop();
    }
    for (const source of sources) {
        assert.equal(source.destroyed, true);
        assert.equal(source.closed, true);
    }
    process.stdout.write('MEDIA_LIFETIME_OK');
} finally {
    requests.forEach(request => request.destroy());
    sources.forEach(source => source.destroy());
    sockets.forEach(socket => socket.destroy());
    await service.stop();
    fs.createReadStream = nativeRead;
    fs.rmSync(media, { force: true });
}

}
void run().catch(error => { process.stderr.write(String(error.stack || error)); process.exitCode = 1; });
