import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { copyFile, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { withNativeChildEnvironment } from '../helpers/native-child-environment';

let fixtureDirectory: string;
let entryPath: string;

beforeAll(async () => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'synthetic-bootstrap-'));
    entryPath = join(fixtureDirectory, 'bootstrap.js');
    // Exercise the real bootstrap with only the application boundary replaced.
    // Keeping main external preserves static versus dynamic import evaluation order.
    const build = await Bun.build({
        entrypoints: [fileURLToPath(import.meta.resolve('../../src/bootstrap.ts'))],
        target: 'bun',
        plugins: [{ name: 'synthetic-main-boundary', setup(builder) {
            builder.onResolve({ filter: /^\.\/main$/ }, () => ({
                path: join(fixtureDirectory, 'main.ts'), external: true,
            }));
        } }],
        outdir: fixtureDirectory,
        naming: 'bootstrap.js',
    });
    expect(build.success).toBe(true);
    await copyFile(fileURLToPath(import.meta.resolve('../fixtures/bootstrap/synthetic-main.ts')), join(fixtureDirectory, 'main.ts'));
});

afterAll(async () => {
    if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
});

async function runSyntheticBootstrap(scenario: string, args: string[] = []) {
    return withNativeChildEnvironment(async env => {
        const cwd = dirname(env.CHAT_BOT_CONFIG_PATH!);
        const child = Bun.spawnSync([process.execPath, '--no-env-file', entryPath, ...args], {
            cwd,
            env: { ...env, SYNTHETIC_BOOTSTRAP_CASE: scenario },
            stdout: 'pipe',
            stderr: 'pipe',
            timeout: 5_000,
        });
        const files = await readdir(cwd);
        const emergencyFile = files.includes('logs')
            ? await readFile(join(cwd, 'logs/program-log.txt'), 'utf8') : undefined;
        return { code: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString(), emergencyFile };
    });
}

describe('bootstrap process boundary', () => {
    test('guards application import failures with redacted stderr and fatal exit, without startup files', async () => {
        const result = await runSyntheticBootstrap('import-failure');
        expect(result.code).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('[FATAL] [Bootstrap] Main function failed:');
        expect(result.stderr).toContain('synthetic import failure');
        expect(result.stderr).not.toContain('synthetic-bootstrap-token');
        expect(result.emergencyFile).toBeUndefined();
    });

    test('guards main rejection with stderr and fatal exit, without startup files', async () => {
        const result = await runSyntheticBootstrap('main-failure');
        expect(result.code).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('[FATAL] [Bootstrap] Main function failed:');
        expect(result.stderr).toContain('synthetic main failure');
        expect(result.emergencyFile).toBeUndefined();
    });

    test('exits after reporting an uncaught exception to both emergency sinks', async () => {
        const result = await runSyntheticBootstrap('uncaught-exception');
        expect(result.code).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('[FATAL] Uncaught Exception:');
        expect(result.emergencyFile).toContain('synthetic uncaught failure');
    });

    test('exits nonzero after exactly one bounded unhandled rejection report', async () => {
        const result = await runSyntheticBootstrap('unhandled-rejection');
        expect(result.code).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('[BOOTSTRAP] Unhandled Rejection:');
        expect(result.emergencyFile).toContain('synthetic rejection failure');
        expect(result.stderr.match(/\[BOOTSTRAP\] Unhandled Rejection:/g)).toHaveLength(1);
        expect(result.emergencyFile?.match(/\[BOOTSTRAP\] Unhandled Rejection:/g)).toHaveLength(1);
        expect(result.stderr.length).toBeLessThan(5_000);
    });

    test('keeps handled operational failures outside the fatal rejection policy', async () => {
        expect(await runSyntheticBootstrap('handled-rejection')).toEqual({
            code: 0, stdout: '', stderr: '', emergencyFile: undefined,
        });
    });

    test('passes debug to main without extra bootstrap announcements', async () => {
        expect(await runSyntheticBootstrap('debug', ['--debug'])).toEqual({
            code: 0, stdout: '', stderr: '', emergencyFile: undefined,
        });
    });

    test('passes help to main and preserves its output', async () => {
        expect(await runSyntheticBootstrap('help', ['--help'])).toEqual({
            code: 0, stdout: 'synthetic CLI help\n', stderr: '', emergencyFile: undefined,
        });
    });
});
