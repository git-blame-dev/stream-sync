import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { isIP } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import type { LookupAddress } from 'node:dns';
import { createArchiveDownloader } from '../../../../src/services/tiktok-gift-animation/archive-downloader';
import { archiveTestTransport, type ArchiveTestHop } from '../../../helpers/archive-download-transport';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function destination() {
    const root = await mkdtemp(join(tmpdir(), 'archive-download-test-'));
    roots.push(root);
    return { root, output: join(root, 'archive.zip') };
}
const publicLookup = async () => [{ address: '1.1.1.1', family: 4 }];

test('streams an allowed HTTPS archive into an exclusive output', async () => {
    const { output } = await destination();
    const transport = archiveTestTransport([{}]);
    const result = await createArchiveDownloader({ lookup: publicLookup, request: transport.request })('https://cdn.tiktokcdn.com/asset?signature=synthetic', output);
    expect(result.bytes).toBe(19);
    expect(await readFile(output, 'utf8')).toBe('synthetic ZIP bytes');
    expect(transport.requests.every(item => item.request.closed && item.response.closed)).toBe(true);
});

for (const url of ['http://cdn.tiktokcdn.com/a', 'https://cdn.tiktokcdn.com:444/a', 'https://viewer:secret@cdn.tiktokcdn.com/a', 'https://cdn.tiktokcdn.com/a#fragment', 'https://tiktokcdn.com.attacker.invalid/a', 'https://127.0.0.1/a', 'https:////@tiktokcdn.com/a', 'https:@tiktokcdn.com/a']) {
    test(`rejects disallowed destination ${url.split('@').pop()}`, async () => {
        const { root, output } = await destination();
        const transport = archiveTestTransport([]);
        await expect(createArchiveDownloader({ lookup: publicLookup, request: transport.request })(url, output)).rejects.toMatchObject({ code: 'ERR_GIFT_ARCHIVE_DOWNLOAD', reason: 'destination' });
        expect(await readdir(root)).toEqual([]);
        expect(transport.requests).toHaveLength(0);
    });
}

for (const address of [
    '0.1.2.3', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.1.2', '172.16.0.1', '192.0.0.9', '192.0.2.1',
    '192.88.99.1', '192.168.1.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', '::ffff:1.1.1.1', 'fe80::1', 'fc00::1', 'fec0::1', '64:ff9b::101:101', 'ff02::1',
    '2001::1', '2001:db8::1', '2002::1', '3fff::1', '2606:4700:4700::1111%eth0'
]) {
    test(`rejects mixed public and excluded DNS answer ${address}`, async () => {
        const { root, output } = await destination();
        const transport = archiveTestTransport([]);
        const lookup = async () => [...await publicLookup(), { address, family: isIP(address) }];
        await expect(createArchiveDownloader({ lookup, request: transport.request })('https://tiktokcdn.com/asset', output)).rejects.toMatchObject({ reason: 'dns' });
        expect(transport.requests).toHaveLength(0);
        expect(await readdir(root)).toEqual([]);
    });
}

for (const records of [[], [{ address: 'not-an-address', family: 4 }], [{ address: '1.1.1.1', family: 6 }], [{ address: '2606:4700:4700::1111', family: 4 }]]) {
    test(`rejects empty/malformed/family-inconsistent DNS ${JSON.stringify(records)}`, async () => {
        const { output } = await destination();
        const transport = archiveTestTransport([]);
        await expect(createArchiveDownloader({ lookup: async () => records, request: transport.request })('https://tiktokcdn.com/asset', output)).rejects.toMatchObject({ reason: 'dns' });
        expect(transport.requests).toHaveLength(0);
    });
}

test('pins one validated record for native lookup all/single callbacks without changing Host/SNI/TLS policy', async () => {
    const { output } = await destination();
    const transport = archiveTestTransport([{}]);
    let resolutions = 0;
    const records = [{ address: '1.1.1.1', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }];
    const download = createArchiveDownloader({
        lookup: async (hostname, options) => {
            resolutions++;
            expect(hostname).toBe('cdn.tiktokcdn.com');
            expect(options).toEqual({ all: true, verbatim: true });
            return records;
        },
        request: (url, options, receive) => {
            expect(url.href).toBe('https://cdn.tiktokcdn.com/asset?signed=synthetic');
            expect(options).toMatchObject({ hostname: 'cdn.tiktokcdn.com', servername: 'cdn.tiktokcdn.com', port: 443, rejectUnauthorized: true, agent: false, method: 'GET', headers: { 'Accept-Encoding': 'identity' } });
            expect(options.checkServerIdentity).toBeUndefined();
            expect(options).not.toHaveProperty('proxy');
            let calls = 0;
            options.lookup!('cdn.tiktokcdn.com', { all: true }, (error, addresses) => {
                expect(error).toBeNull();
                expect(addresses).toEqual([{ address: '1.1.1.1', family: 4 }]);
                calls++;
            });
            records[0]!.address = '127.0.0.1'; // Later DNS state cannot change the pinned copy.
            options.lookup!('cdn.tiktokcdn.com', {}, (error, address, family) => {
                expect(error).toBeNull();
                expect(address).toBe('1.1.1.1');
                expect(family).toBe(4);
                calls++;
            });
            options.lookup!('different.synthetic.invalid', {}, error => { expect(error).toMatchObject({ reason: 'dns' }); calls++; });
            expect(calls).toBe(3);
            return transport.request(url, options, receive);
        }
    });
    await download('https://cdn.tiktokcdn.com/asset?signed=synthetic', output);
    expect(resolutions).toBe(1);
});

test('accepts public IPv6 and each default suffix; trusted additions are exact hostnames only', async () => {
    const { root } = await destination();
    for (const hostname of ['tiktokcdn.com', 'a.tiktokcdn-us.com', 'a.tiktokcdn-eu.com', 'a.ibytedtos.com', 'a.byteoversea.com', 'cdn.synthetic.invalid']) {
        const transport = archiveTestTransport([{}]);
        await createArchiveDownloader({ additionalHostnames: ['cdn.synthetic.invalid'], lookup: async () => [{ address: '2606:4700:4700::1111', family: 6 }], request: transport.request })(`https://${hostname}:443/asset`, join(root, hostname));
        expect(transport.requests).toHaveLength(1);
    }
    const transport = archiveTestTransport([]);
    const download = createArchiveDownloader({ additionalHostnames: ['cdn.synthetic.invalid'], lookup: publicLookup, request: transport.request });
    await expect(download('https://sub.cdn.synthetic.invalid/a', join(root, 'rejected'))).rejects.toMatchObject({ reason: 'destination' });
    await expect(createArchiveDownloader({ additionalHostnames: ['cdn.synthetic.invalid'], lookup: async () => [{ address: '127.0.0.1', family: 4 }], request: transport.request })('https://cdn.synthetic.invalid/a', join(root, 'private'))).rejects.toMatchObject({ reason: 'dns' });
    expect(() => createArchiveDownloader({ additionalHostnames: ['127.0.0.1'] })).toThrow('Gift archive download failed');
    expect(() => createArchiveDownloader({ additionalHostnames: ['*.synthetic.invalid'] })).toThrow('Gift archive download failed');
});

test('destroys redirect bodies without reading them and serializes retirement before the next hop', async () => {
    const { output } = await destination();
    let reads = 0;
    const redirect = new Readable({ read() { reads++; this.push(Buffer.alloc(65536)); } });
    const transport = archiveTestTransport([{ status: 302, headers: { location: 'https://next.ibytedtos.com/final' }, body: redirect }, {}]);
    let resolutions = 0;
    await createArchiveDownloader({ lookup: async () => { resolutions++; return publicLookup(); }, request: transport.request })('https://tiktokcdn.com/first', output);
    expect(reads).toBe(0);
    expect(resolutions).toBe(2);
    expect(transport.requests.map(item => item.url.hostname)).toEqual(['tiktokcdn.com', 'next.ibytedtos.com']);
    expect(transport.requests[0]!.options.signal).toBe(transport.requests[1]!.options.signal);
    expect(transport.requests.every(item => item.request.closed && item.response.closed)).toBe(true);
});

for (const location of ['http://tiktokcdn.com/a', 'https://tiktokcdn.com:444/a', 'https://tiktokcdn.com.attacker.invalid/a', '//viewer:secret@tiktokcdn.com/a', 'https://@tiktokcdn.com/a', '/asset#', 'https://[::1]/a']) {
    test(`revalidates redirect destination ${location.split('@').pop()}`, async () => {
        const { root, output } = await destination();
        const transport = archiveTestTransport([{ status: 302, headers: { location } }]);
        await expect(createArchiveDownloader({ lookup: publicLookup, request: transport.request })('https://tiktokcdn.com/start', output)).rejects.toMatchObject({ reason: 'destination' });
        expect(transport.requests).toHaveLength(1);
        expect(transport.requests[0]!.response.closed).toBe(true);
        expect(await readdir(root)).toEqual([]);
    });
}

test('rechecks DNS on redirects and caps redirects at three', async () => {
    const { root, output } = await destination();
    const transport = archiveTestTransport([{ status: 302, headers: { location: '/next' } }]);
    let resolutions = 0;
    await expect(createArchiveDownloader({ request: transport.request, lookup: async () => ++resolutions === 1 ? publicLookup() : [{ address: '127.0.0.1', family: 4 }] })('https://tiktokcdn.com/a', output)).rejects.toMatchObject({ reason: 'dns' });
    expect(resolutions).toBe(2);
    expect(transport.requests).toHaveLength(1);
    const looping = archiveTestTransport(Array.from({ length: 4 }, () => ({ status: 307, headers: { location: '/next' } })));
    await expect(createArchiveDownloader({ request: looping.request, lookup: publicLookup })('https://tiktokcdn.com/a', output)).rejects.toMatchObject({ reason: 'redirect' });
    expect(looping.requests).toHaveLength(4);
    expect(looping.requests.every(item => item.request.closed && item.response.closed)).toBe(true);
    expect(await readdir(root)).toEqual([]);
});

for (const [hop, maxBytes, reason] of [
    [{ status: 404 }, 100, 'status'],
    [{ status: 302 }, 100, 'redirect'],
    [{ headers: { 'content-encoding': 'gzip' } }, 100, 'encoding'],
    [{ headers: { 'content-length': '9007199254740992' } }, 100, 'length'],
    [{ headers: { 'content-length': '2, 2' } }, 100, 'length'],
    [{ headers: { 'content-length': '-1' } }, 100, 'length'],
    [{ headers: { 'content-length': '101' } }, 100, 'limit'],
    [{ headers: { 'content-length': '100' } }, 100, 'length'],
    [{ headers: { 'content-length': '1' } }, 100, 'length'],
    [{}, 10, 'limit'],
    [{ requestError: true }, 100, 'network']
] satisfies [ArchiveTestHop, number, string][]) {
    test(`rejects response ${JSON.stringify(hop)} with ${reason} and removes only owned files`, async () => {
        const { root, output } = await destination();
        const transport = archiveTestTransport([hop]);
        await expect(createArchiveDownloader({ request: transport.request, lookup: publicLookup })('https://tiktokcdn.com/a?signed=synthetic-secret', output, { maxBytes })).rejects.toMatchObject({ code: 'ERR_GIFT_ARCHIVE_DOWNLOAD', message: 'Gift archive download failed', reason });
        expect(await readdir(root)).toEqual([]);
        expect(transport.requests.every(item => item.request.closed && item.response.closed)).toBe(true);
    });
}

test('uses identity/raw bytes without a narrow MIME policy and preserves pre-existing output', async () => {
    const { output } = await destination();
    const transport = archiveTestTransport([{ headers: { 'content-type': 'application/octet-stream', 'content-encoding': 'IDENTITY', 'content-length': '19' } }]);
    const download = createArchiveDownloader({ lookup: publicLookup, request: transport.request });
    await download('https://tiktokcdn.com/a', output);
    const second = archiveTestTransport([{}]);
    await expect(createArchiveDownloader({ lookup: publicLookup, request: second.request })('https://tiktokcdn.com/a', output)).rejects.toMatchObject({ reason: 'io' });
    expect(await readFile(output, 'utf8')).toBe('synthetic ZIP bytes');
    expect(second.requests.every(item => item.request.closed && item.response.closed)).toBe(true);
});

test('request/response errors and aborted bodies retire streams without payload/error leakage', async () => {
    const { root, output } = await destination();
    for (const body of [
        new Readable({ read() { this.destroy(new Error('synthetic-sensitive-response')); } }),
        new Readable({ read() { this.emit('aborted'); } })
    ]) {
        const transport = archiveTestTransport([{ body }]);
        await expect(createArchiveDownloader({ lookup: publicLookup, request: transport.request })('https://tiktokcdn.com/a', output)).rejects.toMatchObject({ reason: 'network', message: 'Gift archive download failed' });
        expect(transport.requests.every(item => item.request.closed && item.response.closed)).toBe(true);
        expect(await readdir(root)).toEqual([]);
    }
});

test('abort while DNS is pending fences late public resolution from starting any request/write', async () => {
    const { root, output } = await destination();
    const controller = new AbortController();
    let resolveDns!: (records: LookupAddress[]) => void;
    let started!: () => void;
    const lookupStarted = new Promise<void>(resolve => { started = resolve; });
    const transport = archiveTestTransport([]);
    const download = createArchiveDownloader({ request: transport.request, lookup: () => {
        started();
        return new Promise(resolve => { resolveDns = resolve; });
    } });
    const operation = download('https://tiktokcdn.com/a', output, { signal: controller.signal });
    await lookupStarted;
    controller.abort();
    await expect(operation).rejects.toMatchObject({ reason: 'aborted' });
    resolveDns(await publicLookup());
    await yieldTurn();
    expect(transport.requests).toHaveLength(0);
    expect(await readdir(root)).toEqual([]);
});

test('abort during request creation retires its handle before any response/file admission', async () => {
    const { root, output } = await destination();
    const controller = new AbortController();
    const transport = archiveTestTransport([{}]);
    const download = createArchiveDownloader({ lookup: publicLookup, request: (url, options, receive) => {
        const request = transport.request(url, options, receive);
        controller.abort();
        return request;
    } });
    await expect(download('https://tiktokcdn.com/a', output, { signal: controller.signal })).rejects.toMatchObject({ reason: 'aborted' });
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests.every(item => item.request.closed && item.response.closed)).toBe(true);
    expect(await readdir(root)).toEqual([]);
});

test('pre-abort, DNS failure, deadline and invalid budgets remain bounded categorical failures', async () => {
    const { root, output } = await destination();
    const transport = archiveTestTransport([]);
    const download = createArchiveDownloader({ lookup: publicLookup, request: transport.request });
    await expect(download('https://tiktokcdn.com/a', output, { signal: AbortSignal.abort() })).rejects.toMatchObject({ reason: 'aborted' });
    await expect(createArchiveDownloader({ request: transport.request, lookup: async () => { throw new Error('synthetic DNS details'); } })('https://tiktokcdn.com/a', output)).rejects.toMatchObject({ reason: 'dns' });
    await expect(createArchiveDownloader({ request: transport.request, lookup: () => new Promise(() => undefined) })('https://tiktokcdn.com/a', output, { timeoutMs: 5 })).rejects.toMatchObject({ reason: 'timeout' });
    for (const options of [{ maxBytes: -1 }, { maxBytes: NaN }, { timeoutMs: 0 }, { timeoutMs: 0x80000000 }, { timeoutMs: 0x100000000 }]) {
        await expect(download('https://tiktokcdn.com/a', output, options)).rejects.toMatchObject({ reason: 'options' });
    }
    expect(transport.requests).toHaveLength(0);
    expect(await readdir(root)).toEqual([]);
});

test('composed deadline during stalled body joins request/response/output close and removes the partial file', async () => {
    const { root, output } = await destination();
    const body = new Readable({ read() { /* Deliberately waits for cancellation. */ } });
    const transport = archiveTestTransport([{ body }]);
    await expect(createArchiveDownloader({ request: transport.request, lookup: publicLookup })('https://tiktokcdn.com/a', output, { timeoutMs: 20, signal: new AbortController().signal })).rejects.toMatchObject({ reason: 'timeout' });
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests.every(item => item.request.closed && item.response.closed)).toBe(true);
    expect(await readdir(root)).toEqual([]);
});

for (const runtime of ['node', 'bun']) {
    test(`real ${runtime} native filesystem pipeline abort closes output FD with fake external DNS/HTTPS`, async () => {
        const { root, output } = await destination();
        const source = `
            import assert from 'node:assert/strict';
            import { Readable } from 'node:stream';
            import { readdir, readlink, stat } from 'node:fs/promises';
            import { setImmediate as yieldTurn } from 'node:timers/promises';
            const { createArchiveDownloader } = await import('./src/services/tiktok-gift-animation/archive-downloader.ts').then(m => m.default ?? m);
            const { archiveTestTransport } = await import('./tests/helpers/archive-download-transport.ts').then(m => m.default ?? m);
            const [root, output] = ${JSON.stringify([root, output])};
            const body = new Readable({ read() { this.push(Buffer.alloc(65536)); } });
            const transport = archiveTestTransport([{ body }]);
            const controller = new AbortController();
            let settled = false;
            let observedWrite = false;
            const operation = createArchiveDownloader({ request: transport.request, lookup: async () => [{ address: '1.1.1.1', family: 4 }] })('https://tiktokcdn.com/a', output, { signal: controller.signal, maxBytes: Number.MAX_SAFE_INTEGER });
            const assertion = assert.rejects(operation, { code: 'ERR_GIFT_ARCHIVE_DOWNLOAD', reason: 'aborted' }).finally(() => { settled = true; });
            const observer = (async () => {
                while (!settled && !observedWrite) {
                    const info = await stat(output).catch(() => null);
                    if (info?.size > 0) { observedWrite = true; controller.abort(); }
                    await yieldTurn();
                }
            })();
            await Promise.all([assertion, observer]);
            assert.equal(observedWrite, true);
            assert.deepEqual(await readdir(root), []);
            assert.equal(transport.requests.every(item => item.request.closed && item.response.closed), true);
            for (const fd of process.platform === 'linux' ? await readdir('/proc/self/fd') : []) {
                const target = await readlink('/proc/self/fd/' + fd).catch(() => '');
                const info = await stat('/proc/self/fd/' + fd).catch(() => null);
                assert.equal(target.startsWith(root) && !!info?.isFile(), false, 'output FD retained');
            }
            console.log('GIFT_ARCHIVE_PIPELINE_OK');
        `;
        const args = runtime === 'node' ? ['--import', 'tsx', '--input-type=module', '--eval', source] : ['--no-env-file', '--eval', source];
        const result = await promisify(execFile)(runtime, args, { cwd: process.cwd(), timeout: 15000 });
        expect(result.stdout.trim()).toBe('GIFT_ARCHIVE_PIPELINE_OK');
        expect(result.stderr).toBe('');
    }, 30000);
}
