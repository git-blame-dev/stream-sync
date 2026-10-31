import { vi, describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { noOpLogger } from "../../../../helpers/mock-factories";
import { createRecordingLogger } from "../../../../helpers/recording-logger";
import {
  useFakeTimers,
  useRealTimers,
  setSystemTime,
  advanceTimersByTime,
} from "../../../../helpers/bun-timers";
import * as testClock from "../../../../helpers/test-clock";
import {
  safeSetTimeout,
  safeDelay,
  validateTimeout,
} from "../../../../../src/utils/timeout-validator";
import { EventEmitter } from "events";

import { createTwitchEventSubWsLifecycle } from "../../../../../src/platforms/twitch/connections/ws-lifecycle.ts";

type WsEventPayload = Record<string, unknown>;
type EmittedEvent = { event: string; payload?: unknown };
type CloseCall = { code?: number; reason?: string };
type Lifecycle = ReturnType<typeof createTwitchEventSubWsLifecycle>;
type LifecycleMethodState = Parameters<Lifecycle["connectWebSocket"]>[0];
type LifecycleLogger = NonNullable<LifecycleMethodState["logger"]>;
type SubscriptionSetupResult = {
  failures?: unknown[];
  aborted?: boolean;
  abortReason?: string;
};
type EventSubErrorCall = {
  msg: string;
  err?: unknown;
  type?: string;
  data?: Record<string, unknown>;
};
type LifecycleState = LifecycleMethodState & {
  logger: LifecycleLogger;
  twitchAuth: { isReady: () => boolean };
  config: { clientId: string };
  userId: string;
  ws: MockWebSocket;
  welcomeTimer: ReturnType<typeof setTimeout> | null;
  connectionStartTime: number | null;
  sessionId: string | null;
  disconnectedSessionId?: string | null;
  reconnectUrl?: string | null;
  _isConnected: boolean;
  subscriptionsReady: boolean;
  subscriptions: Map<string, unknown>;
  isInitialized: boolean;
  retryAttempts: number;
  maxRetryAttempts: number;
  retryDelay: number;
  reconnectTimeout: ReturnType<typeof setTimeout> | null;
  emitCalls: EmittedEvent[];
  emit: (event: string, payload?: unknown) => void;
  handleWebSocketMessage: (message: Record<string, unknown>) => Promise<void>;
  _validateConnectionForSubscriptions: () => boolean;
  _setupEventSubscriptions: (validationAlreadyDone?: boolean) => Promise<SubscriptionSetupResult>;
  scheduleReconnectCalls: boolean[];
  _scheduleReconnect: () => void;
  reconnectCalls: boolean[];
  _reconnect: () => Promise<void>;
  logEventSubErrorCalls: EventSubErrorCall[];
  _logEventSubError: (
    msg: string,
    err?: unknown,
    type?: string,
    data?: Record<string, unknown>,
  ) => number;
};

type LifecycleOverrides = Partial<LifecycleState> & {
  emitCalls?: EmittedEvent[];
  scheduleReconnectCalls?: boolean[];
  reconnectCalls?: boolean[];
  logEventSubErrorCalls?: EventSubErrorCall[];
};

type WebSocketCtor = new (url: string) => MockWebSocket;

const pushOptionalValue = <T extends object, K extends string, V>(
  target: T,
  key: K,
  value: V | undefined,
): T & Partial<Record<K, V>> => {
  if (value !== undefined) {
    Object.assign(target, { [key]: value });
  }
  return target;
};

const eventHasPayload = (
  emittedEvent: EmittedEvent,
): emittedEvent is EmittedEvent & { payload: WsEventPayload } =>
  emittedEvent.payload !== null && typeof emittedEvent.payload === "object";

const requireEventSubErrorCall = (
  call: EventSubErrorCall | undefined,
): EventSubErrorCall => {
  expect(call).toBeDefined();
  if (!call) {
    throw new Error("Expected EventSub error call to be recorded");
  }
  return call;
};

const requireCloseCall = (call: CloseCall | undefined): CloseCall => {
  expect(call).toBeDefined();
  if (!call) {
    throw new Error("Expected WebSocket close call to be recorded");
  }
  return call;
};

class MockWebSocket extends EventEmitter {
  static latest: MockWebSocket;
  url: string;
  readyState: number;
  pongCalls: unknown[];
  closeCalls: CloseCall[];
  options: { maxPayload?: number } | undefined;

  constructor(url: string, options?: { maxPayload?: number }) {
    super();
    MockWebSocket.latest = this;
    this.url = url;
    this.options = options;
    this.readyState = 0;
    this.pongCalls = [];
    this.closeCalls = [];
  }

  pong(data: unknown) {
    this.pongCalls.push(data);
  }

  close(code?: number, reason?: string) {
    const closeCall: CloseCall = {};
    pushOptionalValue(closeCall, "code", code);
    pushOptionalValue(closeCall, "reason", reason);
    this.closeCalls.push(closeCall);
    this.readyState = 3;
  }
}

describe("Twitch EventSub WS lifecycle", () => {
  beforeEach(() => {
    useFakeTimers();
    setSystemTime(new Date("2025-01-15T12:00:00.000Z"));
    testClock.set(1736942400000);
  });

  afterEach(() => {
    useRealTimers();
    testClock.reset();
  });

  const immediateSafeDelay = async () => {};

  const buildLifecycle = (overrides: Record<string, unknown> = {}) =>
    createTwitchEventSubWsLifecycle({
      WebSocketCtor: MockWebSocket satisfies WebSocketCtor,
      safeSetTimeout,
      safeDelay: immediateSafeDelay,
      validateTimeout,
      now: testClock.now,
      random: () => 0,
      setImmediateFn: (fn) => {
        fn();
      },
      ...overrides,
    });

  const createState = (overrides: LifecycleOverrides = {}): LifecycleState => {
    const emitCalls = overrides.emitCalls || [];
    const scheduleReconnectCalls = overrides.scheduleReconnectCalls || [];
    const reconnectCalls = overrides.reconnectCalls || [];
    const logEventSubErrorCalls = overrides.logEventSubErrorCalls || [];

    const state: LifecycleState = {
      logger: noOpLogger,
      twitchAuth: { isReady: vi.fn(() => true) },
      config: { clientId: "testClientId" },
      userId: "testUserId",
      ws: new MockWebSocket("wss://initial.invalid"),
      welcomeTimer: null,
      connectionStartTime: null,
      sessionId: null,
      _isConnected: false,
      subscriptionsReady: false,
      subscriptions: new Map(),
      isInitialized: true,
      retryAttempts: 0,
      maxRetryAttempts: 10,
      retryDelay: 5000,
      reconnectTimeout: null,
      emitCalls,
      emit: (event: string, payload?: unknown) => {
        const emittedEvent: EmittedEvent = { event };
        pushOptionalValue(emittedEvent, "payload", payload);
        emitCalls.push(emittedEvent);
      },
      handleWebSocketMessage: vi.fn(async () => {}),
      _validateConnectionForSubscriptions: vi.fn(() => true),
      _setupEventSubscriptions: vi.fn<(...args: [boolean?]) => Promise<SubscriptionSetupResult>>(async () => ({ failures: [] })),
      scheduleReconnectCalls,
      _scheduleReconnect: () => scheduleReconnectCalls.push(true),
      reconnectCalls,
      _reconnect: async () => {
        reconnectCalls.push(true);
      },
      logEventSubErrorCalls,
      _logEventSubError: (
        msg: string,
        err?: unknown,
        type?: string,
        data?: Record<string, unknown>,
      ) => {
        const errorCall: EventSubErrorCall = { msg };
        pushOptionalValue(errorCall, "err", err);
        pushOptionalValue(errorCall, "type", type);
        pushOptionalValue(errorCall, "data", data);
        return logEventSubErrorCalls.push(errorCall);
      },
      ...overrides,
    };

    return state;
  };

  const welcome = (socket: MockWebSocket) => socket.emit('message', JSON.stringify({
    metadata: { message_type: 'session_welcome' },
    payload: { session: { id: 'synthetic-session', keepalive_timeout_seconds: 30 } },
  }));

  test("rechecks an early watchdog and never treats pings as EventSub activity", async () => {
    const lifecycle = buildLifecycle();
    const state = createState();
    const connected = lifecycle.connectWebSocket(state); const socket = state.ws;
    welcome(socket); await connected;
    testClock.advance(34000); await advanceTimersByTime(35000);
    expect(state.scheduleReconnectCalls).toHaveLength(0);
    socket.emit('message', JSON.stringify({ metadata: { message_type: 'notification' }, payload: {} }));
    testClock.advance(30000); await advanceTimersByTime(30000);
    socket.emit('ping', Buffer.from('synthetic-ping'));
    socket.emit('pong', Buffer.from('synthetic-pong'));
    testClock.advance(5000); await advanceTimersByTime(5000);
    expect(state.scheduleReconnectCalls).toHaveLength(1);
    lifecycle.dispose(state);
    await advanceTimersByTime(35000);
    expect(state.scheduleReconnectCalls).toHaveLength(1);
  });

  test("backoff survives repeated ready-session losses without exhausting setup retries and resets after healthy traffic", async () => {
    const lifecycle = buildLifecycle();
    const state = createState({ maxRetryAttempts: 1 });
    let reconnecting = Promise.resolve();
    state._scheduleReconnect = () => lifecycle.scheduleReconnect(state);
    state._reconnect = () => { reconnecting = lifecycle.reconnect(state); return reconnecting; };
    state._connectWebSocket = async () => {
      const connected = lifecycle.connectWebSocket(state);
      welcome(state.ws);
      await connected;
    };
    await state._connectWebSocket();
    for (const expectedDelay of [2500, 5000, 10000, 15000, 15000]) {
      testClock.advance(5000); await advanceTimersByTime(5000);
      state.ws.emit('close', 1006);
      testClock.advance(expectedDelay - 1); await advanceTimersByTime(expectedDelay - 1);
      expect(state.ws).toBeNull();
      testClock.advance(1); await advanceTimersByTime(1);
      await reconnecting;
      expect(state.retryAttempts).toBe(0);
      expect(state.isInitialized).toBe(true);
      expect(state.subscriptionsReady).toBe(true);
    }
    for (let index = 0; index < 4; index++) {
      testClock.advance(30000); await advanceTimersByTime(30000);
      state.ws.emit('message', JSON.stringify({ metadata: { message_type: index % 2 ? 'notification' : 'session_keepalive' }, payload: {} }));
    }
    state.ws.emit('close', 1006);
    testClock.advance(2499); await advanceTimersByTime(2499);
    expect(state.ws).toBeNull();
    testClock.advance(1); await advanceTimersByTime(1);
    await reconnecting;
    expect(state.subscriptionsReady).toBe(true);
    lifecycle.dispose(state);
  });

  test("reconnect delay remains jittered at the cap", async () => {
    for (const [randomValue, expectedDelay] of [[0, 15000], [0.5, 22500], [0.999, 29985]] as const) {
      const lifecycle = buildLifecycle({ random: () => randomValue });
      const state = createState({ retryAttempts: 8 });
      lifecycle.scheduleReconnect(state);
      await advanceTimersByTime(expectedDelay - 1);
      expect(state.reconnectCalls).toHaveLength(0);
      await advanceTimersByTime(1);
      expect(state.reconnectCalls).toHaveLength(1);
      lifecycle.dispose(state);
    }
  });

  test("normalizes native ErrorEvent causes and keeps transport diagnostic values allowlisted", async () => {
    for (const wrap of [false, true]) {
      const logger = createRecordingLogger();
      const lifecycle = buildLifecycle(); const state = createState({ logger });
      const connected = lifecycle.connectWebSocket(state); const rejected = connected.catch(error => error);
      const cause = Object.assign(new Error('synthetic-secret-error-message'), { code: 'ECONNRESET' });
      state.ws.emit('error', wrap ? new ErrorEvent('error', { error: cause, message: 'synthetic-secret-wrapper-message' }) : cause);
      expect(await rejected).toBe(cause);
      const diagnostics = logger.entries.find(entry => entry.message === 'EventSub session lost')?.data;
      expect(diagnostics).toMatchObject({ cause: 'socket-error', phase: 'startup', errorName: 'Error', errorCode: 'ECONNRESET' });
      expect(JSON.stringify(diagnostics)).not.toContain('synthetic-secret');
      expect(state.scheduleReconnectCalls).toHaveLength(1);
      lifecycle.dispose(state);
    }
  });

  test("records monotonic silence and timer lateness at the tolerated deadline", async () => {
    const logger = createRecordingLogger(); let monotonic = 1000;
    const lifecycle = buildLifecycle({ now: () => monotonic }); const state = createState({ logger });
    const connected = lifecycle.connectWebSocket(state); welcome(state.ws); await connected;
    monotonic += 10000; await advanceTimersByTime(10000);
    state.ws.emit('message', JSON.stringify({ metadata: { message_type: 'notification' }, payload: {} }));
    setSystemTime(new Date('2030-01-01T00:00:00Z'));
    monotonic += 35007; await advanceTimersByTime(35000);
    expect(state.scheduleReconnectCalls).toHaveLength(1);
    expect(logger.entries.find(entry => entry.message === 'EventSub session lost')?.data).toMatchObject({
      connectionAttempt: 1, sessionAgeMs: 45007, silenceMs: 35007, keepaliveTimeoutMs: 30000, deadlineLatenessMs: 7
    });
    const replacement = lifecycle.connectWebSocket(state); const socket = state.ws; welcome(socket); await replacement;
    socket.emit('error', Object.assign(new Error('synthetic-secret-message'), { name: 'synthetic-secret-name', code: 'synthetic-secret-code' }));
    expect(logger.entries.filter(entry => entry.message === 'EventSub session lost').at(-1)?.data).toMatchObject({
      connectionAttempt: 2, errorName: 'unknown', errorCode: null
    });
    lifecycle.dispose(state);
  });

  test("contains malformed error envelopes without invoking their string conversion", async () => {
    for (const error of [null, { get error() { throw new Error('synthetic getter'); }, toString() { throw new Error('synthetic conversion'); } }]) {
      const lifecycle = buildLifecycle(); const state = createState();
      const rejected = lifecycle.connectWebSocket(state).catch(error => error);
      expect(() => state.ws.emit('error', error)).not.toThrow();
      expect(await rejected).toMatchObject({ message: 'EventSub WebSocket transport error' });
      expect(state.scheduleReconnectCalls).toHaveLength(1);
      lifecycle.dispose(state);
    }
  });

  test("ready close reports one safe loss diagnostic and an accurate emitted reason", async () => {
    for (const code of [1000, 1006, 4002]) {
      const logger = createRecordingLogger();
      const lifecycle = buildLifecycle();
      const state = createState({ logger });
      const connected = lifecycle.connectWebSocket(state);
      const socket = state.ws;
      welcome(socket);
      await connected;
      socket.emit('close', code, Buffer.from('synthetic-secret-close-reason'));
      socket.emit('close', code, Buffer.from('synthetic-secret-close-reason'));
      const disconnected = state.emitCalls.find(event => event.event === 'eventSubDisconnected');
      expect(disconnected?.payload).toMatchObject({ reason: code === 1006
        ? 'Connection closed abnormally during EventSub session' : 'EventSub session closed' });
      // Loss diagnostics are the operator-facing contract; exact fields also prove redaction.
      expect(logger.entries.filter(entry => entry.level === 'warn')).toEqual([{ level: 'warn', message: 'EventSub session lost', source: 'twitch', data: {
        cause: 'socket-close', phase: 'ready', closeCode: code, willReconnect: true, terminal: false,
        connectionAttempt: 1, sessionAgeMs: 0, silenceMs: 0, keepaliveTimeoutMs: 30000, deadlineLatenessMs: null,
      } }]);
    }
  });

  test("30 second welcome tolerates boundary jitter, refreshes keepalive, and loses once after grace", async () => {
    const logger = createRecordingLogger();
    const lifecycle = buildLifecycle();
    const state = createState({ logger });
    const connected = lifecycle.connectWebSocket(state);
    const socket = state.ws;
    welcome(socket);
    await connected;
    testClock.advance(12000);
    await advanceTimersByTime(12000);
    expect(state.ws).toBe(socket);
    expect(state.subscriptionsReady).toBe(true);
    expect(state.scheduleReconnectCalls).toHaveLength(0);
    socket.emit('message', JSON.stringify({ metadata: { message_type: 'session_keepalive' }, payload: {} }));
    testClock.advance(30001);
    await advanceTimersByTime(30001);
    expect(state.ws).toBe(socket);
    socket.emit('message', JSON.stringify({ metadata: { message_type: 'session_keepalive' }, payload: {} }));
    testClock.advance(34999);
    await advanceTimersByTime(34999);
    expect(state.ws).toBe(socket);
    expect(logger.entries.filter(entry => entry.level === 'warn')).toEqual([]);
    testClock.advance(1);
    await advanceTimersByTime(1);
    expect(state.scheduleReconnectCalls).toHaveLength(1);
    expect(logger.entries.filter(entry => entry.level === 'warn')).toEqual([{ level: 'warn', message: 'EventSub session lost', source: 'twitch', data: {
      cause: 'keepalive-timeout', phase: 'ready', closeCode: null, willReconnect: true, terminal: false,
      connectionAttempt: 1, sessionAgeMs: 77001, silenceMs: 35000, keepaliveTimeoutMs: 30000, deadlineLatenessMs: 0,
    } }]);
    const replacement = lifecycle.connectWebSocket(state);
    const replacementSocket = state.ws;
    welcome(replacementSocket);
    await replacement;
    socket.emit('close', 1006);
    await advanceTimersByTime(12000);
    expect(state.ws).toBe(replacementSocket);
    expect(state.subscriptionsReady).toBe(true);
    expect(logger.entries.filter(entry => entry.level === 'warn')).toHaveLength(1);
    lifecycle.dispose(state);
    await advanceTimersByTime(30000);
    expect(logger.entries.filter(entry => entry.level === 'warn')).toHaveLength(1);
  });

  test("loss diagnostics classify startup and setup failures without raw error content", async () => {
    for (const cause of ['welcome-timeout', 'first-subscription-timeout', 'socket-error', 'message-or-setup-failure']) {
      const logger = createRecordingLogger();
      const lifecycle = buildLifecycle();
      const state = createState({
        logger,
        _setupEventSubscriptions: async () => new Promise(() => {}),
      });
      const connected = lifecycle.connectWebSocket(state);
      const rejected = connected.catch(error => error);
      const socket = state.ws;
      if (cause !== 'welcome-timeout') welcome(socket);
      if (cause === 'welcome-timeout') await advanceTimersByTime(15000);
      else if (cause === 'first-subscription-timeout') {
        await advanceTimersByTime(15000);
        socket.emit('message', JSON.stringify({ metadata: { message_type: 'session_keepalive' }, payload: {} }));
        await advanceTimersByTime(15000);
      }
      else if (cause === 'socket-error') socket.emit('error', Object.assign(new Error('synthetic-secret-error'), { code: 'synthetic-secret-code' }));
      else socket.emit('message', 'synthetic-secret-invalid-json');
      expect(await rejected).toBeInstanceOf(Error);
      expect(logger.entries.filter(entry => entry.level === 'warn')).toEqual([{ level: 'warn', message: 'EventSub session lost', source: 'twitch', data: {
        cause, phase: cause === 'welcome-timeout' ? 'startup' : 'setting-up',
        closeCode: null, willReconnect: true, terminal: false,
        connectionAttempt: 1, sessionAgeMs: 0,
        silenceMs: cause === 'welcome-timeout' ? null : 0,
        keepaliveTimeoutMs: cause === 'welcome-timeout' ? null : 30000, deadlineLatenessMs: null,
        ...(cause === 'socket-error' ? { errorName: 'Error', errorCode: null } : {}),
      } }]);
      expect(state.scheduleReconnectCalls).toHaveLength(1);
      lifecycle.dispose(state);
    }
  });

  test("throwing loss logger cannot prevent retirement, notification, or recovery", async () => {
    const lifecycle = buildLifecycle();
    const state = createState({ logger: { ...noOpLogger, warn: () => { throw new Error('synthetic logger failure'); } } });
    const connected = lifecycle.connectWebSocket(state);
    const socket = state.ws;
    welcome(socket);
    await connected;
    expect(() => socket.emit('close', 1006)).not.toThrow();
    expect(socket.closeCalls).toHaveLength(1);
    expect(state.subscriptionsReady).toBe(false);
    expect(state.emitCalls.filter(event => event.event === 'eventSubDisconnected')).toHaveLength(1);
    expect(state.scheduleReconnectCalls).toHaveLength(1);
  });

  test("frame admission rejects unsafe input without leaking or coercing it", async () => {
    let coercions = 0;
    const secret = "test-only-frame-secret";
    const cases: [unknown, string][] = [
      [Buffer.from(JSON.stringify({ text: "é".repeat(600000) })), "size"],
      [[Buffer.alloc(600000), Buffer.alloc(600000)], "size"],
      [Buffer.concat([Buffer.from('{"text":"'), Buffer.from([0xff]), Buffer.from('"}')]), "UTF-8"],
      [{ toString() { coercions++; throw new Error(secret); } }, "type"],
      [Buffer.from("null"), "root"],
      [Buffer.from("[]"), "root"],
      [Buffer.from(`{"${secret}": broken}`), "JSON"],
    ];
    for (const [frame, classification] of cases) {
      const lifecycle = buildLifecycle();
      const state = createState();
      const pending = lifecycle.connectWebSocket(state);
      state.ws.emit("message", frame);
      await expect(pending).rejects.toThrow(classification);
      expect(state.scheduleReconnectCalls).toHaveLength(1);
      expect(state.logEventSubErrorCalls).toHaveLength(1);
      const diagnostics = JSON.stringify(state.emitCalls) + state.logEventSubErrorCalls.map(call => String(call.err)).join();
      expect(diagnostics).not.toContain(secret);
      expect(state.emitCalls.filter(call => call.event === "eventSubSubscriptionFailed")).toHaveLength(1);
      lifecycle.dispose(state);
    }
    expect(coercions).toBe(0);
  });

  test("frame admission accepts exact byte limit and real ws data shapes", async () => {
    const welcome = JSON.stringify({ metadata: { message_type: "session_welcome" }, payload: { session: { id: "test-frame-shapes" } } });
    const exact = Buffer.from(welcome + " ".repeat(1024 * 1024 - Buffer.byteLength(welcome)));
    const split = Buffer.from(welcome.replace("test-frame-shapes", "test-é-shapes"));
    const boundary = split.indexOf(Buffer.from("é")) + 1;
    for (const frame of [exact, [split.subarray(0, boundary), split.subarray(boundary)], Uint8Array.from(split).buffer, welcome]) {
      const lifecycle = buildLifecycle();
      const state = createState();
      const pending = lifecycle.connectWebSocket(state);
      expect(state.ws.options?.maxPayload).toBe(1024 * 1024);
      state.ws.emit("message", frame);
      await pending;
      state.ws.emit("message", Buffer.from('{"metadata":{"message_type":"notification"},"payload":{}}'));
      expect(state.handleWebSocketMessage).toHaveBeenCalledTimes(1);
      expect(state.subscriptionsReady).toBe(true);
      lifecycle.dispose(state);
    }
  });

  test("connectWebSocket waits for subscriptions before resolving startup", async () => {
    const lifecycle = buildLifecycle();

    let resolveSubscriptions: (value: SubscriptionSetupResult) => void = () => {};
    const setupPromise = new Promise<SubscriptionSetupResult>((resolve) => {
      resolveSubscriptions = resolve;
    });

    const state = createState({
      _setupEventSubscriptions: vi.fn(async () => setupPromise),
    });
    const connectPromise = lifecycle.connectWebSocket(state);
    let connectResolved = false;
    connectPromise.then(() => {
      connectResolved = true;
    });

    state.ws.readyState = 1;
    state.ws.emit("open");
    state.ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          metadata: { message_type: "session_welcome" },
          payload: {
            session: {
              id: "test-session-123",
              keepalive_timeout_seconds: 30,
              status: "connected",
              connected_at: "2024-01-01T00:00:00Z",
            },
          },
        }),
      ),
    );

    await Promise.resolve();
    await Promise.resolve();
    const resolvedBeforeSubscriptions = connectResolved;
    const emittedConnectedBeforeSubscriptions = state.emitCalls.some(
      ({ event }) => event === "eventSubConnected",
    );

    resolveSubscriptions({ failures: [] });
    await connectPromise;
    await Promise.resolve();

    expect(state.sessionId).toBe("test-session-123");
    expect(state._isConnected).toBe(true);
    expect(resolvedBeforeSubscriptions).toBe(false);
    expect(emittedConnectedBeforeSubscriptions).toBe(false);
    expect(
      state.emitCalls.some(
        (emittedEvent) =>
          emittedEvent.event === "eventSubConnected" &&
          eventHasPayload(emittedEvent) &&
          emittedEvent.payload.sessionId === "test-session-123",
      ),
    ).toBe(true);
    expect(state.subscriptionsReady).toBe(true);
  });

  test("connectWebSocket does not apply fixed welcome delay before subscription setup", async () => {
    const lifecycle = buildLifecycle({
      safeDelay: async () => {
        throw new Error("safeDelay should not run during welcome handling");
      },
    });

    const state = createState({
      _setupEventSubscriptions: vi.fn(async () => ({ failures: [] })),
    });
    const connectPromise = lifecycle.connectWebSocket(state);

    state.ws.readyState = 1;
    state.ws.emit("open");
    state.ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          metadata: { message_type: "session_welcome" },
          payload: {
            session: {
              id: "test-session-no-welcome-wait",
              keepalive_timeout_seconds: 30,
              status: "connected",
              connected_at: "2024-01-01T00:00:00Z",
            },
          },
        }),
      ),
    );

    await connectPromise;
    await Promise.resolve();

    expect(state.subscriptionsReady).toBe(true);
  });

  test("connectWebSocket rejects on connection timeout when no welcome message arrives", async () => {
    const lifecycle = buildLifecycle();

    const state = createState();
    const connectPromise = lifecycle.connectWebSocket(state);

    await advanceTimersByTime(15100);

    await expect(connectPromise).rejects.toThrow(
      "Connection timeout - no welcome message",
    );
  });

  test("connectWebSocket rejects when subscription setup reports failures", async () => {
    const lifecycle = buildLifecycle();

    const state = createState({
      _setupEventSubscriptions: vi.fn(async () => ({
        failures: [{ subscription: "Follows" }],
      })),
    });
    const connectPromise = lifecycle.connectWebSocket(state);

    state.ws.readyState = 1;
    state.ws.emit("open");
    state.ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          metadata: { message_type: "session_welcome" },
          payload: {
            session: {
              id: "test-session-456",
              keepalive_timeout_seconds: 30,
              status: "connected",
              connected_at: "2024-01-01T00:00:00Z",
            },
          },
        }),
      ),
    );

    await expect(connectPromise).rejects.toThrow(
      "Subscription setup completed with failures",
    );
    await Promise.resolve();
    expect(state.subscriptionsReady).toBe(false);
    expect(state.scheduleReconnectCalls).toHaveLength(1);
    expect(
      state.emitCalls.some(({ event }) => event === "eventSubConnected"),
    ).toBe(false);
    expect(
      state.emitCalls.some(
        (emittedEvent) =>
          emittedEvent.event === "eventSubSubscriptionFailed" &&
          eventHasPayload(emittedEvent) &&
          emittedEvent.payload.sessionId === "test-session-456",
      ),
    ).toBe(true);
  });

  test("connectWebSocket rejects when subscription setup returns an aborted result", async () => {
    const lifecycle = buildLifecycle();

    const state = createState({
      _setupEventSubscriptions: vi.fn(async () => ({
        failures: [],
        aborted: true,
        abortReason: "connection-lost",
      })),
    });
    const connectPromise = lifecycle.connectWebSocket(state);

    state.ws.readyState = 1;
    state.ws.emit("open");
    state.ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          metadata: { message_type: "session_welcome" },
          payload: {
            session: {
              id: "aborted-session",
              keepalive_timeout_seconds: 30,
              status: "connected",
              connected_at: "2024-01-01T00:00:00Z",
            },
          },
        }),
      ),
    );

    await expect(connectPromise).rejects.toThrow(
      "Subscription setup aborted: connection-lost",
    );
    expect(state.subscriptionsReady).toBe(false);
    expect(
      state.emitCalls.some(
        (emittedEvent) =>
          emittedEvent.event === "eventSubSubscriptionFailed" &&
          eventHasPayload(emittedEvent) &&
          emittedEvent.payload.reason === "connection-lost",
      ),
    ).toBe(true);
  });

  test("connectWebSocket surfaces one startup failure path when subscription setup aborts on dead session loss", async () => {
    const lifecycle = buildLifecycle();

    const state = createState({
      _setupEventSubscriptions: vi.fn(async () => ({
        failures: [
          {
            subscription: "Chat",
            error: { message: "websocket session has already disconnected" },
          },
        ],
      })),
    });
    const connectPromise = lifecycle.connectWebSocket(state);

    state.ws.readyState = 1;
    state.ws.emit("open");
    state.ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          metadata: { message_type: "session_welcome" },
          payload: { session: { id: "dead-session-startup" } },
        }),
      ),
    );

    await expect(connectPromise).rejects.toThrow(
      "Subscription setup completed with failures",
    );
    expect(state.scheduleReconnectCalls).toHaveLength(1);
    expect(
      state.emitCalls.filter(
        ({ event }) => event === "eventSubSubscriptionFailed",
      ),
    ).toHaveLength(1);
    expect(
      state.emitCalls.some(({ event }) => event === "eventSubDisconnected"),
    ).toBe(true);
  });

  test("scheduleReconnect disables initialization when max attempts exceeded", () => {
    const lifecycle = buildLifecycle();

    const state = createState({
      retryAttempts: 1,
      maxRetryAttempts: 1,
      isInitialized: true,
    });
    lifecycle.scheduleReconnect(state);

    expect(state.isInitialized).toBe(false);
    expect(
      state.emitCalls.some(
        (emittedEvent) =>
          emittedEvent.event === "eventSubDisconnected" &&
          eventHasPayload(emittedEvent) &&
          emittedEvent.payload.willReconnect === false &&
          emittedEvent.payload.terminal === true,
      ),
    ).toBe(true);
  });

  test("scheduleReconnect triggers reconnection after delay", async () => {
    const lifecycle = buildLifecycle();

    const state = createState({
      retryAttempts: 0,
      maxRetryAttempts: 2,
      retryDelay: 1000,
    });
    state._reconnect = () => lifecycle.reconnect(state);
    state._connectWebSocket = vi.fn(async () => {
      state._isConnected = true;
      state.emitCalls.push({
        event: "eventSubConnected",
        payload: { sessionId: "reconnect-session" },
      });
    });

    lifecycle.scheduleReconnect(state);

    expect(state._isConnected).toBe(false);

    await advanceTimersByTime(1100);

    expect(state._isConnected).toBe(true);
    expect(state.emitCalls.some((e) => e.event === "eventSubConnected")).toBe(
      true,
    );
  });

  test("handleReconnectRequest stores reconnect_url and triggers reconnection", async () => {
    const lifecycle = buildLifecycle();

    const state = createState({
      retryAttempts: 0,
      maxRetryAttempts: 2,
      retryDelay: 1000,
    });
    state._scheduleReconnect = () => lifecycle.scheduleReconnect(state);
    state._reconnect = () => lifecycle.reconnect(state);
    state._connectWebSocket = vi.fn(async () => {
      state._isConnected = true;
    });

    lifecycle.handleReconnectRequest(state, {
      session: {
        reconnect_url:
          "wss://eventsub.wss.twitch.tv/ws?token=test-reconnect-token",
      },
    });

    expect(state.reconnectUrl).toBe(
      "wss://eventsub.wss.twitch.tv/ws?token=test-reconnect-token",
    );

    await advanceTimersByTime(1100);
    expect(state._isConnected).toBe(true);
  });

  test("throws when WebSocketCtor is not provided", () => {
    expect(() =>
      createTwitchEventSubWsLifecycle({
        safeSetTimeout,
        safeDelay,
        validateTimeout,
      }),
    ).toThrow("WebSocketCtor is required");
  });

  test("throws when timeout utilities are not provided", () => {
    expect(() =>
      createTwitchEventSubWsLifecycle({
        WebSocketCtor: MockWebSocket,
      }),
    ).toThrow("timeout utilities are required");
  });

  test("connectWebSocket closes ws and rejects on timeout when ws is open", async () => {
    const lifecycle = buildLifecycle();

    const state = createState();
    const connectPromise = lifecycle.connectWebSocket(state);

    state.ws.readyState = 1;
    await advanceTimersByTime(15100);

    await expect(connectPromise).rejects.toThrow(
      "Connection timeout - no welcome message",
    );
    expect(MockWebSocket.latest.closeCalls).toHaveLength(1);
  });

  test("connectWebSocket rejects with invalid session ID", async () => {
    const lifecycle = buildLifecycle();

    const state = createState();
    const connectPromise = lifecycle.connectWebSocket(state);

    state.ws.readyState = 1;
    state.ws.emit("open");
    state.ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          metadata: { message_type: "session_welcome" },
          payload: { session: { id: "   " } },
        }),
      ),
    );

    await expect(connectPromise).rejects.toThrow("Invalid session ID");
  });

  test("connectWebSocket rejects when connection validation fails", async () => {
    const lifecycle = buildLifecycle();

    const state = createState({
      _validateConnectionForSubscriptions: vi.fn(() => false),
    });
    const connectPromise = lifecycle.connectWebSocket(state);

    state.ws.readyState = 1;
    state.ws.emit("open");
    state.ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          metadata: { message_type: "session_welcome" },
          payload: { session: { id: "test-session-789" } },
        }),
      ),
    );

    await expect(connectPromise).rejects.toThrow(
      "Connection validation failed before subscription setup",
    );
    await Promise.resolve();
    expect(
      state.emitCalls.some(
        (emittedEvent) =>
          emittedEvent.event === "eventSubSubscriptionFailed" &&
          eventHasPayload(emittedEvent) &&
          emittedEvent.payload.reason === "connection-validation",
      ),
    ).toBe(true);
    expect(state.subscriptionsReady).toBe(false);
    expect(state.scheduleReconnectCalls).toHaveLength(1);
  });

  test("connectWebSocket rejects when subscription setup throws", async () => {
    const lifecycle = buildLifecycle();

    const state = createState({
      _setupEventSubscriptions: vi.fn(async () => {
        throw new Error("API error");
      }),
    });
    const connectPromise = lifecycle.connectWebSocket(state);

    state.ws.readyState = 1;
    state.ws.emit("open");
    state.ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          metadata: { message_type: "session_welcome" },
          payload: { session: { id: "test-session-error" } },
        }),
      ),
    );

    await expect(connectPromise).rejects.toThrow("API error");
    await Promise.resolve();
    expect(state.subscriptionsReady).toBe(false);
    expect(state.scheduleReconnectCalls).toHaveLength(1);
    expect(
      state.emitCalls.some(
        (emittedEvent) =>
          emittedEvent.event === "eventSubSubscriptionFailed" &&
          eventHasPayload(emittedEvent) &&
          emittedEvent.payload.error === "API error",
      ),
    ).toBe(true);
  });

  test("connectWebSocket rejects on message parse error", async () => {
    const lifecycle = buildLifecycle();

    const state = createState();
    const connectPromise = lifecycle.connectWebSocket(state);

    state.ws.readyState = 1;
    state.ws.emit("open");
    state.ws.emit("message", Buffer.from("not valid json"));

    await expect(connectPromise).rejects.toThrow();
    expect(state.logEventSubErrorCalls).toHaveLength(1);
    const parseErrorLog = requireEventSubErrorCall(state.logEventSubErrorCalls[0]);
    expect(parseErrorLog.msg).toBe(
      "EventSub message/setup failed",
    );
    expect(parseErrorLog.type).toBe("ws-message");
    expect(String(parseErrorLog.err)).toContain("Invalid EventSub frame JSON");
    expect(String(parseErrorLog.err)).not.toContain("not valid json");
  });

  test("connectWebSocket logs session establishment without the full session id", async () => {
    const lifecycle = buildLifecycle();
    const logger = createRecordingLogger();
    const state = createState({ logger });
    const connectPromise = lifecycle.connectWebSocket(state);

    state.ws.readyState = 1;
    state.ws.emit("open");
    state.ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          metadata: { message_type: "session_welcome" },
          payload: { session: { id: "test-session-sensitive-123", keepalive_timeout_seconds: 30 } },
        }),
      ),
    );

    await connectPromise;
    const serializedLogs = JSON.stringify(logger.entries);
    expect(state.sessionId).toBe("test-session-sensitive-123");
    expect(serializedLogs).toContain("hasSessionId");
    expect(serializedLogs).not.toContain("test-session-sensitive-123");
  });

  test("handleReconnectRequest logs reconnect URLs without query strings", () => {
    const lifecycle = buildLifecycle();
    const logger = createRecordingLogger();
    const state = createState({ logger });

    lifecycle.handleReconnectRequest(state, {
      session: {
        reconnect_url: "wss://eventsub.wss.twitch.tv/ws?token=test-reconnect-token#secret-fragment",
      },
    });

    const serializedLogs = JSON.stringify(logger.entries);
    expect(state.reconnectUrl).toBe("wss://eventsub.wss.twitch.tv/ws?token=test-reconnect-token#secret-fragment");
    expect(serializedLogs).toContain("wss://eventsub.wss.twitch.tv/ws");
    expect(serializedLogs).not.toContain("test-reconnect-token");
    expect(serializedLogs).not.toContain("secret-fragment");
  });

  test("connectWebSocket rejects on WebSocket error before connection resolved", async () => {
    const lifecycle = buildLifecycle();

    const state = createState();
    const connectPromise = lifecycle.connectWebSocket(state);

    const wsError = Object.assign(new Error("Connection refused"), {
      code: "ECONNREFUSED",
    });
    state.ws.emit("error", wsError);

    await expect(connectPromise).rejects.toThrow("Connection refused");
  });

  test("connectWebSocket does not manually send pong frames on ping", () => {
    const lifecycle = buildLifecycle();

    const state = createState();
    lifecycle.connectWebSocket(state);

    const pingData = Buffer.from("ping-data");
    state.ws.emit("ping", pingData);

    expect(state.ws.pongCalls).toHaveLength(0);
  });

  test("connectWebSocket handles pong event", () => {
    const lifecycle = buildLifecycle();

    const state = createState();
    lifecycle.connectWebSocket(state);

    expect(() => state.ws.emit("pong")).not.toThrow();
  });

  test("connectWebSocket rejects on abnormal close during handshake", async () => {
    const lifecycle = buildLifecycle();

    const state = createState();
    const connectPromise = lifecycle.connectWebSocket(state);

    state.ws.emit("close", 1006, "abnormal");

    await expect(connectPromise).rejects.toThrow(
      "Connection closed abnormally during initial handshake",
    );
  });

  test("connectWebSocket rejects on non-abnormal close during handshake", async () => {
    const lifecycle = buildLifecycle();

    const state = createState();
    const connectPromise = lifecycle.connectWebSocket(state);

    state.ws.emit("close", 1000, "normal");

    await expect(connectPromise).rejects.toThrow(
      "Connection closed before EventSub startup completed",
    );
  });

  test("connectWebSocket classifies close after welcome frame as subscription setup even before handler completes", async () => {
    const lifecycle = buildLifecycle();

    let resolveMessage: () => void = () => {};
    const messageHandlingPromise = new Promise<void>((resolve) => {
      resolveMessage = resolve;
    });
    const state = createState({
      _setupEventSubscriptions: vi.fn(async () => { await messageHandlingPromise; return { failures: [] }; }),
    });
    const connectPromise = lifecycle.connectWebSocket(state);

    state.ws.readyState = 1;
    state.ws.emit("open");
    state.ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          metadata: { message_type: "session_welcome" },
          payload: { session: { id: "welcome-before-handler-complete" } },
        }),
      ),
    );
    await Promise.resolve();

    state.ws.emit("close", 1006, "abnormal");

    await expect(connectPromise).rejects.toThrow(
      "Connection closed abnormally during EventSub subscription setup",
    );

    resolveMessage();
    await Promise.resolve();
  });

  test("connectWebSocket stops deferred subscription failure handling after startup already failed", async () => {
    const lifecycle = buildLifecycle();

    let resolveSubscriptions: (value: SubscriptionSetupResult) => void = () => {};
    const setupPromise = new Promise<SubscriptionSetupResult>((resolve) => {
      resolveSubscriptions = resolve;
    });

    const state = createState({
      _setupEventSubscriptions: vi.fn(async () => setupPromise),
      isInitialized: false,
    });
    const connectPromise = lifecycle.connectWebSocket(state);

    state.ws.readyState = 1;
    state.ws.emit("open");
    state.ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          metadata: { message_type: "session_welcome" },
          payload: { session: { id: "startup-close-session" } },
        }),
      ),
    );
    await Promise.resolve();
    await Promise.resolve();

    state.ws.emit("close", 1006, "abnormal");

    await expect(connectPromise).rejects.toThrow(
      "Connection closed abnormally during EventSub subscription setup",
    );

    resolveSubscriptions({ failures: [{ subscription: "Chat" }] });
    await Promise.resolve();
    await Promise.resolve();

    expect(
      state.emitCalls.filter(
        ({ event }) => event === "eventSubSubscriptionFailed",
      ),
    ).toHaveLength(0);
    expect(state.scheduleReconnectCalls).toHaveLength(0);
  });

  test("connectWebSocket stops deferred subscription success handling after startup already failed", async () => {
    const lifecycle = buildLifecycle();

    let resolveSubscriptions: (value: SubscriptionSetupResult) => void = () => {};
    const setupPromise = new Promise<SubscriptionSetupResult>((resolve) => {
      resolveSubscriptions = resolve;
    });

    const state = createState({
      _setupEventSubscriptions: vi.fn(async () => setupPromise),
      isInitialized: false,
    });
    const connectPromise = lifecycle.connectWebSocket(state);

    state.ws.readyState = 1;
    state.ws.emit("open");
    state.ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          metadata: { message_type: "session_welcome" },
          payload: { session: { id: "startup-close-success-session" } },
        }),
      ),
    );
    await Promise.resolve();
    await Promise.resolve();

    state.ws.emit("close", 1006, "abnormal");

    await expect(connectPromise).rejects.toThrow(
      "Connection closed abnormally during EventSub subscription setup",
    );

    resolveSubscriptions({ failures: [] });
    await Promise.resolve();
    await Promise.resolve();

    expect(state.subscriptionsReady).toBe(false);
    expect(
      state.emitCalls.filter(
        ({ event }) => event === "eventSubSubscriptionFailed",
      ),
    ).toHaveLength(0);
  });

  test("connectWebSocket emits eventSubDisconnected on close with various codes", async () => {
    const lifecycle = buildLifecycle();

    const state = createState({
      _setupEventSubscriptions: vi.fn(async () => ({ failures: [] })),
    });
    const connectPromise = lifecycle.connectWebSocket(state);

    state.ws.readyState = 1;
    state.ws.emit("open");
    state.ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          metadata: { message_type: "session_welcome" },
          payload: { session: { id: "close-test-session" } },
        }),
      ),
    );

    await connectPromise;

    state.ws.emit("close", 1000, "normal closure");

    expect(
      state.emitCalls.some(
        (emittedEvent) =>
          emittedEvent.event === "eventSubDisconnected" &&
          eventHasPayload(emittedEvent) &&
          emittedEvent.payload.code === 1000 &&
          emittedEvent.payload.abnormal === false &&
          emittedEvent.payload.willReconnect === true &&
          emittedEvent.payload.terminal === false,
      ),
    ).toBe(true);
    expect(state._isConnected).toBe(false);
    expect(state.sessionId).toBe(null);
  });

  test("connectWebSocket marks abnormal disconnects as reconnecting while session recovery is in progress", async () => {
    const lifecycle = buildLifecycle();

    const state = createState({
      _setupEventSubscriptions: vi.fn(async () => ({ failures: [] })),
      isInitialized: true,
    });
    const connectPromise = lifecycle.connectWebSocket(state);

    state.ws.readyState = 1;
    state.ws.emit("open");
    state.ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          metadata: { message_type: "session_welcome" },
          payload: { session: { id: "abnormal-close-session" } },
        }),
      ),
    );

    await connectPromise;
    state.ws.emit("close", 4003, "connection unused");

    expect(
      state.emitCalls.some(
        (emittedEvent) =>
          emittedEvent.event === "eventSubDisconnected" &&
          eventHasPayload(emittedEvent) &&
          emittedEvent.payload.code === 4003 &&
          emittedEvent.payload.willReconnect === true &&
          emittedEvent.payload.terminal === false,
      ),
    ).toBe(true);
  });

  test("connectWebSocket triggers reconnection on abnormal close when initialized", async () => {
    const lifecycle = buildLifecycle();

    const state = createState({
      _setupEventSubscriptions: vi.fn(async () => ({ failures: [] })),
      isInitialized: true,
      retryAttempts: 0,
      maxRetryAttempts: 5,
      retryDelay: 1000,
    });
    state._scheduleReconnect = () => lifecycle.scheduleReconnect(state);
    state._reconnect = () => lifecycle.reconnect(state);
    state._connectWebSocket = vi.fn(async () => {
      state._isConnected = true;
    });

    const connectPromise = lifecycle.connectWebSocket(state);

    state.ws.readyState = 1;
    state.ws.emit("open");
    state.ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          metadata: { message_type: "session_welcome" },
          payload: { session: { id: "reconnect-test-session" } },
        }),
      ),
    );

    await connectPromise;

    state._isConnected = false;
    state.ws.emit("close", 4003, "connection unused");

    await advanceTimersByTime(1100);

    expect(state._isConnected).toBe(true);
  });

  test("reconnect cleans up subscriptions for the session that just closed", async () => {
    const lifecycle = buildLifecycle();

    const state = createState({
      _setupEventSubscriptions: vi.fn(async () => ({ failures: [] })),
      isInitialized: true,
      retryAttempts: 0,
      maxRetryAttempts: 5,
      retryDelay: 1000,
      _deleteAllSubscriptions: vi.fn(async () => {}),
      _connectWebSocket: vi.fn(async () => {
        state._isConnected = true;
      }),
    });
    state._scheduleReconnect = () => lifecycle.scheduleReconnect(state);
    state._reconnect = () => lifecycle.reconnect(state);

    const connectPromise = lifecycle.connectWebSocket(state);

    state.ws.readyState = 1;
    state.ws.emit("open");
    state.ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          metadata: { message_type: "session_welcome" },
          payload: { session: { id: "closed-session-for-cleanup" } },
        }),
      ),
    );

    await connectPromise;
    state.ws.emit("close", 1006, "abnormal");
    expect(state.sessionId).toBeNull();

    await advanceTimersByTime(1100);

    expect(state._deleteAllSubscriptions).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "closed-session-for-cleanup",
    }));
    expect(state.disconnectedSessionId).toBeNull();
  });

  test("connectWebSocket handles various Twitch close codes", async () => {
    const closeCodes = [
      { code: 1001, reason: "going away" },
      { code: 4000, reason: "internal server error" },
      { code: 4001, reason: "client sent inbound traffic" },
      { code: 4002, reason: "client failed ping-pong" },
      { code: 4004, reason: "reconnect grace time expired" },
      { code: 4005, reason: "network timeout" },
      { code: 4006, reason: "network error" },
      { code: 9999, reason: "unknown code" },
    ];

    for (const { code } of closeCodes) {
      useRealTimers();
      useFakeTimers();
      setSystemTime(new Date("2025-01-15T12:00:00.000Z"));

      const lifecycle = buildLifecycle();

      const state = createState({
        _setupEventSubscriptions: vi.fn(async () => ({ failures: [] })),
        isInitialized: true,
      });
      const connectPromise = lifecycle.connectWebSocket(state);

      state.ws.readyState = 1;
      state.ws.emit("open");
      state.ws.emit(
        "message",
        Buffer.from(
          JSON.stringify({
            metadata: { message_type: "session_welcome" },
            payload: { session: { id: `session-${code}` } },
          }),
        ),
      );

      await advanceTimersByTime(2100);
      await connectPromise;
      state.ws.emit("close", code, "test reason");

      expect(
        state.emitCalls.some(
          (emittedEvent) =>
            emittedEvent.event === "eventSubDisconnected" &&
            eventHasPayload(emittedEvent) &&
            emittedEvent.payload.code === code &&
            emittedEvent.payload.abnormal === true,
        ),
      ).toBe(true);
    }
  });

  test("scheduleReconnect coalesces duplicate requests without shortening backoff", async () => {
    const lifecycle = buildLifecycle();

    const state = createState({
      retryAttempts: 0,
      maxRetryAttempts: 5,
      retryDelay: 5000,
    });
    state._reconnect = () => lifecycle.reconnect(state);
    state._connectWebSocket = vi.fn(async () => {
      state._isConnected = true;
    });

    lifecycle.scheduleReconnect(state);

    await advanceTimersByTime(1000);

    state.retryDelay = 2000;
    lifecycle.scheduleReconnect(state);

    await advanceTimersByTime(1400);
    expect(state._isConnected).toBe(false);
    await advanceTimersByTime(100);
    expect(state._isConnected).toBe(true);
  });

  test("reconnect skips when not initialized", async () => {
    const lifecycle = buildLifecycle();

    const state = createState({ isInitialized: false });
    await lifecycle.reconnect(state);

    expect(state.retryAttempts).toBe(0);
  });

  test("reconnect logs error when Twitch auth is not ready", async () => {
    const lifecycle = buildLifecycle();

    const state = createState({
      isInitialized: true,
      twitchAuth: { isReady: () => false },
    });

    await lifecycle.reconnect(state);

    const authErrorLog = requireEventSubErrorCall(
      state.logEventSubErrorCalls.find(
        (c) => c.msg === "Cannot reconnect - Twitch auth not ready",
      ),
    );
    expect(authErrorLog.type).toBe("reconnect-auth");
  });

  test("reconnect closes existing WebSocket before reconnecting", async () => {
    const lifecycle = buildLifecycle();

    const existingWs = new MockWebSocket("wss://test");
    existingWs.readyState = 1;

    const state = createState({
      isInitialized: true,
      ws: existingWs,
      sessionId: "old-session-id",
      _deleteAllSubscriptions: vi.fn(async () => {}),
      _connectWebSocket: vi.fn(async () => {}),
    });

    await lifecycle.reconnect(state);

    expect(state._deleteAllSubscriptions).toHaveBeenCalledTimes(1);
    expect(existingWs.closeCalls).toHaveLength(1);
    expect(requireCloseCall(existingWs.closeCalls[0])).toEqual({
      code: 1000,
      reason: "Session retired",
    });
  });

  test("session_reconnect handoff keeps old subscriptions until replacement connects", async () => {
    const lifecycle = buildLifecycle();
    const state = createState();
    state._connectWebSocket = () => lifecycle.connectWebSocket(state);
    state._reconnect = () => lifecycle.reconnect(state);
    const initial = lifecycle.connectWebSocket(state);
    const old = MockWebSocket.latest;
    const staleMessage = old.listeners('message')[0]!;
    old.readyState = 1;
    old.emit('message', JSON.stringify({ metadata: { message_type: 'session_welcome' }, payload: { session: { id: 'test-old' } } }));
    await initial;
    lifecycle.handleReconnectRequest(state, { session: { reconnect_url: 'wss://test.invalid/handoff' } });
    const replacement = MockWebSocket.latest;
    expect(old.closeCalls).toHaveLength(0);
    expect(state.sessionId).toBe('test-old');
    replacement.readyState = 1;
    replacement.emit('message', JSON.stringify({ metadata: { message_type: 'session_welcome' }, payload: { session: { id: 'test-new' } } }));
    await Promise.resolve();
    expect(old.closeCalls).toHaveLength(1);
    expect(state.sessionId).toBe('test-new');
    expect(state.subscriptionsReady).toBe(true);
    staleMessage({ toString() { throw new Error('test stale coercion'); } });
    expect(state.sessionId).toBe('test-new');
    expect(state.scheduleReconnectCalls).toHaveLength(0);
    lifecycle.dispose(state);
  });

  test("replacement session welcome preserves transferred subscriptions", async () => {
    const lifecycle = buildLifecycle();
    const state = createState({
      reconnectUrl: "wss://reconnect-session",
      sessionId: null,
      _setupEventSubscriptions: vi.fn(async () => ({ failures: [] })),
    });

    const connectPromise = lifecycle.connectWebSocket(state);
    const replacement = MockWebSocket.latest;
    replacement.readyState = 1;
    replacement.emit("open");
    replacement.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          metadata: { message_type: "session_welcome" },
          payload: {
            session: {
              id: "replacement-session-id",
              keepalive_timeout_seconds: 30,
            },
          },
        }),
      ),
    );

    await expect(connectPromise).resolves.toBeUndefined();
    expect(state._setupEventSubscriptions).not.toHaveBeenCalled();
    expect(state.sessionId).toBe("replacement-session-id");
    expect(state.subscriptionsReady).toBe(true);
  });

  test("reconnect continues when deleting prior session subscriptions fails", async () => {
    const lifecycle = buildLifecycle();

    const state = createState({
      isInitialized: true,
      sessionId: "old-session-id",
      _deleteAllSubscriptions: vi.fn(async () => {
        throw new Error("cleanup failed");
      }),
      _connectWebSocket: vi.fn(async () => {}),
    });

    await lifecycle.reconnect(state);

    const cleanupError = requireEventSubErrorCall(
      state.logEventSubErrorCalls.find((c) => c.type === "reconnect-cleanup"),
    );
    expect(cleanupError.type).toBe("reconnect-cleanup");
    expect(state._connectWebSocket).toHaveBeenCalledTimes(1);
  });

  test("reconnect retries on failure when attempts remain", async () => {
    const lifecycle = buildLifecycle();

    const state = createState({
      isInitialized: true,
      retryAttempts: 0,
      maxRetryAttempts: 3,
      retryDelay: 1000,
    });
    state._scheduleReconnect = () => lifecycle.scheduleReconnect(state);
    state._reconnect = () => lifecycle.reconnect(state);

    let shouldFail = true;
    state._connectWebSocket = vi.fn(async () => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("Connection failed");
      }
      state._isConnected = true;
    });

    await lifecycle.reconnect(state);

    expect(state.retryAttempts).toBe(1);
    expect(state._isConnected).toBe(false);

    await advanceTimersByTime(2100);

    expect(state._isConnected).toBe(true);
    expect(state.retryAttempts).toBe(0);
  });

  test("reconnect abandons and disables initialization after max attempts", async () => {
    const lifecycle = buildLifecycle();

    const state = createState({
      isInitialized: true,
      retryAttempts: 2,
      maxRetryAttempts: 3,
      _connectWebSocket: vi.fn(async () => {
        throw new Error("Connection failed");
      }),
    });

    await lifecycle.reconnect(state);

    expect(state.isInitialized).toBe(false);
    const abandonedLog = requireEventSubErrorCall(
      state.logEventSubErrorCalls.find(
        (c) => c.msg === "EventSub reconnection abandoned after maximum attempts",
      ),
    );
    expect(abandonedLog.type).toBe("reconnect-abandoned");
    expect(
      state.emitCalls.some(
        (emittedEvent) =>
          emittedEvent.event === "eventSubDisconnected" &&
          eventHasPayload(emittedEvent) &&
          emittedEvent.payload.willReconnect === false &&
          emittedEvent.payload.terminal === true,
      ),
    ).toBe(true);
  });

  test("reconnect resets retry attempts on success", async () => {
    const lifecycle = buildLifecycle();

    const state = createState({
      isInitialized: true,
      retryAttempts: 2,
      maxRetryAttempts: 5,
      _connectWebSocket: vi.fn(async () => {}),
    });

    await lifecycle.reconnect(state);

    expect(state.retryAttempts).toBe(0);
  });

  test("handleReconnectRequest ignores payload without reconnect_url", async () => {
    const lifecycle = buildLifecycle();

    const state = createState({
      retryAttempts: 0,
      maxRetryAttempts: 2,
      retryDelay: 1000,
      _connectWebSocket: vi.fn(async () => {
        state._isConnected = true;
      }),
    });
    lifecycle.handleReconnectRequest(state, { session: {} });

    expect(state.reconnectUrl).toBeUndefined();

    await advanceTimersByTime(1500);
    expect(state._isConnected).toBe(false);
  });
});
