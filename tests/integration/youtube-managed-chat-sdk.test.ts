import { test, expect } from 'bun:test';
import { access, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runYouTubeSdkChild } from './youtube-sdk-child';

test('actual installed LiveChat uses adopted per-attempt ownership and awaited body cleanup', async () => {
    const harness = fileURLToPath(new URL('../helpers/youtube-managed-chat-sdk.harness.ts', import.meta.url));
    const configDir = await mkdtemp(join(tmpdir(), 'youtube-managed-chat-sdk-'));
    try {
        const config = join(configDir, 'bunfig.toml');
        await writeFile(config, '');
        const result = await runYouTubeSdkChild(['run', '--no-env-file', `--config=${config}`, harness]);
        expect({ exit: result.exit, output: result.exit ? result.stdout + result.stderr : '' }).toEqual({ exit: 0, output: '' });
        expect(result.stdout.trim()).toBe('YOUTUBE_MANAGED_CHAT_SDK_OK checks=8');
        expect(result.stderr).toBe('');
        expect(() => process.kill(result.pid, 0)).toThrow();
        await expect(access(result.configDir)).rejects.toThrow();
    } finally { await rm(configDir, { recursive: true, force: true }); }
    await expect(access(configDir)).rejects.toThrow();
}, 30000);
