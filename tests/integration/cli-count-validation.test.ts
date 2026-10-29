import { expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

it('validates complete decimal message counts before help exits', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'synthetic-cli-count-'));
    const root = path.resolve(import.meta.dir, '../..');
    try {
        const configPath = path.join(directory, 'config.ini');
        await writeFile(configPath, '[general]\nenvFileReadEnabled=false\nenvFileWriteEnabled=false\n[logging]\nfileLoggingEnabled=false\n');
        for (const [token, expected] of [
            ['1', 0], ['10', 0], ['+1', 0], ['01', 0], ['9007199254740991', 0],
            ['1garbage', 1], ['1.5', 1], ['1e3', 1], ['1.0', 1], ['0x10', 1],
            ['0', 1], ['-1', 1], ['', 1], [' 1', 1], ['9007199254740992', 1],
        ] as const) {
            const child = Bun.spawn([process.execPath, '--no-env-file', path.join(root, 'src/bootstrap.ts'), '--chat', token, '--help'], {
                cwd: directory, env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', CHAT_BOT_CONFIG_PATH: configPath },
                stdout: 'pipe', stderr: 'pipe',
            });
            const [stdout, stderr, code] = await Promise.all([
                new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
            ]);
            expect({ token, code }).toEqual({ token, code: expected });
            expect(expected === 0 ? stdout.includes('Usage: stream-sync') : stderr.includes('--chat')).toBe(true);
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}, 15_000);
