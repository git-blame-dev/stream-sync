import { describe, test, expect, afterEach } from "bun:test";
import { EventEmitter } from "node:events";
import { noOpLogger } from "../../helpers/mock-factories";
import { PlatformConnectionFactory } from "../../../src/utils/platform-connection-factory";
import {
  secrets,
  _resetForTesting,
  initializeStaticSecrets,
} from "../../../src/core/secrets";
type LogEntry = {
  level: string;
  message: string;
};
type PlatformDependencies = Parameters<PlatformConnectionFactory["createConnection"]>[2];
type TikTokWebSocketClient = NonNullable<PlatformDependencies["TikTokWebSocketClient"]>;
type YouTubeConnection = {
  platform: string;
  isConnected: () => boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  getUsername: () => unknown;
};

function createTikTokClientFactory(
  initialize: (connection: Record<string, unknown>, username: string, config: Record<string, unknown>) => void,
): TikTokWebSocketClient {
  return class MockTikTokClient {
    constructor(username: string, config: Record<string, unknown>) {
      initialize(this as Record<string, unknown>, username, config);
    }
  } as unknown as TikTokWebSocketClient;
}

describe("platform-connection-factory behavior", () => {
  afterEach(() => {
    _resetForTesting();
    initializeStaticSecrets();
  });

  const createLogCollector = (): {
    entries: LogEntry[];
    debug: (message: string) => void;
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  } => {
    const entries: LogEntry[] = [];
    const collect =
      (level: string) =>
      (message: string): void => {
        entries.push({ level, message });
      };
    return {
      entries,
      debug: collect("debug"),
      info: collect("info"),
      warn: collect("warn"),
      error: collect("error"),
    };
  };

  test("wraps non-emitter connections returned by TikTok constructor", () => {
    const factory = new PlatformConnectionFactory(noOpLogger);
    const deps = {
      logger: noOpLogger,
      TikTokWebSocketClient: createTikTokClientFactory((connection) => {
        connection.connect = () => {};
      }),
    };

    const conn = factory.createConnection(
      "tiktok",
      { username: "testuser" },
      deps,
    );
    const connection = conn as Record<string, unknown>;
    expect(typeof connection.on).toBe("function");
    expect(typeof connection.removeAllListeners).toBe("function");
    const emitter = connection as unknown as EventEmitter;
    let delivered = 0;
    emitter.on("synthetic-event", () => { delivered++; });
    emitter.emit("synthetic-event");
    expect(delivered).toBe(1);
    emitter.removeAllListeners();
    emitter.emit("synthetic-event");
    expect(delivered).toBe(1);
  });

  test.each(["on", "emit", "removeAllListeners", "once"])("rejects partial native emitter method %s before padding", (method) => {
    const factory = new PlatformConnectionFactory(noOpLogger);
    expect(() => factory.createConnection("tiktok", { username: "synthetic-user" }, {
      logger: noOpLogger,
      TikTokWebSocketClient: createTikTokClientFactory((connection) => {
        connection.connect = () => {};
        connection[method] = () => {};
      }),
    })).toThrow("incomplete EventEmitter interface");
  });

  test("preserves complete native emitter methods and actual delivery", () => {
    const factory = new PlatformConnectionFactory(noOpLogger);
    const native = new EventEmitter();
    const originalOn = native.on;
    const originalEmit = native.emit;
    const originalRemove = native.removeAllListeners;
    const connection = factory.createConnection("tiktok", { username: "synthetic-user" }, {
      logger: noOpLogger,
      TikTokWebSocketClient: class {
        constructor() { return Object.assign(native, { connect: () => {} }); }
      } as unknown as TikTokWebSocketClient,
    }) as EventEmitter;
    expect(connection).toBe(native);
    expect(connection.on).toBe(originalOn);
    expect(connection.emit).toBe(originalEmit);
    expect(connection.removeAllListeners).toBe(originalRemove);
    let delivered = false;
    connection.on("synthetic-event", () => { delivered = true; });
    connection.emit("synthetic-event");
    expect(delivered).toBe(true);
  });

  test.each([undefined, 1, "", " ", "@", " @@ "])("rejects invalid username %s before construction", (username) => {
    const factory = new PlatformConnectionFactory(noOpLogger);
    let constructions = 0;
    expect(() => factory.createConnection("tiktok", { username }, {
      logger: noOpLogger,
      TikTokWebSocketClient: createTikTokClientFactory((connection) => { constructions++; connection.connect = () => {}; }),
    })).toThrow(/username.*required/i);
    expect(constructions).toBe(0);
  });

  test("trims before stripping all leading @ markers", () => {
    const factory = new PlatformConnectionFactory(noOpLogger);
    let constructedUsername = "";
    factory.createConnection("tiktok", { username: "  @@ synthetic-user  " }, {
      logger: noOpLogger,
      TikTokWebSocketClient: createTikTokClientFactory((connection, username) => { constructedUsername = username; connection.connect = () => {}; }),
    });
    expect(constructedUsername).toBe("synthetic-user");
  });

  test.each(["abc", "synthetic-key-value-long"])("passes API keys to the connection without emitting receipts for %s", (apiKey) => {
    const logger = createLogCollector();
    const factory = new PlatformConnectionFactory(logger);
    secrets.tiktok.apiKey = apiKey;
    expect(factory.buildTikTokConnectionConfig({}).apiKey).toBe(apiKey);
    expect(logger.entries.filter((entry) => entry.message.includes("EulerStream API key"))).toEqual([]);
    expect(logger.entries.some((entry) => entry.message.includes(apiKey.slice(0, 3)))).toBe(false);
  });

  test("throws on missing inputs", () => {
    const factory = new PlatformConnectionFactory(noOpLogger);
    expect(() =>
      factory.createConnection(null as unknown as string, {}, { logger: noOpLogger }),
    ).toThrow("Platform name is required");
    expect(() =>
      factory.createConnection("tiktok", null as unknown as Record<string, unknown>, { logger: noOpLogger }),
    ).toThrow("Configuration is required");
    expect(() => factory.createConnection("tiktok", {}, null as unknown as PlatformDependencies)).toThrow(
      "missing dependencies",
    );
    expect(() =>
      factory.createConnection("tiktok", {}, { logger: null }),
    ).toThrow("missing dependencies (logger)");
  });

  test("creates TikTok connections and propagates constructor errors", () => {
    const factory = new PlatformConnectionFactory(noOpLogger);
    const deps = {
      logger: noOpLogger,
      TikTokWebSocketClient: createTikTokClientFactory(() => {
        throw new Error("construct fail");
      }),
    };

    expect(() =>
      factory.createConnection("tiktok", { username: "testuser" }, deps),
    ).toThrow("construct fail");
  });

  test("throws for unsupported platform", () => {
    const factory = new PlatformConnectionFactory(noOpLogger);
    expect(() =>
      factory.createConnection("unknown", {}, { logger: noOpLogger }),
    ).toThrow("Unsupported platform");
  });

  test("keeps configured API keys out of diagnostics", () => {
    const logCollector = createLogCollector();
    const factory = new PlatformConnectionFactory(logCollector);

    const apiKey = "euler_1234567890abcdef";
    secrets.tiktok.apiKey = apiKey;
    const config = factory.buildTikTokConnectionConfig({});

    expect(config.apiKey).toBe(apiKey);
    expect(
      logCollector.entries.some(
        (entry) =>
          entry.level === "debug" &&
          entry.message.includes("EulerStream API key"),
      ),
    ).toBe(false);
    expect(
      logCollector.entries.every((entry) => !entry.message.includes(apiKey)),
    ).toBe(true);
  });

  test("accepts anonymous TikTok configuration without a speculative warning", () => {
    const logCollector = createLogCollector();
    const factory = new PlatformConnectionFactory(logCollector);

    _resetForTesting();
    const config = factory.buildTikTokConnectionConfig({});

    expect(config.apiKey).toBeNull();
    expect(logCollector.entries).toEqual([]);
  });

  test("preserves class-based logger prototype methods", () => {
    let warnCalls = 0;

    class PrototypeLogger {
      debug(): void {}

      info(): void {}

      warn(): void {
        warnCalls += 1;
      }

      error(): void {}
    }

    const logger = new PrototypeLogger();
    const factory = new PlatformConnectionFactory(logger);

    _resetForTesting();
    expect(factory.buildTikTokConnectionConfig({}).apiKey).toBeNull();
    expect(Object.getPrototypeOf(factory.logger)).toBe(PrototypeLogger.prototype);
    expect(warnCalls).toBe(0);
  });

  test("rejects incomplete logger implementations instead of filling missing methods", () => {
    const loggerWithOnlyDebug = {
      debug: () => {},
    };

    expect(() => new PlatformConnectionFactory(loggerWithOnlyDebug)).toThrow(/logger|info|warn|error/i);
  });

  test("creates YouTube connection with the shared connection interface", async () => {
    const factory = new PlatformConnectionFactory(noOpLogger);
    const connection = factory.createConnection(
      "youtube",
      { username: "test-youtube-user" },
      { logger: noOpLogger },
    ) as YouTubeConnection;

    expect(connection.platform).toBe("youtube");
    expect(connection.isConnected()).toBe(false);

    await connection.connect();
    expect(connection.isConnected()).toBe(true);

    await connection.disconnect();
    expect(connection.isConnected()).toBe(false);
    expect(connection.getUsername()).toBe("test-youtube-user");
  });

  test("throws for twitch creation placeholder path", () => {
    const factory = new PlatformConnectionFactory(noOpLogger);

    expect(() =>
      factory.createConnection(
        "twitch",
        { username: "test-user" },
        { logger: noOpLogger },
      ),
    ).toThrow("Twitch connection creation not yet implemented");
  });

  test("fails dependency logger validation before platform creation", () => {
    const factory = new PlatformConnectionFactory(noOpLogger);
    const deps = {
      logger: {},
      TikTokWebSocketClient: createTikTokClientFactory((connection) => {
        connection.connect = () => {};
      }),
    };

    expect(() =>
      factory.createConnection("tiktok", { username: "testuser" }, deps),
    ).toThrow("Platform creation failed for tiktok");
  });

  test("strips @ prefix from tiktok username before constructing connection", () => {
    const factory = new PlatformConnectionFactory(noOpLogger);
    let capturedUsername: string | null = null;
    let capturedConfig: Record<string, unknown> | null = null;

    const TikTokWebSocketClient = createTikTokClientFactory((connection, username, config) => {
      capturedUsername = username;
      capturedConfig = config;
      connection.connect = () => {};
      connection.on = () => {};
      connection.emit = () => {};
      connection.removeAllListeners = () => {};
    });

    factory.createConnection(
      "tiktok",
      { username: "@testuser" },
      {
        logger: noOpLogger,
        TikTokWebSocketClient,
      },
    );

    expect(capturedUsername as string | null).toBe("testuser");
    expect(capturedConfig).toMatchObject({ autoReconnect: false });
  });

  test("fails when TikTokWebSocketClient dependency is missing", () => {
    const factory = new PlatformConnectionFactory(noOpLogger);

    expect(() =>
      factory.createConnection(
        "tiktok",
        { username: "testuser" },
        { logger: noOpLogger },
      ),
    ).toThrow("missing TikTokWebSocketClient");
  });

  test("fails when constructed TikTok connection lacks connect method", () => {
    const factory = new PlatformConnectionFactory(noOpLogger);

    const TikTokWebSocketClient = createTikTokClientFactory((connection) => {
      connection.on = () => {};
      connection.emit = () => {};
      connection.removeAllListeners = () => {};
    });

    expect(() =>
      factory.createConnection(
        "tiktok",
        { username: "testuser" },
        {
          logger: noOpLogger,
          TikTokWebSocketClient,
        },
      ),
    ).toThrow("missing essential method: connect");
  });

  test("supports platform helpers for supported and unsupported values", () => {
    const factory = new PlatformConnectionFactory(noOpLogger);

    expect(factory.getSupportedPlatforms()).toEqual(["tiktok", "youtube"]);
    expect(factory.isPlatformSupported("tiktok")).toBe(true);
    expect(factory.isPlatformSupported("youtube")).toBe(true);
    expect(factory.isPlatformSupported("twitch")).toBe(false);
    expect(factory.isPlatformSupported(null as unknown as string)).toBe(false);
  });
});
