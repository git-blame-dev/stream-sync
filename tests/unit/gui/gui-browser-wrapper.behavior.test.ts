import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

function readObsFile(name: string): string {
  return readFileSync(resolve(process.cwd(), "obs", name), "utf8");
}

type HealthResponse = { ok: boolean } | { body: unknown; responseOk?: boolean } | Error;

function createWrapperHarness(healthResponses: HealthResponse[], origin?: string, options: { hash?: string; search?: string; route?: string | null; statusVisible?: boolean } = {}) {
  let timerId = 0;
  const timers = new Map<number, () => void>();
  const healthUrls: string[] = [];
  const frameListeners = new Map<string, () => void>();
  const frame = {
    src: "",
    removedSourceCount: 0,
    style: { display: "" },
    addEventListener: (event: string, listener: () => void) => frameListeners.set(event, listener),
    getAttribute: (name: string) => name === "src" ? frame.src || null : null,
    removeAttribute: (name: string) => {
      if (name !== "src") return;
      frame.src = "";
      frame.removedSourceCount += 1;
    },
  };
  const status = { textContent: "", style: { display: "" } };
  const flushMicrotasks = async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  };

  runInNewContext(readObsFile("browser-wrapper.js"), {
    AbortController,
    URL,
    URLSearchParams,
    clearTimeout: (id: number) => timers.delete(id),
    document: {
      documentElement: { dataset: { ...(options.route === null ? {} : { route: options.route ?? "/overlay" }), statusVisible: String(options.statusVisible ?? false) } },
      getElementById: (id: string) => id === "stream-sync-frame" ? frame : status,
    },
    fetch: async (url: string) => {
      healthUrls.push(url);
      const response = healthResponses.shift();
      if (!response) throw new Error("Missing health response fixture");
      if (response instanceof Error) throw response;
      return "body" in response
        ? { ok: response.responseOk ?? true, json: async () => response.body }
        : { ok: true, json: async () => response };
    },
    setTimeout: (callback: () => void) => {
      const id = ++timerId;
      timers.set(id, callback);
      return id;
    },
    window: { location: { hash: options.hash ?? (origin === undefined ? "" : `#origin=${encodeURIComponent(origin)}`), search: options.search ?? "" } },
  });

  return {
    flushMicrotasks,
    frame,
    status,
    loadFrame: () => {
      const listener = frameListeners.get("load");
      if (!listener) throw new Error("Expected a registered iframe load listener");
      listener();
    },
    healthUrls,
    runNextTimer: async () => {
      const next = timers.entries().next().value as [number, () => void] | undefined;
      if (!next) throw new Error("Expected a scheduled wrapper timer");
      timers.delete(next[0]);
      next[1]();
      await flushMicrotasks();
    },
  };
}

describe("OBS browser wrappers", () => {
  test.each([
    ["#/.//example.invalid/overlay", "/overlay"],
    ["#%2F.%2F%2Fexample.invalid%2Foverlay", "/overlay"],
    ["#//example.invalid/overlay", "/overlay"],
    ["#/goal?synthetic=true", "/goal?synthetic=true"],
  ])("keeps generic-wrapper hash routes on the validated origin: %s", async (hash, route) => {
    const harness = createWrapperHarness([{ ok: true }], undefined, { hash, route: null });
    await harness.flushMicrotasks();
    expect(harness.frame.src).toBe(`http://localhost:3399${route}`);
    expect(harness.healthUrls).toEqual([`http://localhost:3399/health?route=${encodeURIComponent(route.split("?")[0]!)}`]);
  });

  test.each([
    ["http://localhost:4400", "http://localhost:4400"],
    ["https://127.0.0.1:4400", "https://127.0.0.1:4400"],
    ["http://127.0.0.2:4400", "http://127.0.0.2:4400"],
    ["http://[::1]:4400", "http://[::1]:4400"],
    ["http://127.1:4400", "http://127.0.0.1:4400"],
    ["http://0x7f000001:4400", "http://127.0.0.1:4400"],
    ["https://example.invalid", "http://localhost:3399"],
    ["http://localhost.example.invalid:4400", "http://localhost:3399"],
    ["http://192.168.1.2:4400", "http://localhost:3399"],
    ["http://10.0.0.2:4400", "http://localhost:3399"],
    ["http://0.0.0.0:4400", "http://localhost:3399"],
    ["http://[2001:db8::1]:4400", "http://localhost:3399"],
    ["http://127.0.0.1.example.invalid:4400", "http://localhost:3399"],
    ["http://synthetic.local:4400", "http://localhost:3399"],
    ["http://synthetic-user:synthetic-password@localhost:4400", "http://localhost:3399"],
    ["file:///synthetic/preview", "http://localhost:3399"],
  ])("admits only loopback wrapper origins: %s", async (origin, expected) => {
    const harness = createWrapperHarness([{ ok: true }], origin);
    await harness.flushMicrotasks();
    expect(harness.healthUrls).toEqual([`${expected}/health?route=%2Foverlay`]);
    expect(harness.frame.src).toBe(`${expected}/overlay`);
  });

  test("declares shared wrapper assets and status visibility", () => {
    const wrapper = readObsFile("browser-wrapper.html");

    expect(wrapper).toContain('src="browser-wrapper.js?v=3"');
    expect(wrapper).toContain('href="browser-wrapper.css?v=2"');
    expect(wrapper).toContain("data-status-visible");
    expect(wrapper).toContain("data-status-visible=\"false\"");
  });

  test.each([
    ["overlay.html", "/overlay"],
    ["goal.html", "/goal"],
    ["dock.html", "/dock"],
    ["notifications.html", "/notifications"],
    ["tiktok-animations.html", "/tiktok-animations"],
    ["demo.html", "/demo"],
  ])("declares wrapper assets and route for %s", (fileName, route) => {
    const launcher = readObsFile(fileName);

    expect(launcher).toContain(`data-route="${route}"`);
    expect(launcher).toContain('src="browser-wrapper.js?v=3"');
    expect(launcher).toContain('href="browser-wrapper.css?v=2"');
    expect(launcher).not.toContain("window.location.replace");
  });

  test.each(["/overlay", "/goal", "/dock", "/notifications", "/tiktok-animations", "/demo"])("forwards encoded and duplicate query values for %s", async (route) => {
    const search = "?name=hello%20world&tag=%E6%B8%AC&tag=a%3Ab";
    const harness = createWrapperHarness([{ ok: true }], undefined, { route, search });
    await harness.flushMicrotasks();
    expect(harness.frame.src).toBe(`http://localhost:3399${route}${search}`);
    expect(harness.healthUrls).toEqual([`http://localhost:3399/health?route=${encodeURIComponent(route)}`]);
  });

  test("generic hash route does not append launcher search", async () => {
    const harness = createWrapperHarness([{ ok: true }], undefined, { route: null, hash: "#/goal?from=hash", search: "?from=search" });
    await harness.flushMicrotasks();
    expect(harness.frame.src).toBe("http://localhost:3399/goal?from=hash");
    expect(harness.healthUrls).toEqual(["http://localhost:3399/health?route=%2Fgoal"]);
  });

  test("keeps dock status visible and stream-facing launchers transparent", () => {
    expect(readObsFile("dock.html")).toContain('data-status-visible="true"');
    for (const fileName of ["overlay.html", "notifications.html", "tiktok-animations.html"]) {
      const launcher = readObsFile(fileName);
      expect(launcher).toContain('data-status-visible="false"');
    }
    expect(readObsFile("browser-wrapper.css")).toContain("background: transparent");
  });

  test("retains explicit route-unavailable recovery behavior", () => {
    const wrapper = readObsFile("browser-wrapper.js");

    expect(wrapper).toContain("HEALTH_POLL_MS");
    expect(wrapper).toContain("frame.removeAttribute('src')");
    expect(wrapper).toContain("setHealthMonitoring");
    expect(wrapper).toContain("loadFrame();");
    expect(wrapper).toContain("root.dataset.statusVisible === 'true'");
    expect(wrapper).toContain("new URL(targetRoute, origin)");
    expect(wrapper).toContain("frame.addEventListener('load'");
    expect(wrapper).toContain("frame.getAttribute('src') === targetUrl");
    expect(wrapper).toContain("Connecting to Stream Sync...");
    expect(wrapper).toContain("http://localhost:3399");
    expect(wrapper).not.toContain("?t=${Date.now()}");
  });

  test("keeps an attached iframe during an indeterminate health failure", async () => {
    const harness = createWrapperHarness([{ ok: true }, new Error("temporary network failure")]);
    await harness.flushMicrotasks();
    expect(harness.frame.src).toBe("http://localhost:3399/overlay");

    await harness.runNextTimer();

    expect(harness.frame.src).toBe("http://localhost:3399/overlay");
    expect(harness.frame.removedSourceCount).toBe(0);
  });

  test("keeps an attached iframe for non-authoritative health responses", async () => {
    const harness = createWrapperHarness([
      { ok: true },
      { responseOk: false, body: { ok: false } },
      { body: { unexpected: true } },
    ]);
    await harness.flushMicrotasks();

    await harness.runNextTimer();
    expect(harness.frame.removedSourceCount).toBe(0);

    await harness.runNextTimer();
    expect(harness.frame.src).toBe("http://localhost:3399/overlay");
    expect(harness.frame.removedSourceCount).toBe(0);
  });

  test("detaches only for explicit route unavailability and reloads after recovery", async () => {
    const harness = createWrapperHarness([{ ok: true }, { ok: false }, { ok: true }]);
    await harness.flushMicrotasks();
    harness.loadFrame();
    expect(harness.status.style.display).toBe("none");

    await harness.runNextTimer();
    expect(harness.frame.src).toBe("");
    expect(harness.frame.removedSourceCount).toBe(1);
    expect(harness.status.style.display).toBe("none");

    await harness.runNextTimer();
    expect(harness.frame.src).toBe("http://localhost:3399/overlay");
    expect(harness.frame.removedSourceCount).toBe(1);
    expect(harness.status.style.display).toBe("none");
    harness.loadFrame();
    expect(harness.status.style.display).toBe("none");
  });

  test("restores dock status after a loaded frame becomes unavailable and hides it after recovery loads", async () => {
    const harness = createWrapperHarness([{ ok: true }, { ok: false }, { ok: true }], undefined, {
      route: "/dock",
      statusVisible: true,
    });
    await harness.flushMicrotasks();
    expect(harness.frame.src).toBe("http://localhost:3399/dock");
    expect(harness.status.style.display).toBe("block");
    harness.loadFrame();
    expect(harness.status.style.display).toBe("none");

    await harness.runNextTimer();
    expect(harness.frame.src).toBe("");
    expect(harness.frame.style.display).toBe("none");
    expect(harness.status.style.display).toBe("block");
    expect(harness.status.textContent).toBe("Waiting for Stream Sync at http://localhost:3399/health?route=%2Fdock...");

    await harness.runNextTimer();
    expect(harness.frame.src).toBe("http://localhost:3399/dock");
    expect(harness.frame.style.display).toBe("block");
    expect(harness.status.textContent).toBe("Connecting to Stream Sync...");
    expect(harness.status.style.display).toBe("block");
    harness.loadFrame();
    expect(harness.status.style.display).toBe("none");
  });
});
