import { expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
        const run = async () => {
            const child = Bun.spawn([
                process.execPath, '--no-env-file', '--preload', path.join(root, 'tests/setup/bun.prerun.ts'),
                '--eval', source,
            ], { cwd: directory, env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test' }, stdout: 'pipe', stderr: 'pipe' });
            const [stdout, stderr, code] = await Promise.all([
                new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
            ]);
            expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
            return JSON.parse(stdout) as { path: string; read: boolean; write: boolean; importedClient: string | null };
        };
        const results = await Promise.all([run(), run()]);
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
