import { afterEach, expect, it, spyOn } from 'bun:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger, getUnifiedLogger, initializeLoggingConfig } from '../../../src/core/logging';
import { captureStderr, captureStdout } from '../../helpers/output-capture';
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

it('renders control-bearing messages and sources as one physical line across outputs', async () => {
    const root = await directory();
    const capture = captureStdout();
    const logger = createLogger({ console: { enabled: true }, file: { enabled: true, directory: root } }, { operatorCaptureEnabled: true });
    try {
        logger.info('synthetic\nforged\r\u001b[31m\u0085\u2028', 'fixture\nsource', { 'synthetic\nkey': 'safe\nvalue' });
        await logger.flush();
        const file = await readFile(path.join(root, 'runtime.log'), 'utf8');
        const consoleText = capture.output.join('');
        expect(file.trimEnd().split('\n')).toHaveLength(1);
        expect(consoleText.trimEnd().split('\n')).toHaveLength(1);
        expect(file).toContain('synthetic\\u000aforged\\u000d\\u001b[31m\\u0085\\u2028');
        expect(consoleText).toContain('[fixture\\u000asource]');
        expect(logger.getOperatorLogSource()?.history().entries[0]?.message).toContain('synthetic\nforged');
    } finally { await logger.flush(); capture.restore(); }
});

it('keeps console and operator capture working when file configuration is rejected', async () => {
    const root = await directory();
    const stdout = captureStdout(); const stderr = captureStderr();
    try {
        const logger = createLogger({ console: { enabled: true }, file: { enabled: true, directory: root, maxBytes: -1 } }, { operatorCaptureEnabled: true });
        logger.info('synthetic invalid file config');
        expect(stdout.output.join('')).toContain('synthetic invalid file config');
        expect(stderr.output.join('')).toContain('Invalid file output configuration');
        expect(logger.getOperatorLogSource()?.history().entries[0]?.message).toBe('synthetic invalid file config');
        logger.reconfigure({ file: { enabled: true, directory: root } });
        logger.info('synthetic recovered file');
        await logger.flush();
        expect(await readFile(path.join(root, 'runtime.log'), 'utf8')).toContain('synthetic recovered file');
    } finally { stdout.restore(); stderr.restore(); }
});

it('preserves queued destinations across reconfiguration and drains after disabling', async () => {
    const first = await directory(); const second = await directory();
    const logger = createLogger({ file: { enabled: true, directory: first } });
    logger.info('synthetic old destination');
    logger.reconfigure({ file: { enabled: true, directory: second } });
    logger.info('synthetic new destination');
    logger.reconfigure({ file: { enabled: false } });
    logger.info('synthetic disabled');
    await logger.flush();
    const oldFile = await readFile(path.join(first, 'runtime.log'), 'utf8');
    const newFile = await readFile(path.join(second, 'runtime.log'), 'utf8');
    expect(oldFile).toContain('synthetic old destination');
    expect(oldFile).not.toContain('synthetic new destination');
    expect(newFile).toContain('synthetic new destination');
    expect(newFile).not.toContain('synthetic disabled');
});

it('keeps file and operator output working after console failure', async () => {
    const root = await directory();
    const stdout = spyOn(process.stdout, 'write').mockImplementation(() => { throw new Error('synthetic stream failure'); });
    const stderr = captureStderr();
    try {
        const logger = createLogger({ console: { enabled: true }, file: { enabled: true, directory: root } }, { operatorCaptureEnabled: true });
        logger.warn('synthetic survives console');
        await logger.flush();
        expect(await readFile(path.join(root, 'runtime.log'), 'utf8')).toContain('synthetic survives console');
        expect(logger.getOperatorLogSource()?.history().entries[0]?.message).toBe('synthetic survives console');
        expect(stderr.output.join('')).toContain('Console output failed');
    } finally { stdout.mockRestore(); stderr.restore(); }
});

it('shares one metadata snapshot across console, file and operator capture', async () => {
    const root = await directory();
    const capture = captureStdout();
    const logger = createLogger({ console: { enabled: true }, file: { enabled: true, directory: root } }, { operatorCaptureEnabled: true });
    try {
        let reads = 0;
        logger.info('synthetic consistent snapshot', 'fixture', { get snapshot() { return ++reads; }, password: 'synthetic secret' });
        await logger.flush();
        const file = await readFile(path.join(root, 'runtime.log'), 'utf8');
        const entry = logger.getOperatorLogSource()?.history().entries[0];
        expect(reads).toBe(1);
        expect(entry?.data).toEqual({ password: '[REDACTED]', snapshot: 1 });
        expect(file).toContain(JSON.stringify(entry?.data));
        expect(capture.output.join('')).toContain(JSON.stringify(entry?.data));
    } finally { await logger.flush(); capture.restore(); }
});

it('does not traverse records when invalid file configuration leaves no accepting output', async () => {
    const root = await directory(); const capture = captureStderr();
    try {
        const logger = createLogger({ file: { enabled: true, directory: root, maxBytes: -1 } });
        let reads = 0;
        logger.info({ get value() { reads++; return 'synthetic value'; } });
        expect(reads).toBe(0);
        expect(logger.shouldOutput('info', 'file')).toBe(false);
    } finally { capture.restore(); }
});

it('isolates synchronous file output failure when its stderr diagnostic also fails', async () => {
    const root = await directory(); const stdout = captureStdout();
    const stderr = spyOn(process.stderr, 'write').mockImplementation(() => { throw new Error('synthetic broken stderr'); });
    try {
        const logger = createLogger({ console: { enabled: true }, file: { enabled: true, directory: root, filename: '../synthetic-invalid.log' } }, { operatorCaptureEnabled: true });
        expect(() => logger.warn('synthetic survives file failure')).not.toThrow();
        await logger.flush();
        expect(logger.getOperatorLogSource()?.history().entries[0]?.message).toBe('synthetic survives file failure');
        expect(stdout.output.join('')).toContain('synthetic survives file failure');
        expect(stderr).toHaveBeenCalledTimes(2);
        expect(await readdir(root)).toEqual([]);
    } finally { stdout.restore(); stderr.mockRestore(); }
});
