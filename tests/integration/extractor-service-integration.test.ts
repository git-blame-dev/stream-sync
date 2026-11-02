import { test, expect } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runYouTubeSdkChild } from './youtube-sdk-child';

test('installed SDK HTTP responses reach real concurrent extraction and service identity checks', async () => {
    const harness = fileURLToPath(new URL('../helpers/youtube-viewer-count-sdk.harness.ts', import.meta.url));
    const configDir = await mkdtemp(join(tmpdir(), 'youtube-viewer-sdk-'));
    try {
        const config = join(configDir, 'bunfig.toml');
        await writeFile(config, '');
        const result = await runYouTubeSdkChild(['run', '--no-env-file', `--config=${config}`, harness]);
        expect({ exit: result.exit, output: result.exit ? result.stdout + result.stderr : '' }).toEqual({ exit: 0, output: '' });
        expect(result.stdout.trim()).toBe('YOUTUBE_VIEWER_COUNT_SDK_OK checks=17');
        expect(result.stderr).toBe('');
    } finally { await rm(configDir, { recursive: true, force: true }); }
}, 30000);
