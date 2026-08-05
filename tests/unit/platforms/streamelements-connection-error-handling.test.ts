import { describe, it, expect, afterEach } from "bun:test";
import { restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createStreamElementsConfigFixture } from "../../helpers/config-fixture";
import { useFakeTimers, useRealTimers, advanceTimersByTime } from "../../helpers/bun-timers";
import { StreamElementsPlatform } from "../../../src/platforms/streamelements";

afterEach(() => {
  useRealTimers();
  restoreAllMocks();
});

const createPlatform = () => {
  const retrySystem = {
    incrementRetryCount: () => 10,
    resetRetryCount: () => undefined,
  };
  return {
    platform: new StreamElementsPlatform(createStreamElementsConfigFixture(), {
      logger: noOpLogger,
      retrySystem,
    }),
    retrySystem,
  };
};

describe("StreamElementsPlatform connection recovery", () => {
  it("uses one local reconnect attempt when error is followed by close", () => {
    useFakeTimers();
    const { platform } = createPlatform();
    let attempts = 0;
    platform.connect = async () => {
      attempts += 1;
      return false;
    };

    platform.handleConnectionError(new Error("connection lost"));
    platform.handleConnectionClose(1006, "lost");
    advanceTimersByTime(10);

    expect(attempts).toBe(1);
  });

  it("cancels recovery on disconnect after a failure", async () => {
    useFakeTimers();
    const { platform } = createPlatform();
    let attempts = 0;
    platform.connect = async () => {
      attempts += 1;
      return false;
    };

    platform.handleConnectionError(new Error("connection lost"));
    await platform.disconnect();
    advanceTimersByTime(10);

    expect(attempts).toBe(0);
  });

  it("ignores an in-flight connection failure after disconnect", async () => {
    useFakeTimers();
    const { platform } = createPlatform();
    let attempts = 0;
    platform.connect = async () => {
      attempts += 1;
      return false;
    };

    const staleGeneration = 0;
    await platform.disconnect();
    platform.handleConnectionError(new Error("late failure"), staleGeneration);
    advanceTimersByTime(20);

    expect(attempts).toBe(0);
  });
});
