import { describe, it, expect } from "bun:test";
import {
  UserTrackingService,
  createUserTrackingService,
} from "../../../src/services/UserTrackingService.ts";

class ThrowingSeenUsers extends Set<string> {
  constructor(private readonly thrownValue: unknown) {
    super();
  }

  override has(): boolean {
    throw this.thrownValue;
  }
}

describe("UserTrackingService", () => {
  it("returns true for first message and false for repeats", () => {
    const service = new UserTrackingService();

    expect(service.isFirstMessage("testUserId1", { platform: "twitch" })).toBe(
      true,
    );
    expect(service.isFirstMessage("testUserId1", { platform: "twitch" })).toBe(
      false,
    );
  });

  it("returns false when userId is missing", () => {
    const service = new UserTrackingService();

    expect(service.isFirstMessage(null, { platform: "tiktok" })).toBe(false);
    expect(service.isFirstMessage("", { platform: "youtube" })).toBe(false);
  });

  it("creates a service instance via factory", () => {
    const service = createUserTrackingService();

    expect(service).toBeInstanceOf(UserTrackingService);
  });

  it("returns false when seen user lookup throws an error", () => {
    const service = new UserTrackingService();
    service.seenUsers = new ThrowingSeenUsers(new Error("lookup failure"));

    expect(service.isFirstMessage("testUserId3", { platform: "youtube" })).toBe(
      false,
    );
  });

  it("returns false when seen user lookup throws a non-error value", () => {
    const service = new UserTrackingService();
    service.seenUsers = new ThrowingSeenUsers("lookup failure");

    expect(service.isFirstMessage("testUserId4", { platform: "tiktok" })).toBe(
      false,
    );
  });
});
