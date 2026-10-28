import { test, expect } from 'bun:test';
import { access, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runYouTubeSdkChild } from './youtube-sdk-child';

test('actual installed SDK honors owned client initialization, operation and chat lifetimes', async () => {
    // Do not import this harness: the normal test preload globally mocks the SDK.
    const harness = fileURLToPath(new URL('../helpers/innertube-owned-sdk.harness.ts', import.meta.url));
    const configDir = await mkdtemp(join(tmpdir(), 'innertube-owned-sdk-'));
    try {
        const config = join(configDir, 'bunfig.toml');
        await writeFile(config, '');
        // Unlike `bun test`, `bun run` passes trailing flags to the script. Put
        // flags before the script, with Bun's --config=value syntax. The shared
        // child owner still reaps/drains it and cleans its own temporary config.
        const result = await runYouTubeSdkChild(['run', '--no-env-file', `--config=${config}`, harness]);
        expect({ exit: result.exit, output: result.exit ? result.stdout + result.stderr : '' }).toEqual({ exit: 0, output: '' });
        expect(result.stdout.trim()).toBe('YOUTUBE_OWNED_SDK_OK checks=9');
        expect(result.stderr).toBe('');
        expect(() => process.kill(result.pid, 0)).toThrow();
        await expect(access(result.configDir)).rejects.toThrow();
    } finally { await rm(configDir, { recursive: true, force: true }); }
    await expect(access(configDir)).rejects.toThrow();
}, 30000);
