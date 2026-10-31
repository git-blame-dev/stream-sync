import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getSystemTimestampISO } from '../../../src/utils/timestamp';
import { LineFileAppender } from '../../../src/utils/line-file-appender';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function root() { const value = await mkdtemp(path.join(tmpdir(), 'synthetic-log-completion-')); roots.push(value); return value; }

test('confirms each admitted raw batch only after append, while operational append progresses independently', async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const raw = new LineFileAppender({ logDir: await root() }, { appendFile: async () => { entered(); await gate; } });
    let operationalAppended = false;
    const operational = new LineFileAppender({ logDir: await root() }, { appendFile: async () => { operationalAppended = true; } });
    let confirmed = false;
    const pending = raw.writeConfirmed('raw.ndjson', 'synthetic').then(() => { confirmed = true; });
    try {
        await started;
        operational.log('operational');
        await operational.flush();
        expect(operationalAppended).toBe(true);
        expect(confirmed).toBe(false);
    } finally { release(); await pending; await raw.flush(); }
    expect(confirmed).toBe(true);
});

test('rejects admission and append failures, settles shared batches and accepts recovery', async () => {
    let fail = true;
    const writer = new LineFileAppender({ logDir: await root(), maxQueueBytes: 16 }, { appendFile: async () => { if (fail) throw new Error('synthetic failure'); } });
    const a = writer.writeConfirmed('raw.ndjson', 'one');
    const b = writer.writeConfirmed('raw.ndjson', 'two');
    await expect(writer.writeConfirmed('raw.ndjson', 'too much content for this queue')).rejects.toThrow('not admitted');
    const outcomes = await Promise.allSettled([a, b]);
    expect(outcomes.map(value => value.status)).toEqual(['rejected', 'rejected']);
    fail = false;
    await expect(writer.writeConfirmed('raw.ndjson', 'recovery')).resolves.toBeUndefined();
    await writer.flush();
});

test('runs maintenance for each queued configuration, including a tightened policy on the same root', async () => {
    const a = await root(), b = await root();
    const { archiveIdentity } = await import('../../../src/utils/log-retention');
    const { writeFile, readdir, utimes } = await import('node:fs/promises');
    const archive = `archive-${archiveIdentity('runtime.log')}.0946684800000.00000000-0000-0000-0000-000000000000.log`;
    for (const directory of [a, b]) {
        await writeFile(path.join(directory, archive), 'old archive');
        await utimes(path.join(directory, archive), new Date('2000-01-01'), new Date('2000-01-01'));
    }
    const writer = new LineFileAppender({ logDir: a });
    writer.log('a'); writer.reconfigure({ logDir: b }); writer.log('b');
    await writer.flush();
    expect(await readdir(a)).not.toContain(archive);
    expect(await readdir(b)).not.toContain(archive);
    const freshArchive = archive.replace('0946684800000', String(Date.parse(getSystemTimestampISO())));
    await writeFile(path.join(b, freshArchive), 'over budget');
    writer.log('old policy');
    writer.reconfigure({ logDir: b, archiveMaxBytes: 1 }); writer.log('new policy');
    await writer.flush();
    expect(await readdir(b)).not.toContain(freshArchive);
});

test('appends after rotating inherited history without depending on a metadata timestamp write', async () => {
    const directory = await root();
    const { promises: fs } = await import('node:fs');
    const { spyOn } = await import('bun:test');
    await fs.writeFile(path.join(directory, 'runtime.log'), 'prior\n');
    await fs.utimes(path.join(directory, 'runtime.log'), new Date('2000-01-01'), new Date('2000-01-01'));
    const stamp = spyOn(fs, 'utimes').mockRejectedValue(new Error('synthetic metadata permission failure'));
    const writer = new LineFileAppender({ logDir: directory, maxBytes: 14 });
    try {
        await expect(writer.writeConfirmed('runtime.log', 'current')).resolves.toBeUndefined();
        const { readFile, readdir } = fs;
        expect(await readFile(path.join(directory, 'runtime.log'), 'utf8')).toBe('current\n');
        const archive = (await readdir(directory)).find(name => name.startsWith('archive-'))!;
        expect(await readFile(path.join(directory, archive), 'utf8')).toBe('prior\n');
    } finally { await writer.flush(); stamp.mockRestore(); }
});
