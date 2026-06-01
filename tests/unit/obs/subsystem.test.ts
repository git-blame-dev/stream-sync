import { describe, expect, test } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createOBSSubsystem } from "../../../src/obs/subsystem.ts";
import { logger as coreLogger } from "../../../src/core/logging.ts";

type OBSSubsystemDeps = Parameters<typeof createOBSSubsystem>[0];
type OBSEventServiceDeps = Parameters<OBSSubsystemDeps["createOBSEventService"]>[0];

const logger = noOpLogger as unknown as typeof coreLogger;

const createConfig = (overrides: Record<string, unknown> = {}) => ({
  obs: {
    chatMsgGroup: "chat-message-group",
    notificationMsgGroup: "notification-message-group",
  },
  timing: {
    fadeDuration: 0,
  },
  goals: {
    enabled: true,
    tiktokGoalEnabled: true,
    tiktokGoalSource: "tiktok-goal-text",
  },
  ...overrides,
});

const createRawConnectionManager = (overrides: Record<string, unknown> = {}) => ({
  ensureConnected: createMockFn<[], Promise<void>>().mockResolvedValue(),
  call: createMockFn<[requestType: string, payload?: Record<string, unknown>], Promise<unknown>>().mockResolvedValue({}),
  isConnected: createMockFn<[], boolean>().mockReturnValue(true),
  addEventListener: createMockFn(),
  removeEventListener: createMockFn(),
  ...overrides,
});

describe("createOBSSubsystem", () => {
  test("rejects connection managers missing required OBS methods", () => {
    expect(() =>
      createOBSSubsystem({
        config: createConfig(),
        logger,
        eventBus: {},
        getOBSConnectionManager: () => ({
          ensureConnected: createMockFn<[], Promise<void>>().mockResolvedValue(),
          call: createMockFn(),
        } as never),
        createOBSEventService: createMockFn(),
      }),
    ).toThrow("createOBSSubsystem requires OBS manager methods");
  });

  test("uses isConnected as the readiness fallback when isReady is not provided", async () => {
    const rawConnectionManager = createRawConnectionManager({
      isConnected: createMockFn<[], boolean>().mockReturnValue(true),
    });
    const createOBSEventService = createMockFn<[OBSEventServiceDeps], OBSEventServiceDeps>((deps) => deps);

    const subsystem = createOBSSubsystem({
      config: createConfig(),
      logger,
      eventBus: { emit: createMockFn() },
      getOBSConnectionManager: () => rawConnectionManager,
      createOBSEventService,
    });

    await expect(subsystem.connectionManager.isReady()).resolves.toBe(true);
    expect(rawConnectionManager.isConnected).toHaveBeenCalled();
  });

  test("requires goals configuration before exposing subsystem managers", () => {
    const rawConnectionManager = createRawConnectionManager();

    expect(() =>
      createOBSSubsystem({
        config: createConfig({ goals: undefined }),
        logger,
        eventBus: {},
        getOBSConnectionManager: () => rawConnectionManager,
        createOBSEventService: createMockFn(),
      }),
    ).toThrow("createOBSSubsystem requires goals configuration");
  });

  test("passes one bound connection manager through OBS services", () => {
    const rawConnectionManager = createRawConnectionManager({
      connect: createMockFn<[], Promise<boolean>>().mockResolvedValue(true),
      disconnect: createMockFn<[], Promise<void>>().mockResolvedValue(),
      isReady: createMockFn<[], Promise<boolean>>().mockResolvedValue(true),
    });
    const createOBSEventService = createMockFn<[OBSEventServiceDeps], OBSEventServiceDeps>((deps) => deps);

    const subsystem = createOBSSubsystem({
      config: createConfig(),
      logger,
      eventBus: { emit: createMockFn() },
      getOBSConnectionManager: () => rawConnectionManager,
      createOBSEventService,
    });

    const eventServiceDeps = createOBSEventService.mock.calls[0]?.[0];
    expect(eventServiceDeps?.obsConnection).toBe(subsystem.connectionManager);
    expect(eventServiceDeps?.obsSources).toBe(subsystem.sourcesManager);
    expect(subsystem.effectsManager.obsManager).toBe(subsystem.connectionManager);
  });
});
