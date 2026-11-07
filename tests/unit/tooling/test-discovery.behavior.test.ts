import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withTimeout } from '../../../src/utils/timeout-wrapper';

for (const filters of [[], ['tests']]) {
    test(`actual Bun configuration excludes archived tests with ${filters.length ? 'coverage-style filtering' : 'default discovery'}`, async () => {
        const directory = await mkdtemp(join(tmpdir(), 'synthetic-test-discovery-'));
        try {
            const configuration = await readFile(new URL('../../../bunfig.toml', import.meta.url), 'utf8');
            await writeFile(join(directory, 'bunfig.toml'), configuration);
            await mkdir(join(directory, 'tests/setup'), { recursive: true });
            await mkdir(join(directory, 'data/archive/tests'), { recursive: true });
            await writeFile(join(directory, 'tests/setup/bun.prerun.ts'), "process.env.SYNTHETIC_FIRST_PRELOAD = 'ready';");
            await writeFile(join(directory, 'tests/setup/bun.setup.ts'), "process.env.SYNTHETIC_SECOND_PRELOAD = 'ready';");
            await writeFile(join(directory, 'tests/synthetic.test.ts'), `
                import { test, expect } from 'bun:test';
                test('synthetic root selection and preloads', () => {
                    expect(process.env.SYNTHETIC_FIRST_PRELOAD).toBe('ready');
                    expect(process.env.SYNTHETIC_SECOND_PRELOAD).toBe('ready');
                });
            `);
            await writeFile(join(directory, 'data/archive/tests/synthetic-leak.test.ts'), `
                import { test } from 'bun:test';
                test('synthetic archive must stay excluded', () => { throw new Error('synthetic archive was discovered'); });
            `);
            const child = Bun.spawn([process.execPath, 'test', '--no-env-file', ...filters], {
                cwd: directory, env: { PATH: process.env.PATH, NODE_ENV: 'test' }, stdout: 'pipe', stderr: 'pipe',
            });
            try {
                const [exitCode, stdout, stderr] = await withTimeout(Promise.all([
                    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
                ]), 10_000, 'Synthetic Bun discovery');
                expect({ exitCode, output: stdout + stderr }).toMatchObject({ exitCode: 0 });
                expect(stdout + stderr).toContain('1 pass');
                expect(stdout + stderr).not.toContain('synthetic archive must stay excluded');
            } finally {
                if (child.exitCode === null) child.kill();
                await child.exited;
            }
        } finally { await rm(directory, { recursive: true, force: true }); }
    });
}
