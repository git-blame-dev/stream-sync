import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createEventBus } from "../../../src/core/EventBus";
import { createSceneManagementService } from "../../../src/obs/scene-management-service";

describe("SceneManagementService", () => {
  let sceneService;
  let eventBus;
  let mockOBSConnection;

  beforeEach(() => {
    eventBus = createEventBus({ debugEnabled: false });

    mockOBSConnection = {
      call: createMockFn().mockResolvedValue({}),
    };

    sceneService = createSceneManagementService({
      eventBus,
      obsConnection: mockOBSConnection,
      logger: noOpLogger,
    });
  });

  afterEach(() => {
    restoreAllMocks();
    sceneService.destroy();
    eventBus.reset();
  });

  test("starts with empty scene state", () => {
    expect(sceneService.getCurrentScene()).toBe("");
    expect(sceneService.getSceneState()).toEqual({
      currentScene: "",
      previousScene: "",
      switchCount: 0,
    });
    expect(sceneService.getSceneHistory()).toEqual([]);
  });

  test("does not subscribe scene-switch listeners when no producer exists", () => {
    const listeners = eventBus.getListenerSummary();
    expect(listeners["scene:switch"]).toBeUndefined();
  });

  test("validates scenes from OBS scene list", async () => {
    mockOBSConnection.call.mockResolvedValue({
      scenes: [{ sceneName: "GameplayScene" }, { sceneName: "ChatScene" }],
    });

    await expect(sceneService.validateScene("GameplayScene")).resolves.toBe(
      true,
    );
    await expect(sceneService.validateScene("MissingScene")).resolves.toBe(
      false,
    );
  });

  test("uses cached scene list during cache window", async () => {
    mockOBSConnection.call.mockResolvedValue({
      scenes: [{ sceneName: "GameplayScene" }],
    });

    await sceneService.validateScene("GameplayScene");
    await sceneService.validateScene("GameplayScene");

    expect(mockOBSConnection.call.mock.calls.length).toBe(1);
  });

  test("returns false when scene validation call fails", async () => {
    mockOBSConnection.call.mockRejectedValue(new Error("obs-failure"));
    await expect(sceneService.validateScene("GameplayScene")).resolves.toBe(
      false,
    );
  });

  test("destroy is safe and idempotent without listeners", () => {
    sceneService.destroy();
    sceneService.destroy();
    const listeners = eventBus.getListenerSummary();
    expect(listeners["scene:switch"]).toBeUndefined();
  });
});
