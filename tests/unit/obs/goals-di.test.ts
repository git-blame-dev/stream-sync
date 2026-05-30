import { describe, expect, beforeEach, it, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
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

type ObsManagerFixture = Parameters<typeof createOBSGoalsManager>[0];
type GoalsDependencies = NonNullable<Parameters<typeof createOBSGoalsManager>[1]>;
type GoalTrackerFixture = NonNullable<GoalsDependencies["goalTracker"]>;
type UpdateTextSource = NonNullable<GoalsDependencies["updateTextSource"]>;

const createObsManagerFixture = (): ObsManagerFixture => ({
  isConnected: createMockFn<[], boolean>(() => true),
});

const createGoalTrackerFixture = (
  formatted: string,
  currentState: Record<string, unknown> = { formatted },
): GoalTrackerFixture => ({
  initializeGoalTracker: createMockFn<[], Promise<void>>(() => Promise.resolve()),
  addDonationToGoal: createMockFn<[string, number, string?], Promise<{ success: boolean; formatted: string }>>(async () => ({
    success: true,
    formatted,
  })),
  addPaypiggyToGoal: createMockFn<[string, number?], Promise<{ success: boolean; formatted: string }>>(async () => ({
    success: true,
    formatted,
  })),
  getGoalState: createMockFn<[string], Record<string, unknown> | null>(() => currentState),
  getAllGoalStates: createMockFn<[], Record<string, Record<string, unknown> | null>>(() => ({
    tiktok: currentState,
  })),
});

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
    expect(() => Reflect.construct(OBSGoalsManager, [])).toThrow(
      /OBSGoalsManager requires OBSConnectionManager/,
    );
  });

  it("returns goal status from injected goal tracker", async () => {
    const mockObsManager = createObsManagerFixture();
    const mockGoalTracker = createGoalTrackerFixture("100/500", {
      current: 100,
      target: 500,
      formatted: "100/500",
    });

    const goalsManager = createOBSGoalsManager(mockObsManager, {
      config: {
        goals: {
          enabled: true,
          tiktokGoalEnabled: true,
          youtubeGoalEnabled: true,
          twitchGoalEnabled: true,
        },
      },
      updateTextSource: createMockFn<[string, string?], Promise<void>>(() => Promise.resolve()),
      goalTracker: mockGoalTracker,
    });

    const status = await goalsManager.getCurrentGoalStatus("tiktok");

    expect(status).toEqual({ current: 100, target: 500, formatted: "100/500" });
  });

  it("writes goal text through injected updateTextSource", async () => {
    const mockObsManager = createObsManagerFixture();
    const updateTextSource = createMockFn<Parameters<UpdateTextSource>, ReturnType<UpdateTextSource>>(() => Promise.resolve());

    const goalsManager = createOBSGoalsManager(mockObsManager, {
      config: {
        goals: {
          enabled: true,
          tiktokGoalEnabled: true,
          tiktokGoalSource: "test-tiktok-goal-source",
        },
      },
      updateTextSource,
      goalTracker: createGoalTrackerFixture("25/100"),
    });

    await goalsManager.updateGoalDisplay("tiktok", "25/100");

    expect(updateTextSource.mock.calls).toEqual([
      ["test-tiktok-goal-source", "25/100"],
    ]);
  });

  it("writes goal updates through injected default-manager dependencies", async () => {
    const updateTextSource = createMockFn<Parameters<UpdateTextSource>, ReturnType<UpdateTextSource>>(() => Promise.resolve());
    const goalTracker = createGoalTrackerFixture("30/100");

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
