import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TestRenderer, { type ReactTestRenderer } from "react-test-renderer";

import { App } from "../../../gui/src/shared/App";
import { ActivityBar } from "../../../gui/src/shared/components/ActivityBar";
import { GuiShell } from "../../../gui/src/shared/components/GuiShell";

type EventPayload = Record<string, unknown>;
type EventHandler = (payload: EventPayload) => void;
type EventFeedArgs = {
  url: string;
  onEvent: EventHandler;
  onOpen?: () => void;
  onError?: () => void;
};
type AppRenderer = ReactTestRenderer;
type EffectShellProps = {
  activeEffect: { playbackId: string };
  onEffectComplete: (playbackId: string, reason: "ended") => void;
};

function getEffectShellProps(renderer: AppRenderer): EffectShellProps {
  const props: Record<string, unknown> = renderer.root.findByType(GuiShell).props;
  const activeEffect = props.activeEffect;
  const onEffectComplete = props.onEffectComplete;
  if (
    !activeEffect ||
    typeof activeEffect !== "object" ||
    !("playbackId" in activeEffect) ||
    typeof activeEffect.playbackId !== "string" ||
    typeof onEffectComplete !== "function"
  ) {
    throw new Error("Expected GuiShell to expose an active effect contract");
  }

  return {
    activeEffect: { playbackId: activeEffect.playbackId },
    onEffectComplete: (playbackId: string, reason: "ended") => onEffectComplete(playbackId, reason),
  };
}

let originalConsoleTimeStamp: typeof console.timeStamp | undefined;

beforeAll(() => {
  originalConsoleTimeStamp = console.timeStamp;
  if (typeof console.timeStamp !== "function") {
    console.timeStamp = () => {};
  }
});

afterAll(() => {
  if (originalConsoleTimeStamp) {
    console.timeStamp = originalConsoleTimeStamp;
  } else {
    Reflect.deleteProperty(console, "timeStamp");
  }
});

describe("GUI app behavior", () => {
  it("renders shell container for dock mode", () => {
    const html = renderToStaticMarkup(
      React.createElement(App, {
        mode: "dock",
        eventsPath: "/gui/events",
      }),
    );

    expect(html).toContain("gui-shell");
    expect(html).toContain("gui-shell--dock");
    expect(html).toContain("Connecting...");
  });

  it("reports dock connection state without adding status to overlays", async () => {
    let onOpen: (() => void) | undefined;
    let onError: (() => void) | undefined;
    const createEventFeedImpl = (options: EventFeedArgs) => {
      onOpen = options.onOpen;
      onError = options.onError;
      return () => {};
    };
    let dockRenderer: AppRenderer | null = null;

    await TestRenderer.act(async () => {
      dockRenderer = TestRenderer.create(React.createElement(App, {
        mode: "dock",
        createEventFeedImpl,
      }));
    });
    await TestRenderer.act(async () => onOpen?.());
    expect(JSON.stringify(dockRenderer!.toJSON())).toContain("Connected - waiting for chat");
    await TestRenderer.act(async () => onError?.());
    expect(JSON.stringify(dockRenderer!.toJSON())).toContain("Reconnecting...");

    const overlayHtml = renderToStaticMarkup(React.createElement(App, {
      mode: "overlay",
      overlayMaxMessages: 4,
      overlayMaxLinesPerMessage: 3,
    }));
    expect(overlayHtml).not.toContain("Connecting");
    await TestRenderer.act(async () => dockRenderer!.unmount());
  });

  it("bounds dock rows independently from overlay limits", async () => {
    let onEventHandler: EventHandler | null = null;
    const createEventFeedImpl = ({ onEvent }: EventFeedArgs) => {
      onEventHandler = onEvent;
      return () => {};
    };
    let renderer: AppRenderer | null = null;

    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(React.createElement(App, {
        mode: "dock",
        dockMaxMessages: 2,
        createEventFeedImpl,
      }));
    });
    await TestRenderer.act(async () => {
      for (let index = 1; index <= 3; index += 1) {
        onEventHandler!({
          eventId: `dock-${index}`,
          type: "chat",
          kind: "chat",
          platform: "twitch",
          username: `dock-user-${index}`,
          text: `message-${index}`,
          avatarUrl: `https://example.invalid/avatar-${index}.png`,
          timestamp: null,
        });
      }
    });

    const text = JSON.stringify(renderer!.toJSON());
    expect(text).not.toContain("dock-user-1");
    expect(text).toContain("dock-user-2");
    expect(text).toContain("dock-user-3");
    await TestRenderer.act(async () => renderer!.unmount());
  });

  it("renders monetization styling for dock monetization rows", async () => {
    let onEventHandler: EventHandler | null = null;
    const createEventFeedImpl = ({ onEvent }: EventFeedArgs) => {
      onEventHandler = onEvent;
      return () => {};
    };

    let renderer: AppRenderer | null = null;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(App, {
          mode: "dock",
          eventsPath: "/gui/events",
          createEventFeedImpl,
        }),
      );
    });

    await TestRenderer.act(async () => {
      onEventHandler!({
        type: "platform:gift",
        kind: "notification",
        platform: "youtube",
        username: "test-gift-user",
        text: "sent a test gift",
        presentationRole: "monetization",
        avatarUrl: "https://example.invalid/test-avatar.png",
        timestamp: "2024-01-01T00:00:00.000Z",
      });
    });

    const text = JSON.stringify(renderer!.toJSON());
    expect(text).toContain("gui-row--monetization");
    expect(text).toContain("gui-row__monetization-image");
    expect(text).toContain("test-gift-user");
  });

  it("wires event feed through useEffect in app component", async () => {
    let onEventHandler: EventHandler | null = null;
    const createEventFeedImpl = ({ onEvent }: EventFeedArgs) => {
      onEventHandler = onEvent;
      return () => {};
    };

    let renderer: AppRenderer | null = null;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(App, {
          mode: "overlay",
          eventsPath: "/gui/events",
          createEventFeedImpl,
          overlayMaxMessages: 3,
          overlayMaxLinesPerMessage: 3,
        }),
      );
    });

    expect(typeof onEventHandler).toBe("function");

    await TestRenderer.act(async () => {
      onEventHandler!({
        type: "chat",
        kind: "chat",
        platform: "twitch",
        username: "test-user",
        text: "hello",
        avatarUrl: "https://example.invalid/test-avatar.png",
        timestamp: "2024-01-01T00:00:00.000Z",
      });
    });

    const text = JSON.stringify(renderer!.toJSON());
    expect(text).toContain("gui-shell--overlay");
    expect(text).toContain("test-user");
  });

  it("disposes the active event feed when events path changes and on unmount", async () => {
    const openedUrls: string[] = [];
    const disposedUrls: string[] = [];
    const createEventFeedImpl = ({ url }: EventFeedArgs) => {
      openedUrls.push(url);
      return () => {
        disposedUrls.push(url);
      };
    };

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(App, {
          mode: "dock",
          eventsPath: "/gui/events/one",
          createEventFeedImpl,
        }),
      );
    });

    await TestRenderer.act(async () => {
      renderer!.update(
        React.createElement(App, {
          mode: "dock",
          eventsPath: "/gui/events/two",
          createEventFeedImpl,
        }),
      );
    });

    await TestRenderer.act(async () => {
      renderer!.unmount();
    });

    expect(openedUrls).toEqual(["/gui/events/one", "/gui/events/two"]);
    expect(disposedUrls).toEqual(["/gui/events/one", "/gui/events/two"]);
  });

  it("applies overlay max message limit from app configuration", async () => {
    let onEventHandler: EventHandler | null = null;
    const createEventFeedImpl = ({ onEvent }: EventFeedArgs) => {
      onEventHandler = onEvent;
      return () => {};
    };

    let renderer: AppRenderer | null = null;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(App, {
          mode: "overlay",
          eventsPath: "/gui/events",
          createEventFeedImpl,
          overlayMaxMessages: 3,
          overlayMaxLinesPerMessage: 3,
        }),
      );
    });

    await TestRenderer.act(async () => {
      onEventHandler!({
        type: "chat",
        kind: "chat",
        platform: "twitch",
        username: "test-user-1",
        text: "message-1",
        avatarUrl: "https://example.invalid/test-avatar-1.png",
        timestamp: "2024-01-01T00:00:01.000Z",
      });
      onEventHandler!({
        type: "chat",
        kind: "chat",
        platform: "twitch",
        username: "test-user-2",
        text: "message-2",
        avatarUrl: "https://example.invalid/test-avatar-2.png",
        timestamp: "2024-01-01T00:00:02.000Z",
      });
      onEventHandler!({
        type: "chat",
        kind: "chat",
        platform: "twitch",
        username: "test-user-3",
        text: "message-3",
        avatarUrl: "https://example.invalid/test-avatar-3.png",
        timestamp: "2024-01-01T00:00:03.000Z",
      });
      onEventHandler!({
        type: "chat",
        kind: "chat",
        platform: "twitch",
        username: "test-user-4",
        text: "message-4",
        avatarUrl: "https://example.invalid/test-avatar-4.png",
        timestamp: "2024-01-01T00:00:04.000Z",
      });
    });

    const text = JSON.stringify(renderer!.toJSON());
    expect(text).toContain("test-user-2");
    expect(text).toContain("test-user-3");
    expect(text).toContain("test-user-4");
    expect(text).not.toContain("test-user-1");
  });

  it("requires overlay limits when rendering overlay mode", () => {
    expect(() => {
      renderToStaticMarkup(
        React.createElement(App, {
          mode: "overlay",
          eventsPath: "/gui/events",
        }),
      );
    }).toThrow("Overlay mode requires positive integer overlay limits");
  });

  it("routes effect events separately from row feed updates", async () => {
    let onEventHandler: EventHandler | null = null;
    const createEventFeedImpl = ({ onEvent }: EventFeedArgs) => {
      onEventHandler = onEvent;
      return () => {};
    };

    let renderer: AppRenderer | null = null;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(App, {
          mode: "dock",
          eventsPath: "/gui/events",
          createEventFeedImpl,
        }),
      );
    });

    await TestRenderer.act(async () => {
      onEventHandler!({
        __guiEvent: "effect",
        effectType: "tiktok-gift-animation",
        playbackId: "effect-1",
        durationMs: 2500,
        assetUrl: "/gui/runtime/test.mp4",
        config: {
          profileName: "portrait",
          sourceWidth: 960,
          sourceHeight: 864,
          renderWidth: 480,
          renderHeight: 854,
          rgbFrame: [0, 0, 480, 854],
          aFrame: [480, 0, 480, 854],
        },
      });
    });

    await TestRenderer.act(async () => {
      onEventHandler!({
        type: "chat",
        kind: "chat",
        platform: "twitch",
        username: "test-user",
        text: "hello",
        avatarUrl: "https://example.invalid/test-avatar.png",
        timestamp: "2024-01-01T00:00:00.000Z",
      });
    });

    const text = JSON.stringify(renderer!.toJSON());
    expect(text).toContain("test-user");
    expect(text).toContain("gui-shell__effect-layer");
  });

  it("ignores malformed gift effect payloads missing config shape", async () => {
    let onEventHandler: EventHandler | null = null;
    const createEventFeedImpl = ({ onEvent }: EventFeedArgs) => {
      onEventHandler = onEvent;
      return () => {};
    };

    let renderer: AppRenderer | null = null;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(App, {
          mode: "dock",
          eventsPath: "/gui/events",
          createEventFeedImpl,
        }),
      );
    });

    await TestRenderer.act(async () => {
      onEventHandler!({
        __guiEvent: "effect",
        effectType: "tiktok-gift-animation",
        playbackId: "effect-1",
        durationMs: 2500,
        assetUrl: "/gui/runtime/test.mp4",
      });
    });

    const text = JSON.stringify(renderer!.toJSON());
    expect(text).not.toContain("gui-shell__effect-layer");
  });

  it("ignores malformed gift effect payloads with string duration", async () => {
    let onEventHandler: EventHandler | null = null;
    const createEventFeedImpl = ({ onEvent }: EventFeedArgs) => {
      onEventHandler = onEvent;
      return () => {};
    };

    let renderer: AppRenderer | null = null;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(App, {
          mode: "dock",
          eventsPath: "/gui/events",
          createEventFeedImpl,
        }),
      );
    });

    await TestRenderer.act(async () => {
      onEventHandler!({
        __guiEvent: "effect",
        effectType: "tiktok-gift-animation",
        playbackId: "effect-bad-duration",
        durationMs: "2500",
        assetUrl: "/gui/runtime/test.mp4",
        config: {
          profileName: "portrait",
          sourceWidth: 960,
          sourceHeight: 864,
          renderWidth: 480,
          renderHeight: 854,
          rgbFrame: [0, 0, 480, 854],
          aFrame: [480, 0, 480, 854],
        },
      });
    });

    const text = JSON.stringify(renderer!.toJSON());
    expect(text).not.toContain("gui-shell__effect-layer");
  });

  it("queues gift effects and advances only after active playback completion", async () => {
    let onEventHandler: EventHandler | null = null;
    const createEventFeedImpl = ({ onEvent }: EventFeedArgs) => {
      onEventHandler = onEvent;
      return () => {};
    };
    const acknowledgements: Array<{ playbackId: string; reason: string }> = [];

    let renderer: AppRenderer | null = null;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(App, {
          mode: "dock",
          eventsPath: "/gui/events",
          createEventFeedImpl,
          sendGiftAnimationAckImpl: async (playbackId: string, reason: string) => {
            acknowledgements.push({ playbackId, reason });
            throw new Error("test acknowledgement failure");
          },
        }),
      );
    });

    await TestRenderer.act(async () => {
      onEventHandler!({
        __guiEvent: "effect",
        effectType: "tiktok-gift-animation",
        playbackId: "effect-1",
        durationMs: 2500,
        assetUrl: "/gui/runtime/test-1.mp4",
        config: {
          profileName: "portrait",
          sourceWidth: 960,
          sourceHeight: 864,
          renderWidth: 480,
          renderHeight: 854,
          rgbFrame: [0, 0, 480, 854],
          aFrame: [480, 0, 480, 854],
        },
      });
      onEventHandler!({
        __guiEvent: "effect",
        effectType: "tiktok-gift-animation",
        playbackId: "effect-2",
        durationMs: 2600,
        assetUrl: "/gui/runtime/test-2.mp4",
        config: {
          profileName: "portrait",
          sourceWidth: 960,
          sourceHeight: 864,
          renderWidth: 480,
          renderHeight: 854,
          rgbFrame: [0, 0, 480, 854],
          aFrame: [480, 0, 480, 854],
        },
      });
    });

    let shellProps = getEffectShellProps(renderer!);
    expect(shellProps.activeEffect.playbackId).toBe("effect-1");

    await TestRenderer.act(async () => {
      shellProps.onEffectComplete("effect-1", "ended");
    });

    shellProps = getEffectShellProps(renderer!);
    expect(shellProps.activeEffect.playbackId).toBe("effect-2");
    expect(acknowledgements).toEqual([{ playbackId: "effect-1", reason: "ended" }]);
  });

  it("ignores gift animation effects in overlay mode", async () => {
    let onEventHandler: EventHandler | null = null;
    const createEventFeedImpl = ({ onEvent }: EventFeedArgs) => {
      onEventHandler = onEvent;
      return () => {};
    };

    let renderer: AppRenderer | null = null;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(App, {
          mode: "overlay",
          eventsPath: "/gui/events",
          createEventFeedImpl,
          overlayMaxMessages: 3,
          overlayMaxLinesPerMessage: 3,
        }),
      );
    });

    await TestRenderer.act(async () => {
      onEventHandler!({
        __guiEvent: "effect",
        effectType: "tiktok-gift-animation",
        playbackId: "effect-ignored-overlay",
        durationMs: 2500,
        assetUrl: "/gui/runtime/test.mp4",
        config: {
          profileName: "portrait",
          sourceWidth: 960,
          sourceHeight: 864,
          renderWidth: 480,
          renderHeight: 854,
          rgbFrame: [0, 0, 480, 854],
          aFrame: [480, 0, 480, 854],
        },
      });
    });

    const text = JSON.stringify(renderer!.toJSON());
    expect(text).not.toContain("gui-shell__effect-layer");
  });

  it("exposes valid gift animation effects to minimal overlay GuiShell", async () => {
    let onEventHandler: EventHandler | null = null;
    const createEventFeedImpl = ({ onEvent }: EventFeedArgs) => {
      onEventHandler = onEvent;
      return () => {};
    };

    let renderer: AppRenderer | null = null;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(App, {
          mode: "overlay",
          eventsPath: "/gui/events",
          createEventFeedImpl,
          overlayMaxMessages: 3,
          overlayMaxLinesPerMessage: 3,
          initialAppearance: {
            profile: "minimal",
            revision: 0,
            settings: { compactRows: true, rowBackgroundsEnabled: true, maxDisplayableBadges: 1, streamSupporterChatEffectsEnabled: true },
          },
        }),
      );
    });

    await TestRenderer.act(async () => {
      onEventHandler!({
        __guiEvent: "effect",
        effectType: "tiktok-gift-animation",
        playbackId: "effect-minimal-overlay",
        durationMs: 2500,
        assetUrl: "/gui/runtime/test.mp4",
        config: {
          profileName: "portrait",
          sourceWidth: 960,
          sourceHeight: 864,
          renderWidth: 480,
          renderHeight: 854,
          rgbFrame: [0, 0, 480, 854],
          aFrame: [480, 0, 480, 854],
        },
      });
    });

    expect(getEffectShellProps(renderer!).activeEffect.playbackId).toBe("effect-minimal-overlay");
  });

  it("keeps valid gift animation effects out of standard overlay GuiShell", async () => {
    let onEventHandler: EventHandler | null = null;
    const createEventFeedImpl = ({ onEvent }: EventFeedArgs) => {
      onEventHandler = onEvent;
      return () => {};
    };

    let renderer: AppRenderer | null = null;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(App, {
          mode: "overlay",
          eventsPath: "/gui/events",
          createEventFeedImpl,
          overlayMaxMessages: 3,
          overlayMaxLinesPerMessage: 3,
        }),
      );
    });

    await TestRenderer.act(async () => {
      onEventHandler!({
        __guiEvent: "effect",
        effectType: "tiktok-gift-animation",
        playbackId: "effect-standard-overlay",
        durationMs: 2500,
        assetUrl: "/gui/runtime/test.mp4",
        config: {
          profileName: "portrait",
          sourceWidth: 960,
          sourceHeight: 864,
          renderWidth: 480,
          renderHeight: 854,
          rgbFrame: [0, 0, 480, 854],
          aFrame: [480, 0, 480, 854],
        },
      });
    });

    expect(renderer!.root.findByType(GuiShell).props.activeEffect).toBeNull();
  });

  it("keeps the minimal overlay feed connected across appearance revisions", async () => {
    let onEventHandler: EventHandler | null = null;
    let connectionCount = 0;
    let disposalCount = 0;
    const createEventFeedImpl = ({ onEvent }: EventFeedArgs) => {
      connectionCount += 1;
      onEventHandler = onEvent;
      return () => {
        disposalCount += 1;
      };
    };

    let renderer: AppRenderer | null = null;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(React.createElement(App, {
        mode: "overlay",
        createEventFeedImpl,
        overlayMaxMessages: 3,
        overlayMaxLinesPerMessage: 3,
        initialAppearance: {
          profile: "minimal",
          revision: 0,
          settings: { compactRows: true, rowBackgroundsEnabled: true, maxDisplayableBadges: 1, streamSupporterChatEffectsEnabled: true },
        },
      }));
    });
    await TestRenderer.act(async () => {
      onEventHandler!({
        __guiEvent: "appearance",
        profile: "minimal",
        revision: 1,
        settings: { compactRows: true, rowBackgroundsEnabled: false, maxDisplayableBadges: 0, streamSupporterChatEffectsEnabled: true },
      });
    });

    expect(connectionCount).toBe(1);
    expect(disposalCount).toBe(0);
    await TestRenderer.act(async () => renderer!.unmount());
    expect(disposalCount).toBe(1);
  });

  it("renders only gift animation effects in tiktok-animations mode", async () => {
    let onEventHandler: EventHandler | null = null;
    const createEventFeedImpl = ({ onEvent }: EventFeedArgs) => {
      onEventHandler = onEvent;
      return () => {};
    };

    let renderer: AppRenderer | null = null;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(App, {
          mode: "tiktok-animations",
          eventsPath: "/gui/events",
          createEventFeedImpl,
        }),
      );
    });

    await TestRenderer.act(async () => {
      onEventHandler!({
        type: "chat",
        kind: "chat",
        platform: "twitch",
        username: "test-user-ignored",
        text: "hidden-row",
        avatarUrl: "https://example.invalid/test-avatar.png",
        timestamp: "2024-01-01T00:00:00.000Z",
      });
      onEventHandler!({
        __guiEvent: "effect",
        effectType: "tiktok-gift-animation",
        playbackId: "effect-tiktok-only",
        durationMs: 2500,
        assetUrl: "/gui/runtime/test.mp4",
        config: {
          profileName: "portrait",
          sourceWidth: 960,
          sourceHeight: 864,
          renderWidth: 480,
          renderHeight: 854,
          rgbFrame: [0, 0, 480, 854],
          aFrame: [480, 0, 480, 854],
        },
      });
    });

    const text = JSON.stringify(renderer!.toJSON());
    expect(text).toContain("gui-shell__effect-layer");
    expect(text).not.toContain("hidden-row");
  });

  it("applies the configured feed mode before rows reach the overlay", async () => {
    let onEventHandler: EventHandler | null = null;
    const createEventFeedImpl = ({ onEvent }: EventFeedArgs) => {
      onEventHandler = onEvent;
      return () => {};
    };
    let renderer: AppRenderer | null = null;

    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(App, {
          mode: "overlay",
          feedMode: "chat",
          overlayMaxMessages: 3,
          overlayMaxLinesPerMessage: 3,
          createEventFeedImpl,
        }),
      );
    });
    await TestRenderer.act(async () => {
      onEventHandler!({
        type: "platform:follow",
        kind: "notification",
        platform: "twitch",
        username: "test-hidden-follower",
        text: "followed",
        avatarUrl: "https://example.invalid/hidden.png",
        timestamp: "2024-01-01T00:00:00.000Z",
      });
      onEventHandler!({
        type: "chat",
        kind: "chat",
        platform: "twitch",
        username: "test-visible-chatter",
        text: "visible chat",
        avatarUrl: "https://example.invalid/visible.png",
        timestamp: "2024-01-01T00:00:01.000Z",
      });
    });

    const shellRows = renderer!.root.findByType(GuiShell).props.rows as EventPayload[];
    expect(shellRows.map((row) => row.username)).toEqual([
      "test-visible-chatter",
    ]);
    await TestRenderer.act(async () => renderer!.unmount());
  });

  it("keeps every non-chat notification queued until its lifecycle exit completes", async () => {
    let onEventHandler: EventHandler | null = null;
    const createEventFeedImpl = ({ onEvent }: EventFeedArgs) => {
      onEventHandler = onEvent;
      return () => {};
    };
    let renderer: AppRenderer | null = null;

    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(App, {
          mode: "notifications",
          feedMode: "all",
          createEventFeedImpl,
        }),
      );
    });
    await TestRenderer.act(async () => {
      onEventHandler!({
        type: "chat",
        kind: "chat",
        platform: "twitch",
        username: "test-hidden-chatter",
        text: "hidden chat",
        avatarUrl: "https://example.invalid/chat.png",
        timestamp: "2024-01-01T00:00:00.000Z",
      });
    });
    expect(renderer!.root.findByType(ActivityBar).props.row).toBeNull();

    await TestRenderer.act(async () => {
      onEventHandler!({
        __guiEvent: "notification-lifecycle",
        eventId: "activity-2",
        phase: "exit-started",
      });
    });
    await TestRenderer.act(async () => {
      onEventHandler!({
        eventId: "activity-1",
        type: "greeting",
        kind: "greeting",
        platform: "twitch",
        username: "test-greeting-user",
        text: "first activity",
        avatarUrl: "https://example.invalid/greeting.png",
        timestamp: "2024-01-01T00:00:01.000Z",
      });
      onEventHandler!({
        eventId: "activity-2",
        type: "platform:raid",
        kind: "notification",
        platform: "twitch",
        username: "test-raid-user",
        text: "latest activity",
        avatarUrl: "https://example.invalid/raid.png",
        timestamp: "2024-01-01T00:00:02.000Z",
      });
      onEventHandler!({
        type: "chat",
        kind: "chat",
        platform: "twitch",
        username: "test-later-chatter",
        text: "does not evict activity",
        avatarUrl: "https://example.invalid/later-chat.png",
        timestamp: "2024-01-01T00:00:03.000Z",
      });
      onEventHandler!({
        __guiEvent: "effect",
        effectType: "tiktok-gift-animation",
        playbackId: "effect-ignored-notifications",
        durationMs: 2500,
        assetUrl: "/gui/runtime/test.mp4",
        config: {
          profileName: "portrait",
          sourceWidth: 960,
          sourceHeight: 864,
          renderWidth: 480,
          renderHeight: 854,
          rgbFrame: [0, 0, 480, 854],
          aFrame: [480, 0, 480, 854],
        },
      });
    });

    const currentRow = renderer!.root.findByType(ActivityBar).props.row as EventPayload;
    expect(currentRow.username).toBe("test-greeting-user");
    await TestRenderer.act(async () => {
      onEventHandler!({
        __guiEvent: "notification-lifecycle",
        eventId: "activity-1",
        phase: "exit-started",
      });
    });
    const activityProps = renderer!.root.findByType(ActivityBar).props;
    expect(activityProps.exitRequested).toBe(true);
    await TestRenderer.act(async () => {
      activityProps.onExitComplete("activity-1");
    });
    expect((renderer!.root.findByType(ActivityBar).props.row as EventPayload).username).toBe("test-raid-user");
    expect(renderer!.root.findByType(ActivityBar).props.exitRequested).toBe(false);
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("gui-shell__effect-layer");
    await TestRenderer.act(async () => renderer!.unmount());
  });

  it("drops malformed notification rows without a backend event ID", async () => {
    let onEventHandler: EventHandler | null = null;
    const createEventFeedImpl = ({ onEvent }: EventFeedArgs) => {
      onEventHandler = onEvent;
      return () => {};
    };
    let renderer: AppRenderer | null = null;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(React.createElement(App, {
        mode: "notifications",
        createEventFeedImpl,
      }));
    });
    await TestRenderer.act(async () => {
      onEventHandler!({
        type: "platform:follow",
        kind: "notification",
        platform: "twitch",
        username: "missing-id-user",
        text: "followed",
        avatarUrl: "https://example.invalid/avatar.png",
        timestamp: "2024-01-01T00:00:00.000Z",
      });
    });
    expect(renderer!.root.findByType(ActivityBar).props.row).toBeNull();
    await TestRenderer.act(async () => renderer!.unmount());
  });

  it("applies newer appearance snapshots while preserving the client profile", async () => {
    let onEventHandler: EventHandler | null = null;
    const createEventFeedImpl = ({ onEvent }: EventFeedArgs) => {
      onEventHandler = onEvent;
      return () => {};
    };
    let renderer: AppRenderer | null = null;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(React.createElement(App, {
        mode: "dock",
        createEventFeedImpl,
        initialAppearance: {
          profile: "standard",
          revision: 0,
          settings: { compactRows: true, rowBackgroundsEnabled: true, maxDisplayableBadges: 1, streamSupporterChatEffectsEnabled: true },
        },
      }));
    });
    await TestRenderer.act(async () => {
      onEventHandler!({ type: "chat", kind: "chat", platform: "twitch", username: "test-minimal-user", text: "hello", avatarUrl: "https://example.invalid/avatar.png", timestamp: null });
      onEventHandler!({
        __guiEvent: "appearance",
        profile: "minimal",
        revision: 1,
        settings: { compactRows: true, rowBackgroundsEnabled: false, maxDisplayableBadges: 0, streamSupporterChatEffectsEnabled: false },
      });
    });

    const text = JSON.stringify(renderer!.toJSON());
    expect(text).not.toContain("gui-shell--minimal");
    expect(text).not.toContain("gui-row--background-off");
    expect(text).toContain("test-minimal-user");
    await TestRenderer.act(async () => renderer!.unmount());
  });

  it("ignores malformed live appearance snapshots", async () => {
    let onEventHandler: EventHandler | null = null;
    const createEventFeedImpl = ({ onEvent }: EventFeedArgs) => {
      onEventHandler = onEvent;
      return () => {};
    };
    let renderer: AppRenderer | null = null;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(React.createElement(App, {
        mode: "dock",
        createEventFeedImpl,
        initialAppearance: {
          profile: "minimal",
          revision: 1,
          settings: { compactRows: true, rowBackgroundsEnabled: true, maxDisplayableBadges: 1 },
        },
      }));
    });
    await TestRenderer.act(async () => {
      onEventHandler!({
        __guiEvent: "appearance",
        profile: "minimal",
        revision: 2,
        settings: { compactRows: true, rowBackgroundsEnabled: "no", maxDisplayableBadges: 0 },
      });
    });

    const text = JSON.stringify(renderer!.toJSON());
    expect(text).not.toContain("gui-row--background-off");
    await TestRenderer.act(async () => renderer!.unmount());
  });

  it("keeps ordinary chat out of the notifications activity bar", async () => {
    let onEventHandler: EventHandler | null = null;
    const createEventFeedImpl = ({ onEvent }: EventFeedArgs) => {
      onEventHandler = onEvent;
      return () => {};
    };
    let renderer: AppRenderer | null = null;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(React.createElement(App, {
        mode: "notifications",
        createEventFeedImpl,
      }));
    });
    await TestRenderer.act(async () => {
      onEventHandler!({ type: "chat", kind: "chat", platform: "twitch", username: "hidden-chat", text: "hidden", avatarUrl: "https://example.invalid/chat.png", timestamp: null });
      onEventHandler!({ eventId: "visible-follow-1", type: "platform:follow", kind: "notification", platform: "twitch", username: "visible-follow", text: "followed", avatarUrl: "https://example.invalid/follow.png", timestamp: null });
    });

    const activity = renderer!.root.findByType(ActivityBar);
    expect(activity.props.row.username).toBe("visible-follow");
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("hidden-chat");
    await TestRenderer.act(async () => renderer!.unmount());
  });

  it("clears rows when the configured feed changes", async () => {
    let onEventHandler: EventHandler | null = null;
    const createEventFeedImpl = ({ onEvent }: EventFeedArgs) => {
      onEventHandler = onEvent;
      return () => {};
    };
    let renderer: AppRenderer | null = null;

    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(App, {
          mode: "dock",
          feedMode: "all",
          createEventFeedImpl,
        }),
      );
    });
    await TestRenderer.act(async () => {
      onEventHandler!({
        type: "platform:follow",
        kind: "notification",
        platform: "twitch",
        username: "test-previous-feed-user",
        text: "previous feed activity",
        avatarUrl: "https://example.invalid/previous-feed.png",
        timestamp: "2024-01-01T00:00:00.000Z",
      });
    });
    expect(JSON.stringify(renderer!.toJSON())).toContain("test-previous-feed-user");

    await TestRenderer.act(async () => {
      renderer!.update(
        React.createElement(App, {
          mode: "dock",
          feedMode: "chat",
          createEventFeedImpl,
        }),
      );
    });

    expect(JSON.stringify(renderer!.toJSON())).not.toContain("test-previous-feed-user");
    await TestRenderer.act(async () => renderer!.unmount());
  });
});
