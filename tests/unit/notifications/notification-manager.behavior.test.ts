import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";
import { PRIORITY_LEVELS } from "../../../src/core/constants";

import NotificationManager from "../../../src/notifications/NotificationManager";

describe("NotificationManager behavior", () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    restoreAllMocks();
  });

  const createDeps = (overrides = {}) => ({
    logger: noOpLogger,
    displayQueue: {
      enqueue: createMockFn(),
      addItem: createMockFn(),
      getQueueLength: createMockFn(() => 0),
    },
    eventBus: {
      on: createMockFn(),
      emit: createMockFn(),
      subscribe: createMockFn(),
    },
    config: createConfigFixture(),
    constants: {
      PRIORITY_LEVELS,
      NOTIFICATION_CONFIGS: {
        follow: { settingKey: "followsEnabled", commandKey: "follows" },
      },
    },
    textProcessing: { formatChatMessage: createMockFn() },
    obsGoals: { processDonationGoal: createMockFn() },
    ...overrides,
  });

  it("throws when logger dependency is missing", () => {
    expect(() => new NotificationManager({})).toThrow("logger dependency");
  });

  it("throws when constants dependency is missing", () => {
    const deps = createDeps({ constants: undefined });
    expect(() => new NotificationManager(deps)).toThrow("constants dependency");
  });

  it("throws when config dependency is missing", () => {
    const deps = createDeps({ config: null });
    expect(() => new NotificationManager(deps)).toThrow("config");
  });

  it("throws when displayQueue dependency is missing", () => {
    const deps = createDeps({ displayQueue: null });
    expect(() => new NotificationManager(deps)).toThrow(
      "displayQueue dependency",
    );
  });

  it("throws when eventBus dependency is missing", () => {
    const deps = createDeps({ eventBus: null });
    expect(() => new NotificationManager(deps)).toThrow("EventBus dependency");
  });

  it("initializes with valid dependencies", () => {
    const deps = createDeps();
    const manager = new NotificationManager(deps);
    expect(manager).toBeInstanceOf(NotificationManager);
    expect(manager.displayQueue).toBe(deps.displayQueue);
    expect(manager.config).toBe(deps.config);
  });

  it("returns canonical result envelope from handleGiftNotification wrapper", async () => {
    const manager = new NotificationManager(createDeps());
    const expectedResult = {
      success: false,
      error: "Notifications disabled",
      notificationType: "platform:gift",
      platform: "twitch",
    };
    manager.handleNotification =
      createMockFn().mockResolvedValue(expectedResult);

    const result = await manager.handleGiftNotification("twitch", {
      id: "test-gift-id",
      giftType: "bits",
      giftCount: 1,
      amount: 1,
      currency: "bits",
    });

    expect(result).toEqual(expectedResult);
  });
});
