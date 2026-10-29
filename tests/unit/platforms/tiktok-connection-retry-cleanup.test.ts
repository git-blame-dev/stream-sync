import { describe, it, expect, afterEach, beforeEach, spyOn, vi } from "bun:test";
import { promises as fs } from "node:fs";
import { createTikTokLifetimeFixture, flushConnectorSetup } from "../../helpers/tiktok-connector-fixture";

describe("TikTokPlatform connection recovery", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(async () => {
    for (const fixture of fixtures.splice(0)) await fixture.cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const fixtures: ReturnType<typeof createTikTokLifetimeFixture>[] = [];
  let current: ReturnType<typeof createTikTokLifetimeFixture>;
  const createRouterPlatform = () => {
    current = createTikTokLifetimeFixture();
    fixtures.push(current);
    return current.platform;
  };
  const createConnection = () => current.createConnection();

  it("retains one live router facade per root instance", () => {
    const platform = createRouterPlatform();
    const owner = current;
    const other = createRouterPlatform();
    const adapter = platform._createEventRouterPlatformAdapter();
    expect(platform._createEventRouterPlatformAdapter()).toBe(adapter);
    expect(other._createEventRouterPlatformAdapter()).not.toBe(adapter);
    const connection = owner.createConnection();
    platform.connection = connection;
    platform.config = { ...platform.config, dataLoggingEnabled: false };
    expect(adapter.connection).toBe(connection);
    expect(adapter.config).toBe(platform.config);
    expect(adapter.connectionGeneration).toBe(platform._connectionGeneration);
    expect(adapter.listenersConfigured).toBe(false);
    const initialGeneration = adapter.connectionGeneration;
    platform.setupEventListeners();
    expect(adapter.listenersConfigured).toBe(true);
    expect(adapter.connectionGeneration).toBe(initialGeneration + 1);
    platform.cleanupEventListeners();
    expect(adapter.listenersConfigured).toBe(false);
  });

  it("root repeated setup and fresh cleanup remove only owned listeners", () => {
    const platform = createRouterPlatform();
    const connection = createConnection();
    const observer = () => {};
    connection.on(platform.WebcastEvent.CHAT, observer);
    connection.on("rawData", observer);
    platform.connection = connection;
    platform.setupEventListeners();
    platform.setupEventListeners();
    expect(connection.listenerCount(platform.WebcastEvent.CHAT)).toBe(2);
    platform.cleanupEventListeners();
    expect(connection.listeners(platform.WebcastEvent.CHAT)).toEqual([observer]);
    expect(connection.listeners("rawData")).toEqual([observer]);
    expect(platform.listenersConfigured).toBe(false);
  });

  it("duplicate root setup preserves generation and terminal-once state during an in-progress disconnect", async () => {
    const platform = createRouterPlatform();
    const connection = createConnection();
    platform.connection = connection;
    const terminalStatuses: unknown[] = [];
    platform.handlers = { ...platform.handlers, onStreamStatus: (payload: unknown) => { terminalStatuses.push(payload); } };
    // The existing disconnect owner is already active; terminal publication must still occur.
    platform._disconnectionInProgress = true;
    platform.setupEventListeners();
    const generation = platform._connectionGeneration;
    const terminal = connection.listeners("streamEnd")[0];
    if (!terminal) throw new Error("Expected registered terminal listener");
    platform.setupEventListeners();
    await terminal({ code: 4404 });
    expect(terminalStatuses).toHaveLength(1);
    expect(platform._connectionGeneration).toBe(generation);
    expect(platform._terminalStreamEndEmitted).toBe(true);
    platform.setupEventListeners();
    expect(platform._terminalStreamEndEmitted).toBe(true);
    await terminal({ code: 4404 });
    expect(terminalStatuses).toHaveLength(1);
    platform.cleanupEventListeners();
  });

  it("new registration advances generation once and fences captured old terminal callbacks", async () => {
    const platform = createRouterPlatform();
    const oldConnection = createConnection();
    const replacement = createConnection();
    const terminalStatuses: unknown[] = [];
    platform.handlers = { ...platform.handlers, onStreamStatus: (payload: unknown) => { terminalStatuses.push(payload); } };
    platform._disconnectionInProgress = true;
    platform.connection = oldConnection;
    platform.setupEventListeners();
    const oldGeneration = platform._connectionGeneration;
    const oldTerminal = oldConnection.listeners("streamEnd")[0];
    if (!oldTerminal) throw new Error("Expected old terminal listener");
    await oldTerminal({ code: 4404 });
    expect(terminalStatuses).toHaveLength(1);
    platform.cleanupEventListeners();
    platform.connection = replacement;
    platform.setupEventListeners();
    const terminal = replacement.listeners("streamEnd")[0];
    if (!terminal) throw new Error("Expected replacement terminal listener");
    expect(platform._connectionGeneration).toBe(oldGeneration + 1);
    expect(platform._terminalStreamEndEmitted).toBe(false);
    platform.setupEventListeners();
    expect(platform._connectionGeneration).toBe(oldGeneration + 1);
    await oldTerminal({ code: 4404 });
    expect(terminalStatuses).toHaveLength(1);
    expect(platform._terminalStreamEndEmitted).toBe(false);
    await terminal({ code: 4404 });
    await terminal({ code: 4404 });
    expect(terminalStatuses).toHaveLength(2);
    expect(platform._terminalStreamEndEmitted).toBe(true);
    platform.cleanupEventListeners();
  });

  it.each(["error", "disconnect", "disconnected", "webcast-error"])("fences delayed old %s lifecycle effects after replacement registration", async (event) => {
    const platform = createRouterPlatform();
    const oldConnection = createConnection();
    const replacement = createConnection();
    let release: () => void = () => { throw new Error("Diagnostic gate not initialized"); };
    let entered: () => void = () => { throw new Error("Diagnostic entry not initialized"); };
    const held = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    platform.config = { ...platform.config, dataLoggingEnabled: true };
    // Hold only external filesystem completion; both logging owners remain real.
    platform.rawPlatformDataLoggingService.dataLoggingPath = '/tmp/synthetic-tiktok-lifetime-no-write';
    const mkdir = spyOn(fs, 'mkdir').mockResolvedValue(undefined);
    const append = spyOn(fs, 'appendFile').mockImplementation(async () => { entered(); await held; });
    platform.connection = oldConnection;
    platform.setupEventListeners();
    const callback = oldConnection.listeners(event)[0];
    if (!callback) throw new Error("Expected old lifecycle listener");
    const pending = callback(new Error("synthetic old lifecycle event"));
    try {
      await started;
      platform.connection = replacement;
      platform.setupEventListeners();
      platform.connectionActive = true;
      const generation = platform._connectionGeneration;
      release();
      await pending;
      expect(platform.connection).toBe(replacement);
      expect(platform.connectionActive).toBe(true);
      expect(platform.listenersConfigured).toBe(true);
      expect(platform._connectionGeneration).toBe(generation);
      expect(replacement.listenerCount(platform.WebcastEvent.CHAT)).toBe(1);
      expect(platform._disconnectionInProgress).toBe(false);
      expect(platform.retryLock).toBe(false);
      platform.cleanupEventListeners();
    } finally {
      release();
      await pending;
      await current.cleanup();
      append.mockRestore();
      mkdir.mockRestore();
    }
  });

  it.each(["error", "disconnect", "disconnected", "webcast-error"])("fences retained old %s callbacks invoked after cleanup", async (event) => {
    const platform = createRouterPlatform();
    const oldConnection = createConnection();
    const replacement = createConnection();
    platform.connection = oldConnection;
    platform.setupEventListeners();
    const callback = oldConnection.listeners(event)[0];
    if (!callback) throw new Error("Expected retained lifecycle listener");
    platform.cleanupEventListeners();
    platform.connection = replacement;
    platform.setupEventListeners();
    platform.connectionActive = true;
    await callback(new Error("synthetic retained lifecycle event"));
    expect(platform.connection).toBe(replacement);
    expect(platform.connectionActive).toBe(true);
    expect(platform.listenersConfigured).toBe(true);
    expect(replacement.listenerCount(platform.WebcastEvent.CHAT)).toBe(1);
    expect(platform.retryLock).toBe(false);
    platform.cleanupEventListeners();
  });

  it("still executes the current connection control-error destructive root handler", async () => {
    const platform = createRouterPlatform();
    const connection = createConnection();
    const observer = () => {};
    connection.on(platform.WebcastEvent.CHAT, observer);
    platform.connection = connection;
    platform.connectionActive = true;
    platform.setupEventListeners();
    const callback = connection.listeners("error")[0];
    if (!callback) throw new Error("Expected current control-error listener");
    await callback(new Error("synthetic current connection failure"));
    expect(platform.connection).toBeNull();
    expect(platform.connectionActive).toBe(false);
    expect(platform.listenersConfigured).toBe(false);
    expect(connection.listeners(platform.WebcastEvent.CHAT)).toEqual([observer]);
  });

  it("cleanup alone retires captured control callbacks even without a generation change", async () => {
    const platform = createRouterPlatform();
    const connection = createConnection();
    platform.connection = connection;
    platform.connectionActive = true;
    platform.setupEventListeners();
    const callback = connection.listeners("error")[0];
    if (!callback) throw new Error("Expected current control-error listener");
    const generation = platform._connectionGeneration;
    platform.cleanupEventListeners();
    await callback(new Error("synthetic callback after cleanup"));
    expect(platform.connection).toBe(connection);
    expect(platform.connectionActive).toBe(true);
    expect(platform.listenersConfigured).toBe(false);
    expect(platform._connectionGeneration).toBe(generation);
    expect(platform.retryLock).toBe(false);
  });

  it.each(["replacement-without-registration", "same-connection-reregister"])("checks connection and generation independently for %s", async (transition) => {
    const platform = createRouterPlatform();
    const connection = createConnection();
    platform.connection = connection;
    platform.connectionActive = true;
    platform.setupEventListeners();
    const callback = connection.listeners("error")[0];
    if (!callback) throw new Error("Expected captured control-error listener");
    const generation = platform._connectionGeneration;
    if (transition === "replacement-without-registration") {
      platform.connection = createConnection();
      expect(platform._connectionGeneration).toBe(generation);
    } else {
      platform.cleanupEventListeners();
      platform.setupEventListeners();
      expect(platform._connectionGeneration).toBe(generation + 1);
    }
    const current = platform.connection;
    await callback(new Error("synthetic independently stale callback"));
    expect(platform.connection).toBe(current);
    expect(platform.connectionActive).toBe(true);
    expect(platform.listenersConfigured).toBe(true);
    expect(platform.retryLock).toBe(false);
    platform.cleanupEventListeners();
  });

  it("root replacement cleanup retires old connection and adopts current aliases and handlers", () => {
    const platform = createRouterPlatform();
    const oldConnection = createConnection();
    const replacement = createConnection();
    const oldChat = platform.WebcastEvent.CHAT;
    const observer = () => {};
    oldConnection.on(oldChat, observer);
    platform.connection = oldConnection;
    platform.setupEventListeners();
    platform.connection = replacement;
    platform.cleanupEventListeners();
    expect(oldConnection.listeners(oldChat)).toEqual([observer]);
    expect(oldConnection.listenerCount("rawData")).toBe(0);
    platform.WebcastEvent = { ...platform.WebcastEvent, CHAT: "synthetic-chat", ROOM_USER: "synthetic-room" };
    replacement.on(platform.WebcastEvent.CHAT, observer);
    const counts: unknown[] = [];
    platform.handlers = { ...platform.handlers, onViewerCount: (payload: unknown) => { counts.push(payload); } };
    platform.setupEventListeners();
    platform.setupEventListeners();
    expect(replacement.listeners(oldChat)).toEqual([]);
    expect(replacement.listenerCount(platform.WebcastEvent.CHAT)).toBe(2);
    replacement.emit("synthetic-room", { viewerCount: 0, common: { createTime: Date.parse("2024-01-01T00:00:00Z") } });
    expect(counts).toEqual([{ platform: "tiktok", count: 0, timestamp: "2024-01-01T00:00:00.000Z" }]);
    platform.cleanupEventListeners();
    expect(replacement.listeners(platform.WebcastEvent.CHAT)).toEqual([observer]);
    expect(replacement.listenerCount("synthetic-room")).toBe(0);
  });

  it("replaces deliberately invalid stale connecting state and removes its owned listeners", async () => {
    const platform = createRouterPlatform();
    const stale = createConnection();
    // Invalid state leaf: no external connect has been admitted on this client.
    // A genuine SDK failure clears this flag in TikTokWebSocketClient.retire().
    stale.isConnecting = true;
    platform.connection = stale;
    platform.setupEventListeners();
    const observer = () => {};
    stale.on(platform.WebcastEvent.CHAT, observer);
    const connecting = platform._connect({});
    await flushConnectorSetup();
    expect(stale.listeners(platform.WebcastEvent.CHAT)).toEqual([observer]);
    expect(current.clients).toHaveLength(2);
    current.connectors[0]!.open(); current.connectors[0]!.enter();
    await connecting;
    expect<unknown>(platform.connection).toBe(current.clients[1]!);
    expect(platform.connectionActive).toBe(true);
  });

  it("retires a failed real client and retries with a fresh connection", async () => {
    const platform = createRouterPlatform();
    const viewerCounts: unknown[] = [];
    platform.handlers.onViewerCount = payload => { viewerCounts.push(payload); };
    const initialized = platform.initialize(platform.handlers);
    await flushConnectorSetup();
    const first = current.connectors[0]!;
    first.fail(new Error('synthetic acquisition failure'));
    await expect(initialized).resolves.toMatchObject({ state: 'recovering', error: expect.any(Error) });
    await flushConnectorSetup();
    expect(first.signal?.aborted).toBe(true);
    expect(first.disconnects).toBeGreaterThan(0);
    expect(current.retry.getRetryCount('tiktok')).toBe(1);
    const delay = current.retry.calculateAdaptiveRetryDelay('tiktok');
    vi.advanceTimersByTime(delay);
    await flushConnectorSetup();
    const replacement = current.connectors[1]!;
    expect(current.clients).toHaveLength(2);
    expect(current.clients[0]!.isConnecting).toBe(false);
    replacement.open(); replacement.enter();
    await flushConnectorSetup();
    await platform.connectingPromise;
    expect<unknown>(platform.connection).toBe(current.clients[1]!);
    expect(platform.connectionActive).toBe(true);
    replacement.emit('roomUser', { total: 99, common: { createTime: Date.parse('2024-01-01T00:00:00Z') } });
    expect(viewerCounts).toEqual([{ platform: 'tiktok', count: 99, timestamp: '2024-01-01T00:00:00.000Z' }]);
  });
});
