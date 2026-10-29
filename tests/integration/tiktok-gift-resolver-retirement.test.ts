import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { DisplayQueue } from "../../src/obs/display-queue";
import { createTikTokGiftAnimationResolver } from "../../src/services/tiktok-gift-animation/resolver";
import { createGuiTransportService } from "../../src/services/gui/gui-transport-service";
import { zipFixture } from "../helpers/bounded-zip-fixture";
import { TestEventBus } from "../helpers/gui-transport-test-utils";
import { createConfigFixture } from "../helpers/config-fixture";

type Resolver = ReturnType<typeof createTikTokGiftAnimationResolver>;
const roots: string[] = [];
const resolvers: Resolver[] = [];
const releases: Array<() => void> = [];
afterEach(async () => {
  releases.splice(0).forEach((release) => release());
  try {
    await Promise.all(resolvers.splice(0).map((resolver) => resolver.dispose()));
  } finally {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  }
});
const quiet = { debug() {}, warn() {}, error() {} };
const media = Buffer.from("000000186674797069736f6d0000000069736f6d", "hex");
const profile = { path: "output.mp4", videoW: 960, videoH: 864, w: 480, h: 854,
  rgbFrame: [0, 0, 480, 854], aFrame: [480, 0, 480, 854], f: 75 };
const archive = zipFixture([
  { name: "config.json", body: Buffer.from(JSON.stringify({ portrait: profile })), method: 8 },
  { name: "output.mp4", body: media, method: 8 },
]);
const notification = { username: "SyntheticViewer", enhancedGiftData: { originalData: { asset: {
  videoResourceList: [{ videoTypeName: "h264", videoUrl: { urlList: ["https://cdn.synthetic.invalid/owned.zip"] } }],
} } } };
async function makeResolver(downloadArchive?: NonNullable<Parameters<typeof createTikTokGiftAnimationResolver>[0]>["downloadArchive"]) {
  const directory = await mkdtemp(join(tmpdir(), "gift-owner-retirement-"));
  roots.push(directory);
  const resolver = createTikTokGiftAnimationResolver({
    logger: quiet, cacheDirectory: directory,
    downloadArchive: downloadArchive || (async (_url, output) => {
      await writeFile(output, archive, { flag: "wx" });
      return { bytes: archive.length };
    }),
  });
  resolvers.push(resolver);
  return { resolver, directory };
}
function queueWithOwnedResolver(resolver: Resolver, bus = new TestEventBus(),
  processDonationGoal = async () => {}, coordinated = true) {
  const queue = new DisplayQueue({ call: async () => ({}) }, {
    autoProcess: true,
    gui: { enableOverlay: true, showGifts: true, enableNotifications: coordinated },
    obs: {}, ttsNotificationsEnabled: false,
  }, {}, bus, {
    sourcesManager: { clearTextSource: async () => {}, updateTextSource: async () => {} },
    goalsManager: goalBoundary(processDonationGoal),
    createGiftAnimationResolver: () => resolver,
  });
  expect(queue.effects.giftAnimationResolver).toBe(resolver);
  return queue;
}
function goalBoundary(processDonationGoal = async () => {}) {
  return {
    initializeGoalDisplay: async () => {}, updateAllGoalDisplays: async () => {}, updateGoalDisplay: async () => {},
    processDonationGoal: async () => { await processDonationGoal(); return { success: true }; },
    processPaypiggyGoal: async () => ({ success: true }),
    getCurrentGoalStatus: () => null, getAllCurrentGoalStatuses: () => ({}),
  };
}

test("queue stop aborts owned native work immediately but joins the actual held download before completing", async () => {
  const started = Promise.withResolvers<AbortSignal>();
  const release = Promise.withResolvers<void>();
  releases.push(release.resolve);
  const { resolver, directory } = await makeResolver(async (_url, output, context) => {
    if (!context?.signal) throw new Error("Expected owned attempt signal");
    started.resolve(context.signal);
    await release.promise;
    await writeFile(output, archive, { flag: "wx" });
    return { bytes: archive.length };
  });
  const bus = new TestEventBus();
  let emitted = 0;
  let accountingAttempts = 0;
  bus.on("display:gift-animation", () => { emitted += 1; });
  const queue = queueWithOwnedResolver(resolver, bus, async () => {
    accountingAttempts += 1;
    throw new Error("Synthetic goal boundary failure");
  });
  queue.enqueueEffects({ type: "platform:gift", platform: "tiktok", data: {
    ...notification, amount: 1, currency: "coins", giftCount: 1,
  } });
  const signal = await started.promise;
  let stopped = false;
  const stopping = queue.stop().then(() => { stopped = true; });
  expect(signal.aborted).toBe(true);
  await yieldTurn();
  expect(stopped).toBe(false);
  expect(emitted).toBe(0);
  release.resolve();
  await stopping;
  expect(stopped).toBe(true);
  expect(accountingAttempts).toBe(1);
  expect(emitted).toBe(0);
  expect(await readdir(directory)).toEqual([]);
  expect(await resolver.resolveFromNotificationData(notification)).toBeNull();
});

test("effects dispose publishes its canonical promise before reentrant owned cleanup and keeps published files", async () => {
  const { resolver } = await makeResolver();
  const published = await resolver.resolveFromNotificationData(notification);
  expect(published).not.toBeNull();
  const queue = queueWithOwnedResolver(resolver);
  const nativeDispose = resolver.dispose.bind(resolver);
  let calls = 0;
  let reentrant: Promise<void> | undefined;
  resolver.dispose = () => {
    calls += 1;
    reentrant = queue.effects.dispose();
    return nativeDispose();
  };
  const first = queue.effects.dispose();
  expect(reentrant).toBe(first);
  expect(queue.effects.dispose()).toBe(first);
  await Promise.all([first, queue.stop(), queue.stop()]);
  expect(calls).toBe(1);
  expect(await readFile(published!.mediaFilePath)).toEqual(media);
});

test("injected resolver instances remain borrowed even when their disposal would throw", async () => {
  const { resolver } = await makeResolver();
  const nativeDispose = resolver.dispose.bind(resolver);
  let disposed = false;
  resolver.dispose = () => { disposed = true; throw new Error("Synthetic borrowed disposal forbidden"); };
  try {
    const queue = new DisplayQueue({ call: async () => ({}) }, {}, {}, null, {
      sourcesManager: { clearTextSource: async () => {}, updateTextSource: async () => {} },
      goalsManager: goalBoundary(),
      giftAnimationResolver: resolver,
      createGiftAnimationResolver: () => { throw new Error("Borrowed resolver must not construct a default owner"); },
    });
    await queue.stop();
    await queue.effects.dispose();
    expect(disposed).toBe(false);
    expect(await resolver.resolveFromNotificationData(notification)).not.toBeNull();
  } finally {
    resolver.dispose = nativeDispose;
  }
});

test("queue joins accounting work even when owned disposal throws synchronously", async () => {
  const { resolver } = await makeResolver();
  const nativeDispose = resolver.dispose.bind(resolver);
  const failure = new Error("Synthetic owned cleanup failure");
  let attempts = 0;
  let reentrant: Promise<void> | undefined;
  resolver.dispose = () => { attempts += 1; reentrant = queue.effects.dispose(); throw failure; };
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  releases.push(release.resolve);
  let accountingCalls = 0;
  const queue = queueWithOwnedResolver(resolver, new TestEventBus(), async () => {
    accountingCalls += 1;
    entered.resolve(); await release.promise;
  }, false);
  queue.enqueueEffects({ type: "platform:gift", platform: "tiktok", data: { username: "SyntheticViewer", amount: 1, currency: "coins", giftCount: 1 } });
  await entered.promise;
  let settled = false;
  const stopping = queue.stop().catch((error: unknown) => { settled = true; return error; });
  try {
    expect(reentrant).toBe(queue.effects.dispose());
    await yieldTurn();
    expect(settled).toBe(false);
    release.resolve();
    expect(await stopping).toBe(failure);
    expect(attempts).toBe(1);
    expect(accountingCalls).toBe(1);
  } finally {
    release.resolve();
    resolver.dispose = nativeDispose;
  }
});

test("real GUI runtime asset URL still serves immutable extracted media after resolver disposal", async () => {
  const { resolver, directory } = await makeResolver();
  const published = await resolver.resolveFromNotificationData(notification);
  expect(published).not.toBeNull();
  const bus = new TestEventBus();
  const service = createGuiTransportService({
    config: createConfigFixture({ gui: { enableDock: true, enableOverlay: false, host: "127.0.0.1", port: 0, showGifts: true } }),
    eventBus: bus, logger: null, runtimeAssetRoots: [directory],
  });
  const abort = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    await service.start();
    const address = service.getAddress();
    if (!address || typeof address === "string") throw new Error("Expected loopback listener");
    const base = `http://127.0.0.1:${address.port}`;
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(2000)]);
    const events = await fetch(`${base}/gui/events`, { signal });
    reader = events.body!.getReader();
    bus.emit("display:gift-animation", { playbackId: "synthetic-retirement-playback", ...published });
    let buffer = "";
    let assetUrl = "";
    const decoder = new TextDecoder();
    while (!assetUrl) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error("SSE closed before asset registration");
      buffer += decoder.decode(chunk.value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() || "";
      for (const frame of frames) {
        const line = frame.split("\n").find((entry) => entry.startsWith("data: "));
        if (!line) continue;
        const event = JSON.parse(line.slice(6)) as { assetUrl?: string };
        if (event.assetUrl) assetUrl = event.assetUrl;
      }
    }
    expect(assetUrl).toMatch(/^\/gui\/runtime\/[a-f0-9]{24}\.mp4$/);
    const before = await fetch(`${base}${assetUrl}`, { signal });
    expect(before.status).toBe(200);
    expect(Buffer.from(await before.arrayBuffer())).toEqual(media);
    await resolver.dispose();
    const after = await fetch(`${base}${assetUrl}`, { signal });
    expect(after.status).toBe(200);
    expect(Buffer.from(await after.arrayBuffer())).toEqual(media);
    const range = await fetch(`${base}${assetUrl}`, { signal, headers: { Range: "bytes=0-3" } });
    expect(range.status).toBe(206);
    expect(Buffer.from(await range.arrayBuffer())).toEqual(media.subarray(0, 4));
  } finally {
    abort.abort();
    await reader?.cancel().catch(() => {});
    await service.stop();
  }
});
