import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createEventBus } from "../../../src/core/EventBus";
import { createSceneManagementService } from "../../../src/obs/scene-management-service";

type SceneService = ReturnType<typeof createSceneManagementService>;
type SceneServiceDependencies = Parameters<typeof createSceneManagementService>[0];
type SceneEventBus = SceneServiceDependencies["eventBus"];
type SceneObsConnection = SceneServiceDependencies["obsConnection"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function createSceneEventBusAdapter(): SceneEventBus & {
  getListenerSummary: ReturnType<typeof createEventBus>["getListenerSummary"];
  reset: ReturnType<typeof createEventBus>["reset"];
} {
  const eventBus = createEventBus({ debugEnabled: false });

  return {
    subscribe(eventName, handler) {
      return eventBus.subscribe(eventName, async (payload: unknown) => {
        if (isRecord(payload)) {
          await handler(payload);
        }
      });
    },
    getListenerSummary: eventBus.getListenerSummary.bind(eventBus),
    reset: eventBus.reset.bind(eventBus),
  };
}

describe("SceneManagementService", () => {
  let sceneService: SceneService;
  let eventBus: ReturnType<typeof createSceneEventBusAdapter>;
  let mockOBSConnection: SceneObsConnection & {
    call: ReturnType<typeof createMockFn<[string, Record<string, unknown>], Promise<unknown>>>;
  };

  beforeEach(() => {
    eventBus = createSceneEventBusAdapter();

    mockOBSConnection = {
      call: createMockFn<[string, Record<string, unknown>], Promise<unknown>>(
        async () => ({}),
      ),
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
