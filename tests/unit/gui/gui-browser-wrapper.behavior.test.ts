import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

function readObsFile(name: string): string {
  return readFileSync(resolve(process.cwd(), "obs", name), "utf8");
}

type HealthResponse = { ok: boolean } | { body: unknown; responseOk?: boolean } | Error;

function createWrapperHarness(healthResponses: HealthResponse[]) {
  let timerId = 0;
  const timers = new Map<number, () => void>();
  const frame = {
    src: "",
    removedSourceCount: 0,
    style: { display: "" },
    addEventListener: () => undefined,
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
      documentElement: { dataset: { route: "/overlay", statusVisible: "false" } },
      getElementById: (id: string) => id === "stream-sync-frame" ? frame : status,
    },
    fetch: async () => {
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
    window: { location: { hash: "", search: "" } },
  });

  return {
    flushMicrotasks,
    frame,
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
  test("shares compatibility polling while preserving source query parameters", () => {
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
  ])("forwards query parameters from %s", (fileName, route) => {
    const launcher = readObsFile(fileName);

    expect(launcher).toContain(`data-route="${route}"`);
    expect(launcher).toContain('src="browser-wrapper.js?v=3"');
    expect(launcher).toContain('href="browser-wrapper.css?v=2"');
    expect(launcher).not.toContain("window.location.replace");
    expect(readObsFile("browser-wrapper.js")).toContain("window.location.search");
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
    expect(wrapper).toContain("new URL(targetRoute, origin).toString()");
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

    await harness.runNextTimer();
    expect(harness.frame.src).toBe("");
    expect(harness.frame.removedSourceCount).toBe(1);

    await harness.runNextTimer();
    expect(harness.frame.src).toBe("http://localhost:3399/overlay");
    expect(harness.frame.removedSourceCount).toBe(1);
  });
});
