import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extractBoundedZip } from '../../../../src/services/tiktok-gift-animation/bounded-zip-extractor';
import { zipFixture, zip64Fixture, type ZipFixtureEntry } from '../../../helpers/bounded-zip-fixture';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(entries: ZipFixtureEntry[]) {
    const root = await mkdtemp(join(tmpdir(), 'bounded-zip-test-'));
    roots.push(root);
    const archive = join(root, 'synthetic.zip');
    await writeFile(archive, zipFixture(entries));
    return { root, archive };
}

for (const runtime of ['node', 'bun']) {
    for (const [field, offset] of [
        ['locator', 0xffffffffffffffffn], ['central', 0xffffffffffffffffn], ['local', 0xffffffffffffffffn],
        ['locator', 4096n], ['central', 4096n], ['local', 4096n], ['valid', 0n]
    ] as const) {
        test(`${runtime} ZIP64 ${field} offset ${offset} rejects safely or extracts valid data and closes its FD`, async () => {
            const { root, archive } = await fixture([]);
            await writeFile(archive, zip64Fixture(field === 'valid' ? {} : { [field]: offset }));
            const source = `
                import assert from 'node:assert/strict';
                import { readdir, readlink, stat, readFile, rm } from 'node:fs/promises';
                import { join } from 'node:path';
                const { extractBoundedZip } = await import('./src/services/tiktok-gift-animation/bounded-zip-extractor.ts').then(m => m.default ?? m);
                const [root, archive, valid] = ${JSON.stringify([root, archive, field === 'valid'])};
                if (valid) {
                    const result = await extractBoundedZip(archive, root);
                    assert.equal(await readFile(join(result.directory, 'asset'), 'utf8'), 'synthetic asset');
                    await rm(result.directory, { recursive: true });
                } else {
                    await assert.rejects(extractBoundedZip(archive, root), { code: 'ERR_BOUNDED_ZIP', message: 'ZIP extraction rejected' });
                }
                assert.deepEqual(await readdir(root), ['synthetic.zip']);
                for (const fd of process.platform === 'linux' ? await readdir('/proc/self/fd') : []) {
                    const target = await readlink('/proc/self/fd/' + fd).catch(() => '');
                    const info = await stat('/proc/self/fd/' + fd).catch(() => null);
                    assert.equal(target.startsWith(root) && !!info?.isFile(), false, 'archive/output descriptor retained');
                }
                console.log('BOUNDED_ZIP_ZIP64_OK');
            `;
            const args = runtime === 'node' ? ['--import', 'tsx', '--input-type=module', '--eval', source] : ['--no-env-file', '--eval', source];
            const result = await promisify(execFile)(runtime, args, { cwd: process.cwd(), timeout: 15000 });
            expect(result.stdout.trim()).toBe('BOUNDED_ZIP_ZIP64_OK');
            expect(result.stderr).toBe('');
        }, 30000);
    }
}

test('extracts stored and deflated Unicode files into owned staging', async () => {
    const { root, archive } = await fixture([{ name: 'config.json' }, { name: 'media/動画.bin', method: 8 }]);
    const result = await extractBoundedZip(archive, root);
    expect(result.files).toEqual(['config.json', 'media/動画.bin']);
    expect(await readFile(join(result.directory, 'media/動画.bin'), 'utf8')).toBe('synthetic asset');
});

for (const name of ['../escape', '/absolute', 'a\\b', 'C:/drive', '//unc/share', 'a:ads', 'a/./b', 'a/../b', 'nul.txt', 'COM1', 'a. /b', 'a./b', 'a /b', 'a\0b', 'a\nb', 'a?b', 'a*b']) {
    test(`rejects unsafe portable path ${JSON.stringify(name)}`, async () => {
        const { root, archive } = await fixture([{ name }]);
        await expect(extractBoundedZip(archive, root)).rejects.toThrow('ZIP extraction rejected');
        expect(await readdir(root)).toEqual(['synthetic.zip']);
    });
}

for (const entries of [
    [{ name: 'A' }, { name: 'a' }],
    [{ name: 'a' }, { name: 'a/b' }],
    [{ name: 'a/b' }, { name: 'A' }],
    [{ name: 'A/b' }, { name: 'a/c' }],
    [{ name: 'a/' , body: Buffer.alloc(0) }, { name: 'a' }],
    [{ name: 'é' }, { name: 'e\u0301' }],
    [{ name: 'Σ' }, { name: 'ς' }],
    [{ name: 'straße' }, { name: 'STRASSE' }],
    [{ name: 'link', mode: 0xa000 }],
    [{ name: 'fifo', mode: 0x1000 }],
    [{ name: 'directory', mode: 0x4000 }],
    [{ name: 'not-empty/', body: Buffer.from('synthetic') }],
    [{ name: 'encrypted', flags: 1 }],
    [{ name: 'unsupported', method: 99 }],
    [{ name: 'mismatch', size: 1 }],
    [{ name: 'short', method: 8, size: 100 }],
    [{ name: 'expansion', method: 8, size: 1, body: Buffer.alloc(100000) }]
] satisfies ZipFixtureEntry[][]) {
    test(`rejects invalid manifest or stream ${JSON.stringify(entries.map(e => e.name))}`, async () => {
        const { root, archive } = await fixture(entries);
        await expect(extractBoundedZip(archive, root)).rejects.toThrow('ZIP extraction rejected');
        expect(await readdir(root)).toEqual(['synthetic.zip']);
    });
}

test('enforces configurable bounds and pre-abort without staging leaks', async () => {
    const { root, archive } = await fixture([{ name: 'asset', method: 8 }]);
    for (const limits of [{ archiveBytes: 1 }, { entries: 0 }, { fileBytes: 1 }, { totalBytes: 1 }, { filenameBytes: 1 }]) {
        await expect(extractBoundedZip(archive, root, { limits })).rejects.toThrow('ZIP extraction rejected');
    }
    await expect(extractBoundedZip(archive, root, { signal: AbortSignal.abort() })).rejects.toThrow('ZIP extraction rejected');
    expect(await readdir(root)).toEqual(['synthetic.zip']);
});

test('supports explicit directories, unknown file type and aggregate manifest bounds', async () => {
    const { root, archive } = await fixture([
        { name: 'media/', mode: 0x4000, body: Buffer.alloc(0) },
        { name: 'media/asset', mode: 0, method: 8 },
        { name: 'other', method: 8 }
    ]);
    const result = await extractBoundedZip(archive, root);
    expect(result.files).toEqual(['media/asset', 'other']);
    await rm(result.directory, { recursive: true });
    await expect(extractBoundedZip(archive, root, { limits: { totalBytes: 20 } })).rejects.toThrow('ZIP extraction rejected');
    await expect(extractBoundedZip(archive, root, { limits: { entries: -1 } })).rejects.toThrow('ZIP extraction rejected');
    await expect(extractBoundedZip(root, root)).rejects.toThrow('ZIP extraction rejected');
    await writeFile(archive, Buffer.from('synthetic corrupt archive'));
    await expect(extractBoundedZip(archive, root)).rejects.toThrow('ZIP extraction rejected');
    expect(await readdir(root)).toEqual(['synthetic.zip']);
});

test('joins cleanup after corrupt local headers, corrupt deflate and staging I/O failure', async () => {
    const { root, archive } = await fixture([{ name: 'asset', method: 8 }]);
    await expect(extractBoundedZip(archive, join(root, 'missing-parent'))).rejects.toThrow('ZIP extraction rejected');
    const local = zipFixture([{ name: 'asset', method: 8 }]);
    local.writeUInt32LE(0, 0);
    await writeFile(archive, local);
    await expect(extractBoundedZip(archive, root)).rejects.toThrow('ZIP extraction rejected');
    const deflate = zipFixture([{ name: 'asset', method: 8 }]);
    deflate[35] = 0xff; // Reserved DEFLATE block type in the first payload byte.
    await writeFile(archive, deflate);
    await expect(extractBoundedZip(archive, root)).rejects.toThrow('ZIP extraction rejected');
    expect(await readdir(root)).toEqual(['synthetic.zip']);
});

for (const [runtime, method, action] of [
    ['node', 0, 'abort'], ['node', 8, 'abort'], ['bun', 0, 'abort'], ['bun', 8, 'abort'],
    ['node', 0, 'truncate'], ['bun', 0, 'truncate']
] as const) {
    test(`real ${runtime} child: method ${method} active write ${action} and descriptor cleanup without preload`, async () => {
        const { root, archive } = await fixture([{ name: 'asset', body: Buffer.alloc(32 * 1024 * 1024), method }]);
        const source = `
            import assert from 'node:assert/strict';
            import { readdir, readlink, readFile, rm, writeFile, stat, truncate } from 'node:fs/promises';
            import { setImmediate as yieldTurn } from 'node:timers/promises';
            import { join } from 'node:path';
            const { extractBoundedZip } = await import('./src/services/tiktok-gift-animation/bounded-zip-extractor.ts').then(m => m.default ?? m);
            const { zipFixture } = await import('./tests/helpers/bounded-zip-fixture.ts').then(m => m.default ?? m);
            const [root, archive] = ${JSON.stringify([root, archive])};
            const controller = new AbortController();
            let observedWrite = false;
            let settled = false;
            const operation = extractBoundedZip(archive, root, { signal: controller.signal });
            const assertion = assert.rejects(operation, { code: 'ERR_BOUNDED_ZIP' }).finally(() => { settled = true; });
            const observer = (async () => {
                while (!settled && !observedWrite) {
                    for (const name of await readdir(root)) {
                        if (!name.startsWith('gift-zip-')) continue;
                        const info = await stat(join(root, name, 'asset')).catch(() => null);
                        if (info?.size > 0) {
                            observedWrite = true;
                            if (${JSON.stringify(action)} === 'abort') controller.abort();
                            else await truncate(archive, 0);
                        }
                    }
                    await yieldTurn();
                }
            })();
            await Promise.all([assertion, observer]);
            assert.equal(observedWrite, true);
            assert.deepEqual(await readdir(root), ['synthetic.zip']);
            for (const fd of process.platform === 'linux' ? await readdir('/proc/self/fd') : []) {
                const target = await readlink('/proc/self/fd/' + fd).catch(() => '');
                const info = await stat('/proc/self/fd/' + fd).catch(() => null);
                assert.equal(target.startsWith(root) && !!info?.isFile(), false, 'archive/output descriptor retained');
            }
            await writeFile(archive, zipFixture([{ name: 'plain' }, { name: '動画', method: 8 }]));
            const result = await extractBoundedZip(archive, root);
            assert.equal(await readFile(join(result.directory, '動画'), 'utf8'), 'synthetic asset');
            await rm(result.directory, { recursive: true });
            console.log('BOUNDED_ZIP_RUNTIME_OK');
        `;
        const args = runtime === 'node' ? ['--import', 'tsx', '--input-type=module', '--eval', source] : ['--no-env-file', '--eval', source];
        const result = await promisify(execFile)(runtime, args, { cwd: process.cwd(), timeout: 15000 });
        expect(result.stdout.trim()).toBe('BOUNDED_ZIP_RUNTIME_OK');
        expect(result.stderr).toBe('');
    }, 30000);
}
