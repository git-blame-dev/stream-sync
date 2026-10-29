import { afterEach, expect, spyOn, test } from 'bun:test';
import fsp, { access, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { createTikTokGiftAnimationResolver, getGiftAnimationDependencyStatus } from '../../../../src/services/tiktok-gift-animation/resolver';
import { zipFixture, type ZipFixtureEntry } from '../../../helpers/bounded-zip-fixture';
import { withNativeChildEnvironment } from '../../../helpers/native-child-environment';

const roots: string[] = [];
const resolvers: ReturnType<typeof createTikTokGiftAnimationResolver>[] = [];
afterEach(async () => {
    await Promise.all(resolvers.splice(0).map(resolver => resolver.dispose()));
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function root() {
    const directory = await fsp.realpath(await mkdtemp(join(tmpdir(), 'gift-resolver-test-')));
    roots.push(directory);
    return directory;
}
const quiet = { debug() {}, warn() {}, error() {} };
const profile = { path: 'output.mp4', videoW: 960, videoH: 864, w: 480, h: 854, rgbFrame: [0, 0, 480, 854], aFrame: [480, 0, 480, 854], f: 75 };
const mp4 = Buffer.from('000000186674797069736f6d0000000069736f6d', 'hex');
type Options = NonNullable<Parameters<typeof createTikTokGiftAnimationResolver>[0]>;
type Download = NonNullable<Options['downloadArchive']>;
function notification(urls: string[] = ['https://cdn.synthetic.invalid/asset.zip']) {
    return { enhancedGiftData: { originalData: { asset: { videoResourceList: urls.map((url, index) => ({ videoTypeName: index === 0 ? 'h264' : '480p', videoUrl: { urlList: [url] } })) } } } };
}
function archive(config: unknown = { portrait: profile }, files: ZipFixtureEntry[] = [{ name: 'output.mp4', body: mp4, method: 8 }]) {
    return zipFixture([{ name: 'config.json', body: Buffer.from(JSON.stringify(config)), method: 8 }, ...files]);
}
function deferred() {
    let resolve!: () => void;
    return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() };
}
async function harness(options: Options = {}, bytes = archive()) {
    const directory = options.cacheDirectory ?? await root();
    const calls: string[] = [];
    const signals: (AbortSignal | undefined)[] = [];
    const supplied = options.downloadArchive;
    const downloadArchive: Download = async (url, output, context) => {
        calls.push(url);
        signals.push(context?.signal);
        if (supplied) return supplied(url, output, context);
        await writeFile(output, bytes, { flag: 'wx', ...(context?.signal ? { signal: context.signal } : {}) });
        return { bytes: bytes.length };
    };
    const resolver = createTikTokGiftAnimationResolver({ logger: quiet, ...options, cacheDirectory: directory, downloadArchive });
    resolvers.push(resolver);
    return { directory, calls, signals, resolver };
}
function key(url: string) { return createHash('sha1').update(url).digest('hex'); }

test('reports the owned bounded reader without external command discovery', () => {
    expect(getGiftAnimationDependencyStatus().extraction).toMatchObject({ available: true, implementation: 'bounded-zip' });
});

test('synchronous disposal closes admission and returns one retirement promise', async () => {
    const directory = await root();
    const resolver = createTikTokGiftAnimationResolver({ cacheDirectory: directory, logger: quiet });
    const disposal = resolver.dispose();
    expect(resolver.dispose()).toBe(disposal);
    expect(await resolver.resolveFromNotificationData({})).toBeNull();
    await disposal;
    expect(await readdir(directory)).toEqual([]);
});

test('production default rejects insecure destinations without external unzip or a buffer-fetch fallback', async () => {
    const directory = await root();
    const resolver = createTikTokGiftAnimationResolver({ logger: quiet, cacheDirectory: directory });
    resolvers.push(resolver);
    expect(await resolver.resolveFromNotificationData(notification(['http://127.0.0.1/not-requested']))).toBeNull();
    expect(await readdir(directory)).toEqual([]);
});

test('extracts real ZIP data, persists compatible metadata, reuses warm cache and preserves files on dispose', async () => {
    const h = await harness();
    const first = await h.resolver.resolveFromNotificationData(notification());
    expect(first).not.toBeNull();
    expect(first?.durationMs).toBe(2500);
    expect(first?.animationConfig).toMatchObject({ profileName: 'portrait', sourceWidth: 960, renderHeight: 854 });
    expect(await readFile(first!.mediaFilePath)).toEqual(mp4);
    expect(await readdir(h.directory)).toEqual([key('https://cdn.synthetic.invalid/asset.zip')]);
    const second = await h.resolver.resolveFromNotificationData(notification());
    expect(second).toEqual(first);
    expect(h.calls).toHaveLength(1);
    await h.resolver.dispose();
    expect(await readFile(first!.mediaFilePath)).toEqual(mp4);
    const warm = await harness({ cacheDirectory: h.directory });
    expect(await warm.resolver.resolveFromNotificationData(notification())).toEqual(first);
    expect(warm.calls).toEqual([]);
});

test('ranked failures fall through under the same whole-attempt signal', async () => {
    const bytes = archive();
    const h = await harness({ downloadArchive: async (url, output) => {
        if (url.includes('failed')) throw new Error('Synthetic download failure with signed=synthetic-secret');
        await writeFile(output, bytes, { flag: 'wx' });
        return { bytes: bytes.length };
    } });
    const urls = ['https://cdn.synthetic.invalid/failed.zip', 'https://cdn.synthetic.invalid/valid.zip'];
    expect(await h.resolver.resolveFromNotificationData(notification(urls))).not.toBeNull();
    expect(h.calls).toEqual(urls);
    expect(h.signals[0]).toBe(h.signals[1]);
    expect(await readdir(h.directory)).toEqual([key(urls[1]!)]);
});

test('portrait profile fallback, root profiles, duration milliseconds/seconds and missing-path MP4 fallback remain functional', async () => {
    for (const [config, name, expectedDuration, files] of [
        [{ portrait: { ...profile, rgbFrame: undefined }, landscape: profile }, 'landscape', 2500, undefined],
        [{ ...profile, f: undefined, durationMs: 2000 }, 'default', 2000, undefined],
        [{ portrait: { ...profile, f: undefined, durationMs: 0, duration: 1.25, aFrame: undefined } }, 'portrait', 1250, undefined],
        [{ portrait: { ...profile, path: 'missing.mp4' } }, 'portrait', 2500, [{ name: 'fallback.mp4', body: mp4 }]]
    ] as const) {
        const h = await harness({}, archive(config, files ? [...files] : undefined));
        const result = await h.resolver.resolveFromNotificationData(notification());
        expect(result?.animationConfig.profileName).toBe(name);
        expect(result?.durationMs).toBe(expectedDuration);
    }
});

test('filters encrypted labels/URLs, preserves first-occurrence deduplication and source ranking', async () => {
    const h = await harness();
    const resource = (url: string, label: string) => ({ videoTypeName: label, videoUrl: { urlList: [url] } });
    const result = await h.resolver.resolveFromNotificationData({ enhancedGiftData: { originalData: { asset: { videoResourceList: [
        resource('https://cdn.synthetic.invalid/opaque.zip', 'h264_encrypt'),
        resource('https://cdn.synthetic.invalid/opaque.zip', 'h264'),
        resource('https://cdn.synthetic.invalid/low.zip', '480p'),
        resource('https://cdn.synthetic.invalid/best.zip', 'h264'),
        resource('https://cdn.synthetic.invalid/best.zip', 'bytevc1'),
        resource('https://cdn.synthetic.invalid/encrypt.zip', 'h264')
    ] } } } });
    expect(result).not.toBeNull();
    expect(h.calls).toEqual(['https://cdn.synthetic.invalid/best.zip']);
});

test('candidate enumeration caps resources, URLs, lengths and profile-label work', async () => {
    const h = await harness({ downloadArchive: async () => { throw new Error('Synthetic unavailable archive'); } });
    expect(await h.resolver.resolveFromNotificationData({})).toBeNull();
    const resource = { videoTypeName: 'h264', videoUrl: { urlList: Array.from({ length: 100 }, (_, i) => `https://cdn.synthetic.invalid/${i}.zip`) } };
    await h.resolver.resolveFromNotificationData({ enhancedGiftData: { originalData: { asset: { videoResourceList: [resource] } } } });
    expect(h.calls).toHaveLength(16);
    h.calls.splice(0);
    const ignored = Array.from({ length: 64 }, () => null);
    await h.resolver.resolveFromNotificationData({ enhancedGiftData: { originalData: { asset: { videoResourceList: [...ignored, resource] } } } });
    expect(h.calls).toEqual([]);
    await h.resolver.resolveFromNotificationData(notification(['x'.repeat(16385)]));
    expect(h.calls).toEqual([]);
    await h.resolver.resolveFromNotificationData({ enhancedGiftData: { originalData: { asset: { videoResourceList: [{ videoTypeName: 'x'.repeat(129), videoUrl: { urlList: ['https://cdn.synthetic.invalid/oversized-label.zip'] } }], resourceModel: { urlList: ['https://cdn.synthetic.invalid/model.zip'] }, resourceUri: 'https://cdn.synthetic.invalid/uri.zip' } } } });
    expect(h.calls).toEqual(['https://cdn.synthetic.invalid/model.zip', 'https://cdn.synthetic.invalid/uri.zip']);
});

for (const overrides of [
    { videoW: 4097 }, { videoH: '864' }, { w: 480.5 }, { h: 0 }, { videoW: 4000, videoH: 4001 },
    { w: 4000, h: 4001 }, { rgbFrame: [0, 0, 0, 1] }, { rgbFrame: [0, 0, 961, 854] },
    { rgbFrame: [0.5, 0, 480, 854] }, { aFrame: [-1, 0, 480, 854] },
    { f: 3601 }, { f: 75.5 }, { f: 0, durationMs: 0, duration: 0 }, { f: undefined, durationMs: 120001 }, { f: undefined, durationMs: 0, duration: -1 },
    { path: '../../outside.mp4' }, { path: 'C:/outside.mp4' }, { path: 'a\\output.mp4' }
]) {
    test(`rejects unsafe profile ${JSON.stringify(overrides)} without publishing`, async () => {
        const h = await harness({}, archive({ portrait: { ...profile, ...overrides } }));
        expect(await h.resolver.resolveFromNotificationData(notification())).toBeNull();
        expect(await readdir(h.directory)).toEqual([]);
    });
}

test('bounds JSON before parsing and caps profile count/name; rejects non-MP4/absent media', async () => {
    for (const bytes of [
        archive({ portrait: profile, padding: 'x'.repeat(256 * 1024) }),
        archive(Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`profile${index}`, profile]))),
        archive({ ['x'.repeat(129)]: profile }),
        archive({ portrait: profile }, [{ name: 'output.mp4', body: Buffer.from('synthetic non-MP4') }]),
        archive({ portrait: profile }, []),
        zipFixture([{ name: 'config.json', body: Buffer.from('{invalid') }, { name: 'output.mp4', body: mp4 }])
    ]) {
        const h = await harness({}, bytes);
        expect(await h.resolver.resolveFromNotificationData(notification())).toBeNull();
        expect(await readdir(h.directory)).toEqual([]);
    }
});

test('rejects unsafe actual ZIP entries without writing outside owned work or publishing', async () => {
    const outer = await root();
    const outside = join(outer, 'outside.mp4');
    const h = await harness({ cacheDirectory: join(outer, 'cache') }, zipFixture([{ name: outside, body: mp4 }]));
    expect(await h.resolver.resolveFromNotificationData(notification())).toBeNull();
    await expect(access(outside)).rejects.toThrow();
    expect(await readdir(h.directory)).toEqual([]);
});

for (const invalid of ['empty-directory', 'small-file', 'incomplete-hash-entry'] as const) {
    test(`new admission rejects ${invalid} while valid warm hits remain readable`, async () => {
        for (const malformedMetadata of invalid === 'incomplete-hash-entry' ? [false, true] : [false]) {
            const h = await harness();
            const valid = await h.resolver.resolveFromNotificationData(notification());
            expect(valid).not.toBeNull();
            const validMetadata = join(h.directory, key('https://cdn.synthetic.invalid/asset.zip'), 'metadata.json');
            const retainedMetadata = await readFile(validMetadata);
            const badName = invalid === 'empty-directory' ? '.gift-work-unowned' : invalid === 'small-file' ? 'unknown.bin' : key('https://cdn.synthetic.invalid/incomplete.zip');
            const badPath = join(h.directory, badName);
            if (invalid === 'small-file') await writeFile(badPath, Buffer.from('synthetic unknown file'));
            else {
                await mkdir(badPath);
                if (malformedMetadata) await writeFile(join(badPath, 'metadata.json'), JSON.stringify({ mediaFilePath: '', durationMs: 'bad' }));
            }
            const entriesBefore = (await readdir(h.directory)).sort();
            const warm = await harness({ cacheDirectory: h.directory });
            expect(await warm.resolver.resolveFromNotificationData(notification(['https://cdn.synthetic.invalid/new.zip']))).toBeNull();
            expect(warm.calls).toEqual([]);
            expect(await warm.resolver.resolveFromNotificationData(notification())).toEqual(valid);
            expect(await readFile(valid!.mediaFilePath)).toEqual(mp4);
            expect(await readFile(validMetadata)).toEqual(retainedMetadata);
            expect((await readdir(h.directory)).sort()).toEqual(entriesBefore);
            if (invalid === 'small-file') expect(await readFile(badPath, 'utf8')).toBe('synthetic unknown file');
            if (malformedMetadata) expect(JSON.parse(await readFile(join(badPath, 'metadata.json'), 'utf8')).durationMs).toBe('bad');
        }
    });
}

test('corrupt metadata blocks new acquisition but ranked fallback can reuse an already-published valid candidate', async () => {
    const h = await harness();
    const firstUrl = 'https://cdn.synthetic.invalid/asset.zip';
    const resolved = await h.resolver.resolveFromNotificationData(notification());
    const fallback = 'https://cdn.synthetic.invalid/fallback.zip';
    const publishedFallback = await h.resolver.resolveFromNotificationData(notification([fallback]));
    expect(publishedFallback).not.toBeNull();
    const metadata = join(h.directory, key(firstUrl), 'metadata.json');
    await writeFile(metadata, JSON.stringify({ mediaFilePath: '', durationMs: 'bad' }));
    expect(await h.resolver.resolveFromNotificationData(notification([firstUrl, fallback]))).toEqual(publishedFallback);
    expect(await h.resolver.resolveFromNotificationData(notification([firstUrl, 'https://cdn.synthetic.invalid/new.zip']))).toBeNull();
    expect(h.calls).toEqual([firstUrl, fallback]);
    expect(await readFile(resolved!.mediaFilePath)).toEqual(mp4);
    expect(JSON.parse(await readFile(metadata, 'utf8')).durationMs).toBe('bad');
});

for (const corruption of ['media', 'config', 'extra-metadata-field', 'extra-config-field', 'oversized-config'] as const) {
    test(`new admission validates published neighbor ${corruption} using the warm-hit contract`, async () => {
        const h = await harness();
        const good = await h.resolver.resolveFromNotificationData(notification());
        const badUrl = 'https://cdn.synthetic.invalid/bad-neighbor.zip';
        const bad = await h.resolver.resolveFromNotificationData(notification([badUrl]));
        expect(good).not.toBeNull();
        expect(bad).not.toBeNull();
        const metadataPath = join(h.directory, key(badUrl), 'metadata.json');
        const configPath = join(h.directory, key(badUrl), 'asset', 'config.json');
        const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
        if (corruption === 'media') await writeFile(bad!.mediaFilePath, Buffer.from('synthetic bad media'));
        else if (corruption === 'config') await writeFile(configPath, JSON.stringify({ portrait: { ...profile, w: -1 } }));
        else if (corruption === 'oversized-config') await writeFile(configPath, 'x'.repeat(256 * 1024 + 1));
        else if (corruption === 'extra-metadata-field') await writeFile(metadataPath, JSON.stringify({ ...metadata, unknown: { nested: 'synthetic' } }));
        else await writeFile(metadataPath, JSON.stringify({ ...metadata, animationConfig: { ...metadata.animationConfig, unknown: { nested: 'synthetic' } } }));
        const retainedMetadata = await readFile(metadataPath);
        const retainedConfig = await readFile(configPath);
        const retainedMedia = await readFile(bad!.mediaFilePath);
        expect(await h.resolver.resolveFromNotificationData(notification(['https://cdn.synthetic.invalid/new.zip']))).toBeNull();
        expect(h.calls).toEqual(['https://cdn.synthetic.invalid/asset.zip', badUrl]);
        expect(await h.resolver.resolveFromNotificationData(notification())).toEqual(good);
        expect(await readFile(good!.mediaFilePath)).toEqual(mp4);
        expect(await readFile(metadataPath)).toEqual(retainedMetadata);
        expect(await readFile(configPath)).toEqual(retainedConfig);
        expect(await readFile(bad!.mediaFilePath)).toEqual(retainedMedia);
        expect(await readdir(h.directory)).toHaveLength(2);
    });
}

test('untrusted cached absolute paths, profile fields and symlinks are rejected without touching published files', async () => {
    const h = await harness();
    const resolved = await h.resolver.resolveFromNotificationData(notification());
    const metadataPath = join(h.directory, key('https://cdn.synthetic.invalid/asset.zip'), 'metadata.json');
    const original = JSON.parse(await readFile(metadataPath, 'utf8'));
    for (const metadata of [{ ...original, mediaFilePath: join(h.directory, 'outside.mp4') }, { ...original, durationMs: '2500' }, { ...original, animationConfig: {} }]) {
        await writeFile(metadataPath, JSON.stringify(metadata));
        expect(await h.resolver.resolveFromNotificationData(notification())).toBeNull();
        expect(await readFile(resolved!.mediaFilePath)).toEqual(mp4);
    }
    await writeFile(metadataPath, JSON.stringify(original));
    const outer = await root();
    const outside = join(outer, 'media.mp4');
    await writeFile(outside, mp4);
    await rm(resolved!.mediaFilePath);
    await symlink(outside, resolved!.mediaFilePath);
    expect(await h.resolver.resolveFromNotificationData(notification())).toBeNull();
    expect(h.calls).toHaveLength(1);
    expect(await readFile(outside)).toEqual(mp4);
});

test('cached config symlinks block hits and new admission without deleting their targets', async () => {
    const h = await harness();
    const result = await h.resolver.resolveFromNotificationData(notification());
    const outer = await root();
    const outside = join(outer, 'config.json');
    const config = JSON.stringify({ portrait: profile });
    await writeFile(outside, config);
    const cachedConfig = join(h.directory, key('https://cdn.synthetic.invalid/asset.zip'), 'asset', 'config.json');
    await rm(cachedConfig);
    await symlink(outside, cachedConfig);
    expect(await h.resolver.resolveFromNotificationData(notification())).toBeNull();
    expect(await h.resolver.resolveFromNotificationData(notification(['https://cdn.synthetic.invalid/new.zip']))).toBeNull();
    expect(h.calls).toHaveLength(1);
    expect(await readFile(outside, 'utf8')).toBe(config);
    expect(await readFile(result!.mediaFilePath)).toEqual(mp4);
});

test('count admission replaces startup/LRU pruning; existing and in-use published entries are never evicted', async () => {
    const h = await harness({ maxEntries: 1 });
    const first = await h.resolver.resolveFromNotificationData(notification());
    expect(await h.resolver.resolveFromNotificationData(notification(['https://cdn.synthetic.invalid/new.zip']))).toBeNull();
    expect(h.calls).toHaveLength(1);
    expect(await h.resolver.resolveFromNotificationData(notification())).toEqual(first);
    expect(await readFile(first!.mediaFilePath)).toEqual(mp4);
    const directory = await root();
    for (const name of ['a', 'b', 'c', 'd']) await mkdir(join(directory, name));
    const existing = await harness({ cacheDirectory: directory, maxEntries: 2 });
    expect(await existing.resolver.resolveFromNotificationData(notification())).toBeNull();
    expect(existing.calls).toEqual([]);
    expect((await readdir(directory)).sort()).toEqual(['a', 'b', 'c', 'd']);
});

test('byte quota counts persisted actual regular files, admits hits at quota and rejects new downloads', async () => {
    const h = await harness();
    const value = await h.resolver.resolveFromNotificationData(notification());
    const entry = join(h.directory, key('https://cdn.synthetic.invalid/asset.zip'));
    const total = (await stat(value!.mediaFilePath)).size + (await stat(join(entry, 'asset', 'config.json'))).size + (await stat(join(entry, 'metadata.json'))).size;
    const limited = await harness({ cacheDirectory: h.directory, maxCacheBytes: total });
    expect(await limited.resolver.resolveFromNotificationData(notification())).toEqual(value);
    expect(await limited.resolver.resolveFromNotificationData(notification(['https://cdn.synthetic.invalid/new.zip']))).toBeNull();
    expect(limited.calls).toEqual([]);
    expect(await readFile(value!.mediaFilePath)).toEqual(mp4);
});

test('pre-existing oversized files fail closed without being deleted or downloaded over', async () => {
    const directory = await root();
    const unknown = join(directory, 'unknown.bin');
    await writeFile(unknown, Buffer.alloc(100));
    const h = await harness({ cacheDirectory: directory, maxCacheBytes: 50 });
    expect(await h.resolver.resolveFromNotificationData(notification())).toBeNull();
    expect(h.calls).toEqual([]);
    expect((await stat(unknown)).size).toBe(100);
    expect(await readdir(directory)).toEqual(['unknown.bin']);
});

test('rejects invalid owner budgets before starting work', () => {
    for (const options of [{ maxEntries: 0 }, { maxCacheBytes: Infinity }, { maxConcurrent: 0 }, { timeoutMs: 0 }, { timeoutMs: 0x80000000 }]) {
        expect(() => createTikTokGiftAnimationResolver({ logger: quiet, ...options })).toThrow('Gift animation asset unavailable');
    }
});

test('coalesces the same key, limits distinct work to two and never queues a saturated third download', async () => {
    const release = deferred();
    const bothStarted = deferred();
    const bytes = archive();
    let started = 0;
    const h = await harness({ downloadArchive: async (_url, file) => {
        if (++started === 2) bothStarted.resolve();
        await release.promise;
        await writeFile(file, bytes, { flag: 'wx' });
        return { bytes: bytes.length };
    } });
    const a = h.resolver.resolveFromNotificationData(notification());
    const coalesced = h.resolver.resolveFromNotificationData(notification());
    const b = h.resolver.resolveFromNotificationData(notification(['https://cdn.synthetic.invalid/b.zip']));
    try {
        await bothStarted.promise;
        expect(await h.resolver.resolveFromNotificationData(notification(['https://cdn.synthetic.invalid/saturated.zip']))).toBeNull();
        expect(started).toBe(2);
    } finally { release.resolve(); }
    const [first, shared, second] = await Promise.all([a, coalesced, b]);
    expect(first).not.toBeNull();
    expect(shared).toBe(first);
    expect(second).not.toBeNull();
    expect(h.calls).toHaveLength(2);
});

test('concurrent byte reservations cannot publish two assets using the same remaining quota', async () => {
    const release = deferred();
    const started = deferred();
    const bytes = archive({ portrait: profile, padding: 'x'.repeat(200) });
    let count = 0;
    const h = await harness({ maxCacheBytes: 1000, downloadArchive: async (_url, file) => {
        if (++count === 2) started.resolve();
        await release.promise;
        await writeFile(file, bytes, { flag: 'wx' });
        return { bytes: bytes.length };
    } });
    const a = h.resolver.resolveFromNotificationData(notification());
    const b = h.resolver.resolveFromNotificationData(notification(['https://cdn.synthetic.invalid/b.zip']));
    try { await started.promise; } finally { release.resolve(); }
    const results = await Promise.all([a, b]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await readdir(h.directory)).toHaveLength(1);
    expect(await readFile(results.find(Boolean)!.mediaFilePath)).toEqual(mp4);
});

test('dispose is reentrant-safe, aborts pending work and joins its actual cleanup without deleting successful assets', async () => {
    const release = deferred();
    const started = deferred();
    const bytes = archive();
    let reentrant: Promise<void> | undefined;
    let h!: Awaited<ReturnType<typeof harness>>;
    h = await harness({ downloadArchive: async (_url, file, options) => {
        await writeFile(file, bytes, { flag: 'wx' });
        options!.signal!.addEventListener('abort', () => { reentrant = h.resolver.dispose(); }, { once: true });
        started.resolve();
        await release.promise;
        return { bytes: bytes.length };
    } });
    const attempt = h.resolver.resolveFromNotificationData(notification());
    await started.promise;
    const disposal = h.resolver.dispose();
    let retired = false;
    void disposal.then(() => { retired = true; });
    try {
        await yieldTurn();
        expect(retired).toBe(false);
        expect(reentrant).toBe(disposal);
        expect(await h.resolver.resolveFromNotificationData(notification())).toBeNull();
    } finally { release.resolve(); }
    await disposal;
    expect(await attempt).toBeNull();
    expect(await readdir(h.directory)).toEqual([]);
});

test('a later coalesced caller cannot cancel the first callers shared work and cannot publish its own stopped result', async () => {
    const release = deferred();
    const started = deferred();
    const bytes = archive();
    const h = await harness({ downloadArchive: async (_url, file) => {
        started.resolve();
        await release.promise;
        await writeFile(file, bytes, { flag: 'wx' });
        return { bytes: bytes.length };
    } });
    const owner = h.resolver.resolveFromNotificationData(notification());
    await started.promise;
    const controller = new AbortController();
    const follower = h.resolver.resolveFromNotificationData(notification(), { signal: controller.signal });
    await yieldTurn();
    controller.abort();
    release.resolve();
    const [result, stopped] = await Promise.all([owner, follower]);
    expect(result).not.toBeNull();
    expect(stopped).toBeNull();
    expect(h.calls).toHaveLength(1);
    expect(await readFile(result!.mediaFilePath)).toEqual(mp4);
});

test('one total deadline stops ranked fallback and waits for an external download cleanup tail', async () => {
    const aborted = deferred();
    const release = deferred();
    const h = await harness({ timeoutMs: 100, downloadArchive: async (_url, file, options) => {
        await writeFile(file, archive(), { flag: 'wx' });
        await new Promise<void>(resolve => {
            if (options!.signal!.aborted) resolve();
            else options!.signal!.addEventListener('abort', () => resolve(), { once: true });
        });
        aborted.resolve();
        await release.promise;
        throw new Error('Synthetic cleanup completed');
    } });
    const attempt = h.resolver.resolveFromNotificationData(notification(['https://cdn.synthetic.invalid/first.zip', 'https://cdn.synthetic.invalid/never.zip']));
    await aborted.promise;
    let completed = false;
    void attempt.then(() => { completed = true; });
    try { await yieldTurn(); expect(completed).toBe(false); } finally { release.resolve(); }
    expect(await attempt).toBeNull();
    expect(h.calls).toHaveLength(1);
    expect(await readdir(h.directory)).toEqual([]);
});

test('caller abort during actual native extraction closes the ZIP pipeline and denies publication', async () => {
    const payload = Buffer.alloc(8 * 1024 * 1024);
    mp4.copy(payload);
    const h = await harness({}, archive({ portrait: profile }, [{ name: 'output.mp4', body: payload, method: 8 }]));
    const controller = new AbortController();
    let settled = false;
    let observedExtraction = false;
    const attempt = h.resolver.resolveFromNotificationData(notification(), { signal: controller.signal });
    void attempt.then(() => { settled = true; });
    const observer = (async () => {
        while (!settled && !observedExtraction) {
            for (const work of await readdir(h.directory)) {
                if (!work.startsWith('.gift-work-')) continue;
                for (const extracting of await readdir(join(h.directory, work)).catch(() => [])) {
                    if (!extracting.startsWith('gift-zip-')) continue;
                    const file = await stat(join(h.directory, work, extracting, 'output.mp4')).catch(() => null);
                    if (file && file.size > 0) {
                        observedExtraction = true;
                        controller.abort();
                    }
                }
            }
            await yieldTurn();
        }
    })();
    const [result] = await Promise.all([attempt, observer]);
    expect(observedExtraction).toBe(true);
    expect(result).toBeNull();
    expect(await readdir(h.directory)).toEqual([]);
}, 30000);

test('dispose at the native private-metadata boundary prevents a late published entry', async () => {
    let workWatcher: FSWatcher | undefined;
    let watcherClosed: Promise<void> | undefined;
    let disposal: Promise<void> | undefined;
    let observedMetadata = false;
    const bytes = archive();
    const h = await harness({ downloadArchive: async (_url, file) => {
        // Attach before the fake external download completes, not by racing a
        // parent-directory creation event against extraction/validation.
        workWatcher = watch(dirname(file), (_event, entry) => {
            if (String(entry) === 'metadata.json' && !observedMetadata) {
                observedMetadata = true;
                disposal = h.resolver.dispose();
            }
        });
        watcherClosed = new Promise<void>(done => workWatcher!.once('close', done));
        workWatcher.on('error', () => undefined);
        await writeFile(file, bytes, { flag: 'wx' });
        return { bytes: bytes.length };
    } });
    try {
        expect(await h.resolver.resolveFromNotificationData(notification())).toBeNull();
        expect(observedMetadata).toBe(true);
        await disposal;
        expect(await readdir(h.directory)).toEqual([]);
    } finally {
        workWatcher?.close();
        await watcherClosed;
    }
});

test('cancellation after real readiness rename retains the public commit and joins its delayed completion', async () => {
    const h = await harness();
    const metadataPath = join(h.directory, key('https://cdn.synthetic.invalid/asset.zip'), 'metadata.json');
    const committed = deferred();
    const release = deferred();
    const realRename = fsp.rename.bind(fsp);
    // External filesystem boundary only: perform the real atomic rename first,
    // then hold its completion so abort wins before the owner resumes.
    const rename = spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
        await realRename(from, to);
        if (String(to) === metadataPath) {
            committed.resolve();
            await release.promise;
        }
    });
    const attempt = h.resolver.resolveFromNotificationData(notification());
    let disposal: Promise<void> | undefined;
    try {
        await committed.promise;
        const peer = await harness({ cacheDirectory: h.directory });
        const visible = await peer.resolver.resolveFromNotificationData(notification());
        expect(visible).not.toBeNull();
        expect(peer.calls).toEqual([]);
        expect(await readFile(visible!.mediaFilePath)).toEqual(mp4);
        disposal = h.resolver.dispose();
        let retired = false;
        void disposal.then(() => { retired = true; });
        await yieldTurn();
        expect(retired).toBe(false);
        release.resolve();
        expect(await attempt).toBeNull();
        await disposal;
        expect(await readFile(visible!.mediaFilePath)).toEqual(mp4);
        const resumed = await harness({ cacheDirectory: h.directory });
        expect(await resumed.resolver.resolveFromNotificationData(notification())).toEqual(visible);
        expect(resumed.calls).toEqual([]);
        expect(await readdir(h.directory)).toEqual([key('https://cdn.synthetic.invalid/asset.zip')]);
    } finally {
        release.resolve();
        await attempt;
        await disposal;
        rename.mockRestore();
    }
});

test('a failed readiness rename still removes the owned unready reservation', async () => {
    const h = await harness();
    const metadataPath = join(h.directory, key('https://cdn.synthetic.invalid/asset.zip'), 'metadata.json');
    const realRename = fsp.rename.bind(fsp);
    const rename = spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
        if (String(to) === metadataPath) throw new Error('Synthetic readiness rename failure');
        await realRename(from, to);
    });
    try {
        expect(await h.resolver.resolveFromNotificationData(notification())).toBeNull();
        expect(await readdir(h.directory)).toEqual([]);
    } finally { rename.mockRestore(); }
});

test('diagnostics never contain signed URLs, arbitrary labels or external error payloads', async () => {
    const diagnostics: unknown[] = [];
    const capture = (...args: unknown[]) => { diagnostics.push(args); };
    const h = await harness({ logger: { debug: capture, warn: capture, error: capture }, downloadArchive: async () => { throw new Error('synthetic-private-error-payload'); } });
    await h.resolver.resolveFromNotificationData(notification(['https://cdn.synthetic.invalid/a?signed=synthetic-private-query']));
    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain('synthetic-private-error-payload');
    expect(serialized).not.toContain('synthetic-private-query');
    expect(serialized).not.toContain('https://');
    expect(serialized).toContain('download');
});

for (const runtime of ['node', 'bun']) {
    test(`${runtime} real resolver pipeline resumes valid cache and blocks new acquisition beside an invalid neighbor offline`, async () => {
        const directory = await root();
        const source = `
            import assert from 'node:assert/strict';
            import { writeFile, readFile, readdir, readlink, stat } from 'node:fs/promises';
            import fsp from 'node:fs/promises';
            import { setImmediate as yieldTurn } from 'node:timers/promises';
            const { createTikTokGiftAnimationResolver } = await import('./src/services/tiktok-gift-animation/resolver.ts').then(m => m.default ?? m);
            const { zipFixture } = await import('./tests/helpers/bounded-zip-fixture.ts').then(m => m.default ?? m);
            const directory = ${JSON.stringify(directory)};
            const data = ${JSON.stringify(notification())};
            const profile = ${JSON.stringify(profile)};
            const media = Buffer.from(${JSON.stringify([...mp4])});
            const bytes = zipFixture([{ name: 'config.json', body: Buffer.from(JSON.stringify({ portrait: profile })), method: 8 }, { name: 'output.mp4', body: media, method: 8 }]);
            let downloads = 0;
            const options = { cacheDirectory: directory, logger: { debug(){}, warn(){}, error(){} }, downloadArchive: async (_, file) => { downloads++; await writeFile(file, bytes, { flag: 'wx' }); return { bytes: bytes.length }; } };
            const resolver = createTikTokGiftAnimationResolver(options);
            const first = await resolver.resolveFromNotificationData(data);
            assert.ok(first);
            assert.equal(first.durationMs, 2500);
            assert.deepEqual(await readFile(first.mediaFilePath), media);
            assert.deepEqual(await resolver.resolveFromNotificationData(data), first);
            assert.equal(downloads, 1);
            await resolver.dispose();
            assert.deepEqual(await readFile(first.mediaFilePath), media);
            const warm = createTikTokGiftAnimationResolver(options);
            assert.deepEqual(await warm.resolveFromNotificationData(data), first);
            assert.equal(downloads, 1);
            assert.ok(await warm.resolveFromNotificationData(${JSON.stringify(notification(['https://cdn.synthetic.invalid/second.zip']))}));
            assert.equal(downloads, 2);
            await writeFile(directory + '/unknown.bin', 'synthetic unknown neighbor');
            assert.equal(await warm.resolveFromNotificationData(${JSON.stringify(notification(['https://cdn.synthetic.invalid/blocked.zip']))}), null);
            assert.equal(downloads, 2);
            assert.deepEqual(await warm.resolveFromNotificationData(data), first);
            await warm.dispose();
            assert.deepEqual(await readFile(first.mediaFilePath), media);
            assert.equal(await readFile(directory + '/unknown.bin', 'utf8'), 'synthetic unknown neighbor');
            const raceDirectory = directory + '/commit-race';
            const raceOptions = { ...options, cacheDirectory: raceDirectory };
            const raceMetadata = raceDirectory + '/${key('https://cdn.synthetic.invalid/asset.zip')}/metadata.json';
            const originalRename = fsp.rename;
            const realRename = originalRename.bind(fsp);
            let release;
            let markCommitted;
            const held = new Promise(resolve => { release = resolve; });
            const committed = new Promise(resolve => { markCommitted = resolve; });
            fsp.rename = async (from, to) => {
                await realRename(from, to);
                if (String(to) === raceMetadata) { markCommitted(); await held; }
            };
            const race = createTikTokGiftAnimationResolver(raceOptions);
            const pending = race.resolveFromNotificationData(data);
            let retirement;
            try {
                await committed;
                const peer = createTikTokGiftAnimationResolver(raceOptions);
                const visible = await peer.resolveFromNotificationData(data);
                assert.ok(visible);
                await peer.dispose();
                retirement = race.dispose();
                let retired = false;
                retirement.then(() => { retired = true; });
                await yieldTurn();
                assert.equal(retired, false);
                release();
                assert.equal(await pending, null);
                await retirement;
                assert.deepEqual(await readFile(visible.mediaFilePath), media);
                const resumed = createTikTokGiftAnimationResolver(raceOptions);
                assert.deepEqual(await resumed.resolveFromNotificationData(data), visible);
                await resumed.dispose();
            } finally {
                release();
                await pending;
                await retirement;
                fsp.rename = originalRename;
            }
            assert.equal((await readdir(directory)).some(name => name.startsWith('.gift-work-')), false);
            for (const fd of process.platform === 'linux' ? await readdir('/proc/self/fd') : []) {
                const target = await readlink('/proc/self/fd/' + fd).catch(() => '');
                const info = await stat('/proc/self/fd/' + fd).catch(() => null);
                assert.equal(target.startsWith(directory) && !!info?.isFile(), false, 'resolver file descriptor retained');
            }
            console.log('GIFT_RESOLVER_PIPELINE_OK');
        `;
        const args = runtime === 'node' ? ['--import', 'tsx', '--input-type=module', '--eval', source] : ['--no-env-file', '--eval', source];
        const result = await withNativeChildEnvironment(env =>
            promisify(execFile)(runtime, args, { cwd: process.cwd(), timeout: 15000, env }));
        expect(result.stdout.trim()).toBe('GIFT_RESOLVER_PIPELINE_OK');
        expect(result.stderr).toBe('');
    }, 30000);
}
