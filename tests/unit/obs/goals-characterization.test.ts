import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";

import { TEST_TIMEOUTS } from "../../helpers/test-setup";
import {
  noOpLogger,
  createMockSourcesManager,
} from "../../helpers/mock-factories";
import { setupAutomatedCleanup } from "../../helpers/mock-lifecycle";
import * as testClock from "../../helpers/test-clock";
import { createOBSGoalsManager } from "../../../src/obs/goals.ts";

setupAutomatedCleanup({
  clearCallsBeforeEach: true,
  validateAfterCleanup: true,
  logPerformanceMetrics: true,
});

describe("OBS Goals Module Characterization Tests", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  let goalsModule;
  let mockObsManager;
  let configFixture;
  let mockSourcesManager;
  let mockGoalTracker;

  beforeEach(() => {
    mockSourcesManager = createMockSourcesManager();

    mockObsManager = {
      isConnected: createMockFn().mockReturnValue(true),
    };

    configFixture = {
      goals: {
        enabled: true,
        tiktokGoalEnabled: true,
        youtubeGoalEnabled: true,
        twitchGoalEnabled: true,
        tiktokGoalTarget: 1000,
        youtubeGoalTarget: 100,
        twitchGoalTarget: 500,
        tiktokGoalSource: "tiktok goal txt",
        youtubeGoalSource: "youtube goal txt",
        twitchGoalSource: "twitch goal txt",
      },
    };

    mockGoalTracker = {
      initializeGoalTracker: createMockFn().mockResolvedValue(),
      addDonationToGoal: createMockFn().mockResolvedValue({
        success: true,
        formatted: "500/1000 coins",
        current: 500,
        target: 1000,
        percentage: 50,
      }),
      addPaypiggyToGoal: createMockFn().mockResolvedValue({
        success: true,
        formatted: "550/1000 coins",
        current: 550,
        target: 1000,
        percentage: 55,
      }),
      getGoalState: createMockFn().mockReturnValue({
        current: 500,
        target: 1000,
        formatted: "500/1000 coins",
        percentage: 50,
      }),
      getAllGoalStates: createMockFn().mockReturnValue({
        tiktok: { current: 500, target: 1000, formatted: "500/1000 coins" },
        youtube: { current: 0.5, target: 1.0, formatted: "$0.50/$1.00" },
        twitch: { current: 50, target: 100, formatted: "050/100 bits" },
      }),
      formatGoalDisplay: createMockFn().mockReturnValue("500/1000 coins"),
    };

    goalsModule = createOBSGoalsManager(mockObsManager, {
      logger: noOpLogger,
      config: configFixture,
      updateTextSource: mockSourcesManager.updateTextSource,
      goalTracker: mockGoalTracker,
    });
  });

  describe("Goal System Initialization", () => {
test(
  "getDefaultGoalsManager returns status from injected goal tracker",
  async () => {
        const injectedGoalTracker = {
          initializeGoalTracker: createMockFn().mockResolvedValue(),
          addDonationToGoal: createMockFn().mockResolvedValue({
            success: true,
            formatted: "40/100",
          }),
          addPaypiggyToGoal: createMockFn().mockResolvedValue({
            success: true,
            formatted: "40/100",
          }),
          getGoalState: createMockFn().mockReturnValue({ formatted: "40/100" }),
          getAllGoalStates: createMockFn().mockReturnValue({
            tiktok: { formatted: "40/100" },
          }),
        };

        const freshGoals = await import(
          `../../../src/obs/goals.ts?test-default-goal-tracker=${testClock.now()}`
        );
        const defaultGoalsManager = freshGoals.getDefaultGoalsManager({
          config: {
            goals: {
              enabled: true,
              tiktokGoalEnabled: true,
              tiktokGoalSource: "test-default-goal-source",
            },
          },
          obsManager: {
            isConnected: () => false,
          },
          goalTracker: injectedGoalTracker,
          updateTextSource: createMockFn().mockResolvedValue(),
        });

      const status = defaultGoalsManager.getCurrentGoalStatus("tiktok");

      expect(status).toEqual({ formatted: "40/100" });
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "initializeGoalDisplay should initialize goal tracker and update displays when OBS connected",
      async () => {
        const { updateTextSource } = mockSourcesManager;

        mockObsManager.isConnected.mockReturnValue(true);

        await goalsModule.initializeGoalDisplay();

        expect(mockGoalTracker.initializeGoalTracker).toHaveBeenCalled();
        expect(mockGoalTracker.getAllGoalStates).toHaveBeenCalled();
        expect(updateTextSource).toHaveBeenCalled();
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "initializeGoalDisplay should skip OBS updates when OBS not connected",
      async () => {
        const { updateTextSource } = mockSourcesManager;

        mockObsManager.isConnected.mockReturnValue(false);

        await goalsModule.initializeGoalDisplay();

        expect(mockGoalTracker.initializeGoalTracker).toHaveBeenCalled();
        expect(mockGoalTracker.getAllGoalStates).not.toHaveBeenCalled();
        expect(updateTextSource).not.toHaveBeenCalled();
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "initializeGoalDisplay should return early when goals disabled",
      async () => {
        const { updateTextSource } = mockSourcesManager;

        const disabledGoalsModule = createOBSGoalsManager(mockObsManager, {
          logger: noOpLogger,
          config: { goals: { enabled: false } },
          updateTextSource: mockSourcesManager.updateTextSource,
          goalTracker: mockGoalTracker,
        });

        await disabledGoalsModule.initializeGoalDisplay();

        expect(mockGoalTracker.initializeGoalTracker).not.toHaveBeenCalled();
        expect(updateTextSource).not.toHaveBeenCalled();
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "initializeGoalDisplay should handle initialization errors gracefully",
      async () => {
        const error = new Error("Goal tracker initialization failed");
        mockGoalTracker.initializeGoalTracker.mockRejectedValueOnce(error);

        await expect(goalsModule.initializeGoalDisplay()).rejects.toThrow(
          "Goal tracker initialization failed",
        );
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "initializeGoalDisplay should handle errors from updateAllGoalDisplays gracefully",
      async () => {
        const obsError = new Error("OBS not connected");
        mockGoalTracker.getAllGoalStates.mockImplementationOnce(() => {
          throw obsError;
        });

        await expect(
          goalsModule.initializeGoalDisplay(),
        ).resolves.toBeUndefined();
      },
      TEST_TIMEOUTS.FAST,
    );
  });

  describe("Goal Display Updates", () => {
    test(
      "updateAllGoalDisplays should update all enabled platform goals when OBS connected",
      async () => {
        const { updateTextSource } = mockSourcesManager;

        await goalsModule.updateAllGoalDisplays();

      expect(mockGoalTracker.getAllGoalStates).toHaveBeenCalled();
      const updates = updateTextSource.mock.calls.map(([source, text]) => ({ source, text }));
      expect(updates).toEqual([
        { source: "tiktok goal txt", text: "500/1000 coins" },
        { source: "youtube goal txt", text: "$0.50/$1.00" },
        { source: "twitch goal txt", text: "050/100 bits" },
      ]);
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "updateAllGoalDisplays should skip updates when OBS not connected",
      async () => {
        const { updateTextSource } = mockSourcesManager;

        mockObsManager.isConnected.mockReturnValue(false);

        await goalsModule.updateAllGoalDisplays();

        expect(mockGoalTracker.getAllGoalStates).not.toHaveBeenCalled();
        expect(updateTextSource).not.toHaveBeenCalled();
      },
      TEST_TIMEOUTS.FAST,
    );

test(
  "updateGoalDisplay writes the requested platform goal text",
  async () => {
        const { updateTextSource } = mockSourcesManager;

        await goalsModule.updateGoalDisplay("tiktok");

      const [sourceName, goalText] = updateTextSource.mock.calls[0] || [];
      expect(sourceName).toBe("tiktok goal txt");
      expect(goalText).toBe("500/1000 coins");
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "updateGoalDisplay should handle disabled platform gracefully",
      async () => {
        const { updateTextSource } = mockSourcesManager;

        const youtubeDisabledModule = createOBSGoalsManager(mockObsManager, {
          logger: noOpLogger,
          config: {
            goals: {
              enabled: true,
              youtubeGoalEnabled: false,
              youtubeGoalSource: "youtube goal txt",
            },
          },
          updateTextSource: mockSourcesManager.updateTextSource,
          goalTracker: mockGoalTracker,
        });

        await youtubeDisabledModule.updateGoalDisplay("youtube");

        expect(updateTextSource).not.toHaveBeenCalled();
      },
      TEST_TIMEOUTS.FAST,
    );
  });

  describe("Event Processing", () => {
    test(
      "processDonationGoal should process donation and update display",
      async () => {
        const { updateTextSource } = mockSourcesManager;

        mockObsManager.isConnected.mockReturnValue(true);

        mockGoalTracker.addDonationToGoal.mockResolvedValue({
          success: true,
          formatted: "500/1000 coins",
          current: 500,
          target: 1000,
          percentage: 50,
        });

        updateTextSource.mockResolvedValue();

        const result = await goalsModule.processDonationGoal("tiktok", 100);

      const [sourceName, goalText] = updateTextSource.mock.calls[0] || [];
      expect(sourceName).toBe("tiktok goal txt");
      expect(goalText).toBe("500/1000 coins");
      expect(result.success).toBe(true);
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "processPaypiggyGoal should process paypiggy and update display",
      async () => {
        const { updateTextSource } = mockSourcesManager;

        mockObsManager.isConnected.mockReturnValue(true);

        mockGoalTracker.addPaypiggyToGoal.mockResolvedValue({
          success: true,
          formatted: "500/1000 coins",
          current: 500,
          target: 1000,
          percentage: 50,
        });

        updateTextSource.mockResolvedValue();

        const result = await goalsModule.processPaypiggyGoal("tiktok");

      const [sourceName, goalText] = updateTextSource.mock.calls[0] || [];
      expect(sourceName).toBe("tiktok goal txt");
      expect(goalText).toBe("500/1000 coins");
      expect(result.success).toBe(true);
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should handle donation processing errors gracefully",
      async () => {
        const error = new Error("Donation processing failed");
        mockGoalTracker.addDonationToGoal.mockRejectedValueOnce(error);

        const result = await goalsModule.processDonationGoal("tiktok", 100);
        expect(result.success).toBe(false);
        expect(result.error).toContain("Donation processing failed");
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "processDonationGoal should reject invalid platform",
      async () => {
        const result = await goalsModule.processDonationGoal(null, 100);
        expect(result.success).toBe(false);
        expect(result.error).toContain("Invalid platform");
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "processDonationGoal should return error when goals disabled",
      async () => {
        const disabledModule = createOBSGoalsManager(mockObsManager, {
          logger: noOpLogger,
          config: { goals: { enabled: false } },
          updateTextSource: mockSourcesManager.updateTextSource,
          goalTracker: mockGoalTracker,
        });

        const result = await disabledModule.processDonationGoal("tiktok", 100);
        expect(result.success).toBe(false);
        expect(result.error).toContain("disabled");
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "processDonationGoal should return error when platform goal disabled",
      async () => {
        const tiktokDisabledModule = createOBSGoalsManager(mockObsManager, {
          logger: noOpLogger,
          config: {
            goals: {
              enabled: true,
              tiktokGoalEnabled: false,
              tiktokGoalSource: "tiktok goal txt",
            },
          },
          updateTextSource: mockSourcesManager.updateTextSource,
          goalTracker: mockGoalTracker,
        });

        const result = await tiktokDisabledModule.processDonationGoal(
          "tiktok",
          100,
        );
        expect(result.success).toBe(false);
        expect(result.error).toContain("disabled");
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "processPaypiggyGoal should return error when goals disabled",
      async () => {
        const disabledModule = createOBSGoalsManager(mockObsManager, {
          logger: noOpLogger,
          config: { goals: { enabled: false } },
          updateTextSource: mockSourcesManager.updateTextSource,
          goalTracker: mockGoalTracker,
        });

        const result = await disabledModule.processPaypiggyGoal("tiktok");
        expect(result.success).toBe(false);
        expect(result.error).toContain("disabled");
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "processPaypiggyGoal should return error when platform goal disabled",
      async () => {
        const tiktokDisabledModule = createOBSGoalsManager(mockObsManager, {
          logger: noOpLogger,
          config: {
            goals: {
              enabled: true,
              tiktokGoalEnabled: false,
              tiktokGoalSource: "tiktok goal txt",
            },
          },
          updateTextSource: mockSourcesManager.updateTextSource,
          goalTracker: mockGoalTracker,
        });

        const result = await tiktokDisabledModule.processPaypiggyGoal("tiktok");
        expect(result.success).toBe(false);
        expect(result.error).toContain("disabled");
      },
      TEST_TIMEOUTS.FAST,
    );
  });

  describe("Status Queries", () => {
    test(
      "getCurrentGoalStatus should return current goal status",
      async () => {
        const status = await goalsModule.getCurrentGoalStatus("tiktok");

      expect(status).toEqual({
        current: 500,
        target: 1000,
          formatted: "500/1000 coins",
          percentage: 50,
        });
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "getAllCurrentGoalStatuses should return all goal statuses",
      async () => {
        const statuses = await goalsModule.getAllCurrentGoalStatuses();

        expect(mockGoalTracker.getAllGoalStates).toHaveBeenCalled();
        expect(statuses).toEqual({
          tiktok: { current: 500, target: 1000, formatted: "500/1000 coins" },
          youtube: { current: 0.5, target: 1.0, formatted: "$0.50/$1.00" },
          twitch: { current: 50, target: 100, formatted: "050/100 bits" },
        });
      },
      TEST_TIMEOUTS.FAST,
    );
  });

  describe("Configuration Handling", () => {
    test(
      "should respect platform enable/disable flags",
      async () => {
        const { updateTextSource } = mockSourcesManager;

        const youtubeDisabledModule = createOBSGoalsManager(mockObsManager, {
          logger: noOpLogger,
          config: {
            goals: {
              enabled: true,
              tiktokGoalEnabled: true,
              youtubeGoalEnabled: false,
              twitchGoalEnabled: true,
              tiktokGoalSource: "tiktok goal txt",
              youtubeGoalSource: "youtube goal txt",
              twitchGoalSource: "twitch goal txt",
            },
          },
          updateTextSource: mockSourcesManager.updateTextSource,
          goalTracker: mockGoalTracker,
        });

        await youtubeDisabledModule.updateAllGoalDisplays();

      const updates = updateTextSource.mock.calls.map(([source, text]) => ({ source, text }));
      expect(updates).toEqual([
        { source: "tiktok goal txt", text: "500/1000 coins" },
        { source: "twitch goal txt", text: "050/100 bits" },
      ]);
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should handle missing source configurations gracefully",
      async () => {
        const { updateTextSource } = mockSourcesManager;

        const missingSourceModule = createOBSGoalsManager(mockObsManager, {
          logger: noOpLogger,
          config: {
            goals: {
              enabled: true,
              tiktokGoalEnabled: true,
            },
          },
          updateTextSource: mockSourcesManager.updateTextSource,
          goalTracker: mockGoalTracker,
        });

        await missingSourceModule.updateGoalDisplay("tiktok");

        expect(updateTextSource).not.toHaveBeenCalled();
      },
      TEST_TIMEOUTS.FAST,
    );
  });

  describe("Error Handling", () => {
    test(
      "should handle OBS connection errors gracefully",
      async () => {
        const { updateTextSource } = mockSourcesManager;

        updateTextSource.mockRejectedValueOnce(
          new Error("OBS connection failed"),
        );

        await expect(
          goalsModule.updateGoalDisplay("tiktok"),
        ).resolves.toBeUndefined();
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should handle goal tracker errors gracefully",
      async () => {
        mockGoalTracker.getGoalState.mockImplementationOnce(() => {
          throw new Error("Goal tracker error");
        });

        const result = await goalsModule.getCurrentGoalStatus("tiktok");
        expect(result).toBeNull();
      },
      TEST_TIMEOUTS.FAST,
    );
  });

  describe("Performance Tests", () => {
    test(
      "should handle rapid goal updates efficiently",
      async () => {
        const startTime = testClock.now();

        for (let i = 0; i < 10; i++) {
          await goalsModule.updateGoalDisplay("tiktok");
        }

        testClock.advance(10);
        const duration = testClock.now() - startTime;
        expect(duration).toBeLessThan(1000);
      },
      TEST_TIMEOUTS.MEDIUM,
    );

    test(
      "should handle multiple platform updates efficiently",
      async () => {
        const startTime = testClock.now();

        for (let i = 0; i < 5; i++) {
          await goalsModule.updateAllGoalDisplays();
        }

        testClock.advance(15);
        const duration = testClock.now() - startTime;
        expect(duration).toBeLessThan(1000);
      },
      TEST_TIMEOUTS.MEDIUM,
    );
  });
});
