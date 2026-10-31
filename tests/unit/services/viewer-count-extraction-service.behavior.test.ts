import { afterEach, describe, it, expect, spyOn } from "bun:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { noOpLogger } from "../../helpers/mock-factories";
import { ViewerCountExtractionService } from "../../../src/services/viewer-count-extraction-service";
import { InnertubeService } from "../../../src/services/innertube-service";

type VideoInfo = Record<string, unknown>;
function barrier<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

const owners: InnertubeService[] = [];
function fixture(getInfo: (id: string) => Promise<VideoInfo> = async () => ({}),
  options: ConstructorParameters<typeof ViewerCountExtractionService>[1] = {}) {
  const owner = new InnertubeService({ createWithTimeout: async () => ({ getInfo }) }, { logger: noOpLogger });
  owners.push(owner);
  return { owner, service: new ViewerCountExtractionService(owner, { logger: noOpLogger, ...options }) };
}

afterEach(async () => {
  await Promise.all(owners.splice(0).map(owner => owner.dispose()));
});

describe("ViewerCountExtractionService with real metadata and extraction owners", () => {
  it("normalizes configuration without losing prior valid values", () => {
    const { service } = fixture(undefined, { timeout: Infinity, strategies: ["unknown"], retries: 2 });
    expect(service.config.timeout).toBe(8000);
    expect(service.config.strategies).toEqual(["view_text", "video_details", "basic_info"]);
    service.updateConfig({ timeout: 4500, strategies: ["basic_info"], debug: true });
    service.updateConfig({ timeout: 1.5, strategies: ["unknown"], debug: "false", unexpected: "synthetic-private" });
    expect(service.config).toEqual({ timeout: 4500, strategies: ["basic_info"], debug: true, retries: 2 });
    service.updateConfig({ timeout: 2147483648 });
    expect(service.config.timeout).toBe(4500);
  });

  it("caps held external jobs at five, waits for the whole batch and preserves input order", async () => {
    const ids = Array.from({ length: 12 }, (_, index) => `synthetic-video-${index}`);
    const gates = ids.map(() => barrier<VideoInfo>());
    const entered = ids.map(() => barrier<void>());
    const admissions: string[] = [];
    let active = 0;
    let maximum = 0;
    const { service } = fixture(async id => {
      const index = ids.indexOf(id);
      admissions.push(id);
      active++;
      maximum = Math.max(maximum, active);
      entered[index]!.resolve();
      try { return await gates[index]!.promise; } finally { active--; }
    });
    const extraction = spyOn(service, "extractViewerCount");
    const pending = service.extractViewerCountsBatch(ids, { maxConcurrency: 999 });
    try {
      await Promise.all(entered.slice(0, 5).map(item => item.promise));
      expect(admissions).toEqual(ids.slice(0, 5));
      for (const index of [4, 3, 2, 1]) gates[index]!.resolve({ video_details: { viewer_count: index } });
      // The spy calls the actual body; join its public results, not just SDK values.
      const releasedResults = await Promise.all(extraction.mock.results.slice(1, 5).map(result => {
        if (result.type !== "return") throw new Error("Expected an extraction promise");
        return result.value;
      }));
      expect(releasedResults.map(result => [result.videoId, result.count, result.success])).toEqual(
        ids.slice(1, 5).map((id, index) => [id, index + 1, true]),
      );
      // Let scheduler continuations reach SDK admission while request 0 remains held.
      await nextTurn();
      expect(admissions).toEqual(ids.slice(0, 5));
      expect(active).toBe(1);
      gates[0]!.resolve({ video_details: { viewer_count: 0 } });
      await Promise.all(entered.slice(5, 10).map(item => item.promise));
      expect(admissions).toEqual(ids.slice(0, 10));
      for (const index of [9, 8, 7, 6, 5]) gates[index]!.resolve({ video_details: { viewer_count: index } });
      await Promise.all(entered.slice(10).map(item => item.promise));
      gates[11]!.resolve({ video_details: { viewer_count: 11 } });
      gates[10]!.resolve({ video_details: { viewer_count: 10 } });
      const results = await pending;
      expect(maximum).toBe(5);
      expect(active).toBe(0);
      expect(results.map(result => [result.videoId, result.count, result.success])).toEqual(ids.map((id, index) => [id, index, true]));
    } finally {
      gates.forEach(gate => gate.resolve({}));
      try { await pending; } finally { extraction.mockRestore(); }
    }
  });

  it("projects actual diagnostic provenance without raw provider content", async () => {
    const { service } = fixture(async () => ({ video_details: { viewer_count: 10000001, private: "synthetic-private" } }));
    const result = await service.extractViewerCount("synthetic-private-video", { debug: true });
    expect(result).toMatchObject({ success: true, count: 10000001, videoId: "synthetic-private-video", strategy: "video_details" });
    expect(result.metadata).toEqual({ strategiesAttempted: ["view_text", "video_details"], rawData: {
      view_text: {}, video_details: { hasVideoDetails: true, sourceField: "viewer_count" },
    } });
    expect(JSON.stringify(result.metadata)).not.toContain("synthetic-private");
    expect(JSON.stringify(result.metadata)).not.toContain("10000001");
  });

  it("rejects external count/text objects without coercion and uses actual basic-info fallback", async () => {
    let coercions = 0;
    const disguised = { body: "synthetic-private-body", toString: () => { coercions++; return "12"; } };
    const { service } = fixture(async () => ({
      primary_info: { view_count: { view_count: { text: disguised } } },
      video_details: { viewer_count: disguised },
      basic_info: { is_live: true, view_count: 12 },
    }));
    const result = await service.extractViewerCount("synthetic-functional-id", { debug: true });
    expect(result).toMatchObject({ success: true, count: 12, strategy: "basic_info" });
    expect(coercions).toBe(0);
    expect(result.metadata).toEqual({ strategiesAttempted: ["view_text", "video_details", "basic_info"], rawData: {
      view_text: { hasViewText: true }, video_details: { hasVideoDetails: true },
      basic_info: { hasBasicInfo: true, is_live: true, sourceField: "view_count" },
    } });
    expect(JSON.stringify(result.metadata)).not.toContain("synthetic-private-body");
  });

  it("extracts watching text and reports real request statistics and config updates", async () => {
    const { service } = fixture(async () => ({ primary_info: { view_count: { view_count: { text: "123 watching now" } } } }), { strategies: ["view_text"], timeout: 2000 });
    expect(service.getStats()).toMatchObject({ totalRequests: 0, successRate: "0%" });
    service.updateConfig({ timeout: 4500, retries: 2 });
    expect(await service.extractViewerCount("synthetic-text")).toMatchObject({ success: true, count: 123, strategy: "view_text" });
    expect(service.config).toMatchObject({ timeout: 4500, retries: 2 });
    expect(service.getStats()).toMatchObject({ totalRequests: 1, successfulExtractions: 1, failedExtractions: 0, successRate: "100.00%" });
    expect(service.getStats().uptime).toBeGreaterThanOrEqual(0);
  });

  it("returns unavailable for missing or invalid metadata and counts failures", async () => {
    const { service } = fixture(async id => id === "synthetic-missing" ? {} : { video_details: { viewer_count: Infinity } });
    for (const id of ["synthetic-missing", "synthetic-invalid"]) {
      expect(await service.extractViewerCount(id)).toMatchObject({ success: false, count: 0, videoId: id, error: "Extraction failed" });
    }
    expect(service.getStats()).toMatchObject({ totalRequests: 2, successfulExtractions: 0, failedExtractions: 2 });
  });

  it("serially settles mixed SDK failures without losing batch members", async () => {
    const first = barrier<VideoInfo>();
    const entered = barrier<void>();
    const admissions: string[] = [];
    const { service } = fixture(async id => {
      admissions.push(id);
      if (id === "synthetic-one") { entered.resolve(); return first.promise; }
      throw new TypeError("synthetic-private-provider-failure");
    });
    const pending = service.extractViewerCountsBatch(["synthetic-one", "synthetic-two"], { maxConcurrency: 1 });
    try {
      await entered.promise;
      expect(admissions).toEqual(["synthetic-one"]);
      first.resolve({ video_details: { viewer_count: 1 } });
      expect(await pending).toMatchObject([
        { success: true, count: 1, videoId: "synthetic-one" },
        { success: false, count: 0, videoId: "synthetic-two", error: "Viewer count extraction failed", errorType: "TypeError" },
      ]);
      expect(admissions).toEqual(["synthetic-one", "synthetic-two"]);
      expect(service.getStats()).toMatchObject({ totalRequests: 2, successfulExtractions: 1, failedExtractions: 1, errorsByType: { TypeError: 1 } });
    } finally { first.resolve({}); await pending; }
  });

  it("aggregates empty input without admitting SDK work", async () => {
    let calls = 0;
    const { service } = fixture(async () => { calls++; return {}; });
    expect(await service.getAggregatedViewerCount([])).toEqual({ success: true, totalCount: 0, successfulStreams: 0, failedStreams: 0, streams: [] });
    expect(calls).toBe(0);
  });

  it("aggregates complete unique streams with exact details", async () => {
    const admissions: string[] = [];
    const { service } = fixture(async id => { admissions.push(id); return { video_details: { viewer_count: id === "synthetic-a" ? 14 : 6 } }; });
    expect(await service.getAggregatedViewerCount(["synthetic-a", "synthetic-b", "synthetic-a"])).toEqual({
      success: true, totalCount: 20, successfulStreams: 2, failedStreams: 0,
      streams: [{ videoId: "synthetic-a", count: 14, success: true, strategy: "video_details" }, { videoId: "synthetic-b", count: 6, success: true, strategy: "video_details" }],
    });
    expect(admissions).toEqual(["synthetic-a", "synthetic-b"]);
  });

  for (const mode of ["missing", "invalid", "throws"] as const) {
    it(`marks mixed aggregation unavailable for ${mode} external metadata`, async () => {
      const { service } = fixture(async id => {
        if (id === "synthetic-a") return { video_details: { viewer_count: 14 } };
        if (mode === "throws") throw new Error("synthetic SDK failure");
        return mode === "missing" ? {} : { video_details: { viewer_count: Infinity } };
      });
      expect(await service.getAggregatedViewerCount(["synthetic-a", "synthetic-b"])).toMatchObject({
        success: false, totalCount: 0, successfulStreams: 1, failedStreams: 1,
        streams: [{ videoId: "synthetic-a", count: 14, success: true }, { videoId: "synthetic-b", count: 0, success: false, error: mode === "throws" ? "Viewer count extraction failed" : "Extraction failed" }],
      });
    });
  }

  it("reports all unavailable streams and rejects unsafe aggregate sums", async () => {
    const { service } = fixture(async () => ({}));
    expect(await service.getAggregatedViewerCount(["synthetic-a", "synthetic-b"])).toMatchObject({ success: false, totalCount: 0, successfulStreams: 0, failedStreams: 2 });
    const { service: large } = fixture(async () => ({ video_details: { viewer_count: Number.MAX_SAFE_INTEGER } }));
    expect(await large.getAggregatedViewerCount(["synthetic-a", "synthetic-b"])).toMatchObject({ success: false, totalCount: 0, successfulStreams: 2, failedStreams: 0, error: "Unsafe aggregate viewer count" });
  });

  it("normalizes nonboolean debug to false through the actual extractor", async () => {
    const { service } = fixture(async () => ({ video_details: { viewer_count: 1 } }), { debug: "false" });
    expect(await service.extractViewerCount("synthetic-debug")).toMatchObject({ success: true, count: 1, metadata: { rawData: null } });
  });

  for (const mode of ["cancel", "deadline", "retire"] as const) {
    it(`fences held SDK results on ${mode} and joins actual settlement during retirement`, async () => {
      const entered = barrier<void>();
      const release = barrier<VideoInfo>();
      const settled = barrier<void>();
      let admissions = 0;
      const { owner, service } = fixture(async () => {
        admissions++;
        entered.resolve();
        try { return await release.promise; } finally { settled.resolve(); }
      });
      const controller = new AbortController();
      const pending = service.extractViewerCount("synthetic-held", { signal: controller.signal, timeout: mode === "deadline" ? 10 : 8000 });
      let disposal: Promise<void> | undefined;
      let disposed = false;
      try {
        await entered.promise;
        if (mode === "cancel") controller.abort(new DOMException("synthetic cancellation", "AbortError"));
        if (mode === "retire") disposal = owner.dispose().then(() => { disposed = true; });
        expect(await pending).toMatchObject({ success: false, count: 0, error: "Viewer count extraction failed", errorType: mode === "cancel" ? "AbortError" : mode === "deadline" ? "TimeoutError" : "Error" });
        disposal ??= owner.dispose().then(() => { disposed = true; });
        expect(await service.extractViewerCount("synthetic-after-retirement")).toMatchObject({ success: false, count: 0 });
        // Even after another public operation settles, disposal still joins the held SDK work.
        expect(disposed).toBe(false);
        expect(admissions).toBe(1);
        release.resolve({ video_details: { viewer_count: 999 } });
        await settled.promise;
        await disposal;
        expect(disposed).toBe(true);
        expect(service.getStats()).toMatchObject({ totalRequests: 2, successfulExtractions: 0, failedExtractions: 2 });
        expect(admissions).toBe(1);
      } finally {
        release.resolve({});
        await pending;
        await owner.dispose();
      }
    });
  }
});

it('keeps extraction results and one safe failure cause without batch progress diagnostics', async () => {
  const diagnostics: unknown[] = [];
  const capture = (...args: unknown[]) => { diagnostics.push(args); };
  const logger = { ...noOpLogger, debug: capture, warn: capture, error: capture };
  const { service } = fixture(async id => {
    if (id === 'synthetic-failed') throw new TypeError('synthetic-private-request-body');
    return { video_details: { viewer_count: 12 } };
  }, { logger });
  const aggregate = await service.getAggregatedViewerCount(['synthetic-one', 'synthetic-two']);
  expect(aggregate).toMatchObject({ success: true, totalCount: 24, successfulStreams: 2 });
  expect(diagnostics).toEqual([]);
  expect(await service.extractViewerCount('synthetic-failed')).toMatchObject({ success: false, errorType: 'TypeError' });
  expect(diagnostics).toHaveLength(1);
  expect(JSON.stringify(diagnostics)).toContain('request (TypeError)');
  expect(JSON.stringify(diagnostics)).not.toContain('synthetic-private');
});
