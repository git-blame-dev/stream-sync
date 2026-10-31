import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { acquireSingleInstanceGuard } from '../../src/services/SingleInstanceGuard';
import { withTimeout } from '../../src/utils/timeout-wrapper';

const root = path.resolve(__dirname, '../..');
const fixture = path.join(root, 'tests/fixtures/single-instance-process.ts');
let directory: string;
let compiled: string;
beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'synthetic-instance-probe-'));
    compiled = path.join(directory, process.platform === 'win32' ? 'guard-probe.exe' : 'guard-probe');
    const build = Bun.spawn([process.execPath, 'build', '--compile', fixture, '--outfile', compiled], {
        cwd: root, env: { PATH: process.env.PATH }, stdout: 'pipe', stderr: 'pipe'
    });
    try {
        const [code, stdout, stderr] = await Promise.all([
            withTimeout(build.exited, 30000, 'Synthetic guard probe compilation'),
            new Response(build.stdout).text(), new Response(build.stderr).text()
        ]);
        if (code !== 0) throw new Error(`Synthetic guard probe compilation failed: ${stdout}${stderr}`);
    } finally {
        if (build.exitCode === null) build.kill();
        await build.exited;
    }
}, 35000);
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

async function readPort(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<number> {
    const ready = async () => {
        let line = '';
        const decoder = new TextDecoder();
        while (!line.includes('\n')) {
            const next = await reader.read();
            if (next.done) throw new Error('Synthetic guard exited before readiness');
            line += decoder.decode(next.value, { stream: true });
        }
        const port = Number(line.trim());
        if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('Invalid synthetic guard readiness');
        return port;
    };
    return withTimeout(ready(), 5000, 'Synthetic guard readiness');
}

const runtimes = [
    { name: 'Bun', command: () => [process.execPath] },
    { name: 'Node', command: () => ['node', '--import', pathToFileURL(path.join(root, 'node_modules/tsx/dist/loader.mjs')).href] },
    { name: 'compiled Bun', command: () => [compiled] }
];

for (const runtime of runtimes) {
    describe(`${runtime.name} instance ownership`, () => {
        const launch = (mode: 'hold' | 'exit') => Bun.spawn([...runtime.command(), ...(runtime.name === 'compiled Bun' ? [] : [fixture]), '0', mode], {
            cwd: root,
            env: { PATH: process.env.PATH, NODE_ENV: 'test' },
            stdin: 'pipe', stdout: 'pipe', stderr: 'pipe'
        });

        it('releases ownership after confirmed force termination without a stale-lock delay', async () => {
            const child = launch('hold');
            const reader = child.stdout.getReader();
            try {
                const port = await readPort(reader);
                expect(port).toBeGreaterThan(0);
                await expect(acquireSingleInstanceGuard({ port })).rejects.toMatchObject({ code: 'STREAM_SYNC_INSTANCE_UNAVAILABLE' });
                child.kill('SIGKILL');
                await withTimeout(child.exited, 5000, 'Synthetic owner termination');
                const successor = await acquireSingleInstanceGuard({ port });
                await successor.release();
                expect(await new Response(child.stderr).text()).toBe('');
            } finally {
                reader.releaseLock();
                if (child.exitCode === null) child.kill();
                await child.exited;
            }
        }, 15000);

        it('does not keep a process alive when the guard is its only handle', async () => {
            const child = launch('exit');
            try {
                expect(await withTimeout(child.exited, 5000, 'Unreferenced guard natural exit')).toBe(0);
                expect(await new Response(child.stderr).text()).toBe('');
                const port = Number((await new Response(child.stdout).text()).trim());
                expect(port).toBeGreaterThan(0);
                const successor = await acquireSingleInstanceGuard({ port });
                await successor.release();
            } finally {
                if (child.exitCode === null) child.kill();
                await child.exited;
            }
        }, 15000);

        it('releases a live owner explicitly and exits without lingering handles', async () => {
            const child = launch('hold');
            const reader = child.stdout.getReader();
            try {
                const port = await readPort(reader);
                expect(port).toBeGreaterThan(0);
                child.stdin.write('release\n');
                await child.stdin.flush();
                expect(await withTimeout(child.exited, 5000, 'Released owner exit')).toBe(0);
                const successor = await acquireSingleInstanceGuard({ port });
                await successor.release();
                expect(await new Response(child.stderr).text()).toBe('');
            } finally {
                reader.releaseLock();
                if (child.exitCode === null) child.kill();
                await child.exited;
            }
        }, 15000);
    });
}
