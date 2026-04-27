import { describe, expect, beforeEach, it, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { initializeTestLogging } from "../../helpers/test-setup";
import * as testClock from "../../helpers/test-clock";
import * as goals from "../../../src/obs/goals.ts";
import {
  OBSGoalsManager,
  createOBSGoalsManager,
  getDefaultGoalsManager,
  resetDefaultGoalsManager,
} from "../../../src/obs/goals.ts";

initializeTestLogging();

describe("OBSGoalsManager DI requirements", () => {
  afterEach(() => {
    restoreAllMocks();
    resetDefaultGoalsManager();
  });

  beforeEach(() => {
    initializeTestLogging();
  });

it("exports only the DI public API surface", () => {
    const exportedKeys = Object.keys(goals).sort();
    expect(exportedKeys).toEqual([
      "OBSGoalsManager",
      "createOBSGoalsManager",
      "getDefaultGoalsManager",
      "resetDefaultGoalsManager",
    ]);
  });

  it("requires an OBS manager in the constructor", () => {
    expect(() => new OBSGoalsManager()).toThrow(
      /OBSGoalsManager requires OBSConnectionManager/,
    );
  });

it("returns goal status from injected goal tracker", async () => {
    const mockObsManager = {
      isConnected: createMockFn().mockReturnValue(true),
      ensureConnected: createMockFn(),
      call: createMockFn(),
      addEventListener: createMockFn(),
      removeEventListener: createMockFn(),
    };

    const mockGoalTracker = {
      initializeGoalTracker: createMockFn().mockResolvedValue(),
      addDonationToGoal: createMockFn(),
      addPaypiggyToGoal: createMockFn(),
      getGoalState: createMockFn().mockReturnValue({
        current: 100,
        target: 500,
        formatted: "100/500",
      }),
      getAllGoalStates: createMockFn().mockReturnValue({}),
    };

    const goalsManager = createOBSGoalsManager(mockObsManager, {
      logger: noOpLogger,
      config: {
        goals: {
          enabled: true,
          tiktokGoalEnabled: true,
          youtubeGoalEnabled: true,
          twitchGoalEnabled: true,
        },
      },
      updateTextSource: createMockFn(),
      goalTracker: mockGoalTracker,
    });

    const status = await goalsManager.getCurrentGoalStatus("tiktok");

  expect(status).toEqual({ current: 100, target: 500, formatted: "100/500" });
});

it("writes goal text through injected updateTextSource", async () => {
    const mockObsManager = {
      isConnected: createMockFn().mockReturnValue(true),
      ensureConnected: createMockFn(),
      call: createMockFn(),
      addEventListener: createMockFn(),
      removeEventListener: createMockFn(),
    };
    const updateTextSource = createMockFn().mockResolvedValue();

    const goalsManager = createOBSGoalsManager(mockObsManager, {
      logger: noOpLogger,
      config: {
        goals: {
          enabled: true,
          tiktokGoalEnabled: true,
          tiktokGoalSource: "test-tiktok-goal-source",
        },
      },
      updateTextSource,
      goalTracker: {
        initializeGoalTracker: createMockFn().mockResolvedValue(),
        addDonationToGoal: createMockFn().mockResolvedValue({
          success: true,
          formatted: "25/100",
        }),
        addPaypiggyToGoal: createMockFn().mockResolvedValue({
          success: true,
          formatted: "25/100",
        }),
        getGoalState: createMockFn().mockReturnValue({ formatted: "25/100" }),
        getAllGoalStates: createMockFn().mockReturnValue({
          tiktok: { formatted: "25/100" },
        }),
      },
    });

    await goalsManager.updateGoalDisplay("tiktok", "25/100");

  expect(updateTextSource.mock.calls).toEqual([
    ["test-tiktok-goal-source", "25/100"],
  ]);
});

it("writes goal updates through injected default-manager dependencies", async () => {
    const updateTextSource = createMockFn().mockResolvedValue();
    const goalTracker = {
      initializeGoalTracker: createMockFn().mockResolvedValue(),
      addDonationToGoal: createMockFn().mockResolvedValue({
        success: true,
        formatted: "30/100",
      }),
      addPaypiggyToGoal: createMockFn().mockResolvedValue({
        success: true,
        formatted: "30/100",
      }),
      getGoalState: createMockFn().mockReturnValue({ formatted: "30/100" }),
      getAllGoalStates: createMockFn().mockReturnValue({
        tiktok: { formatted: "30/100" },
      }),
    };

    const freshGoals = await import(
      `../../../src/obs/goals.ts?test-default-update-source=${testClock.now()}`
    );
    const defaultGoalsManager = freshGoals.getDefaultGoalsManager({
      config: {
        goals: {
          enabled: true,
          tiktokGoalEnabled: true,
          tiktokGoalSource: "test-default-tiktok-goal-source",
        },
      },
      obsManager: {
        isConnected: createMockFn().mockReturnValue(true),
      },
      updateTextSource,
      goalTracker,
    });

    await defaultGoalsManager.updateGoalDisplay("tiktok", "30/100");

  expect(updateTextSource.mock.calls).toEqual([
    ["test-default-tiktok-goal-source", "30/100"],
  ]);
});

  it("supports resetting default goals manager singleton", () => {
    const first = getDefaultGoalsManager({
      config: { goals: { enabled: false } },
      obsManager: { isConnected: () => false },
    });

    resetDefaultGoalsManager();

    const second = getDefaultGoalsManager({
      config: { goals: { enabled: false } },
      obsManager: { isConnected: () => false },
    });

    expect(second).not.toBe(first);
  });
});
