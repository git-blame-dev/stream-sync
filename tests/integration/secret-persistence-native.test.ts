import { expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureSecrets } from '../../src/utils/secret-manager';
import { parseEnvContent } from '../../src/utils/env-file-parser';
import { initializeStaticSecrets } from '../../src/core/secrets';

it('roundtrips persisted prompt values through actual Bun and Node startup loaders', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'synthetic-secret-roundtrip-'));
    const previous = process.env.OBS_PASSWORD;
    try {
        await writeFile(path.join(directory, 'child.cjs'), 'process.stdout.write(JSON.stringify(process.env.OBS_PASSWORD ?? null));');
        await writeFile(path.join(directory, 'package.json'), JSON.stringify({ scripts: { start: 'bun child.cjs' } }));
        for (const input of [
            'synthetic-plain=part', 'synthetic-password"', "'synthetic-password", '"synthetic-paired"',
            'synthetic#hash', 'synthetic space', 'synthetic\'and"quotes', 'synthetic`tick', 'synthetic-😀',
        ]) {
            process.env.OBS_PASSWORD = '';
            const entries: string[] = [];
            const log = (message: string) => { entries.push(message); };
            const envFilePath = path.join(directory, '.env');
            const result = await ensureSecrets({
                config: { obs: { enabled: true } }, logger: { debug: log, info: log, warn: log, error: log },
                interactive: true, promptFor: async () => input, envFilePath,
                envFileReadEnabled: false, envFileWriteEnabled: true,
            });
            expect(process.env.OBS_PASSWORD).toBe(input);
            expect(result.persisted).toEqual(['OBS_PASSWORD']);
            const content = await readFile(envFilePath, 'utf8');
            expect(parseEnvContent(content).OBS_PASSWORD).toBe(input);
            for (const command of [
                [process.execPath, 'child.cjs'], [process.execPath, 'run', 'start'],
                ['node', `--env-file=${envFilePath}`, 'child.cjs'],
            ]) {
                const child = Bun.spawn(command, {
                    cwd: directory, env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test' }, stdout: 'pipe', stderr: 'pipe',
                });
                const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
                expect(code).toBe(0);
                expect(JSON.parse(stdout)).toBe(input);
            }
            expect(entries.join('\n')).not.toContain(input);
        }
    } finally {
        if (previous === undefined) delete process.env.OBS_PASSWORD;
        else process.env.OBS_PASSWORD = previous;
        initializeStaticSecrets();
        await rm(directory, { recursive: true, force: true });
    }
}, 30_000);

it('keeps unrepresentable credentials usable without reporting or writing a persisted value', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'synthetic-secret-unsaved-'));
    const previous = process.env.OBS_PASSWORD;
    try {
        for (const input of ['synthetic-$SYNTHETIC_BASE', 'synthetic\\path', 'synthetic\nline', 'synthetic\'"`all-quotes']) {
            process.env.OBS_PASSWORD = '';
            const entries: string[] = [];
            const log = (message: string) => { entries.push(message); };
            const envFilePath = path.join(directory, '.env');
            const result = await ensureSecrets({
                config: { obs: { enabled: true } }, logger: { debug: log, info: log, warn: log, error: log },
                interactive: true, promptFor: async () => input, envFilePath,
                envFileReadEnabled: false, envFileWriteEnabled: true,
            });
            expect(process.env.OBS_PASSWORD).toBe(input);
            expect(result.applied.OBS_PASSWORD).toEqual({ source: 'prompt' });
            expect(result.persisted).toEqual([]);
            await expect(access(envFilePath)).rejects.toMatchObject({ code: 'ENOENT' });
            expect(entries.some(message => message.includes('not persisted'))).toBe(true);
            expect(entries.some(message => message.includes('Saved'))).toBe(false);
            expect(entries.join('\n')).not.toContain(input);
        }
    } finally {
        if (previous === undefined) delete process.env.OBS_PASSWORD;
        else process.env.OBS_PASSWORD = previous;
        initializeStaticSecrets();
        await rm(directory, { recursive: true, force: true });
    }
});
