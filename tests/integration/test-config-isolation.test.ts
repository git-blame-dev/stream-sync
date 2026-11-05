import { expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { withTimeout } from '../../src/utils/timeout-wrapper';

type Probe = ReturnType<typeof spawnProbe>;
const spawnProbe = (source: string, cwd: string) => Bun.spawn([
    process.execPath, '--no-env-file', '--eval', source,
], { cwd, env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test' }, stdout: 'pipe', stderr: 'pipe' });

async function collectConfigProbes(launches: (() => Probe)[], timeoutMs = 3000) {
    const children: Probe[] = [];
    try {
        for (const launch of launches) children.push(launch());
        return await withTimeout(Promise.all(children.map(async child => {
            const [stdout, stderr, code] = await Promise.all([
                new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
            ]);
            if (code !== 0 || stderr !== '') throw new Error(`Synthetic config probe exited with code ${code}: ${stderr}`);
            return stdout;
        })), timeoutMs, 'Synthetic config probes');
    } finally {
        for (const child of children) {
            if (child.exitCode === null) child.kill('SIGKILL');
        }
        await Promise.allSettled(children.map(child => child.exited));
    }
}

it('retires a hanging config probe when its deadline expires', async () => {
    const children: Probe[] = [];
    await expect(collectConfigProbes([() => {
        const child = spawnProbe('setInterval(() => {}, 1000)', import.meta.dir);
        children.push(child);
        return child;
    }], 50)).rejects.toThrow('Synthetic config probes timeout');
    expect(children).toHaveLength(1);
    expect(children[0]?.signalCode).toBe('SIGKILL');
});

it('retires a hanging sibling when another config probe fails', async () => {
    const children: Probe[] = [];
    await expect(collectConfigProbes([
        () => {
            const child = spawnProbe('setInterval(() => {}, 1000)', import.meta.dir);
            children.push(child);
            return child;
        },
        () => spawnProbe('process.exit(7)', import.meta.dir),
    ])).rejects.toThrow('Synthetic config probe exited with code 7');
    expect(children).toHaveLength(1);
    expect(children[0]?.signalCode).toBe('SIGKILL');
});

it('isolates concurrent preruns and skips a cwd dotenv through the real config loader', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'synthetic-test-isolation-'));
    const root = path.resolve(import.meta.dir, '../..');
    const source = `
        const config = await import(${JSON.stringify(path.join(root, 'src/core/config.ts'))});
        const value = config.loadConfig();
        globalThis.__ORIGINAL_STDOUT_WRITE__(JSON.stringify({
            path: process.env.CHAT_BOT_CONFIG_PATH,
            read: value.general.envFileReadEnabled,
            write: value.general.envFileWriteEnabled,
            importedClient: process.env.TWITCH_CLIENT_ID ?? null
        }));
    `;
    try {
        await writeFile(path.join(directory, '.env'), 'TWITCH_CLIENT_ID=synthetic-must-not-import\n');
        const launch = () => Bun.spawn([
            process.execPath, '--no-env-file', '--preload', path.join(root, 'tests/setup/bun.prerun.ts'),
            '--eval', source,
        ], { cwd: directory, env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test' }, stdout: 'pipe', stderr: 'pipe' });
        const results = (await collectConfigProbes([launch, launch])).map(stdout => JSON.parse(stdout) as {
            path: string; read: boolean; write: boolean; importedClient: string | null;
        });
        expect(results[0]?.path).not.toBe(results[1]?.path);
        for (const result of results) {
            expect(result.read).toBe(false);
            expect(result.write).toBe(false);
            expect(result.importedClient).toBeNull();
            await expect(access(result.path)).rejects.toMatchObject({ code: 'ENOENT' });
        }
        expect(await readFile(path.join(directory, '.env'), 'utf8')).toBe('TWITCH_CLIENT_ID=synthetic-must-not-import\n');
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
