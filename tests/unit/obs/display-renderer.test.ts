import { describe, expect, it } from "bun:test";

import { DisplayRenderer } from "../../../src/obs/display-renderer.ts";

type Action =
  | { type: "chatText"; source: string; username: string; message: string }
  | { type: "groupVisibility"; source: string; group: string | null | undefined; visible: boolean }
  | { type: "chatDisplay"; visible: boolean; scene: string }
  | { type: "notificationDisplay"; visible: boolean; scene: string }
  | { type: "notificationText"; source: string; text: string }
  | { type: "platformLogo"; platform: string }
  | { type: "notificationLogo"; platform: string }
  | { type: "error"; message: string; error: unknown; payload: Record<string, unknown> | undefined };

type RendererOverrides = {
  sourcesManager?: Partial<{
    updateChatMsgText: (source: string, username: string, message: string) => Promise<void>;
    setGroupSourceVisibility: (source: string, group: string | null | undefined, visible: boolean) => Promise<void>;
    setChatDisplayVisibility: (visible: boolean, scene: string, platformLogos: Record<string, unknown>) => Promise<void>;
    setNotificationDisplayVisibility: (visible: boolean, scene: string, platformLogos: Record<string, unknown>) => Promise<void>;
    updateTextSource: (source: string, text: string) => Promise<void>;
    setPlatformLogoVisibility: (platform: string, platformLogos: Record<string, unknown>) => Promise<void>;
    setNotificationPlatformLogoVisibility: (platform: string, platformLogos: Record<string, unknown>) => Promise<void>;
  }>;
  handleDisplayQueueError?: (message: string, error: unknown, payload?: Record<string, unknown>) => void;
  obsReady?: boolean;
  config?: Record<string, unknown>;
  delay?: (ms: number) => Promise<void>;
  extractUsername?: (data: unknown) => string;
  validateDisplayConfig?: (config: { sourceName?: unknown; sceneName?: unknown; groupName?: unknown }, type: string) => boolean;
  isNotificationType?: (type: string) => boolean;
  isChatType?: (type: string) => boolean;
};

type TestDisplayItem = {
  type: string;
  platform: string;
  data: Record<string, unknown> & { message?: unknown; displayMessage?: unknown };
};

describe("DisplayRenderer", () => {
  const createRenderer = (
    platformConfig: Record<string, unknown> = {},
    overrides: RendererOverrides = {},
  ) => {
    const actions: Action[] = [];
    const sourcesManager = {
      updateChatMsgText: async (source: string, username: string, message: string) => {
        actions.push({ type: "chatText", source, username, message });
      },
      setGroupSourceVisibility: async (source: string, group: string | null | undefined, visible: boolean) => {
        actions.push({ type: "groupVisibility", source, group, visible });
      },
      setChatDisplayVisibility: async (visible: boolean, scene: string) => {
        actions.push({ type: "chatDisplay", visible, scene });
      },
      setNotificationDisplayVisibility: async (visible: boolean, scene: string) => {
        actions.push({ type: "notificationDisplay", visible, scene });
      },
      updateTextSource: async (source: string, text: string) => {
        actions.push({ type: "notificationText", source, text });
      },
      setPlatformLogoVisibility: async (platform: string) => {
        actions.push({ type: "platformLogo", platform });
      },
      setNotificationPlatformLogoVisibility: async (platform: string) => {
        actions.push({ type: "notificationLogo", platform });
      },
      ...(overrides.sourcesManager || {}),
    };

    const handleDisplayQueueError =
      overrides.handleDisplayQueueError ||
      ((message: string, error: unknown, payload?: Record<string, unknown>) => {
        actions.push({ type: "error", message, error, payload });
      });

    const renderer = new DisplayRenderer({
      obsManager: { isReady: async () => overrides.obsReady ?? true },
      sourcesManager,
      config: {
        chat: {
          sourceName: "chat",
          sceneName: "scene",
          groupName: "group",
          platformLogos: {},
        },
        notification: {
          sourceName: "notification",
          sceneName: "scene",
          groupName: "group",
          platformLogos: {},
        },
        timing: { transitionDelay: 0, notificationClearDelay: 0 },
        tiktok: { messagesEnabled: true, ...platformConfig },
        ...(overrides.config || {}),
      },
      delay: overrides.delay || (async () => {}),
      handleDisplayQueueError,
      extractUsername:
        overrides.extractUsername ||
        ((data: unknown) => {
          if (data && typeof data === "object" && "username" in data) {
            const username = data.username;
            return typeof username === "string" ? username : "";
          }
          return "";
        }),
      validateDisplayConfig: overrides.validateDisplayConfig || (() => true),
      isNotificationType:
        overrides.isNotificationType ||
        ((type: string) => typeof type === "string" && type.startsWith("platform:")),
      isChatType: overrides.isChatType || ((type: string) => type === "chat"),
    });

    return { renderer, actions };
  };

  const chatItem = (message: unknown): TestDisplayItem => ({
    type: "chat",
    platform: "tiktok",
    data: { username: "test-user", message },
  });

  it("renders chat items when enabled", async () => {
    const { renderer, actions } = createRenderer();

    await renderer.displayChatItem(chatItem("hello"));

    expect(actions.some((action) => action.type === "chatText")).toBe(true);
    expect(
      actions.some(
        (action) => action.type === "chatDisplay" && action.visible === true,
      ),
    ).toBe(true);
  });

  it("renders structured chat message text instead of object stringification", async () => {
    const { renderer, actions } = createRenderer();

    await renderer.displayChatItem(
      chatItem({
        text: "hello from object",
        parts: [{ type: "text", text: "hello from object" }],
      }),
    );

    const chatTextUpdate = actions.find((action) => action.type === "chatText");
    expect(chatTextUpdate).toBeDefined();
    expect(chatTextUpdate?.type === "chatText" ? chatTextUpdate.message : undefined).toBe(
      "hello from object",
    );
  });

  it("skips chat rendering when messages are disabled", async () => {
    const { renderer, actions } = createRenderer({ messagesEnabled: false });

    await renderer.displayChatItem(chatItem("hello"));

    expect(actions.length).toBe(0);
  });

  it("returns false when OBS is not ready for chat", async () => {
    const { renderer, actions } = createRenderer({}, { obsReady: false });

    const result = await renderer.displayChatItem(chatItem("hello"));

    expect(result).toBe(false);
    expect(actions.length).toBe(0);
  });

  it("returns false when chat config validation fails", async () => {
    const { renderer, actions } = createRenderer(
      {},
      { validateDisplayConfig: () => false },
    );

    const result = await renderer.displayChatItem(chatItem("hello"));

    expect(result).toBe(false);
    expect(actions.length).toBe(0);
  });

  it("reports notification errors when displayMessage is missing", async () => {
    const { renderer, actions } = createRenderer();
    const item: TestDisplayItem = {
      type: "platform:follow",
      platform: "tiktok",
      data: { username: "test-user" },
    };

    const result = await renderer.displayNotificationItem(item);

    expect(result).toBe(false);
    expect(actions.some((action) => action.type === "error")).toBe(true);
  });

  it("reports chat update errors and returns false", async () => {
    const { renderer, actions } = createRenderer(
      {},
      {
        sourcesManager: {
          updateChatMsgText: async () => {
            throw new Error("chat update failed");
          },
        },
      },
    );

    const result = await renderer.displayChatItem(chatItem("hello"));

    expect(result).toBe(false);
    expect(actions.some((action) => action.type === "error")).toBe(true);
  });

  it("returns early when no lingering chat is available", async () => {
    const { renderer, actions } = createRenderer();

    await renderer.displayLingeringChat(null);

    expect(actions.length).toBe(0);
  });

  it("hides notification displays for notification types", async () => {
    const { renderer, actions } = createRenderer();

    await renderer.hideCurrentDisplay({ type: "platform:gift" });

    expect(
      actions.some(
        (action) =>
          action.type === "notificationDisplay" && action.visible === false,
      ),
    ).toBe(true);
  });

  it("hides chat displays for chat types", async () => {
    const { renderer, actions } = createRenderer();

    await renderer.hideCurrentDisplay({ type: "chat" });

    expect(
      actions.some(
        (action) => action.type === "chatDisplay" && action.visible === false,
      ),
    ).toBe(true);
  });
});
