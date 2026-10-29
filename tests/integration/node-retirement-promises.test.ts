import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("native Node retires real effects/runtime owners and unwinds early main failure without native disposal stacks", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "node-retirement-"));
  const root = path.resolve(__dirname, "../..");
  const configPath = path.join(directory, "synthetic-retirement.ini");
  const entry = path.join(directory, "retirement.ts");
  try {
    await writeFile(configPath, `[general]
envFileReadEnabled=false
envFileWriteEnabled=false
[obs]
enabled=false
[twitch]
enabled=false
[youtube]
enabled=false
[tiktok]
enabled=false
[streamelements]
enabled=false
[gui]
enableDock=false
enableOverlay=false
enableOperator=false
enableChatFeed=false
[logging]
fileLoggingEnabled=false
`);
    await writeFile(entry, `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import { createRequire, syncBuiltinESMExports } from 'node:module';
const require = createRequire(${JSON.stringify(path.join(root, "package.json"))});
const nativePromiseMethod = Promise.withResolvers;
const nativeStack = globalThis.DisposableStack;
const nativeAsyncStack = globalThis.AsyncDisposableStack;
if (process.versions.node.startsWith('20.')) {
  assert.equal(typeof nativePromiseMethod, 'undefined');
  assert.equal(typeof nativeStack, 'undefined');
  assert.equal(typeof nativeAsyncStack, 'undefined');
}
const network: string[] = [];
const forbidden = (operation: string) => { network.push(operation); throw new Error('FORBIDDEN_NETWORK:' + operation); };
net.Socket.prototype.connect = function() { return forbidden('connect'); };
net.Server.prototype.listen = function() { return forbidden('listen'); };
http.request = () => forbidden('http');
http.get = () => forbidden('http-get');
https.request = () => forbidden('https');
https.get = () => forbidden('https-get');
dns.lookup = () => forbidden('dns');
dns.promises.lookup = async () => forbidden('dns-promises');
globalThis.fetch = async () => forbidden('fetch');
const read = fs.readFileSync.bind(fs);
const exists = fs.existsSync.bind(fs);
const runtimeReads: string[] = [];
const guard = (file: unknown) => {
  if (/(?:^|[/\\\\])(?:config\\.ini|\\.env)$/.test(String(file))) {
    runtimeReads.push(String(file));
    throw new Error('FORBIDDEN_RUNTIME_READ');
  }
};
fs.readFileSync = ((file: unknown, ...args: unknown[]) => { guard(file); return read(file as string, ...args as []); }) as typeof fs.readFileSync;
fs.existsSync = ((file: unknown) => { guard(file); return exists(file as string); }) as typeof fs.existsSync;
syncBuiltinESMExports();
const { DisplayQueueEffects } = require(${JSON.stringify(path.join(root, "src/obs/display-queue-effects.ts"))});
const { createTikTokGiftAnimationResolver } = require(${JSON.stringify(path.join(root, "src/services/tiktok-gift-animation/resolver.ts"))});
let app: any;
let reentrant: Promise<void> | undefined;
const quiet = { debug() {}, info(message: unknown) {
  if (message === 'Shutting down application...') reentrant = app.shutdown();
}, warn() {}, error() {} };
async function run() {
  const resolver = createTikTokGiftAnimationResolver({ logger: quiet, cacheDirectory: ${JSON.stringify(path.join(directory, "cache"))} });
  const nativeDispose = resolver.dispose.bind(resolver);
  const effects = new DisplayQueueEffects({
    obsManager: { call: async () => ({}) },
    sourcesManager: { clearTextSource: async () => {}, updateTextSource: async () => {} },
    goalsManager: { processDonationGoal: async () => {}, processPaypiggyGoal: async () => {} },
    config: { obs: {} }, delay: async () => {},
    handleDisplayQueueError() {}, extractUsername: () => null,
    createGiftAnimationResolver: () => resolver,
  });
  let nested: Promise<void> | undefined;
  let calls = 0;
  resolver.dispose = () => { calls += 1; nested = effects.dispose(); return nativeDispose(); };
  try {
    const first = effects.dispose();
    assert.equal(nested, first);
    assert.equal(effects.dispose(), first);
    await first;
    assert.equal(calls, 1);
    const borrowed = new DisplayQueueEffects({
      obsManager: { call: async () => ({}) },
      sourcesManager: { clearTextSource: async () => {}, updateTextSource: async () => {} },
      goalsManager: { processDonationGoal: async () => {}, processPaypiggyGoal: async () => {} },
      config: { obs: {} }, delay: async () => {},
      handleDisplayQueueError() {}, extractUsername: () => null,
      giftAnimationResolver: resolver,
    });
    await borrowed.dispose();
    assert.equal(calls, 1);
    const { AppRuntime } = require(${JSON.stringify(path.join(root, "src/runtime/AppRuntime.ts"))});
    const { config } = require(${JSON.stringify(path.join(root, "src/core/config.ts"))});
    const { createEventBus } = require(${JSON.stringify(path.join(root, "src/core/EventBus.ts"))});
    const { DisplayQueue } = require(${JSON.stringify(path.join(root, "src/obs/display-queue.ts"))});
    const { getOBSConnectionManager } = require(${JSON.stringify(path.join(root, "src/obs/connection.ts"))});
    const { getDefaultSourcesManager } = require(${JSON.stringify(path.join(root, "src/obs/sources.ts"))});
    const { getDefaultGoalsManager } = require(${JSON.stringify(path.join(root, "src/obs/goals.ts"))});
    const { createOBSEventService } = require(${JSON.stringify(path.join(root, "src/obs/obs-event-service.ts"))});
    const { NotificationManager } = require(${JSON.stringify(path.join(root, "src/notifications/NotificationManager.ts"))});
    const { CommandCooldownService } = require(${JSON.stringify(path.join(root, "src/services/CommandCooldownService.ts"))});
    const { PlatformLifecycleService } = require(${JSON.stringify(path.join(root, "src/services/PlatformLifecycleService.ts"))});
    const { createVFXCommandService } = require(${JSON.stringify(path.join(root, "src/services/VFXCommandService.ts"))});
    const { createUserTrackingService } = require(${JSON.stringify(path.join(root, "src/services/UserTrackingService.ts"))});
    const constants = require(${JSON.stringify(path.join(root, "src/core/constants.ts"))});
    const eventBus = createEventBus({ logger: quiet });
    const obsManager = getOBSConnectionManager({ config: config.obs });
    const sources = getDefaultSourcesManager();
    const goals = getDefaultGoalsManager();
    const displayQueue = new DisplayQueue(obsManager, config.displayQueue, constants, eventBus, {
      sourcesManager: sources, goalsManager: goals, giftAnimationResolver: resolver,
    });
    const userTrackingService = createUserTrackingService();
    const vfxCommandService = createVFXCommandService(config, eventBus);
    const notificationManager = new NotificationManager({ logger: quiet, constants, config,
      displayQueue, eventBus, userTrackingService, vfxCommandService });
    const commandCooldownService = new CommandCooldownService({ config, eventBus, logger: quiet });
    const obsEventService = createOBSEventService({ eventBus, obsConnection: obsManager, obsSources: sources, logger: quiet });
    const platformLifecycleService = new PlatformLifecycleService({ config, eventBus, logger: quiet });
    let shutdownEvents = 0;
    eventBus.subscribe('system:shutdown', () => { shutdownEvents += 1; });
    try {
      app = new AppRuntime(config, { logging: quiet, displayQueue, notificationManager,
        eventBus, vfxCommandService, userTrackingService, commandCooldownService,
        platformLifecycleService, obsEventService, obs: { connectionManager: obsManager } });
      const stopping = app.shutdown();
      assert.equal(reentrant, stopping);
      assert.equal(app.shutdown(), stopping);
      await stopping;
      assert.equal(shutdownEvents, 1);
      assert.equal(app.viewerCountSystem.isPolling, false);
      assert.equal(commandCooldownService.cleanupInterval, null);
    } finally {
      commandCooldownService.dispose();
      obsEventService.destroy();
    }
    const { main } = require(${JSON.stringify(path.join(root, "src/main.ts"))});
    config.logging.console.enabled = false;
    const startupFailure = new Error('Synthetic native main secret setup failure');
    let released = 0;
    let acquired = 0;
    await assert.rejects(main({
      config,
      createSingleInstanceGuard: async () => {
        acquired += 1;
        return { release: async () => { released += 1; } };
      },
      ensureSecrets: async () => { throw startupFailure; },
    }), (error: unknown) => error === startupFailure);
    assert.equal(acquired, 1);
    assert.equal(released, 1);
    assert.deepEqual(network, []);
    assert.deepEqual(runtimeReads, []);
    assert.equal(Promise.withResolvers, nativePromiseMethod);
    assert.equal(globalThis.DisposableStack, nativeStack);
    assert.equal(globalThis.AsyncDisposableStack, nativeAsyncStack);
    process.stdout.write('NODE_RETIREMENT_OK:' + process.versions.node + ':' + typeof nativePromiseMethod + ':' + typeof nativeStack + ':' + typeof nativeAsyncStack);
  } finally { await nativeDispose(); }
}
run().catch((error) => { process.stderr.write(String(error.stack || error)); process.exitCode = 1; });
`);
    const child = Bun.spawn(["node", "--import", path.join(root, "node_modules/tsx/dist/loader.mjs"), entry], {
      cwd: directory,
      env: { PATH: process.env.PATH, NODE_ENV: "test", CHAT_BOT_CONFIG_PATH: configPath },
      stdout: "pipe", stderr: "pipe", timeout: 10000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(stdout).toContain("NODE_RETIREMENT_OK:");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
