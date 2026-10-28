import { describe, expect, test } from "bun:test";

import {
  createFundingGoalService,
  type FundingGoalFileSystem,
  type FundingGoalServiceOptions,
} from "../../../src/services/funding-goal-service";

function memoryFileSystem(initial?: string, failWrites = 0): FundingGoalFileSystem & { value: string | undefined } {
  let value = initial;
  let remainingFailures = failWrites;
  const temporaryFiles = new Map<string, string>();
  return {
    readFile: async () => {
      if (value === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return value;
    },
    mkdir: async () => undefined,
    writeFile: async (path, content) => {
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        throw new Error("write failed");
      }
      temporaryFiles.set(path, content);
    },
    rename: async (from, to) => {
      value = temporaryFiles.get(from);
      temporaryFiles.delete(from);
      if (value !== undefined) temporaryFiles.set(to, value);
    },
    unlink: async (path) => {
      temporaryFiles.delete(path);
    },
    get value() {
      return value;
    },
  };
}

function options(overrides: Partial<FundingGoalServiceOptions> = {}): FundingGoalServiceOptions {
  return {
    config: {
      enabled: true,
      id: "controller",
      label: "🎮 New Controller",
      targetUsd: 100,
    },
    monetizationValuesConfig: {
      tiktokGiftUnitUsd: 0.005,
      twitchBitUsd: 0.01,
      youtubeJewelUsd: 0.005,
      tiktokMembershipUsd: 2.10,
      twitchMembershipUsd: 3.50,
      youtubeMembershipUsd: 3.89,
    },
    filePath: "/tmp/funding-goal.json",
    fs: memoryFileSystem(),
    ...overrides,
  };
}

function event(platform: string, type: string, data: Record<string, unknown>) {
  return { platform, type, data };
}

describe("FundingGoalService", () => {
  for (const failFirst of [false, true]) {
    test(`bounds outstanding manual commands, reserves presentation admission, and frees settled slots (failure=${failFirst})`, async () => {
      const fs = memoryFileSystem();
      const originalWrite = fs.writeFile;
      let releaseFirst!: () => void;
      let releaseRest!: () => void;
      const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
      const restGate = new Promise<void>(resolve => { releaseRest = resolve; });
      const totals: number[] = [];
      fs.writeFile = async (path, content, writeOptions) => {
        totals.push(JSON.parse(content).currentMicros);
        if (totals.length === 1) {
          await firstGate;
          if (failFirst) throw new Error("synthetic first write failure");
        } else {
          await restGate;
        }
        return originalWrite(path, content, writeOptions);
      };
      const service = await createFundingGoalService(options({ fs }));
      const first = service.adjust(1).then(() => "completed", () => "failed");
      const rest = Array.from({ length: 99 }, () => service.adjust(1));
      const expectImmediateCapacityRejection = async (command: Promise<void>) => {
        let rejection: unknown;
        void command.catch(error => { rejection = error; });
        await Promise.resolve();
        expect(rejection).toBeInstanceOf(Error);
        expect((rejection as Error).message).toContain("capacity");
      };
      await expectImmediateCapacityRejection(service.adjust(999));
      await expectImmediateCapacityRejection(service.setTotal(999));
      await expectImmediateCapacityRejection(service.setLabel("Synthetic overload"));
      await expectImmediateCapacityRejection(service.resetLabel());
      const presentation = service.processPresentedContributions([
        event("youtube", "platform:gift", { id: "synthetic-reserved", amount: 5, currency: "USD" }),
      ]);
      releaseFirst();
      expect(await first).toBe(failFirst ? "failed" : "completed");
      const replacement = service.setTotal(200);
      await expectImmediateCapacityRejection(service.adjust(999));
      let disposed = false;
      const disposing = service.dispose().then(() => { disposed = true; });
      await expect(service.adjust(1)).rejects.toThrow("disposed");
      await expect(service.setTotal(1)).rejects.toThrow("disposed");
      await expect(service.setLabel("Synthetic late")).rejects.toThrow("disposed");
      await expect(service.resetLabel()).rejects.toThrow("disposed");
      await expect(service.processPresentedContributions([])).rejects.toThrow("disposed");
      expect(disposed).toBe(false);
      releaseRest();
      await Promise.all([...rest, presentation, replacement, disposing]);
      expect(totals).toHaveLength(102);
      const manualTotal = failFirst ? 99 : 100;
      expect(totals.slice(-3)).toEqual([manualTotal * 1000000, (manualTotal + 5) * 1000000, 200000000]);
      expect(service.snapshot).toMatchObject({ currentUsd: 200, revision: failFirst ? 101 : 102 });
      expect(disposed).toBe(true);
    });
  }

  test("rejects missing monetization values before subscribing", async () => {
    let subscribed = false;
    const creation = createFundingGoalService(options({
      monetizationValuesConfig: undefined as unknown as FundingGoalServiceOptions["monetizationValuesConfig"],
      eventBus: {
        subscribe: () => {
          subscribed = true;
          return () => undefined;
        },
      },
    }));

    await expect(creation).rejects.toThrow("monetizationValuesConfig");
    expect(subscribed).toBe(false);
  });

  test("rejects a missing monetization value field before subscribing", async () => {
    const config = { ...options().monetizationValuesConfig };
    delete (config as Partial<typeof config>).youtubeJewelUsd;

    await expect(createFundingGoalService(options({ monetizationValuesConfig: config })))
      .rejects.toThrow("monetizationValuesConfig.youtubeJewelUsd");
  });

  test("rejects negative and non-finite monetization values", async () => {
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(createFundingGoalService(options({
        monetizationValuesConfig: { ...options().monetizationValuesConfig, twitchBitUsd: value },
      }))).rejects.toThrow("monetizationValuesConfig.twitchBitUsd");
    }
  });

  test("values canonical gifts in configured USD units and ignores unsupported values", async () => {
    const service = await createFundingGoalService(options());

    await service.processPlatformEvent(event("youtube", "platform:gift", { id: "yt-1", amount: 5, currency: "USD" }));
    await service.processPlatformEvent(event("twitch", "platform:gift", { id: "tw-1", amount: 100, currency: "bits" }));
    await service.processPlatformEvent(event("tiktok", "platform:gift", { id: "tt-1", amount: 100, currency: "coins" }));
    await service.processPlatformEvent(event("youtube", "platform:gift", { id: "yt-jewel", amount: 20, currency: "jewels" }));

    expect(service.snapshot.currentUsd).toBe(6.6);
  });

  test("accumulates TikTok gift units with exact micros-visible totals", async () => {
    const service = await createFundingGoalService(options());

    for (const [index, amount] of [1, 10, 100, 1000].entries()) {
      await service.processPlatformEvent(event("tiktok", "platform:gift", {
        id: `tt-${index}`, amount, currency: "coins",
      }));
    }

    expect(service.snapshot.currentUsd).toBe(5.555);
    expect(service.snapshot.currentUsd * 1_000_000).toBe(5_555_000);
  });

  test("uses canonical unit semantics, diagnostics, and injected fiat conversion", async () => {
    const diagnostics: string[] = [];
    const converter = (amount: number, currency: string) => {
      return currency === "cad" ? amount * 0.75 : null;
    };
    const service = await createFundingGoalService(options({ fiatToUsd: converter, debug: message => diagnostics.push(message) }));

    await service.processPlatformEvent(event("twitch", "platform:gift", {
      id: "bits", amount: 100, currency: "bits", giftCount: 8,
    }));
    await service.processPlatformEvent(event("youtube", "platform:gift", {
      id: "jewels", amount: 20, currency: "jewels",
    }));
    await service.processPlatformEvent(event("youtube", "platform:gift", {
      id: "amountless", currency: "jewels",
    }));
    await service.processPlatformEvent(event("youtube", "platform:gift", {
      id: "usd", amount: 2, currency: "USD",
    }));
    await service.processPlatformEvent(event("youtube", "platform:gift", {
      id: "cad", amount: 4, currency: "CAD",
    }));
    await service.processPlatformEvent(event("youtube", "platform:gift", {
      id: "eur", amount: 4, currency: "EUR",
    }));

    expect(service.snapshot.currentUsd).toBe(6.1);
    expect(diagnostics).toContain("Skipped gift with missing or non-positive amount: youtube");
  });

  test("zero configured unit and membership values disable those contributions", async () => {
    const service = await createFundingGoalService(options({ monetizationValuesConfig: {
      tiktokGiftUnitUsd: 0, twitchBitUsd: 0, youtubeJewelUsd: 0,
      tiktokMembershipUsd: 0, twitchMembershipUsd: 0, youtubeMembershipUsd: 0,
    } }));

    await service.processPlatformEvent(event("tiktok", "platform:gift", { id: "gift", amount: 100, currency: "coins" }));
    await service.processPlatformEvent(event("twitch", "platform:gift", { id: "bits", amount: 100, currency: "bits" }));
    await service.processPlatformEvent(event("youtube", "platform:gift", { id: "jewels", amount: 20, currency: "jewels" }));
    await service.processPlatformEvent(event("youtube", "platform:paypiggy", { id: "member", timestamp: "2026-08-18T00:00:00.000Z" }));

    expect(service.snapshot.currentUsd).toBe(0);
  });

  test("values ordinary and gifted memberships with existing platform equivalents", async () => {
    const service = await createFundingGoalService(options());

    await service.processPlatformEvent(event("tiktok", "platform:paypiggy", { id: "tt-sub", timestamp: "2026-08-18T00:00:00.000Z" }));
    await service.processPlatformEvent(event("twitch", "platform:giftpaypiggy", { id: "tw-gift-sub", giftCount: 2, timestamp: "2026-08-18T00:00:01.000Z" }));
    await service.processPlatformEvent(event("youtube", "platform:paypiggy", { id: "yt-member", timestamp: "2026-08-18T00:00:02.000Z" }));

    expect(service.snapshot.currentUsd).toBe(12.99);
  });

  test("deduplicates event IDs and fallback membership fingerprints across restarts", async () => {
    const fs = memoryFileSystem();
    const first = await createFundingGoalService(options({ fs }));
    const gift = event("youtube", "platform:gift", { id: "same-gift", amount: 5, currency: "USD" });
    const membership = event("twitch", "platform:paypiggy", {
      userId: "test-user",
      tier: "1000",
      timestamp: "2026-08-18T00:00:00.000Z",
    });

    await first.processPlatformEvent(gift);
    await first.processPlatformEvent(gift);
    await first.processPlatformEvent(membership);
    const second = await createFundingGoalService(options({ fs }));
    await second.processPlatformEvent(gift);
    await second.processPlatformEvent(membership);

    expect(second.snapshot.currentUsd).toBe(8.5);
    const persisted = JSON.parse(fs.value ?? "null") as Record<string, unknown>;
    expect(JSON.stringify(persisted)).not.toContain("test-user");
    expect(JSON.stringify(persisted)).not.toContain("same-gift");
  });

  test("rejects fractional gifted membership counts", async () => {
    const service = await createFundingGoalService(options());

    await service.processPlatformEvent(event("youtube", "platform:giftpaypiggy", {
      id: "fractional-memberships",
      giftCount: 1.5,
      timestamp: "2026-08-18T00:00:00.000Z",
    }));

    expect(service.snapshot.currentUsd).toBe(0);
  });

  test("keeps numeric provider IDs distinct and bounds the persisted replay horizon", async () => {
    const fs = memoryFileSystem();
    const service = await createFundingGoalService(options({ fs, maxProcessedEventKeys: 2 }));
    const shared = { amount: 1, currency: "USD", timestamp: "2026-08-18T00:00:00.000Z" };

    await service.processPlatformEvent(event("youtube", "platform:gift", { ...shared, id: 1 }));
    await service.processPlatformEvent(event("youtube", "platform:gift", { ...shared, id: 2 }));
    await service.processPlatformEvent(event("youtube", "platform:gift", { ...shared, id: 3 }));

    expect(service.snapshot.currentUsd).toBe(3);
    const persisted = JSON.parse(fs.value ?? "null") as { processedEventKeys: string[] };
    expect(persisted.processedEventKeys).toHaveLength(2);
  });

  test("does not count TikTok envelopes because they are viewer redistribution events", async () => {
    const service = await createFundingGoalService(options());

    await service.processPlatformEvent(event("tiktok", "platform:envelope", {
      id: "envelope-1",
      amount: 100,
      currency: "coins",
      timestamp: "2026-08-18T00:00:00.000Z",
    }));

    expect(service.snapshot.currentUsd).toBe(0);
  });

  test("serializes manual updates, shows over-goal totals, and preserves state after write failure", async () => {
    const fs = memoryFileSystem(undefined, 1);
    const service = await createFundingGoalService(options({ fs }));

    await expect(service.adjust(1)).rejects.toThrow("write failed");
    expect(service.snapshot.currentUsd).toBe(0);
    await Promise.all([service.adjust(60), service.adjust(50)]);

    expect(service.snapshot.currentUsd).toBe(110);
    expect(service.snapshot.completed).toBe(true);
    await service.setTotal(12.34);
    expect(service.snapshot.currentUsd).toBe(12.34);
  });

  test("supports signed adjustments without allowing a negative total", async () => {
    const service = await createFundingGoalService(options());

    await expect(service.adjust(-1)).rejects.toThrow("cannot be negative");
    expect(service.snapshot.currentUsd).toBe(0);
    expect(service.snapshot.revision).toBe(0);
    await service.adjust(10);
    await service.adjust(1);
    await service.adjust(-1);

    expect(service.snapshot.currentUsd).toBe(10);
    await expect(service.adjust(0)).rejects.toThrow("finite nonzero amount");
  });

  test("resets persisted progress when the configured goal ID changes", async () => {
    const fs = memoryFileSystem();
    const first = await createFundingGoalService(options({ fs }));
    await first.adjust(25);

    const second = await createFundingGoalService(options({
      fs,
      config: { ...options().config, id: "microphone", label: "🎙️ New Microphone" },
    }));

    expect(second.snapshot.currentUsd).toBe(0);
    expect(second.snapshot.label).toBe("🎙️ New Microphone");
  });

  test("validates Unicode labels, persists overrides, and restores them after restart", async () => {
    const fs = memoryFileSystem();
    const first = await createFundingGoalService(options({ fs }));
    await expect(first.setLabel("   ")).rejects.toThrow("must not be empty");
    await expect(first.setLabel("bad\nlabel")).rejects.toThrow("control characters");
    await expect(first.setLabel("hidden\u200Blabel")).rejects.toThrow("format characters");
    await expect(first.setLabel("spoofed\u202Elabel")).rejects.toThrow("format characters");
    await expect(first.setLabel("x".repeat(81))).rejects.toThrow("at most 80");
    const label = "  🚀 family‍👩‍👧‍👦  ";
    await first.setLabel(label);
    expect(first.snapshot).toMatchObject({ label: label.trim(), labelOverridden: true, revision: 1 });
    const second = await createFundingGoalService(options({ fs }));
    expect(second.snapshot).toMatchObject({ label: label.trim(), labelOverridden: true, revision: 1 });
    await second.resetLabel();
    expect(second.snapshot).toMatchObject({ label: "🎮 New Controller", labelOverridden: false, revision: 2 });
    const third = await createFundingGoalService(options({ fs }));
    expect(third.snapshot).toMatchObject({ label: "🎮 New Controller", labelOverridden: false, revision: 2 });
    expect(JSON.parse(fs.value ?? "null")).not.toHaveProperty("labelOverride");
  });

  test("failed label reset preserves the override and can be retried durably", async () => {
    const fs = memoryFileSystem();
    const writeFile = fs.writeFile;
    let rejectWrites = false;
    fs.writeFile = async (...args) => {
      if (rejectWrites) throw new Error("synthetic reset write failure");
      return writeFile(...args);
    };
    const service = await createFundingGoalService(options({ fs }));
    await service.setLabel("Synthetic replacement goal");
    const revisions: number[] = [];
    service.subscribe(snapshot => revisions.push(snapshot.revision));

    rejectWrites = true;
    await expect(service.resetLabel()).rejects.toThrow("synthetic reset write failure");
    expect(service.snapshot).toMatchObject({ label: "Synthetic replacement goal", labelOverridden: true, revision: 1 });
    const unchanged = await createFundingGoalService(options({ fs }));
    expect(unchanged.snapshot).toMatchObject({ label: "Synthetic replacement goal", labelOverridden: true, revision: 1 });
    expect(revisions).toEqual([]);

    rejectWrites = false;
    await service.resetLabel();
    const restarted = await createFundingGoalService(options({ fs }));
    expect(restarted.snapshot).toMatchObject({ label: "🎮 New Controller", labelOverridden: false, revision: 2 });
    expect(revisions).toEqual([2]);
  });

  test("loads old state without a label override and avoids no-op revisions", async () => {
    const fs = memoryFileSystem(JSON.stringify({ version: 1, goalId: "controller", currentMicros: 0, processedEventKeys: [], revision: 4 }));
    const service = await createFundingGoalService(options({ fs }));
    const revisions: number[] = [];
    service.subscribe(snapshot => revisions.push(snapshot.revision));
    await service.resetLabel();
    await service.setLabel("🎮 New Controller");
    expect(service.snapshot).toMatchObject({ label: "🎮 New Controller", labelOverridden: false, revision: 4 });
    expect(revisions).toEqual([]);
  });

  test("does not partially apply state when the persisted label is malformed", async () => {
    const fs = memoryFileSystem(JSON.stringify({ version: 1, goalId: "controller", currentMicros: 5000000, processedEventKeys: ["x"], revision: 9, labelOverride: "bad\nlabel" }));
    const service = await createFundingGoalService(options({ fs }));
    expect(service.snapshot).toMatchObject({ currentUsd: 0, revision: 0, label: "🎮 New Controller", labelOverridden: false });
  });

  test("raw publication cannot credit funding; explicit presentation publishes immutable snapshots", async () => {
    let handler: ((payload: unknown) => unknown) | undefined;
    let unsubscribed = false;
    const service = await createFundingGoalService(options({
      eventBus: {
        subscribe: (_name, nextHandler) => {
          handler = nextHandler;
          return () => { unsubscribed = true; };
        },
      },
    }));
    const revisions: number[] = [];
    service.subscribe((snapshot) => revisions.push(snapshot.revision));

    await handler?.(event("youtube", "platform:gift", { id: "yt-1", amount: 5, currency: "USD" }));
    expect(service.snapshot.currentUsd).toBe(0);
    expect(handler).toBeUndefined();
    await service.processPresentedContributions([event("youtube", "platform:gift", { id: "yt-1", amount: 5, currency: "USD" })]);
    await service.dispose();

    expect(revisions).toEqual([1]);
    expect(Object.isFrozen(service.snapshot)).toBe(true);
    expect(unsubscribed).toBe(false);
  });

  test("presentation batches partially deduplicate version1 sources atomically across restart", async () => {
    const fs = memoryFileSystem();
    const old = event("youtube", "platform:gift", { id: 123, amount: 2, currency: "USD" });
    const fresh = event("twitch", "platform:gift", { id: "synthetic-bits", amount: 100, currency: "bits" });
    const first = await createFundingGoalService(options({ fs }));
    await first.processPlatformEvent(old);
    const second = await createFundingGoalService(options({ fs }));
    const revisions: number[] = [];
    second.subscribe(snapshot => revisions.push(snapshot.revision));
    await second.processPresentedContributions([old, fresh, fresh, null]);
    expect(second.snapshot).toMatchObject({ currentUsd: 3, revision: 2 });
    expect(revisions).toEqual([2]);
    expect(JSON.parse(fs.value ?? "null")).toMatchObject({ version: 1, currentMicros: 3000000, revision: 2 });
    const third = await createFundingGoalService(options({ fs }));
    await third.processPresentedContributions([old, fresh]);
    expect(third.snapshot).toMatchObject({ currentUsd: 3, revision: 2 });
  });

  test("failed batch preserves all state and explicit retry credits once", async () => {
    const fs = memoryFileSystem(undefined, 1);
    const service = await createFundingGoalService(options({ fs }));
    const batch = [
      event("tiktok", "platform:gift", { id: "synthetic-coins", amount: 100, currency: "coins" }),
      event("twitch", "platform:giftpaypiggy", { id: "synthetic-members", giftCount: 2 }),
    ];
    const revisions: number[] = [];
    service.subscribe(snapshot => revisions.push(snapshot.revision));
    await expect(service.processPresentedContributions(batch)).rejects.toThrow("write failed");
    expect(service.snapshot).toMatchObject({ currentUsd: 0, revision: 0 });
    expect(fs.value).toBeUndefined();
    expect(revisions).toEqual([]);
    await service.processPresentedContributions(batch);
    await service.processPresentedContributions(batch);
    expect(service.snapshot).toMatchObject({ currentUsd: 7.5, revision: 1 });
    expect(revisions).toEqual([1]);
  });

  test("filters malformed and zero-valued sources without writes and rejects overflow atomically", async () => {
    const fs = memoryFileSystem();
    const service = await createFundingGoalService(options({ fs }));
    await service.processPresentedContributions([
      null, [], {}, event("youtube", "platform:gift", { amount: 3, currency: "USD" }),
      event("youtube", "platform:gift", { id: "synthetic-zero", amount: 0, currency: "USD" }),
      event("youtube", "platform:gift", { id: "synthetic-error", amount: 3, currency: "USD", isError: true }),
    ]);
    expect(fs.value).toBeUndefined();
    const valid = event("youtube", "platform:gift", { id: "synthetic-valid", amount: 2, currency: "USD" });
    await expect(service.processPresentedContributions([
      valid, event("youtube", "platform:gift", { id: "synthetic-overflow", amount: Number.MAX_SAFE_INTEGER, currency: "USD" }),
    ])).rejects.toThrow("supported range");
    expect(service.snapshot).toMatchObject({ currentUsd: 0, revision: 0 });
    expect(fs.value).toBeUndefined();
    await service.processPresentedContributions([valid]);
    expect(service.snapshot).toMatchObject({ currentUsd: 2, revision: 1 });
  });

  test("dispose stops new work and waits for an in-flight persistence", async () => {
    let releaseWrite!: () => void;
    let writeStarted!: () => void;
    const started = new Promise<void>((resolve) => { writeStarted = resolve; });
    const fs = memoryFileSystem();
    const blockedFs: FundingGoalFileSystem = {
      ...fs,
      writeFile: async (...args) => {
        if (!releaseWrite) {
          writeStarted();
          await new Promise<void>((resolve) => { releaseWrite = resolve; });
        }
        return fs.writeFile(...args);
      },
    };
    const service = await createFundingGoalService(options({ fs: blockedFs }));
    const accepted = service.processPresentedContributions([
      event("youtube", "platform:gift", { id: "synthetic-blocked", amount: 5, currency: "USD" }),
    ]);
    await started;
    const queued = service.adjust(2);

    let disposed = false;
    const disposing = service.dispose().then(() => { disposed = true; });
    await Promise.resolve();
    expect(disposed).toBe(false);
    await expect(service.adjust(1)).rejects.toThrow("disposed");
    await expect(service.processPresentedContributions([])).rejects.toThrow("disposed");

    releaseWrite();
    await accepted;
    await queued;
    await disposing;
    expect(disposed).toBe(true);
    expect(service.snapshot.currentUsd).toBe(7);
  });
});
