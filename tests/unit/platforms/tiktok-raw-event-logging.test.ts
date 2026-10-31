import { vi, describe, it, expect, afterEach } from 'bun:test';

import { createTikTokLifetimeFixture } from "../../helpers/tiktok-connector-fixture";

type TikTokLifetimeFixture = ReturnType<typeof createTikTokLifetimeFixture>;

describe("TikTokPlatform raw event logging", () => {
  const activeFixtures: TikTokLifetimeFixture[] = [];

  afterEach(async () => {
    try {
      while (activeFixtures.length > 0) {
        const fixture = activeFixtures.pop();
        if (fixture) {
          await fixture.cleanup();
        }
      }
    } finally {
      vi.restoreAllMocks();
    }
  });

  const createPlatform = (configOverrides: Record<string, unknown> = {}) => {
    const fixture = createTikTokLifetimeFixture({
      enabled: true,
      username: "testDataLogger",
      dataLoggingEnabled: false,
      dataLoggingPath: "/synthetic",
      envFileReadEnabled: false,
      envFileWriteEnabled: false,
      ...configOverrides,
    });
    activeFixtures.push(fixture);
    fixture.platform.rawPlatformDataLoggingService.rawEventLogWriter = {
      resolveLogFileName: () => "tiktok-data-log.ndjson",
      writeRawEvent: async () => ({
        fileName: "tiktok-data-log.ndjson",
        filePath: "/synthetic/tiktok-data-log.ndjson",
      }),
    };
    return fixture.platform;
  };

  it("completes without error when data logging is enabled", async () => {
    const platform = createPlatform({ dataLoggingEnabled: true });
    const eventData = { type: "gift", giftId: "test-gift-1" };

    await expect(
      platform.logRawPlatformData("gift", eventData),
    ).resolves.toBeUndefined();
  });

  it("completes without error when data logging is disabled", async () => {
    const platform = createPlatform({ dataLoggingEnabled: false });
    const eventData = { type: "gift", giftId: "test-gift-1" };

    await expect(
      platform.logRawPlatformData("gift", eventData),
    ).resolves.toBeUndefined();
  });
});
