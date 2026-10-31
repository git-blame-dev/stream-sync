import { vi, describe, expect, it, afterEach, beforeEach, spyOn } from 'bun:test';

import { noOpLogger } from "../../helpers/mock-factories";
import testClock from "../../helpers/test-clock";
import { InitializationStatistics } from "../../../src/utils/initialization-statistics.ts";
describe("InitializationStatistics behavior", () => {
  beforeEach(() => {
    spyOn(performance, 'now').mockImplementation(() => testClock.now());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps elapsed and success age monotonic while retaining stepped wall timestamps', () => {
    let elapsed = 10;
    spyOn(performance, 'now').mockImplementation(() => elapsed);
    const stats = new InitializationStatistics('synthetic-clock', noOpLogger);
    testClock.set(1000);
    const attempt = stats.startInitializationAttempt();
    testClock.set(500);
    elapsed = 35;
    stats.recordSuccess(attempt);
    elapsed = 45;
    testClock.set(100);
    expect(stats.getTimingHistory()).toMatchObject([{ startTime: 1000, endTime: 500, duration: 25 }]);
    expect(stats.getStatistics()).toMatchObject({ averageInitializationTime: 25, lastSuccessTime: 500, timeSinceLastSuccess: 10 });
    stats.reset();
    expect(stats.getStatistics().timeSinceLastSuccess).toBeNull();
  });

  it("tracks successful initialization timing and metrics", () => {
    const stats = new InitializationStatistics("twitch", noOpLogger);

    testClock.set(1000);
    const attemptId = stats.startInitializationAttempt({ reason: "boot" });
    testClock.set(2000);
    stats.recordSuccess(attemptId, { connectionTime: 50, serviceInitTime: 30 });

    const summary = stats.getStatistics();

    expect(summary.successfulAttempts).toBe(1);
    expect(summary.averageInitializationTime).toBe(1000);
    expect(summary.performanceMetrics.connectionEstablishmentTime).toBeDefined();
    if (summary.performanceMetrics.connectionEstablishmentTime === undefined) {
      throw new Error("Expected connection timing metrics");
    }
    expect(summary.performanceMetrics.connectionEstablishmentTime.average).toBe(
      50,
    );
    expect(stats.consecutiveFailures).toBe(0);
  });

  it("records failures and tracks error statistics", () => {
    const stats = new InitializationStatistics("youtube", noOpLogger);

    testClock.set(1000);
    const attemptId = stats.startInitializationAttempt();
    testClock.set(1050);
    const error = new Error("connect failed");

    stats.recordFailure(attemptId, error, { phase: "connect" });

    expect(stats.failedAttempts).toBe(1);
    expect(stats.errorTypes.get("Error")).toBe(1);
    expect(stats.consecutiveFailures).toBe(1);
  });

  it("identifies unhealthy state after repeated failures", () => {
    const stats = new InitializationStatistics("platform", noOpLogger);

    testClock.set(10);
    for (let i = 0; i < 5; i++) {
      const attemptId = stats.startInitializationAttempt();
      testClock.advance(10);
      stats.recordFailure(attemptId, new Error("boom"));
    }

    const summary = stats.getStatistics();
    const analysis = stats.getErrorAnalysis();

    expect(summary.isHealthy).toBe(false);
    expect(analysis.recommendedAction).toContain("CRITICAL");
    expect(analysis.mostCommonError).toBe("Error");
  });

  it("resets statistics to defaults", () => {
    const stats = new InitializationStatistics("platform", noOpLogger);

    testClock.set(1000);
    const attemptId = stats.startInitializationAttempt();
    testClock.set(1020);
    stats.recordSuccess(attemptId);
    stats.reset();

    const summary = stats.getStatistics();
    expect(summary.totalAttempts).toBe(0);
    expect(stats.errorTypes.size).toBe(0);
    expect(stats.isCurrentlyInitializing).toBe(false);
  });

  it("bounds failed timing and error samples without losing lifetime counts", () => {
    const stats = new InitializationStatistics("synthetic", noOpLogger);
    testClock.set(1000);
    const ids: string[] = [];
    for (let i = 0; i < 105; i++) {
      const id = stats.startInitializationAttempt();
      ids.push(id);
      testClock.advance(1);
      stats.recordFailure(id, new Error("synthetic failure"));
    }
    expect(stats.getTimingHistory(200).map(({ attemptId }) => attemptId)).toEqual(ids.slice(-100));
    expect(stats.errorHistory.map(({ attemptId }) => attemptId)).toEqual(ids.slice(-50));
    expect(stats.getStatistics()).toMatchObject({ totalAttempts: 105, failedAttempts: 105, consecutiveFailures: 105, errorTypes: { Error: 105 } });
  });

  it("bounds every performance bucket and retains zero while rejecting invalid durations", () => {
    const stats = new InitializationStatistics("synthetic", noOpLogger);
    testClock.set(1000);
    for (let i = 0; i < 105; i++) {
      const id = stats.startInitializationAttempt();
      testClock.advance(2);
      stats.recordSuccess(id, { connectionTime: i, serviceInitTime: i, configValidationTime: i, dependencyTime: i });
    }
    for (const bucket of Object.values(stats.performanceMetrics)) expect(bucket).toEqual(Array.from({ length: 100 }, (_, i) => i + 5));
    stats.recordSuccess(stats.startInitializationAttempt(), { connectionTime: 0, serviceInitTime: NaN, configValidationTime: Infinity, dependencyTime: -1 });
    expect(stats.performanceMetrics.connectionEstablishmentTime.at(-1)).toBe(0);
    expect(stats.performanceMetrics.serviceInitializationTime.at(-1)).toBe(104);
    expect(stats.performanceMetrics.configurationValidationTime.at(-1)).toBe(104);
    expect(stats.performanceMetrics.dependencyResolutionTime.at(-1)).toBe(104);
    expect(stats.getStatistics()).toMatchObject({ successfulAttempts: 106, totalInitializationTime: 210, averageInitializationTime: 210 / 106 });
    expect(stats.getTimingHistory(200)).toHaveLength(100);
    stats.recordSuccess(stats.startInitializationAttempt(), { connectionTime: 0, serviceInitTime: 0, configValidationTime: 0, dependencyTime: 0 });
    for (const summary of Object.values(stats.getStatistics().performanceMetrics)) {
      expect(summary).toMatchObject({ count: 100, min: 0, max: 104 });
    }
  });

  it("completes overlapping attempts once using their own start times", () => {
    const stats = new InitializationStatistics("synthetic", noOpLogger);
    testClock.set(1000);
    const first = stats.startInitializationAttempt();
    testClock.advance(10);
    const second = stats.startInitializationAttempt();
    testClock.advance(10);
    stats.recordSuccess(first);
    expect(stats.isCurrentlyInitializing).toBe(true);
    expect(stats.currentAttemptStartTime).toBe(1010);
    testClock.advance(10);
    stats.recordFailure(second, new Error("synthetic failure"));
    expect(stats.isCurrentlyInitializing).toBe(false);
    expect(stats.currentAttemptStartTime).toBeNull();
    expect(stats.getTimingHistory().map(({ duration, startTime }) => ({ duration, startTime }))).toEqual([{ duration: 20, startTime: 1000 }, { duration: 20, startTime: 1010 }]);
    expect(stats.getStatistics()).toMatchObject({ totalAttempts: 2, successfulAttempts: 1, failedAttempts: 1 });
    const earlier = stats.startInitializationAttempt();
    testClock.advance(5);
    const later = stats.startInitializationAttempt();
    stats.recordSuccess(later);
    expect(stats.currentAttemptStartTime).toBe(1030);
    stats.recordSuccess(earlier);
    expect(stats.isCurrentlyInitializing).toBe(false);
  });

  it("ignores unknown duplicate and reset-retired completions without consuming active attempts", () => {
    const stats = new InitializationStatistics("synthetic", noOpLogger);
    testClock.set(1000);
    const retired = stats.startInitializationAttempt();
    stats.reset();
    const active = stats.startInitializationAttempt();
    stats.recordSuccess(retired);
    stats.recordFailure("synthetic-unknown", new Error("ignored"));
    expect(stats.isCurrentlyInitializing).toBe(true);
    expect(stats.getTimingHistory()).toEqual([]);
    stats.recordSuccess(active);
    const next = stats.startInitializationAttempt();
    stats.recordFailure(active, new Error("duplicate"));
    expect(stats.isCurrentlyInitializing).toBe(true);
    stats.recordSuccess(next);
    expect(stats.getStatistics()).toMatchObject({ totalAttempts: 2, successfulAttempts: 2, failedAttempts: 0 });
    expect(stats.getTimingHistory()).toHaveLength(2);
  });
});
