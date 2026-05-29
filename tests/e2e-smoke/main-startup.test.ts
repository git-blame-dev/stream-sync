import { describe, it, beforeEach, afterEach, expect } from "bun:test";
import { createConfigFixture } from "../helpers/config-fixture";
import { createMockDisplayQueue } from "../helpers/mock-factories";
import { captureStdout, captureStderr } from "../helpers/output-capture";
import {
  clearAllTimers,
  useFakeTimers,
  useRealTimers,
} from "../helpers/bun-timers";
import { main } from "../../src/main.ts";
import type { SingleInstanceMetadata } from "../../src/services/SingleInstanceGuard.ts";
import { createDonationSpamDetection } from "../../src/utils/spam-detection";

type OutputCapture = ReturnType<typeof captureStdout>;
type StartupOnlyEnv = NodeJS.ProcessEnv["CHAT_BOT_STARTUP_ONLY"];
type MainOverridesArg = NonNullable<Parameters<typeof main>[0]>;
type DonationSpamFactory = NonNullable<MainOverridesArg["createDonationSpamDetection"]>;

const createSuccessfulSecretSetupResult = () => ({
  applied: {},
  persisted: [],
  missingRequired: [],
});

const TEST_SINGLE_INSTANCE_METADATA: SingleInstanceMetadata = {
  instanceId: "test-smoke-instance",
  pid: 1,
  ppid: 0,
  hostname: "test-host",
  platform: process.platform,
  cwd: "/tmp/test-stream-sync-smoke",
  command: "test stream-sync smoke",
  startedAt: "2025-01-15T12:00:00.000Z",
};

const buildSmokeConfig = () =>
  createConfigFixture({
    general: {
      debugEnabled: false,
      envFilePath: "/tmp/test-smoke-env",
      envFileReadEnabled: false,
      envFileWriteEnabled: false,
      viewerCountPollingIntervalMs: 0,
    },
    obs: {
      chatMsgTxt: "test-smoke-chat-text",
      chatMsgScene: "test-smoke-chat-scene",
      chatMsgGroup: "test-smoke-chat-group",
      ttsEnabled: false,
      notificationTxt: "test-smoke-notification-text",
      notificationScene: "test-smoke-notification-scene",
      notificationMsgGroup: "test-smoke-notification-group",
      chatPlatformLogos: {},
      notificationPlatformLogos: {},
    },
    displayQueue: {
      autoProcess: false,
      maxQueueSize: 5,
    },
    timing: {
      transitionDelay: 1000,
      notificationClearDelay: 500,
      chatMessageDuration: 1000,
    },
    http: { userAgents: ["test-smoke-agent"] },
    twitch: { enabled: false },
    youtube: { enabled: false },
    tiktok: { enabled: false },
  });

describe("main startup smoke", () => {
  let stdoutCapture: OutputCapture;
  let stderrCapture: OutputCapture;
  let originalStartupOnly: StartupOnlyEnv;

  beforeEach(() => {
    stdoutCapture = captureStdout();
    stderrCapture = captureStderr();
    useFakeTimers();
    originalStartupOnly = process.env.CHAT_BOT_STARTUP_ONLY;
    delete process.env.CHAT_BOT_STARTUP_ONLY;
  });

  afterEach(() => {
    if (originalStartupOnly === undefined) {
      delete process.env.CHAT_BOT_STARTUP_ONLY;
    } else {
      process.env.CHAT_BOT_STARTUP_ONLY = originalStartupOnly;
    }
    clearAllTimers();
    useRealTimers();
    stdoutCapture.restore();
    stderrCapture.restore();
  });

  it("starts with fixture-only dependencies", async () => {
    const createDonationSpamDetectionNoCleanup: DonationSpamFactory = (spamConfig, deps) =>
      createDonationSpamDetection(spamConfig, { ...deps, autoCleanup: false });

    const overrides: Record<string, unknown> = {
      cliArgs: { chat: 1 },
      ensureSecrets: async () => createSuccessfulSecretSetupResult(),
      createSingleInstanceGuard: async () => ({
        lockPath: "/tmp/test-stream-sync-smoke.lock",
        metadata: TEST_SINGLE_INSTANCE_METADATA,
        release: async () => {},
      }),
      initializeDisplayQueue: () => createMockDisplayQueue(),
      getOBSConnectionManager: () => ({
        isConnected: () => false,
        isReady: () => false,
        ensureConnected: async () => undefined,
        call: async () => ({}),
        connect: async () => true,
        disconnect: async () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
      createOBSEventService: () => ({ disconnect: async () => {} }),
      createSceneManagementService: () => ({}),
      createDonationSpamDetection: createDonationSpamDetectionNoCleanup,
    };

    const result = await main({
      ...overrides,
      config: buildSmokeConfig(),
    });

    expect(result.success).toBe(true);
    expect(result.appStarted).toBe(true);
  });
});
