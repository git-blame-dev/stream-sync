import { describe, expect, it } from "bun:test";
import { AppRuntime } from "../../../src/runtime/AppRuntime";

const makeRuntime = () => {
  const calls: string[] = [];
  const runtime = Object.create(AppRuntime.prototype) as any;
  runtime.config = {};
  runtime.logger = { warn() {}, debug() {} };
  runtime._handleAppRuntimeError = () => undefined;
  runtime.notificationManager = {
    prepareNotification: async (_type: string, _platform: string, payload: Record<string, unknown>) => {
      calls.push("prepare");
      return { success: true, item: { type: "farewell", platform: "twitch", priority: 1, data: payload } };
    },
    handleNotification: async (_type: string, _platform: string, payload: Record<string, unknown>) => {
      calls.push("handle");
      return { success: true, notificationData: payload };
    },
  };
  return { runtime, calls };
};

describe("AppRuntime notification preparation", () => {
  it("uses unified validation and payload construction without enqueueing", async () => {
    const { runtime, calls } = makeRuntime();
    const options = { command: "!bye", userId: "user", timestamp: "2024-01-01T00:00:00.000Z" };
    const result = await runtime.prepareFarewellNotification("twitch", "viewer", options);
    expect(result.success).toBe(true);
    expect(calls).toEqual(["prepare"]);
    expect(result.item.data).toMatchObject({ command: "!bye", username: "viewer", platform: "twitch" });
  });

  it("keeps normal farewell handling on the enqueueing manager path", async () => {
    const { runtime, calls } = makeRuntime();
    const result = await runtime.handleFarewellNotification("twitch", "viewer", {
      command: "!bye", userId: "user", timestamp: "2024-01-01T00:00:00.000Z"
    });
    expect(result.success).toBe(true);
    expect(calls).toEqual(["handle"]);
  });
});
