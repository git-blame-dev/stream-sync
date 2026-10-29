import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

for (const runtime of ['node', 'bun']) {
    for (const mode of ['abort', 'stop']) {
        test(`${runtime} closes full and ranged runtime-media sources on ${mode}`, async () => {
            const directory = await mkdtemp(path.join(tmpdir(), 'synthetic-media-lifetime-'));
            const root = path.resolve(__dirname, '../..');
            const configPath = path.join(directory, 'synthetic-config.ini');
            try {
                await writeFile(configPath, '[general]\nenvFileReadEnabled=false\nenvFileWriteEnabled=false\n[logging]\nfileLoggingEnabled=false\n');
                const fixture = path.join(root, 'tests/fixtures/gui-runtime-media-lifetime.ts');
                const command = runtime === 'node'
                    ? ['node', '--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'), fixture, directory, mode]
                    : [process.execPath, '--no-env-file', fixture, directory, mode];
                const child = Bun.spawn(command, {
                    cwd: directory,
                    env: { PATH: process.env.PATH, NODE_ENV: 'test', CHAT_BOT_CONFIG_PATH: configPath },
                    stdout: 'pipe', stderr: 'pipe', timeout: 10000
                });
                const [stdout, stderr, exitCode] = await Promise.all([
                    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited
                ]);
                expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' });
                expect(stdout).toContain('MEDIA_LIFETIME_OK');
            } finally {
                await rm(directory, { recursive: true, force: true });
            }
        });
    }
}
