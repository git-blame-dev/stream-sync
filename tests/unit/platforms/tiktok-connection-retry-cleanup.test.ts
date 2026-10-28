import { describe, it, expect, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";

import { EventEmitter } from "events";
import { TikTokPlatform } from "../../../src/platforms/tiktok";
import { createMockTikTokPlatformDependencies } from "../../helpers/mock-factories";

describe("TikTokPlatform connection recovery", () => {
  const baseConfig = { enabled: true, username: "retry_tester" };
  type TestConnection = EventEmitter & Record<string, unknown> & {
    id: string;
    isConnecting: boolean;
    isConnected: boolean;
    connect: () => Promise<boolean>;
    disconnect: () => Promise<boolean>;
  };
  type ViewerCountEvent = { platform: string; count: number };

  afterEach(() => {
    restoreAllMocks();
  });

  const createConnection = ({
    shouldReject,
    id,
  }: {
    shouldReject: boolean;
    id: string;
  }): TestConnection => {
    const connection = new EventEmitter() as TestConnection;
    connection.id = id;
    connection.isConnecting = false;
    connection.isConnected = false;
    connection.connect = createMockFn(() => {
      connection.isConnecting = true;
      if (shouldReject) {
        return Promise.reject(new Error("room id failure"));
      }
      connection.isConnecting = false;
      connection.isConnected = true;
      return Promise.resolve(true);
    });
    connection.disconnect = createMockFn().mockResolvedValue(true);
    connection.removeAllListeners =
      connection.removeAllListeners.bind(connection);
    return connection;
  };

  const createRouterPlatform = () => new TikTokPlatform(baseConfig, {
    ...createMockTikTokPlatformDependencies(),
    WebcastEvent: { CHAT: "chat", GIFT: "gift", FOLLOW: "follow", SOCIAL: "social", ROOM_USER: "roomUser", ERROR: "webcast-error", DISCONNECT: "disconnect", STREAM_END: "streamEnd" },
  });

  it("retains one live router facade per root instance", () => {
    const platform = createRouterPlatform();
    const other = createRouterPlatform();
    const adapter = platform._createEventRouterPlatformAdapter();
    expect(platform._createEventRouterPlatformAdapter()).toBe(adapter);
    expect(other._createEventRouterPlatformAdapter()).not.toBe(adapter);
    const connection = createConnection({ shouldReject: false, id: "synthetic-current" });
    platform.connection = connection;
    platform.config = { ...baseConfig, dataLoggingEnabled: true };
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
    const connection = createConnection({ shouldReject: false, id: "synthetic-owned" });
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
    const connection = createConnection({ shouldReject: false, id: "synthetic-terminal" });
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
    const oldConnection = createConnection({ shouldReject: false, id: "synthetic-terminal-old" });
    const replacement = createConnection({ shouldReject: false, id: "synthetic-terminal-new" });
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
    const oldConnection = createConnection({ shouldReject: false, id: "synthetic-held-old" });
    const replacement = createConnection({ shouldReject: false, id: "synthetic-held-new" });
    let release: () => void = () => { throw new Error("Diagnostic gate not initialized"); };
    let entered: () => void = () => { throw new Error("Diagnostic entry not initialized"); };
    const held = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    platform.config = { ...platform.config, dataLoggingEnabled: true };
    // Replace only the external file-writing boundary; root diagnostics and lifecycle stay real.
    platform.rawPlatformDataLoggingService.dataLoggingPath = "/synthetic-no-write";
    platform.rawPlatformDataLoggingService.rawEventLogWriter = {
      resolveLogFileName: () => "synthetic.jsonl",
      writeRawEvent: async () => {
        entered();
        await held;
        return { fileName: "synthetic.jsonl", filePath: "/synthetic-no-write/synthetic.jsonl" };
      },
    };
    platform.connection = oldConnection;
    platform.setupEventListeners();
    const callback = oldConnection.listeners(event)[0];
    if (!callback) throw new Error("Expected old lifecycle listener");
    const pending = callback(new Error("synthetic old lifecycle event"));
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
  });

  it.each(["error", "disconnect", "disconnected", "webcast-error"])("fences retained old %s callbacks invoked after cleanup", async (event) => {
    const platform = createRouterPlatform();
    const oldConnection = createConnection({ shouldReject: false, id: "synthetic-retained-old" });
    const replacement = createConnection({ shouldReject: false, id: "synthetic-retained-new" });
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
    const connection = createConnection({ shouldReject: false, id: "synthetic-current-error" });
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
    const connection = createConnection({ shouldReject: false, id: "synthetic-cleaned-current" });
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
    const connection = createConnection({ shouldReject: false, id: "synthetic-independent-fence" });
    platform.connection = connection;
    platform.connectionActive = true;
    platform.setupEventListeners();
    const callback = connection.listeners("error")[0];
    if (!callback) throw new Error("Expected captured control-error listener");
    const generation = platform._connectionGeneration;
    if (transition === "replacement-without-registration") {
      platform.connection = createConnection({ shouldReject: false, id: "synthetic-unregistered-new" });
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
    const oldConnection = createConnection({ shouldReject: false, id: "synthetic-old" });
    const replacement = createConnection({ shouldReject: false, id: "synthetic-new" });
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

  it("drops a stuck connecting instance and retries with a fresh connection", async () => {
    const connection1 = createConnection({ shouldReject: true, id: "conn-1" });
    const connection2 = createConnection({ shouldReject: false, id: "conn-2" });

    const dependencyBase = createMockTikTokPlatformDependencies();
    const dependencies = {
      ...dependencyBase,
      ControlEvent: {
        CONNECTED: "connected",
        DISCONNECTED: "disconnected",
        ERROR: "error",
      },
      WebcastEvent: {
        CHAT: "chat",
        GIFT: "gift",
        FOLLOW: "follow",
        ROOM_USER: "roomUser",
        ENVELOPE: "envelope",
        SUBSCRIBE: "subscribe",
        SUPER_FAN: "superfan",
        LIKE: "like",
        SOCIAL: "social",
        SHARE: "share",
        MEMBER: "member",
        EMOTE: "emote",
        QUESTION_NEW: "question",
        ERROR: "error",
        DISCONNECT: "disconnect",
        STREAM_END: "stream_end",
      },
    };

    const connectionFactory = {
      createConnection: createMockFn()
        .mockReturnValueOnce(connection1)
        .mockReturnValueOnce(connection2),
    };

    const platformDependencies = {
      ...dependencies,
      connectionFactory,
    };

    const viewerCounts: ViewerCountEvent[] = [];
    const platform = new TikTokPlatform(baseConfig, platformDependencies);
    platform.handlers = {
      ...platform.handlers,
      onViewerCount: (payload: unknown) => {
        viewerCounts.push(payload as ViewerCountEvent);
      },
    };

    await expect(platform.initialize(platform.handlers)).resolves.toMatchObject({
      state: "recovering",
      error: expect.any(Error),
    });

    await platform._connect(platform.handlers);
    connection2.emit(platformDependencies.ControlEvent.CONNECTED);
    const viewerTimestamp = Date.parse("2024-01-01T00:00:00Z");
    connection2.emit(platformDependencies.WebcastEvent.ROOM_USER, {
      viewerCount: 99,
      common: { createTime: viewerTimestamp },
    });

    expect(viewerCounts).toHaveLength(1);
    expect(viewerCounts[0]).toMatchObject({ platform: "tiktok", count: 99 });
  });
});
