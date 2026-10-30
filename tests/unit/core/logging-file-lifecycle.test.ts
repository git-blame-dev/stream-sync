import { afterEach, expect, it } from 'bun:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getUnifiedLogger, initializeLoggingConfig } from '../../../src/core/logging';
import { captureStderr } from '../../helpers/output-capture';
const roots: string[] = [];
afterEach(async () => {
    await getUnifiedLogger().flush();
    initializeLoggingConfig({ logging: { console: { enabled: false }, file: { enabled: false } } });
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function directory() { const root = await mkdtemp(path.join(tmpdir(), 'synthetic-logging-lifecycle-')); roots.push(root); return root; }

it('stores full dates and a stable run identifier across reconfiguration', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'synthetic-log-context-')); roots.push(directory);
    initializeLoggingConfig({ logging: { console: { enabled: false }, file: { enabled: true, directory } } });
    const logger = getUnifiedLogger(); logger.info('first synthetic entry', 'fixture');
    initializeLoggingConfig({ logging: { console: { enabled: false }, file: { enabled: true, directory } } });
    logger.info('second synthetic entry', 'fixture'); await logger.flush();
    const lines = (await readFile(path.join(directory, 'runtime.log'), 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    const contexts = lines.map(line => /^\[(\d{4}-\d\d-\d\dT[^\]]+Z)\] \[INFO\] \[fixture\] \[run:([^\]]+)\]/.exec(line));
    expect(contexts.every(Boolean)).toBe(true);
    expect(contexts[0]![2]).toBe(contexts[1]![2]);
    expect(lines[0]).toContain('first synthetic entry');
    expect(lines[1]).toContain('second synthetic entry');
});

it('uses stderr for high severity entries refused by the bounded file queue', async () => {
    const root = await directory(); const capture = captureStderr();
    try {
        initializeLoggingConfig({ logging: { console: { enabled: false }, file: { enabled: true, directory: root, maxQueueBytes: 1 } } });
        getUnifiedLogger().error('synthetic important failure', 'fixture'); await getUnifiedLogger().flush();
        expect(capture.output.join('')).toContain('synthetic important failure');
        expect(capture.output.join('')).toContain('dropped 1');
    } finally { capture.restore(); }
});

for (const mode of ['test', 'production']) {
    it(`keeps default ${mode} file logging isolated in a native child`, async () => {
        const root = await directory();
        const modulePath = fileURLToPath(new URL('../../../src/core/logging.ts', import.meta.url));
        const code = `import { getUnifiedLogger } from ${JSON.stringify(modulePath)}; getUnifiedLogger().info('synthetic child record', 'fixture'); await getUnifiedLogger().flush();`;
        const child = Bun.spawn([process.execPath, '--no-env-file', '-e', code], { cwd: root,
            env: { ...process.env, NODE_ENV: mode }, stdout: 'pipe', stderr: 'pipe' });
        const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect(exit).toBe(0); expect(stdout).toBe(''); expect(stderr).toBe('');
        if (mode === 'test') expect(await readdir(root)).toEqual([]);
        else expect(await readFile(path.join(root, 'logs/runtime.log'), 'utf8')).toContain('synthetic child record');
    });
}
