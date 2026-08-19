import { describe, it, expect } from "bun:test";

import { UserTrackingService } from "../../../src/services/UserTrackingService.ts";

describe("UserTrackingService behavior", () => {
  it("reports first message once and tracks seen users", () => {
    const service = new UserTrackingService();

    expect(service.hasSeenUser("test-user-1")).toBe(false);
    expect(service.isFirstMessage("test-user-1", { platform: "twitch" })).toBe(
      true,
    );
    expect(service.hasSeenUser("test-user-1")).toBe(true);
    expect(service.isFirstMessage("test-user-1", { platform: "twitch" })).toBe(
      false,
    );
  });

  it("marks users as seen directly through markMessageSeen", () => {
    const service = new UserTrackingService();

    expect(
      service.markMessageSeen("test-user-2", { platform: "youtube" }),
    ).toBe(true);
    expect(service.hasSeenUser("test-user-2")).toBe(true);
  });

  it("treats missing user IDs as non-trackable", () => {
    const service = new UserTrackingService();

    expect(service.hasSeenUser("")).toBe(true);
    expect(service.markMessageSeen("")).toBe(false);
    expect(service.isFirstMessage("")).toBe(false);
  });

  it("tracks stream supporters by platform and normalized native ID", () => {
    const service = new UserTrackingService();

    expect(service.markStreamSupporter(" Twitch ", " supporter-1 ")).toBe(true);
    expect(service.isStreamSupporter("twitch", "supporter-1")).toBe(true);
    expect(service.isStreamSupporter("youtube", "supporter-1")).toBe(false);
  });

  it("promotes a pending normalized handle to its same-platform native ID", () => {
    const service = new UserTrackingService();

    expect(service.markPendingStreamSupporter(" YouTube ", " @TestSupporterHandle ")).toBe(true);
    expect(service.promotePendingStreamSupporter("twitch", "test-twitch-user-id", "TestSupporterHandle")).toBe(false);
    expect(service.promotePendingStreamSupporter(
      "youtube",
      " test-youtube-channel-id ",
      "testsupporterhandle",
    )).toBe(true);
    expect(service.isStreamSupporter("youtube", "test-youtube-channel-id")).toBe(true);
    expect(service.isStreamSupporter("twitch", "test-twitch-user-id")).toBe(false);
  });

  it("clears pending supporter handles at the requested platform's stream end", () => {
    const service = new UserTrackingService();
    service.markPendingStreamSupporter("youtube", "TestSupporterHandle");

    service.clearStreamSupporters("youtube");

    expect(service.promotePendingStreamSupporter(
      "youtube",
      "test-youtube-channel-id",
      "TestSupporterHandle",
    )).toBe(false);
    expect(service.isStreamSupporter("youtube", "test-youtube-channel-id")).toBe(false);
  });

  it("clears only the requested platform's stream supporters", () => {
    const service = new UserTrackingService();
    service.markStreamSupporter("twitch", "supporter-1");
    service.markStreamSupporter("youtube", "supporter-1");
    service.markMessageSeen("seen-user");

    service.clearStreamSupporters("twitch");
    service.clearStreamSupporters("unknown");

    expect(service.isStreamSupporter("twitch", "supporter-1")).toBe(false);
    expect(service.isStreamSupporter("youtube", "supporter-1")).toBe(true);
    expect(service.hasSeenUser("seen-user")).toBe(true);
  });

  it("rejects unsupported platforms and non-string supporter IDs", () => {
    const service = new UserTrackingService();

    expect(service.markStreamSupporter("unknown", "supporter-1")).toBe(false);
    expect(service.markPendingStreamSupporter("unknown", "supporter-1")).toBe(false);
    expect(service.markPendingStreamSupporter("youtube", 123)).toBe(false);
    expect(service.markStreamSupporter("twitch", 123)).toBe(false);
    expect(service.promotePendingStreamSupporter("youtube", 123, "supporter-1")).toBe(false);
    expect(service.isStreamSupporter("twitch", "supporter-1")).toBe(false);
  });
});
