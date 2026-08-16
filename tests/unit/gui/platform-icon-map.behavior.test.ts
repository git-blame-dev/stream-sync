import { describe, expect, it } from "bun:test";

import { getPlatformIconUrl } from "../../../gui/src/shared/platform-icon-map";

describe("platform icon map behavior", () => {
  it("returns cache-versioned local asset URLs for each supported platform id", () => {
    expect(getPlatformIconUrl("youtube")).toBe(
      "/gui/assets/platform-icons/youtube-icon.png?v=2",
    );
    expect(getPlatformIconUrl("twitch")).toBe(
      "/gui/assets/platform-icons/twitch-icon.png?v=2",
    );
    expect(getPlatformIconUrl("tiktok")).toBe(
      "/gui/assets/platform-icons/tiktok-icon.png?v=2",
    );
  });

  it("normalizes case and whitespace when resolving platform ids", () => {
    expect(getPlatformIconUrl("  YouTube  ")).toBe(getPlatformIconUrl("youtube"));
    expect(getPlatformIconUrl(" TwItCh ")).toBe(getPlatformIconUrl("twitch"));
  });

  it("returns null for unknown or non-string platform ids", () => {
    expect(getPlatformIconUrl("unknown")).toBeNull();
    expect(getPlatformIconUrl(null)).toBeNull();
    expect(getPlatformIconUrl(42)).toBeNull();
  });
});
