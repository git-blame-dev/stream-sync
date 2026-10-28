import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { InnertubeService } from "../../../src/services/innertube-service";
import { InnertubeFactory as SDKFactory } from "../../../src/factories/innertube-factory";
import { useFakeTimers, useRealTimers, advanceTimersByTime, getTimerCount } from "../../helpers/bun-timers";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
};
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

type VideoInfo = { video: string };
type InnertubeInfoClient = {
  getInfo: (videoId: string, options?: Record<string, unknown>) => Promise<VideoInfo>;
};
type InnertubeFactory = {
  createWithTimeout: ReturnType<typeof createMockFn<[timeoutMs?: number], Promise<InnertubeInfoClient>>>;
};
type TimeoutCall = [Promise<unknown>, number, string];

const expectFirstTimeoutCall = (calls: unknown[][]): TimeoutCall => {
  const firstCall = calls[0];
  if (!firstCall) {
    throw new Error("Expected timeout call to be recorded");
  }
  expect(firstCall).toBeDefined();
  expect(firstCall).toHaveLength(3);

  const [promise, timeoutMs, operationName] = firstCall;
  expect(promise).toBeInstanceOf(Promise);
  expect(typeof timeoutMs).toBe("number");
  expect(typeof operationName).toBe("string");
  if (!(promise instanceof Promise) || typeof timeoutMs !== "number" || typeof operationName !== "string") {
    throw new Error("Expected timeout call arguments to match the timeout contract");
  }

  return [promise, timeoutMs, operationName];
};

describe("InnertubeService behavior", () => {
  let factory: InnertubeFactory;

  beforeEach(() => {
    factory = {
      createWithTimeout: createMockFn<
        [timeoutMs?: number],
        Promise<InnertubeInfoClient>
      >(async () => ({
        getInfo: createMockFn(async (_videoId: string) => ({ video: "info" })),
      })),
    };
  });

  afterEach(() => {
    restoreAllMocks();
  });

  test("reuses cached instances and tracks stats", async () => {
    const service = new InnertubeService(factory, { logger: noOpLogger });

    const first = await service.getSharedInstance("shared");
    const second = await service.getSharedInstance("shared");

    expect(first).toBe(second);
    expect(service.stats.cacheMisses).toBe(1);
    expect(service.stats.cacheHits).toBe(1);
    expect(service.stats.instancesCreated).toBe(1);
  });

  test("coalesces initialization without letting one cancelled waiter cancel others", async () => {
    let release!: (client: InnertubeInfoClient) => void;
    factory.createWithTimeout.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const service = new InnertubeService(factory, { logger: noOpLogger });
    const cancel = new AbortController();
    const a = service.withMetadataOperation({ signal: cancel.signal }, async client => client.getInfo("synthetic-a"));
    const rejected = a.catch(error => error);
    const b = service.withMetadataOperation({}, async client => client.getInfo("synthetic-b"));
    const c = service.withMetadataOperation({}, async client => client.getInfo("synthetic-c"));
    await Promise.resolve();
    cancel.abort(new Error("synthetic cancel"));
    release({ getInfo: async video => ({ video }) });
    expect(String(await rejected)).toContain("synthetic cancel");
    expect(await b).toEqual({ video: "synthetic-b" });
    expect(await c).toEqual({ video: "synthetic-c" });
    expect(factory.createWithTimeout.mock.calls).toHaveLength(1);
    await service.dispose();
  });

  test("passes timeout metadata when fetching video info", async () => {
    const timeoutCalls: TimeoutCall[] = [];
    const withTimeout = async <T>(
      promise: Promise<T>,
      timeoutMs: number,
      operationName: string,
    ): Promise<T> => {
      timeoutCalls.push([promise, timeoutMs, operationName]);
      return promise;
    };
    const service = new InnertubeService(factory, {
      logger: noOpLogger,
      withTimeout,
    });

    const result = await service.getVideoInfo("abc123", {
      timeout: 5000,
      instanceKey: "custom",
    });
    const cached = service.instanceCache.get("custom");

    expect(result).toEqual({ video: "info" });
    const [getInfoPromise, timeoutMs, operationName] = expectFirstTimeoutCall(timeoutCalls);
    expect(timeoutMs).toBe(5000);
    expect(operationName).toBe("YouTube getInfo call");
    await expect(getInfoPromise).resolves.toEqual({ video: "info" });
    expect(cached).toBeDefined();
    if (!cached) {
      throw new Error("Expected custom cached Innertube instance");
    }
    expect(cached.lastUsed).toBeGreaterThanOrEqual(cached.created);
  });

  test("cleans up stale instances", async () => {
    const service = new InnertubeService(factory, { logger: noOpLogger });
    await service.getSharedInstance("old");
    service.instanceCache.set("old", {
      instance: { getInfo: async () => ({ video: "stale" }) },
      created: 0,
      lastUsed: 0,
    });

    service.cleanup(1);

    expect(service.instanceCache.has("old")).toBe(false);
  });

  test("failed shared initialization is evicted and retried", async () => {
    factory.createWithTimeout.mockRejectedValueOnce(new Error("synthetic initialization failure"));
    const service = new InnertubeService(factory, { logger: noOpLogger });
    await expect(service.withMetadataOperation({}, async client => client.getInfo("synthetic"))).rejects.toThrow("synthetic initialization failure");
    expect(await service.withMetadataOperation({}, async client => client.getInfo("synthetic"))).toEqual({ video: "info" });
    expect(factory.createWithTimeout.mock.calls).toHaveLength(2);
    await service.dispose();
  });

  test("waiter deadline includes initialization but does not expire the shared initialization", async () => {
    let release!: (client: InnertubeInfoClient) => void;
    factory.createWithTimeout.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const service = new InnertubeService(factory, { logger: noOpLogger });
    const short = service.withMetadataOperation({ timeoutMs: 1 }, async client => client.getInfo("synthetic-short")).catch(error => error);
    const long = service.withMetadataOperation({}, async client => client.getInfo("synthetic-long"));
    expect(String(await short)).toContain("timed out");
    release({ getInfo: async video => ({ video }) });
    expect(await long).toEqual({ video: "synthetic-long" });
    expect(factory.createWithTimeout.mock.calls).toHaveLength(1);
    await service.dispose();
  });

  test("initialization fetch is outside caller scope and disposal aborts it", async () => {
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    let initSignal!: AbortSignal;
    const service = new InnertubeService({ createWithTimeout: async (_timeout, config) => {
      await (config!.fetch as (input: string) => Promise<Response>)("https://synthetic.invalid/init");
      return { getInfo: async (_videoId: string) => ({ video: "synthetic" }) };
    } }, { logger: noOpLogger, fetch: async (_input, init) => {
      initSignal = init!.signal!;
      entered();
      return new Promise((_resolve, reject) => initSignal.addEventListener("abort", () => reject(initSignal.reason), { once: true }));
    } });
    const cancel = new AbortController();
    const a = service.withMetadataOperation({ signal: cancel.signal }, async client => client.getInfo("synthetic-a")).catch(error => error);
    const b = service.withMetadataOperation({}, async client => client.getInfo("synthetic-b")).catch(error => error);
    await started;
    cancel.abort(new Error("synthetic A"));
    expect(String(await a)).toContain("synthetic A");
    expect(initSignal.aborted).toBe(false);
    await service.dispose();
    expect(String(await b)).toContain("disposed");
    expect(initSignal.aborted).toBe(true);
  });

  test("disposal during creation closes admission and prevents late publication", async () => {
    let release!: (client: InnertubeInfoClient) => void;
    factory.createWithTimeout.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const service = new InnertubeService(factory, { logger: noOpLogger });
    const pending = service.getSharedInstance().catch(error => error);
    await Promise.resolve();
    const disposal = service.dispose();
    expect(service.dispose()).toBe(disposal);
    release({ getInfo: async () => ({ video: "late" }) });
    await disposal;
    expect(await pending).toBeInstanceOf(Error);
    await Promise.resolve();
    expect(service.getStats().cachedInstances).toBe(0);
    expect(service.stats.instancesCreated).toBe(0);
    await expect(service.getSharedInstance()).rejects.toThrow("disposed");
  });

  test("disposal while SDK import is pending prevents late fetch admission and publication", async () => {
    let release!: (module: { Innertube: { create: (config?: Record<string, unknown>) => Promise<InnertubeInfoClient> } }) => void;
    let entered!: () => void;
    const importing = new Promise<void>(resolve => { entered = resolve; });
    SDKFactory.configure({ importer: () => {
      entered();
      return new Promise(resolve => { release = resolve; });
    } });
    let calls = 0;
    const service = new InnertubeService({ createWithTimeout: async (timeout, config) =>
      await SDKFactory.createWithTimeout(timeout, config) as InnertubeInfoClient
    }, { logger: noOpLogger, fetch: async () => { calls += 1; return Response.json({}); } });
    try {
      const pending = service.withMetadataOperation({}, async client => client.getInfo("synthetic")).catch(error => error);
      await importing;
      const disposal = service.dispose();
      let creationEntered!: () => void;
      const created = new Promise<void>(resolve => { creationEntered = resolve; });
      release({ Innertube: { create: async config => {
        try {
          await (config!.fetch as (input: string) => Promise<Response>)("https://synthetic.invalid/late");
        } finally { creationEntered(); }
        return { getInfo: async () => ({ video: "late" }) };
      } } });
      await created;
      await disposal;
      expect(String(await pending)).toContain("disposed");
      expect(calls).toBe(0);
      expect(service.stats.instancesCreated).toBe(0);
      expect(service.getStats().cachedInstances).toBe(0);
    } finally {
      await service.dispose();
      SDKFactory.configure();
    }
  });

  test("owned fetch scopes entire body chains, preserves incoming signals and isolates chat owners", async () => {
    type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    const fetches: Fetch[] = [];
    const seen: AbortSignal[] = [];
    let bodyEntered!: () => void;
    const entered = new Promise<void>(resolve => { bodyEntered = resolve; });
    const external: Fetch = async (_input, init) => {
      const signal = init!.signal!;
      seen.push(signal);
      return new Response(new ReadableStream({ start(controller) {
        signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
        bodyEntered();
      } }));
    };
    const service = new InnertubeService({ createWithTimeout: async (_timeout, config) => {
      const fetch = config!.fetch as Fetch;
      fetches.push(fetch);
      expect(config!.retrieve_player).toBe(false);
      return { getInfo: async (_videoId: string) => (await fetch("https://synthetic.invalid/info")).json() };
    } }, { logger: noOpLogger, fetch: external });
    const cancel = new AbortController();
    const operation = service.withMetadataOperation({ signal: cancel.signal }, async client => client.getInfo("synthetic")).catch(error => error);
    await entered;
    cancel.abort(new Error("synthetic operation cancelled"));
    expect(String(await operation)).toContain("synthetic operation cancelled");
    expect(seen[0]!.aborted).toBe(true);
    const a = await service.createChatClient();
    const b = await service.createChatClient();
    expect(a.client).not.toBe(b.client);
    const aPending = a.run(client => client.getInfo("synthetic-a")).catch(error => error);
    const bPending = b.run(client => client.getInfo("synthetic-b")).catch(error => error);
    await Promise.resolve();
    await a.dispose();
    expect(String(await aPending)).toContain("disposed");
    expect(seen[2]!.aborted).toBe(false);
    await b.dispose();
    expect(String(await bPending)).toContain("disposed");
    for (const which of ["request", "init"] as const) {
      const request = new AbortController(), init = new AbortController();
      const read = (await fetches[0]!(new Request("https://synthetic.invalid/request", { signal: request.signal }), { signal: init.signal })).text().catch(error => error);
      (which === "request" ? request : init).abort(new Error(`synthetic ${which}`));
      expect((await read).message).toBe(`synthetic ${which}`);
    }
    await service.dispose();
    const calls = seen.length;
    expect(() => fetches[0]!("https://synthetic.invalid/closed")).toThrow("disposed");
    expect(seen).toHaveLength(calls);
  });

  test("chat creation cancelled during initialization retires its owner", async () => {
    let release!: (client: InnertubeInfoClient) => void;
    factory.createWithTimeout.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const service = new InnertubeService(factory, { logger: noOpLogger });
    const cancel = new AbortController();
    const pending = service.createChatClient({ signal: cancel.signal }).catch(error => error);
    await Promise.resolve();
    cancel.abort(new Error("synthetic chat cancelled"));
    expect((await pending).message).toBe("synthetic chat cancelled");
    release({ getInfo: async () => ({ video: "late" }) });
    await service.dispose();
  });

  test("tracks error stats and throws on factory failure", async () => {
    const error = new Error("boom");
    factory.createWithTimeout.mockRejectedValue(error);
    const service = new InnertubeService(factory, { logger: noOpLogger });

    await expect(service.getSharedInstance("fail")).rejects.toThrow(
      "InnertubeService instance creation failed",
    );
    expect(service.stats.errors).toBe(1);
  });

  for (const kind of ["metadata", "chat"] as const) {
    test(`${kind} retirement awaits cooperative callback finally cleanup, not just caller rejection`, async () => {
      const started = deferred(), cleaning = deferred(), finish = deferred();
      let redispose!: () => Promise<void>;
      let reentrant: Promise<void> | undefined;
      const service = new InnertubeService({ createWithTimeout: async (_timeout, config) => ({
        getInfo: async (_videoId: string) => (await (config!.fetch as (input: string) => Promise<Response>)("https://synthetic.invalid/cleanup")).json()
      }) }, { logger: noOpLogger, fetch: async (_input, init) => {
        started.resolve();
        return new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => {
          reentrant = redispose();
          reject(init!.signal!.reason);
        }, { once: true }));
      } });
      const chat = kind === "chat" ? await service.createChatClient() : undefined;
      redispose = chat ? () => chat.dispose() : () => service.dispose();
      const operation = async (client: { getInfo: (id: string) => Promise<unknown> }) => {
        try { await client.getInfo("synthetic"); }
        finally { cleaning.resolve(); await finish.promise; }
      };
      const caller = (chat ? chat.run(operation) : service.withMetadataOperation({}, operation)).catch(error => error);
      await started.promise;
      const ownerDisposal = chat?.dispose();
      if (chat) expect(chat.dispose()).toBe(ownerDisposal!);
      const disposal = service.dispose();
      expect(service.dispose()).toBe(disposal);
      expect(reentrant).toBe(chat ? ownerDisposal! : disposal);
      let disposed = false;
      void disposal.then(() => { disposed = true; });
      expect(String(await caller)).toContain("disposed");
      await cleaning.promise;
      await flush();
      try {
        expect(disposed).toBe(false);
        expect(() => service.withMetadataOperation({}, operation)).toThrow("disposed");
        if (chat) expect(() => chat.run(operation)).toThrow("disposed");
      } finally { finish.resolve(); await disposal; await ownerDisposal; }
      expect(disposed).toBe(true);
    });
  }

  for (const kind of ["metadata", "chat"] as const) test(`uncooperative ${kind} callback retirement is bounded at exactly five seconds and diagnosed`, async () => {
    useFakeTimers();
    const errors: unknown[][] = [];
    const service = new InnertubeService(factory, { logger: { ...noOpLogger, error: (...args) => { errors.push(args); } } });
    const started = deferred();
    const chat = kind === "chat" ? await service.createChatClient() : undefined;
    const operation = async () => {
      started.resolve();
      return await new Promise<never>(() => {});
    };
    const caller = (chat ? chat.run(operation) : service.withMetadataOperation({}, operation)).catch(error => error);
    try {
      await started.promise;
      const nativeDeadlineTimers = getTimerCount();
      const disposal = service.dispose();
      expect(service.dispose()).toBe(disposal);
      let disposed = false;
      void disposal.then(() => { disposed = true; });
      expect(String(await caller)).toContain("disposed");
      await flush();
      advanceTimersByTime(4999); await flush();
      expect(disposed).toBe(false);
      advanceTimersByTime(1); await disposal;
      expect(disposed).toBe(true);
      expect(errors).toEqual([["Innertube retirement deadline exceeded after 5000ms; 1 operations may still be running", "innertube-service"]]);
      expect(service.getStats().retirementTimeouts).toBe(1);
      expect(getTimerCount()).toBe(nativeDeadlineTimers);
      advanceTimersByTime(5000); await flush();
      expect(getTimerCount()).toBe(0);
      expect(service.getStats().cachedInstances).toBe(0);
    } finally { useRealTimers(); }
  });

  test("raw creation and external fetch cooperative cleanup are both awaited", async () => {
    const started = deferred(), fetchCleaning = deferred(), fetchFinish = deferred(), createCleaning = deferred(), createFinish = deferred();
    const service = new InnertubeService({
      createWithTimeout: async () => { throw new Error("must use raw creation, not factory timeout race"); },
      createWithConfig: async config => {
        try { await (config!.fetch as (input: string) => Promise<Response>)("https://synthetic.invalid/initializing"); }
        finally { createCleaning.resolve(); await createFinish.promise; }
        return { getInfo: async (_videoId: string) => ({ video: "synthetic" }) };
      }
    }, { logger: noOpLogger, fetch: async (_input, init) => {
      try {
        started.resolve();
        return await new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true }));
      } finally { fetchCleaning.resolve(); await fetchFinish.promise; }
    } });
    const caller = service.createChatClient().catch(error => error);
    await started.promise;
    const disposal = service.dispose();
    let disposed = false;
    void disposal.then(() => { disposed = true; });
    try {
      expect(String(await caller)).toContain("disposed");
      await fetchCleaning.promise; await createCleaning.promise; await flush();
      expect(disposed).toBe(false);
      createFinish.resolve(); await flush();
      expect(disposed).toBe(false);
    } finally { createFinish.resolve(); fetchFinish.resolve(); await disposal; }
    expect(service.stats.instancesCreated).toBe(0);
    expect(service.stats.retirementTimeouts).toBe(0);
  });

  test("raw creation beyond the retirement bound cannot publish on late completion", async () => {
    useFakeTimers();
    let release!: (client: InnertubeInfoClient) => void;
    const started = deferred();
    const service = new InnertubeService({
      createWithTimeout: factory.createWithTimeout,
      createWithConfig: () => { started.resolve(); return new Promise<InnertubeInfoClient>(resolve => { release = resolve; }); }
    }, { logger: noOpLogger });
    try {
      const caller = service.getSharedInstance().catch(error => error);
      await started.promise;
      const disposal = service.dispose();
      expect(String(await caller)).toContain("disposed");
      await flush(); advanceTimersByTime(5000); await disposal;
      expect(service.stats.retirementTimeouts).toBe(1);
      release({ getInfo: async () => ({ video: "synthetic-late" }) });
      await flush();
      expect(service.stats.instancesCreated).toBe(0);
      expect(service.getStats().cachedInstances).toBe(0);
      expect(factory.createWithTimeout.mock.calls).toHaveLength(0);
      advanceTimersByTime(5000); await flush();
      expect(getTimerCount()).toBe(0);
    } finally { useRealTimers(); }
  });

  test("legacy timeout wrappers cannot hide underlying SDK getInfo cleanup", async () => {
    const started = deferred(), cleaning = deferred(), finish = deferred();
    const service = new InnertubeService({ createWithTimeout: async (_timeout, config) => ({
      getInfo: async (_videoId: string) => {
        try { return await (await (config!.fetch as (input: string) => Promise<Response>)("https://synthetic.invalid/legacy")).json(); }
        finally { cleaning.resolve(); await finish.promise; }
      }
    }) }, { logger: noOpLogger,
      withTimeout: async () => { throw new Error("synthetic legacy timeout"); },
      fetch: async (_input, init) => new Response(new ReadableStream({ start(controller) {
        init!.signal!.addEventListener("abort", () => controller.error(init!.signal!.reason), { once: true });
        started.resolve();
      } }))
    });
    const caller = service.getVideoInfo("synthetic").catch(error => error);
    await started.promise;
    expect(String(await caller)).toContain("synthetic legacy timeout");
    const disposal = service.dispose();
    let disposed = false;
    void disposal.then(() => { disposed = true; });
    try {
      await cleaning.promise; await flush();
      expect(disposed).toBe(false);
    } finally { finish.resolve(); await disposal; }
  });
});
