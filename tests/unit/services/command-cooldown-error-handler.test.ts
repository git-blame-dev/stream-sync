import { type Mock, vi, describe, it, beforeEach, afterEach, expect } from 'bun:test';

import { CommandCooldownService } from "../../../src/services/CommandCooldownService.ts";
import { createConfigFixture } from "../../helpers/config-fixture";

type MockLogger = {
  debug: Mock<(...args: [message: unknown, source?: string, data?: unknown]) => void>;
  warn: Mock<(...args: [message: unknown, source?: string, data?: unknown]) => void>;
  error: Mock<(...args: [message: unknown, source?: string, data?: unknown]) => void>;
};
type TestConfig = ReturnType<typeof createConfigFixture>;

describe("CommandCooldownService error handler integration", () => {
  let service: CommandCooldownService;
  let mockLogger: MockLogger;
  let testConfig: TestConfig;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn<(message: unknown, source?: string | undefined, data?: unknown) => void>(),
      warn: vi.fn<(message: unknown, source?: string | undefined, data?: unknown) => void>(),
      error: vi.fn<(message: unknown, source?: string | undefined, data?: unknown) => void>(),
    };
    testConfig = createConfigFixture();
    service = new CommandCooldownService({
      logger: mockLogger,
      config: testConfig,
    });
  });

  afterEach(() => {
    service.dispose();
    vi.restoreAllMocks();
  });

  it("routes invalid userId validation error through error handler", () => {
    service.checkUserCooldown(null, 60000, 300000);

    expect(mockLogger.error).toHaveBeenCalled();
    const [errorCall] = mockLogger.error.mock.calls;
    expect(errorCall).toBeDefined();
    expect(String(errorCall?.[0])).toContain("Invalid userId");
  });

  it("routes negative cooldown validation error through error handler", () => {
    service.checkUserCooldown("test-user-1", -1, 300000);

    expect(mockLogger.error).toHaveBeenCalled();
    const [errorCall] = mockLogger.error.mock.calls;
    expect(errorCall).toBeDefined();
    expect(String(errorCall?.[0])).toContain("Negative cooldown");
  });

  it("routes invalid userId in updateUserCooldown through error handler", () => {
    service.updateUserCooldown(null);

    expect(mockLogger.error).toHaveBeenCalled();
    const [errorCall] = mockLogger.error.mock.calls;
    expect(errorCall).toBeDefined();
    expect(String(errorCall?.[0])).toContain("Invalid userId");
  });

  it("routes dispose unsubscribe error through error handler", () => {
    service.configSubscriptions = [
      () => {
        throw new Error("unsub failed");
      },
    ];

    service.dispose();

    expect(mockLogger.warn).toHaveBeenCalled();
    const warnCall = mockLogger.warn.mock.calls.find((call) =>
      String(call[0]).includes("unsubscrib"),
    );
    expect(warnCall).toBeTruthy();
  });
});
