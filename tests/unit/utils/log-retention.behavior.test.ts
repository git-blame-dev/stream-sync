import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getSystemTimestampISO } from '../../../src/utils/timestamp';
import { archiveIdentity, pruneLogArchives } from '../../../src/utils/log-retention';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function directory() { const root = await mkdtemp(path.join(tmpdir(), 'synthetic-retention-')); roots.push(root); return root; }
function name(filename: string, id: number, created = Date.parse(getSystemTimestampISO())) { return `archive-${archiveIdentity(filename)}.${String(created).padStart(13, '0')}.00000000-0000-0000-0000-${String(id).padStart(12, '0')}.log`; }

test('expires oldest managed archives by aggregate bytes and age, leaving active and historical files alone', async () => {
    const root = await directory();
    const a = name('a.ndjson', 1), b = name('b.ndjson', 2), expired = name('a.ndjson', 3, Date.parse('2000-01-01'));
    const history = `log-${archiveIdentity('a.ndjson')}.2000-01-01.00000000-0000-0000-0000-000000000000.gz`;
    for (const [filename, content] of [[a, '1234567890'], [b, 'abcdefghij'], [expired, 'expired'], ['a.ndjson', 'active'], [history, 'historical']]) await writeFile(path.join(root, filename!), content!);
    await utimes(path.join(root, a), new Date(Date.parse(getSystemTimestampISO()) - 1000), new Date(Date.parse(getSystemTimestampISO()) - 1000));
    await utimes(path.join(root, expired), new Date('2000-01-01'), new Date('2000-01-01'));
    await pruneLogArchives(root, ['a.ndjson', 'b.ndjson'], { archiveMaxBytes: 12, archiveMaxAgeDays: 2 });
    expect((await readdir(root)).sort()).toEqual(['a.ndjson', b, history].sort());
    expect(await readFile(path.join(root, 'a.ndjson'), 'utf8')).toBe('active');
});

test('preserves unrelated identities, near matches, symbolic links and their targets', async () => {
    const root = await directory();
    const unrelated = name('other.log', 1), near = name('a.log', 2) + '.gz.partial', link = name('a.log', 3);
    await writeFile(path.join(root, unrelated), 'other');
    await writeFile(path.join(root, near), 'partial history');
    await writeFile(path.join(root, 'target'), 'protected');
    await symlink(path.join(root, 'target'), path.join(root, link));
    await pruneLogArchives(root, ['a.log'], { archiveMaxBytes: 1, archiveMaxAgeDays: 1 });
    expect((await readdir(root)).sort()).toEqual([unrelated, near, link, 'target'].sort());
    expect(await readFile(path.join(root, link), 'utf8')).toBe('protected');
});

test('reports inaccessible maintenance roots to the writer rather than claiming enforcement', async () => {
    const root = await directory();
    await expect(pruneLogArchives(path.join(root, 'absent'), ['runtime.log'], { archiveMaxBytes: 1, archiveMaxAgeDays: 1 })).rejects.toThrow();
});
