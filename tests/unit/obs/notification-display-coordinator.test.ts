import { describe, expect, it } from "bun:test";

import { NotificationDisplayCoordinator } from "../../../src/obs/notification-display-coordinator";

class ControlledDelay {
  calls: Array<{ ms: number; resolve: () => void; settled: boolean }> = [];

  delay = (ms: number) => new Promise<void>((resolve) => {
    this.calls.push({ ms, resolve, settled: false });
  });

  resolve(ms: number) {
    const call = this.calls.find((candidate) => candidate.ms === ms && !candidate.settled);
    if (!call) throw new Error(`No pending ${ms}ms delay`);
    call.settled = true;
    call.resolve();
  }
}

const flush = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

describe("NotificationDisplayCoordinator", () => {
  it("starts immediately, waits the normal hold after effects, then transitions", async () => {
    const delays = new ControlledDelay();
    const lifecycle: Array<Record<string, unknown>> = [];
    let finishEffect!: () => void;
    const effect = new Promise<void>((resolve) => { finishEffect = resolve; });
    const coordinator = new NotificationDisplayCoordinator({
      delay: delays.delay,
      emit: (_event, payload) => lifecycle.push(payload),
    });
    const registration = coordinator.register({ eventId: "event-1", type: "platform:follow", platform: "twitch" });
    const starts: string[] = [];

    const run = registration.run(() => starts.push("event-1"), () => effect);
    await flush();
    expect(starts).toEqual(["event-1"]);
    expect(lifecycle.map((event) => event.phase)).toEqual(["started"]);

    finishEffect();
    await flush();
    expect(lifecycle.map((event) => event.phase)).toEqual(["started"]);
    delays.resolve(5000);
    await flush();
    expect(lifecycle.map((event) => event.phase)).toEqual(["started", "exit-started"]);
    delays.resolve(1000);
    await run;
  });

  it("bypasses remaining idle hold when a successor is pending", async () => {
    const delays = new ControlledDelay();
    const lifecycle: Array<Record<string, unknown>> = [];
    let finishFirst!: () => void;
    const firstEffect = new Promise<void>((resolve) => { finishFirst = resolve; });
    const coordinator = new NotificationDisplayCoordinator({
      delay: delays.delay,
      emit: (_event, payload) => lifecycle.push(payload),
    });
    const first = coordinator.register({ eventId: "event-1", type: "platform:follow" });
    const firstRun = first.run(() => {}, () => firstEffect);
    await flush();
    coordinator.register({ eventId: "event-2", type: "platform:gift" });

    finishFirst();
    await flush();
    expect(lifecycle.map((event) => event.phase)).toEqual(["started", "exit-started"]);
    delays.resolve(1000);
    await firstRun;
  });

  it("wakes an idle notification when a successor registers after effects settle", async () => {
    const delays = new ControlledDelay();
    const phases: string[] = [];
    const coordinator = new NotificationDisplayCoordinator({
      delay: delays.delay,
      emit: (_event, payload) => phases.push(payload.phase),
    });
    const firstRun = coordinator.register({ eventId: "event-1", type: "platform:follow" })
      .run(() => {}, async () => {});
    await flush();
    expect(phases).toEqual(["started"]);

    coordinator.register({ eventId: "event-2", type: "platform:follow" });
    await flush();
    expect(phases).toEqual(["started", "exit-started"]);
    delays.resolve(1000);
    await firstRun;
  });

  it("uses the monetization hold for every monetization notification type", async () => {
    for (const type of ["platform:gift", "platform:paypiggy", "platform:giftpaypiggy", "platform:envelope"]) {
      const delays = new ControlledDelay();
      const coordinator = new NotificationDisplayCoordinator({ delay: delays.delay });
      const run = coordinator.register({ eventId: type, type }).run(() => {}, async () => {});
      await flush();
      expect(delays.calls.some((call) => call.ms === 30_000)).toBe(true);
      delays.resolve(30_000);
      await flush();
      delays.resolve(1000);
      await run;
    }
  });

  it("emits exit and completes transition before propagating an effect failure", async () => {
    const delays = new ControlledDelay();
    const phases: string[] = [];
    const coordinator = new NotificationDisplayCoordinator({
      notificationIdleHoldMs: 0,
      delay: delays.delay,
      emit: (_event, payload) => phases.push(payload.phase),
    });
    const run = coordinator.register({ eventId: "event-1", type: "platform:follow" })
      .run(() => {}, async () => { throw new Error("effect failed"); });
    await flush();
    delays.resolve(0);
    await flush();
    expect(phases).toEqual(["started", "exit-started"]);
    delays.resolve(1000);
    await expect(run).rejects.toThrow("effect failed");
  });

  it("stops an idle notification without leaving its hold pending", async () => {
    const phases: string[] = [];
    const coordinator = new NotificationDisplayCoordinator({
      notificationIdleHoldMs: 60_000,
      notificationTransitionMs: 60_000,
      emit: (_event, payload) => phases.push(payload.phase),
    });
    const run = coordinator.register({ eventId: "event-1", type: "platform:follow" })
      .run(() => {}, async () => {});
    await flush();

    coordinator.stop();
    await run;
    expect(phases).toEqual(["started", "exit-started"]);
  });

  it("uses the bounded fallback when an effect never settles", async () => {
    const phases: string[] = [];
    const coordinator = new NotificationDisplayCoordinator({
      notificationIdleHoldMs: 0,
      notificationTransitionMs: 0,
      effectFallbackMs: 1,
      emit: (_event, payload) => phases.push(payload.phase),
    });
    await coordinator.register({ eventId: "event-1", type: "platform:follow" })
      .run(() => {}, () => new Promise(() => {}));
    expect(phases).toEqual(["started", "exit-started"]);
  });
});
