import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { restoreAllMocks } from "../../helpers/bun-mock-utils";
import { TEST_TIMEOUTS } from "../../helpers/test-setup";
import testClock from "../../helpers/test-clock";
import { GoalTracker } from "../../../src/utils/goal-tracker";

type GoalState = NonNullable<ReturnType<GoalTracker["getGoalState"]>>;
type DonationResult = ReturnType<GoalTracker["addDonationToGoal"]>;

const requireGoalState = (
  state: ReturnType<GoalTracker["getGoalState"]>,
  platform: string,
): GoalState => {
  if (state === null) {
    throw new Error(`Expected ${platform} goal state`);
  }
  return state;
};

describe("Goal Tracker - Core Functionality", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  let goalTracker: GoalTracker;
  let configFixture: Record<string, unknown>;

  beforeEach(() => {
    configFixture = {
      enabled: true,
      tiktokGoalEnabled: true,
      tiktokGoalSource: "tiktok goal txt",
      tiktokGoalTarget: 1000,
      tiktokGoalCurrency: "coins",
      tiktokPaypiggyEquivalent: 50,
      youtubeGoalEnabled: true,
      youtubeGoalSource: "youtube goal txt",
      youtubeGoalTarget: 1.0,
      youtubeGoalCurrency: "dollars",
      youtubePaypiggyPrice: 4.99,
      twitchGoalEnabled: true,
      twitchGoalSource: "twitch goal txt",
      twitchGoalTarget: 100,
      twitchGoalCurrency: "bits",
      twitchPaypiggyEquivalent: 350,
    };

    goalTracker = new GoalTracker({
      config: { goals: configFixture },
    });
  });

  describe("Goal Tracker Initialization", () => {
    test(
      "should initialize with default state",
      async () => {
        await goalTracker.initializeGoalTracker();

        const state = goalTracker.getAllGoalStates();
        const tiktokState = requireGoalState(state.tiktok, "tiktok");
        const youtubeState = requireGoalState(state.youtube, "youtube");
        const twitchState = requireGoalState(state.twitch, "twitch");

        expect(tiktokState.current).toBe(0);
        expect(tiktokState.target).toBe(1000);
        expect(tiktokState.currency).toBe("coins");

        expect(youtubeState.current).toBe(0);
        expect(youtubeState.target).toBe(1.0);
        expect(youtubeState.currency).toBe("USD");

        expect(twitchState.current).toBe(0);
        expect(twitchState.target).toBe(100);
        expect(twitchState.currency).toBe("bits");
      },
      TEST_TIMEOUTS.FAST,
    );
  });

  describe("Donation Processing", () => {
    beforeEach(async () => {
      await goalTracker.initializeGoalTracker();
    });

    test(
      "should process TikTok donation correctly",
      async () => {
        const result = await goalTracker.addDonationToGoal("tiktok", 500);

        expect(result.success).toBe(true);
        expect(result.newTotal).toBe(500);
        expect(result.target).toBe(1000);
        expect(result.percentage).toBe(50);
        expect(result.goalCompleted).toBe(false);
        expect(result.formatted).toBe("0500/1000 coins");
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should process YouTube donation correctly",
      async () => {
        const result = await goalTracker.addDonationToGoal("youtube", 0.5, "USD");

        expect(result.success).toBe(true);
        expect(result.newTotal).toBe(0.5);
        expect(result.target).toBe(1.0);
        expect(result.percentage).toBe(50);
        expect(result.goalCompleted).toBe(false);
        expect(result.formatted).toBe("$0.50/$1.00");
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should skip donation when contribution currency does not match goal currency",
      async () => {
        const result = await goalTracker.addDonationToGoal("youtube", 500, "jewels");
        const state = requireGoalState(goalTracker.getGoalState("youtube"), "youtube");

        expect(result.success).toBe(false);
        expect(result.error).toContain("does not match");
        expect(result.skipped).toBe(true);
        expect(state.current).toBe(0);
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should accept YouTube jewels only when the YouTube goal currency is jewels",
      async () => {
        goalTracker = new GoalTracker({
          config: {
            goals: {
              ...configFixture,
              youtubeGoalTarget: 500,
              youtubeGoalCurrency: "jewels",
            },
          },
        });
        await goalTracker.initializeGoalTracker();

        const jewelsResult = await goalTracker.addDonationToGoal("youtube", 250, "jewels");
        const usdResult = await goalTracker.addDonationToGoal("youtube", 1, "USD");

        expect(jewelsResult.success).toBe(true);
        expect(jewelsResult.formatted).toBe("250.00/500.00 jewels");
        expect(usdResult.success).toBe(false);
        expect(requireGoalState(goalTracker.getGoalState("youtube"), "youtube").current).toBe(250);
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should process Twitch donation correctly",
      async () => {
        const result = await goalTracker.addDonationToGoal("twitch", 50);

        expect(result.success).toBe(true);
        expect(result.newTotal).toBe(50);
        expect(result.target).toBe(100);
        expect(result.percentage).toBe(50);
        expect(result.goalCompleted).toBe(false);
        expect(result.formatted).toBe("050/100 bits");
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should handle goal completion",
      async () => {
        const result = await goalTracker.addDonationToGoal("tiktok", 1000);

        expect(result.success).toBe(true);
        expect(result.newTotal).toBe(1000);
        expect(result.percentage).toBe(100);
        expect(result.goalCompleted).toBe(true);
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should handle goal exceeding",
      async () => {
        const result = await goalTracker.addDonationToGoal("youtube", 2.5);

        expect(result.success).toBe(true);
        expect(result.newTotal).toBe(2.5);
        expect(result.percentage).toBe(250);
        expect(result.goalCompleted).toBe(true);
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should reject invalid platform",
      async () => {
        const result = await goalTracker.addDonationToGoal("invalid", 100);

        expect(result.success).toBe(false);
        expect(result.error).toContain("Invalid platform");
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should reject negative amounts",
      async () => {
        const result = await goalTracker.addDonationToGoal("tiktok", -50);

        expect(result.success).toBe(false);
        expect(result.error).toContain("must be positive");
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should reject zero amounts",
      async () => {
        const result = await goalTracker.addDonationToGoal("tiktok", 0);

        expect(result.success).toBe(false);
        expect(result.error).toContain("must be positive");
      },
      TEST_TIMEOUTS.FAST,
    );
  });

  describe("Paypiggy Processing", () => {
    beforeEach(async () => {
      await goalTracker.initializeGoalTracker();
    });

    test(
      "should process TikTok paypiggy",
      async () => {
        const result = await goalTracker.addPaypiggyToGoal("tiktok");

        expect(result.success).toBe(true);
        expect(result.newTotal).toBe(50);
        if (!("paypiggyValue" in result)) {
          throw new Error("Expected TikTok paypiggy result value");
        }
        expect(result.paypiggyValue).toBe(50);
        if (!("paypiggyCount" in result)) {
          throw new Error("Expected TikTok paypiggy result count");
        }
        expect(result.paypiggyCount).toBe(1);
        expect(result.formatted).toBe("0050/1000 coins");
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should multiply paypiggy value by gifted count",
      async () => {
        const result = await goalTracker.addPaypiggyToGoal("twitch", 3);

        expect(result.success).toBe(true);
        expect(result.newTotal).toBe(1050);
        if (!("paypiggyValue" in result) || !("paypiggyCount" in result)) {
          throw new Error("Expected Twitch paypiggy result value and count");
        }
        expect(result.paypiggyValue).toBe(350);
        expect(result.paypiggyCount).toBe(3);
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should reject invalid paypiggy counts",
      async () => {
        const result = await goalTracker.addPaypiggyToGoal("twitch", 0);

        expect(result.success).toBe(false);
        expect(result.error).toContain("positive integer");
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should skip YouTube paypiggy when the YouTube goal tracks jewels",
      async () => {
        goalTracker = new GoalTracker({
          config: {
            goals: {
              ...configFixture,
              youtubeGoalTarget: 500,
              youtubeGoalCurrency: "jewels",
            },
          },
        });
        await goalTracker.initializeGoalTracker();

        const result = await goalTracker.addPaypiggyToGoal("youtube");

        expect(result.success).toBe(false);
        expect(result.error).toContain("does not match");
        expect(requireGoalState(goalTracker.getGoalState("youtube"), "youtube").current).toBe(0);
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should process YouTube paypiggy",
      async () => {
        const result = await goalTracker.addPaypiggyToGoal("youtube");

        expect(result.success).toBe(true);
        expect(result.newTotal).toBe(4.99);
        if (!("paypiggyValue" in result)) {
          throw new Error("Expected YouTube paypiggy result value");
        }
        expect(result.paypiggyValue).toBe(4.99);
        expect(result.goalCompleted).toBe(true);
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should process Twitch paypiggy",
      async () => {
        const result = await goalTracker.addPaypiggyToGoal("twitch");

        expect(result.success).toBe(true);
        expect(result.newTotal).toBe(350);
        if (!("paypiggyValue" in result)) {
          throw new Error("Expected Twitch paypiggy result value");
        }
        expect(result.paypiggyValue).toBe(350);
        expect(result.goalCompleted).toBe(true);
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should reject invalid platform",
      async () => {
        const result = await goalTracker.addPaypiggyToGoal("invalid");

        expect(result.success).toBe(false);
        expect(result.error).toContain("Invalid platform");
      },
      TEST_TIMEOUTS.FAST,
    );
  });

  describe("Currency Formatting", () => {
    beforeEach(async () => {
      await goalTracker.initializeGoalTracker();
    });

    test(
      "should format TikTok coins correctly",
      () => {
        const formatted = goalTracker.formatGoalDisplay("tiktok", 123, 1000);
        expect(formatted).toBe("0123/1000 coins");
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should format YouTube dollars correctly",
      () => {
        const formatted = goalTracker.formatGoalDisplay("youtube", 1.5, 10.0);
        expect(formatted).toBe("$1.50/$10.00");
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should format Twitch bits correctly",
      () => {
        const formatted = goalTracker.formatGoalDisplay("twitch", 75, 200);
        expect(formatted).toBe("075/200 bits");
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should handle edge case formatting",
      () => {
        const formatted = goalTracker.formatGoalDisplay("youtube", 0.1, 1.0);
        expect(formatted).toBe("$0.10/$1.00");
      },
      TEST_TIMEOUTS.FAST,
    );
  });

  describe("Multi-Platform Scenario", () => {
    test(
      "should handle the exact scenario: $0.50, 50 bits, 500 coins",
      async () => {
        await goalTracker.initializeGoalTracker();

        const youtubeResult = await goalTracker.addDonationToGoal(
          "youtube",
          0.5,
        );
        expect(youtubeResult.success).toBe(true);
        expect(youtubeResult.newTotal).toBe(0.5);
        expect(youtubeResult.formatted).toBe("$0.50/$1.00");
        expect(youtubeResult.percentage).toBe(50);

        const twitchResult = await goalTracker.addDonationToGoal("twitch", 50);
        expect(twitchResult.success).toBe(true);
        expect(twitchResult.newTotal).toBe(50);
        expect(twitchResult.formatted).toBe("050/100 bits");
        expect(twitchResult.percentage).toBe(50);

        const tiktokResult = await goalTracker.addDonationToGoal("tiktok", 500);
        expect(tiktokResult.success).toBe(true);
        expect(tiktokResult.newTotal).toBe(500);
        expect(tiktokResult.formatted).toBe("0500/1000 coins");
        expect(tiktokResult.percentage).toBe(50);

        const finalState = goalTracker.getAllGoalStates();
        expect(requireGoalState(finalState.tiktok, "tiktok").current).toBe(500);
        expect(requireGoalState(finalState.youtube, "youtube").current).toBe(0.5);
        expect(requireGoalState(finalState.twitch, "twitch").current).toBe(50);
      },
      TEST_TIMEOUTS.MEDIUM,
    );
  });

  describe("Input Validation", () => {
    beforeEach(async () => {
      await goalTracker.initializeGoalTracker();
    });

    test(
      "returns error for null platform",
      async () => {
        const result = await goalTracker.addDonationToGoal(null, 100);
        expect(result.success).toBe(false);
        expect(result.error).toContain("Invalid platform");
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "returns error for non-string platform",
      async () => {
        const result = await goalTracker.addDonationToGoal(123, 100);
        expect(result.success).toBe(false);
        expect(result.error).toContain("Invalid platform");
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "coerces numeric string amounts",
      async () => {
        const result = await goalTracker.addDonationToGoal("tiktok", "50");
        expect(result.success).toBe(true);
        expect(result.newTotal).toBe(50);
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "rejects NaN amounts",
      async () => {
        const result = await goalTracker.addDonationToGoal("tiktok", NaN);
        expect(result.success).toBe(false);
        expect(result.error).toContain("must be positive");
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "rejects Infinity amounts",
      async () => {
        const result = await goalTracker.addDonationToGoal("tiktok", Infinity);
        expect(result.success).toBe(false);
        expect(result.error).toContain("must be positive");
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "addPaypiggyToGoal returns error for null platform",
      async () => {
        const result = await goalTracker.addPaypiggyToGoal(null);
        expect(result.success).toBe(false);
        expect(result.error).toContain("Invalid platform");
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "formatGoalDisplay handles string targets without throwing",
      () => {
        const formatted = goalTracker.formatGoalDisplay(
          "youtube",
          "1.5",
          "10.00",
        );
        expect(formatted).toBe("$1.50/$10.00");
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "percentage is 0 when target is zero",
      async () => {
        goalTracker.goalState.tiktok.target = 0;
        const result = await goalTracker.addDonationToGoal("tiktok", 100);
        expect(result.success).toBe(true);
        expect(Number.isFinite(result.percentage)).toBe(true);
        expect(result.percentage).toBe(0);
      },
      TEST_TIMEOUTS.FAST,
    );
  });

  describe("Performance Tests", () => {
    beforeEach(async () => {
      await goalTracker.initializeGoalTracker();
    });

    test(
      "should handle multiple rapid donations",
      async () => {
        const promises: DonationResult[] = [];
        for (let i = 1; i <= 10; i++) {
          promises.push(goalTracker.addDonationToGoal("tiktok", 10));
        }

        const results = await Promise.all(promises);

        results.forEach((result) => {
          expect(result.success).toBe(true);
        });

        const finalState = goalTracker.getGoalState("tiktok");
        expect(requireGoalState(finalState, "tiktok").current).toBe(100); // 10 donations of 10 each
      },
      TEST_TIMEOUTS.MEDIUM,
    );

    test(
      "should maintain performance with many operations",
      () => {
        const startTime = testClock.now();

        for (let i = 0; i < 1000; i++) {
          goalTracker.getAllGoalStates();
          goalTracker.formatGoalDisplay("tiktok", i, 1000);
          testClock.advance(0.05);
        }

        const duration = testClock.now() - startTime;
        expect(duration).toBeLessThan(100); // Should complete in under 100ms
      },
      TEST_TIMEOUTS.FAST,
    );
  });
});
