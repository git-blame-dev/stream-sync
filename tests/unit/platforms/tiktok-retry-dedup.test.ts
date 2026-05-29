import { describe, it, expect, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";

import { TikTokPlatform } from "../../../src/platforms/tiktok";
import {
  createMockTikTokPlatformDependencies,
  noOpLogger,
} from "../../helpers/mock-factories";

type RetryCall = {
  platformName: string;
  err: Error;
  reconnectFn: () => Promise<void>;
};

type RetryHandleArgs = [
  string,
  unknown,
  () => Promise<void>,
  () => Promise<void>,
];

type RetrySystem = {
  isConnected?: (platform: string) => boolean | undefined;
  resetRetryCount: (platform: string) => void;
  handleConnectionError: (
    platform: string,
    error: unknown,
    reconnect: () => Promise<void>,
    cleanup: () => Promise<void>,
  ) => void;
};

const requiredWebcastEvents = {
  CHAT: "chat",
  GIFT: "gift",
  FOLLOW: "follow",
  SOCIAL: "social",
  ROOM_USER: "roomUser",
  ERROR: "error",
  DISCONNECT: "disconnect",
};

const createDependencies = (retrySystem: RetrySystem) => ({
  ...createMockTikTokPlatformDependencies(),
  retrySystem,
  logger: noOpLogger,
  WebcastEvent: requiredWebcastEvents,
  connectionFactory: {
    createConnection: createMockFn<[string, unknown, unknown], unknown>(),
  },
});

describe("TikTokPlatform retry deduplication", () => {
  const baseConfig = { enabled: true, username: "retry_tester" };

  afterEach(() => {
    restoreAllMocks();
  });

  it("only schedules one retry when queueRetry is invoked multiple times before a reconnect starts", () => {
    const retryCalls: RetryHandleArgs[] = [];
    const retrySystem: RetrySystem = {
      resetRetryCount: createMockFn<[string], void>(),
      handleConnectionError: (...args: RetryHandleArgs) => {
        retryCalls.push(args);
      },
    };
    const dependencies = createDependencies(retrySystem);

    const platform = new TikTokPlatform(baseConfig, dependencies);

    platform.queueRetry(new Error("first"));
    platform.queueRetry(new Error("second"));

    expect(retryCalls).toHaveLength(1);
  });

  it("requeues a retry when the reconnect attempt fails, without double scheduling", async () => {
    const retryCalls: RetryCall[] = [];
    const retrySystem: RetrySystem = {
      resetRetryCount: createMockFn<[string], void>(),
      handleConnectionError: (
        platformName: string,
        err: unknown,
        reconnectFn: () => Promise<void>,
      ) => {
        expect(err).toBeInstanceOf(Error);
        if (!(err instanceof Error)) {
          throw new Error("Expected retry error to be an Error instance");
        }
        retryCalls.push({ platformName, err, reconnectFn });
        void reconnectFn();
      },
    };
    const dependencies = createDependencies(retrySystem);

    const platform = new TikTokPlatform(baseConfig, dependencies);

    const connectCalls: boolean[] = [];
    platform._connect = async () => {
      connectCalls.push(true);
      if (connectCalls.length === 1) {
        throw new Error("connect-failed");
      }
      return true;
    };

    platform.queueRetry(new Error("initial"));
    await Promise.resolve();
    await Promise.resolve();

    expect(retryCalls).toHaveLength(2);
    expect(connectCalls).toHaveLength(2);
  });
});
