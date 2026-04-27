import { describe, expect, it } from "bun:test";

import { NotificationGate } from "../../../src/notifications/notification-gate";

describe("NotificationGate", () => {
  it("reports missing configuration access", () => {
    const gate = new NotificationGate(null);

    expect(gate.hasConfigAccess()).toBe(false);
  });

  it("returns enabled state for valid config entries", () => {
    const gate = new NotificationGate({
      tiktok: { followsEnabled: true },
    });

    expect(gate.isEnabled("followsEnabled", "tiktok")).toBe(true);
  });

  it("returns disabled state for falsy config entries", () => {
    const gate = new NotificationGate({
      twitch: { giftsEnabled: false },
    });

    expect(gate.isEnabled("giftsEnabled", "twitch")).toBe(false);
  });

  it("throws when the setting key is missing", () => {
    const gate = new NotificationGate({
      youtube: { messagesEnabled: true },
    });

    expect(() => gate.isEnabled("followsEnabled", "youtube")).toThrow(
      "Config missing youtube.followsEnabled",
    );
  });
});
