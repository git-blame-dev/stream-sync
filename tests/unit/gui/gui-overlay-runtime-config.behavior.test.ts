import { describe, expect, it } from "bun:test";

import { readOverlayRuntimeConfig } from "../../../gui/src/overlay/runtime-config";

describe("Overlay runtime config behavior", () => {
  it("reads positive integer overlay limits from runtime config", () => {
    const runtimeConfig = readOverlayRuntimeConfig({
      __STREAM_SYNC_GUI_CONFIG__: {
        overlayMaxMessages: 7,
        overlayMaxLinesPerMessage: 4,
        overlayFeedMode: "chat",
      },
    });

    expect(runtimeConfig).toMatchObject({
      overlayMaxMessages: 7,
      overlayMaxLinesPerMessage: 4,
      overlayFeedMode: "chat",
      appearance: { profile: "standard", revision: 0 },
    });
  });

  it("throws when runtime config object is missing", () => {
    expect(() => readOverlayRuntimeConfig({})).toThrow(
      "Overlay runtime config is required",
    );
  });

  it("throws when runtime config contains invalid overlay limits", () => {
    expect(() => {
      readOverlayRuntimeConfig({
        __STREAM_SYNC_GUI_CONFIG__: {
          overlayMaxMessages: 0,
          overlayMaxLinesPerMessage: 2,
        },
      });
    }).toThrow(
      "Overlay runtime config requires positive integer overlayMaxMessages",
    );
  });

  it("falls back to all for an invalid feed mode", () => {
    expect(readOverlayRuntimeConfig({
      __STREAM_SYNC_GUI_CONFIG__: {
        overlayMaxMessages: 1,
        overlayMaxLinesPerMessage: 1,
        overlayFeedMode: "invalid",
      },
    }).overlayFeedMode).toBe("all")
  })
});
