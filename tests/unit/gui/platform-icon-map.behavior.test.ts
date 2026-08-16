import { describe, expect, it } from "bun:test";

import { getPlatformIconUrl } from "../../../gui/src/shared/platform-icon-map";

describe("platform icon map behavior", () => {
  it("returns the imported original artwork for each supported platform", () => {
    const iconUrls = ["youtube", "twitch", "tiktok"].map(getPlatformIconUrl);

    expect(iconUrls.every((iconUrl) => typeof iconUrl === "string" && iconUrl.length > 0)).toBe(true);
    expect(new Set(iconUrls).size).toBe(3);
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
