import { afterEach, expect, spyOn, test } from 'bun:test';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RawEventLogWriter } from '../../../src/services/RawEventLogWriter';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function directory() { const root = await fs.mkdtemp(path.join(tmpdir(), 'synthetic-capture-lifetime-')); roots.push(root); return root; }

test('joins admitted capture during close and ignores late content before serialization', async () => {
    const root = await directory();
    const writer = new RawEventLogWriter({ directories: [root] });
    const nativeAppend = fs.appendFile;
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const append = spyOn(fs, 'appendFile').mockImplementation(async (...args) => { entered(); await gate; return nativeAppend(...args); });
    let closed = false;
    const pending = writer.writeRawEvent({ dataLoggingPath: root, platform: 'tiktok', eventType: 'chat', payload: { text: 'synthetic' } });
    try {
        await started;
        const closing = writer.close().then(() => { closed = true; });
        await expect(writer.writeRawEvent({ dataLoggingPath: root, platform: 'tiktok', eventType: 'chat', payload: { get text() { throw new Error('late content must not be read'); } } })).rejects.toThrow('Raw event capture write failed');
        expect(closed).toBe(false);
        release(); await pending; await closing;
        expect(closed).toBe(true);
        expect((await fs.readFile(path.join(root, 'tiktok-data-log.ndjson'), 'utf8')).trim().split('\n')).toHaveLength(1);
    } finally { release(); await writer.close(); append.mockRestore(); }
});

test('shares one configured owner across relative roots and filesystem aliases', async () => {
    const root = await directory();
    const alias = path.join(root, 'alias');
    const target = path.join(root, 'target');
    await fs.mkdir(target); await fs.symlink(target, alias, 'dir');
    const writer = new RawEventLogWriter({ directories: [alias, path.relative(process.cwd(), target)] });
    await Promise.all(Array.from({ length: 40 }, (_, index) => writer.writeRawEvent({
        dataLoggingPath: index % 2 ? alias : target, platform: 'youtube', eventType: 'chat', payload: { index }
    })));
    await writer.close();
    const records = (await fs.readFile(path.join(target, 'youtube-data-log.ndjson'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { payload: { index: number } });
    expect(records.map(record => record.payload.index)).toEqual(Array.from({ length: 40 }, (_, index) => index));
    await expect(writer.writeRawEvent({ dataLoggingPath: path.join(root, 'unconfigured'), platform: 'youtube', eventType: 'chat', payload: {} })).rejects.toThrow();
});

test('contains a broken configured root and recovers without separating a healthy alias owner', async () => {
    const base = await directory();
    const blocker = path.join(base, 'obstruction');
    const goodParent = path.join(base, 'healthy');
    const healthy = path.join(goodParent, 'capture');
    const broken = path.join(blocker, 'capture');
    await fs.writeFile(blocker, 'synthetic obstruction');
    await fs.mkdir(healthy, { recursive: true });
    const writer = new RawEventLogWriter({ directories: [broken, healthy] });
    const event = { platform: 'youtube', eventType: 'chat', payload: { text: 'synthetic capture' } };
    try {
        await expect(writer.writeRawEvent({ ...event, dataLoggingPath: broken })).rejects.toThrow('Raw event capture write failed');
        await writer.writeRawEvent({ ...event, dataLoggingPath: healthy });
        await fs.unlink(blocker);
        await fs.symlink(goodParent, blocker, 'dir');
        await writer.writeRawEvent({ ...event, dataLoggingPath: broken });
        await writer.close();
        const records = (await fs.readFile(path.join(healthy, 'youtube-data-log.ndjson'), 'utf8')).trim().split('\n');
        expect(records).toHaveLength(2);
    } finally { await writer.close(); }
});

test('bounds concurrent recovery probes and closes without admitting a late recovered write', async () => {
    const base = await directory();
    const obstruction = path.join(base, 'obstruction');
    const root = path.join(obstruction, 'capture');
    await fs.writeFile(obstruction, 'synthetic obstruction');
    const writer = new RawEventLogWriter({ directories: [root] });
    await fs.unlink(obstruction); await fs.mkdir(root, { recursive: true });
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const nativeRealpath = fs.realpath;
    const probe = spyOn(fs, 'realpath').mockImplementation(new Proxy(nativeRealpath, {
        apply(target, receiver, args) { entered(); return gate.then(() => Reflect.apply(target, receiver, args)); }
    }));
    const event = { dataLoggingPath: root, platform: 'youtube', eventType: 'chat', payload: 'synthetic capture' };
    const pending = writer.writeRawEvent(event);
    let closing: Promise<void> | undefined;
    try {
        await started;
        await expect(writer.writeRawEvent(event)).rejects.toThrow('Raw event capture write failed');
        expect(probe).toHaveBeenCalledTimes(1);
        let closed = false;
        closing = writer.close().then(() => { closed = true; });
        expect(closed).toBe(false);
        release();
        await expect(pending).rejects.toThrow('Raw event capture write failed');
        await closing;
        expect(await fs.readdir(root)).toEqual([]);
    } finally { release(); await Promise.allSettled([pending, closing]); probe.mockRestore(); }
});
