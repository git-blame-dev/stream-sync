import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, stat, utimes, appendFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LineFileAppender } from '../../../src/utils/line-file-appender';
import { captureStderr } from '../../helpers/output-capture';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function directory() { const root = await mkdtemp(path.join(tmpdir(), 'synthetic-runtime-log-')); roots.push(root); return root; }

describe('bounded runtime file writer', () => {
    it('flushes ordered entries and preserves all records across size rotation', async () => {
        const root = await directory();
        const writer = new LineFileAppender({ logDir: root, maxBytes: 14 });
        for (const text of ['first', 'second', 'third']) expect(writer.log(text)).toBe(true);
        await writer.flush();
        const archives = (await readdir(root)).filter(name => name.startsWith('archive-'));
        expect(archives).toHaveLength(1);
        expect(await readFile(path.join(root, archives[0]!), 'utf8') + await readFile(path.join(root, 'runtime.log'), 'utf8')).toBe('first\nsecond\nthird\n');
        expect((await stat(path.join(root, 'runtime.log'))).size).toBeLessThanOrEqual(14);
    });

    it('rotates an existing file at a UTC day boundary without deleting its records', async () => {
        const root = await directory();
        const old = new LineFileAppender({ logDir: root }); old.log('previous'); await old.flush();
        await utimes(path.join(root, 'runtime.log'), new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'));
        const writer = new LineFileAppender({ logDir: root }); writer.log('current'); await writer.flush();
        const archive = (await readdir(root)).find(name => name.startsWith('archive-'))!;
        expect(await readFile(path.join(root, archive), 'utf8')).toBe('previous\n');
        expect(await readFile(path.join(root, 'runtime.log'), 'utf8')).toBe('current\n');
    });

    it('bounds queued bytes and reports dropped entries instead of accumulating unbounded work', async () => {
        const root = await directory(); const capture = captureStderr();
        try {
            const writer = new LineFileAppender({ logDir: root, maxQueueBytes: 16 });
            expect(writer.log('1234567890')).toBe(true);
            expect(writer.log('overflow')).toBe(false);
            expect(capture.output.join('')).toContain('dropped 1');
            await writer.flush();
            expect(await readFile(path.join(root, 'runtime.log'), 'utf8')).toBe('1234567890\n');
            expect(capture.output.join('')).toContain('dropped 1');
        } finally { capture.restore(); }
    });

    it('serializes destination changes and flushes both old and new destinations', async () => {
        const a = await directory(); const b = await directory();
        const writer = new LineFileAppender({ logDir: a }); writer.log('a1');
        writer.reconfigure({ logDir: b }); writer.log('b1');
        writer.reconfigure({ logDir: a }); writer.log('a2'); await writer.flush();
        const archived = (await readdir(a)).filter(name => name.startsWith('archive-'));
        const prior = await Promise.all(archived.map(async name => await readFile(path.join(a, name), 'utf8')));
        expect(prior.join('') + await readFile(path.join(a, 'runtime.log'), 'utf8')).toBe('a1\na2\n');
        expect(await readFile(path.join(b, 'runtime.log'), 'utf8')).toBe('b1\n');
    });
    it('preserves a valid long basename through rotation', async () => {
        const root = await directory(); const filename = 'x'.repeat(220);
        const writer = new LineFileAppender({ logDir: root, filename, maxBytes: 14 });
        writer.log('first'); writer.log('second'); writer.log('third'); await writer.flush();
        const archive = (await readdir(root)).find(name => name.startsWith('archive-'));
        expect(archive).toBeDefined();
        expect(await readFile(path.join(root, archive!), 'utf8') + await readFile(path.join(root, filename), 'utf8')).toBe('first\nsecond\nthird\n');
    });

    it('counts the active write against the bound and reports sustained overload before draining', async () => {
        const root = await directory(); const capture = captureStderr();
        let release!: () => void; let entered!: () => void; let now = 0;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const writing = new Promise<void>(resolve => { entered = resolve; });
        const writer = new LineFileAppender({ logDir: root, maxQueueBytes: 16 }, {
            now: () => now,
            appendFile: async (file, data) => { entered(); await gate; await appendFile(file, data); }
        });
        try {
            writer.log('1234567890'); await writing;
            expect(writer.log('overflow')).toBe(false);
            expect(capture.output.join('')).toContain('dropped 1');
            expect(writer.log('overflow')).toBe(false);
            expect(capture.output).toHaveLength(1);
            now = 1000;
            expect(writer.log('overflow')).toBe(false);
            expect(capture.output).toHaveLength(2);
            expect(capture.output[1]).toContain('dropped 2');
        } finally { release(); await writer.flush(); capture.restore(); }
        expect(await readFile(path.join(root, 'runtime.log'), 'utf8')).toBe('1234567890\n');
    });

    it('contains simultaneous file and stderr failures and accepts later records', async () => {
        const root = await directory();
        let fail = true;
        const writer = new LineFileAppender({ logDir: root }, {
            appendFile: async (file, data) => {
                if (fail) throw new Error('synthetic disk failure');
                await appendFile(file, data);
            }
        });
        const stderr = spyOn(process.stderr, 'write').mockImplementation(() => { throw new Error('synthetic stderr failure'); });
        try {
            expect(writer.log('synthetic lost record')).toBe(true);
            await expect(writer.flush()).resolves.toBeUndefined();
            expect(writer.write('../synthetic-invalid', 'rejected')).toBe(false);
            fail = false;
            expect(writer.log('synthetic recovered')).toBe(true);
            await writer.flush();
            expect(await readFile(path.join(root, 'runtime.log'), 'utf8')).toBe('synthetic recovered\n');
        } finally { stderr.mockRestore(); await writer.flush(); }
    });

    it('preserves the active file when rotation fails and permits subsequent recovery', async () => {
        const root = await directory();
        let fail = true;
        const writer = new LineFileAppender({ logDir: root, maxBytes: 14 }, {
            rename: async (from, to) => { if (fail) throw new Error('synthetic rename failure'); await rename(from, to); }
        });
        await writer.writeConfirmed('runtime.log', 'first');
        await expect(writer.writeConfirmed('runtime.log', 'second record')).rejects.toThrow('Log append failed');
        expect(await readFile(path.join(root, 'runtime.log'), 'utf8')).toBe('first\n');
        fail = false;
        await writer.writeConfirmed('runtime.log', 'recovered');
        expect(await readFile(path.join(root, 'runtime.log'), 'utf8')).toBe('recovered\n');
        const archives = (await readdir(root)).filter(name => name.startsWith('archive-'));
        expect(await readFile(path.join(root, archives[0]!), 'utf8')).toBe('first\n');
        await writer.flush();
    });
});
