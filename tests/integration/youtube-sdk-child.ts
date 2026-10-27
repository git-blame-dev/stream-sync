import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Own just this child, its output readers, and its temporary preload-free config.
export async function runYouTubeSdkChild(args: string[], timeout = 20000) {
    const configDir = await mkdtemp(join(tmpdir(), 'youtube-sdk-retirement-'));
    let child: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined;
    let readers: Promise<string>[] = [];
    try {
        const config = join(configDir, 'bunfig.toml');
        await writeFile(config, '');
        child = Bun.spawn([process.execPath, ...args, '--no-env-file', '--config', config], {
            cwd: fileURLToPath(new URL('../..', import.meta.url)),
            env: { ...process.env, YOUTUBE_SDK_RETIREMENT_CHILD: '1' },
            stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
            timeout, killSignal: 'SIGKILL'
        });
        readers = [new Response(child.stdout).text(), new Response(child.stderr).text()];
        const [stdout, stderr, exit] = await Promise.all([readers[0]!, readers[1]!, child.exited]);
        return { stdout, stderr, exit, signal: child.signalCode, pid: child.pid, configDir };
    } finally {
        try {
            if (child) {
                if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
                await child.exited;
                await Promise.allSettled(readers);
            }
        } finally { await rm(configDir, { recursive: true, force: true }); }
    }
}
