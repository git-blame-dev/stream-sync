import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { InnertubeService } from "../../../src/services/innertube-service";
import { InnertubeFactory as SDKFactory } from "../../../src/factories/innertube-factory";
import { useFakeTimers, useRealTimers, advanceTimersByTime, getTimerCount } from "../../helpers/bun-timers";
import { setTimeout as delay } from "node:timers/promises";

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

  test("reuses the metadata owner and reports initialization and reuse separately", async () => {
    const service = new InnertubeService(factory, { logger: noOpLogger });

    const first = await service.withMetadataOperation({}, client => client.getInfo("synthetic-first"));
    const second = await service.withMetadataOperation({}, client => client.getInfo("synthetic-second"));

    expect(first).toEqual({ video: "info" });
    expect(second).toEqual({ video: "info" });
    expect(factory.createWithTimeout.mock.calls).toHaveLength(1);
    const chat = await service.createChatClient();
    expect(service.getStats()).toMatchObject({ metadataInitializations: 1, metadataReuses: 1, instancesCreated: 2 });
    await chat.dispose();
    await service.dispose();
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
    let callbacks = 0;
    const operation = async () => { callbacks += 1; return true; };
    const pending = service.withMetadataOperation({}, operation).catch(error => error);
    await Promise.resolve();
    const disposal = service.dispose();
    expect(service.dispose()).toBe(disposal);
    release({ getInfo: async () => ({ video: "late" }) });
    await disposal;
    expect(await pending).toBeInstanceOf(Error);
    await Promise.resolve();
    expect(callbacks).toBe(0);
    expect(service.stats.instancesCreated).toBe(0);
    expect(() => service.withMetadataOperation({}, operation)).toThrow("disposed");
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
      expect(() => service.withMetadataOperation({}, async () => true)).toThrow("disposed");
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

  test("preserves the original factory failure without publishing a successful initialization", async () => {
    const error = new Error("boom");
    factory.createWithTimeout.mockRejectedValue(error);
    const service = new InnertubeService(factory, { logger: noOpLogger });

    await expect(service.withMetadataOperation({}, client => client.getInfo("synthetic"))).rejects.toBe(error);
    expect(service.getStats()).toMatchObject({ metadataInitializations: 1, instancesCreated: 0 });
    await service.dispose();
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
      expect(() => service.withMetadataOperation({}, async () => true)).toThrow("disposed");
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
      let callbacks = 0;
      const operation = async () => { callbacks += 1; return true; };
      const caller = service.withMetadataOperation({}, operation).catch(error => error);
      await started.promise;
      const disposal = service.dispose();
      expect(String(await caller)).toContain("disposed");
      await flush(); advanceTimersByTime(5000); await disposal;
      expect(service.stats.retirementTimeouts).toBe(1);
      release({ getInfo: async () => ({ video: "synthetic-late" }) });
      await flush();
      expect(service.stats.instancesCreated).toBe(0);
      expect(callbacks).toBe(0);
      expect(factory.createWithTimeout.mock.calls).toHaveLength(0);
      advanceTimersByTime(5000); await flush();
      expect(getTimerCount()).toBe(0);
    } finally { useRealTimers(); }
  });

  test("metadata caller rejection cannot hide underlying SDK getInfo finally cleanup", async () => {
    const started = deferred(), cleaning = deferred(), finish = deferred();
    const service = new InnertubeService({ createWithTimeout: async (_timeout, config) => ({
      getInfo: async (_videoId: string) => {
        try { return await (await (config!.fetch as (input: string) => Promise<Response>)("https://synthetic.invalid/legacy")).json(); }
        finally { cleaning.resolve(); await finish.promise; }
      }
    }) }, { logger: noOpLogger,
      fetch: async (_input, init) => new Response(new ReadableStream({ start(controller) {
        init!.signal!.addEventListener("abort", () => controller.error(init!.signal!.reason), { once: true });
        started.resolve();
      } }))
    });
    const cancel = new AbortController();
    const reason = new Error("synthetic metadata cancellation");
    const caller = service.withMetadataOperation({ signal: cancel.signal }, client => client.getInfo("synthetic")).catch(error => error);
    await started.promise;
    cancel.abort(reason);
    expect(await caller).toBe(reason);
    const disposal = service.dispose();
    let disposed = false;
    void disposal.then(() => { disposed = true; });
    try {
      await cleaning.promise; await flush();
      expect(disposed).toBe(false);
    } finally { finish.resolve(); await disposal; }
  });

  const bodyService = (requestTimeoutMs = 8000) => {
    const signals = new Map<string, AbortSignal>();
    const service = new InnertubeService({ createWithTimeout: async (_timeout, config) => ({
      getInfo: async (id: string) => (await (config!.fetch as (input: string) => Promise<Response>)(`https://synthetic.invalid/${id}`)).json()
    }) }, { logger: noOpLogger, requestTimeoutMs, fetch: async (input, init) => {
      const id = new URL(String(input)).pathname.slice(1);
      signals.set(id, init!.signal!);
      return new Response(new ReadableStream({ start(controller) {
        init!.signal!.addEventListener("abort", () => controller.error(init!.signal!.reason), { once: true });
      } }));
    } });
    return { service, signals };
  };

  test("metadata operation timeout covers SDK response-body continuation without retiring the shared owner", async () => {
    const { service, signals } = bodyService();
    const caller = service.withMetadataOperation({ timeoutMs: 20 }, client => client.getInfo("metadata-timed")).catch(error => error);
    try {
      await flush();
      expect(signals.get("metadata-timed")!.aborted).toBe(false);
      await delay(50);
      expect(signals.get("metadata-timed")!.aborted).toBe(true);
      expect(await caller).toBeInstanceOf(Error);
      expect(await service.withMetadataOperation({}, async () => "alive")).toBe("alive");
      expect(service.getStats()).toMatchObject({ instancesCreated: 1, metadataInitializations: 1, metadataReuses: 1 });
    } finally { await service.dispose(); await caller; }
  });

  test("explicit chat scope aborts its response body without retiring polling, metadata or another owner", async () => {
    const { service, signals } = bodyService();
    const chat = await service.createChatClient(), other = await service.createChatClient();
    const cancel = new AbortController();
    const scoped = chat.run(client => client.getInfo("scoped"), { signal: cancel.signal }).catch(error => error);
    const polling = chat.run(client => client.getInfo("polling")).catch(error => error);
    const independent = other.run(client => client.getInfo("other")).catch(error => error);
    const metadata = service.withMetadataOperation({}, client => client.getInfo("metadata")).catch(error => error);
    try {
      await flush();
      expect(signals.size).toBe(4);
      cancel.abort(new Error("synthetic setup cancelled"));
      await flush();
      expect(signals.get("scoped")!.aborted).toBe(true);
      expect(String(await scoped)).toContain("synthetic setup cancelled");
      for (const id of ["polling", "other", "metadata"]) expect(signals.get(id)!.aborted).toBe(false);
      expect(await chat.run(async () => "still admitted")).toBe("still admitted");
    } finally { await service.dispose(); await Promise.all([scoped, polling, independent, metadata]); }
  });

  test("explicit timeout covers response-body continuation without closing the owner", async () => {
    const { service, signals } = bodyService();
    const chat = await service.createChatClient();
    const caller = chat.run(client => client.getInfo("timed"), { timeoutMs: 20 }).catch(error => error);
    try {
      await flush();
      expect(signals.get("timed")!.aborted).toBe(false);
      await delay(50);
      expect(signals.get("timed")!.aborted).toBe(true);
      expect(await caller).toBeInstanceOf(Error);
      expect(await chat.run(async () => "alive")).toBe("alive");
    } finally { await service.dispose(); await caller; }
  });

  test("default nested run escapes expired metadata and explicit chat scopes", async () => {
    const { service, signals } = bodyService();
    const chat = await service.createChatClient();
    const cancel = new AbortController();
    const background: Promise<unknown>[] = [];
    try {
      await service.withMetadataOperation({ signal: cancel.signal, timeoutMs: 20 }, async () => {
        await chat.run(async () => {
          background.push(chat.run(client => client.getInfo("escaped")).catch(error => error));
          await flush();
        }, { signal: cancel.signal, timeoutMs: 20 });
      });
      cancel.abort(new Error("synthetic outer scope finished"));
      await delay(50);
      expect(signals.get("escaped")!.aborted).toBe(false);
    } finally { await service.dispose(); await Promise.all(background); }
  });

  test("scoped caller cancellation is prompt but repeated owner disposal joins actual finally cleanup", async () => {
    const { service, signals } = bodyService();
    const chat = await service.createChatClient();
    const cancel = new AbortController(), cleaning = deferred(), finish = deferred();
    const caller = chat.run(async client => {
      try { await client.getInfo("cleanup-scoped"); }
      finally { cleaning.resolve(); await finish.promise; }
    }, { signal: cancel.signal }).catch(error => error);
    try {
      await flush();
      cancel.abort(new Error("synthetic scoped cancellation"));
      await flush();
      expect(signals.get("cleanup-scoped")!.aborted).toBe(true);
      expect(String(await caller)).toContain("synthetic scoped cancellation");
      await cleaning.promise;
      const disposal = chat.dispose();
      expect(chat.dispose()).toBe(disposal);
      let retired = false;
      void disposal.then(() => { retired = true; });
      await flush();
      expect(retired).toBe(false);
      finish.resolve();
      await disposal;
      expect(retired).toBe(true);
    } finally { finish.resolve(); await service.dispose(); await caller; }
  });

  test("pre-aborted and closed scoped admission never invokes the SDK callback", async () => {
    const service = new InnertubeService(factory, { logger: noOpLogger });
    const chat = await service.createChatClient();
    const cancel = new AbortController();
    cancel.abort(new Error("synthetic already aborted"));
    let calls = 0;
    const operation = async () => { calls++; };
    try {
      expect(() => chat.run(operation, { signal: cancel.signal })).toThrow("synthetic already aborted");
      await flush();
      expect(calls).toBe(0);
      await chat.dispose();
      expect(() => chat.run(operation, {})).toThrow("disposed");
      expect(calls).toBe(0);
    } finally { await service.dispose(); }
  });

  test("explicit empty context defaults to request deadline while omitted context has no operation deadline", async () => {
    const service = new InnertubeService(factory, { logger: noOpLogger, requestTimeoutMs: 20 });
    const chat = await service.createChatClient(), finish = deferred();
    let scopedRejected = false, pollingSettled = false;
    const scoped = chat.run(() => finish.promise, {}).catch(() => { scopedRejected = true; });
    const polling = chat.run(() => finish.promise).finally(() => { pollingSettled = true; });
    try {
      await delay(50);
      expect(scopedRejected).toBe(true);
      expect(pollingSettled).toBe(false);
    } finally { finish.resolve(); await Promise.all([scoped, polling]); await service.dispose(); }
  });

  test("nested explicit scopes retain owner cancellation and join the inner callback finally", async () => {
    const { service, signals } = bodyService();
    const chat = await service.createChatClient(), finish = deferred(), cleaning = deferred();
    const caller = chat.run(() => chat.run(async client => {
      try { await client.getInfo("nested"); }
      finally { cleaning.resolve(); await finish.promise; }
    }, {}), {}).catch(error => error);
    try {
      await flush();
      const disposal = chat.dispose();
      expect(signals.get("nested")!.aborted).toBe(true);
      expect(String(await caller)).toContain("disposed");
      await cleaning.promise;
      let retired = false;
      void disposal.then(() => { retired = true; });
      await flush();
      expect(retired).toBe(false);
      finish.resolve(); await disposal;
      expect(retired).toBe(true);
    } finally { finish.resolve(); await service.dispose(); await caller; }
  });

  test("abort between scoped admission and callback microtask prevents SDK side effects", async () => {
    const service = new InnertubeService(factory, { logger: noOpLogger });
    const chat = await service.createChatClient(), cancel = new AbortController();
    let calls = 0;
    const caller = chat.run(async () => { calls++; }, { signal: cancel.signal }).catch(error => error);
    cancel.abort(new Error("synthetic queued cancellation"));
    try {
      expect(String(await caller)).toContain("synthetic queued cancellation");
      await flush();
      expect(calls).toBe(0);
    } finally { await service.dispose(); }
  });

  test("default run applies its synchronous prelude before the SDK selects its next continuation", async () => {
    const service = new InnertubeService(factory, { logger: noOpLogger });
    const owner = await service.createChatClient();
    let continuation = "synthetic-top";
    const operation = owner.run(async () => { continuation = "synthetic-live"; });
    void operation.catch(() => {});
    try {
      expect(continuation).toBe("synthetic-live");
      await operation;
    } finally { await service.dispose(); }
  });

  test("default synchronous callback failure is an observed promise rejection, not an admission throw", async () => {
    const service = new InnertubeService(factory, { logger: noOpLogger });
    const owner = await service.createChatClient();
    const failure = new Error("synthetic callback failure");
    let caller: Promise<unknown> | undefined;
    try {
      expect(() => { caller = owner.run(() => { throw failure; }); }).not.toThrow();
      await expect(caller).rejects.toBe(failure);
      expect(await owner.run(async () => "still admitted")).toBe("still admitted");
    } finally { await service.dispose(); }
  });

  test("default run publishes actual completion before reentrant disposal and joins asynchronous finally", async () => {
    const service = new InnertubeService(factory, { logger: noOpLogger });
    const owner = await service.createChatClient();
    const cleaning = deferred(), finish = deferred();
    let disposal: Promise<void> | undefined;
    const caller = owner.run(async () => {
      disposal = owner.dispose();
      try { await Promise.resolve(); }
      finally { cleaning.resolve(); await finish.promise; }
    }).catch(error => error);
    try {
      expect(disposal).toBeInstanceOf(Promise);
      expect(owner.dispose()).toBe(disposal!);
      expect(String(await caller)).toContain("disposed");
      await cleaning.promise;
      let retired = false;
      void disposal!.then(() => { retired = true; });
      await flush();
      expect(retired).toBe(false);
      finish.resolve(); await disposal;
      expect(retired).toBe(true);
      expect(service.stats.retirementTimeouts).toBe(0);
    } finally { finish.resolve(); await service.dispose(); await caller; }
  });

  test("begin handle keeps prompt ready rejection separate from unpublished initializer retirement", async () => {
    const started = deferred(), cleaning = deferred(), finish = deferred();
    const cancel = new AbortController();
    const service = new InnertubeService({ createWithTimeout: async (_timeout, config) => {
      try { await (await (config!.fetch as (input: string) => Promise<Response>)("https://synthetic.invalid/initializing")).json(); }
      finally { cleaning.resolve(); await finish.promise; }
      return { getInfo: async () => ({ video: "synthetic" }) };
    } }, { logger: noOpLogger, fetch: async (_input, init) => new Response(new ReadableStream({ start(controller) {
      init!.signal!.addEventListener("abort", () => controller.error(init!.signal!.reason), { once: true });
      started.resolve();
    } })) });
    const creation = service.beginChatClient({ signal: cancel.signal });
    const caller = creation.ready.catch(error => error);
    try {
      await started.promise;
      cancel.abort(new Error("synthetic creation cancelled"));
      expect(String(await caller)).toContain("synthetic creation cancelled");
      await cleaning.promise;
      const disposal = creation.dispose();
      expect(creation.dispose()).toBe(disposal);
      let retired = false;
      void disposal.then(() => { retired = true; });
      await flush();
      expect(retired).toBe(false);
      finish.resolve(); await disposal;
      expect(retired).toBe(true);
      expect(service.stats.instancesCreated).toBe(0);
    } finally { finish.resolve(); await creation.dispose(); await service.dispose(); }
  });

  test("begin publishes disposal before the initialization microtask and never starts a retired SDK client", async () => {
    const service = new InnertubeService(factory, { logger: noOpLogger });
    const creation = service.beginChatClient();
    const disposal = creation.dispose();
    expect(creation.dispose()).toBe(disposal);
    await expect(creation.ready).rejects.toThrow("disposed");
    await disposal;
    expect(factory.createWithTimeout).not.toHaveBeenCalled();
    expect(service.stats.instancesCreated).toBe(0);
    await service.dispose();
  });

  test("published owner and creation handle share the same disposer and retirement identity", async () => {
    const service = new InnertubeService(factory, { logger: noOpLogger });
    const creation = service.beginChatClient();
    const owner = await creation.ready;
    expect(owner.dispose).toBe(creation.dispose);
    const disposal = owner.dispose();
    expect(creation.dispose()).toBe(disposal);
    expect(owner.dispose()).toBe(disposal);
    await disposal;
    expect(() => owner.run(async () => "not admitted")).toThrow("disposed");
    await service.dispose();
  });

  test("pre-aborted begin throws before admission while async convenience preserves rejection semantics", async () => {
    const service = new InnertubeService(factory, { logger: noOpLogger });
    const cancel = new AbortController();
    cancel.abort(new Error("synthetic pre-aborted creation"));
    expect(() => service.beginChatClient({ signal: cancel.signal })).toThrow("synthetic pre-aborted creation");
    await expect(service.createChatClient({ signal: cancel.signal })).rejects.toThrow("synthetic pre-aborted creation");
    await flush();
    expect(factory.createWithTimeout).not.toHaveBeenCalled();
    await service.dispose();
  });

  test("failed readiness auto-retires even when its handle consumer only awaits disposal", async () => {
    const failure = new Error("synthetic initialization failed");
    let requestSignal: AbortSignal | undefined, creations = 0;
    const service = new InnertubeService({ createWithTimeout: async (_timeout, config) => {
      creations++;
      void (config!.fetch as (input: string) => Promise<Response>)("https://synthetic.invalid/initialization-side-request").catch(() => {});
      throw failure;
    } }, { logger: noOpLogger, fetch: async (_input, init) => {
      requestSignal = init!.signal!;
      return await new Promise<Response>((_resolve, reject) => requestSignal!.addEventListener("abort", () => reject(requestSignal!.reason), { once: true }));
    } });
    const creation = service.beginChatClient();
    try {
      // Deliberately leave ready unawaited: the creation owner observes rejection.
      await flush();
      expect(requestSignal?.aborted).toBe(true);
      const disposal = creation.dispose();
      expect(creation.dispose()).toBe(disposal);
      await disposal;
      expect(creations).toBe(1);
      expect(service.stats.instancesCreated).toBe(0);
      expect(service.stats.retirementTimeouts).toBe(0);
    } finally { await service.dispose(); }
  });

  test("uncooperative unpublished initialization retires within five seconds and cannot publish its late client", async () => {
    useFakeTimers();
    const started = deferred();
    let release!: (client: InnertubeInfoClient) => void;
    const errors: unknown[][] = [];
    const service = new InnertubeService({ createWithTimeout: () => {
      started.resolve(); return new Promise<InnertubeInfoClient>(resolve => { release = resolve; });
    } }, { logger: { ...noOpLogger, error: (...args) => { errors.push(args); throw new Error("synthetic retirement reporter failure"); } } });
    try {
      const creation = service.beginChatClient();
      let published = false;
      const caller = creation.ready.then(() => { published = true; }, error => error);
      await started.promise;
      const disposal = creation.dispose();
      expect(String(await caller)).toContain("disposed");
      let retired = false;
      void disposal.then(() => { retired = true; });
      await flush(); advanceTimersByTime(4999); await flush();
      expect(retired).toBe(false);
      advanceTimersByTime(1); await disposal;
      expect(retired).toBe(true);
      expect(service.stats.retirementTimeouts).toBe(1);
      expect(errors).toEqual([["Innertube retirement deadline exceeded after 5000ms; 1 operations may still be running", "innertube-service"]]);
      release({ getInfo: async () => ({ video: "synthetic late client" }) });
      await flush();
      expect(published).toBe(false);
      expect(service.stats.instancesCreated).toBe(0);
      advanceTimersByTime(5000); await flush();
      expect(getTimerCount()).toBe(0);
    } finally { await service.dispose(); useRealTimers(); }
  });
});
