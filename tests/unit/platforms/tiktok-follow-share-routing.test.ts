import { afterEach, describe, it, expect } from "bun:test";
import { createMainPresentationFixture } from "../../helpers/main-presentation-fixture";

type MainPresentationFixture = Awaited<
  ReturnType<typeof createMainPresentationFixture>
>;

type RoutedNotification = {
  type: string;
  platform: string;
  username: string;
  payload: unknown;
};

type PlatformEventPayload = {
  type: string;
  platform: string;
  data: {
    username: string;
    userId: string;
    timestamp: string;
    metadata: Record<string, unknown>;
  };
};

const getOnlyHandledNotification = (
  handled: readonly RoutedNotification[],
): RoutedNotification => {
  expect(handled).toHaveLength(1);
  const notification = handled[0];
  expect(notification).toBeDefined();
  if (!notification) {
    throw new Error("Expected one routed notification");
  }
  return notification;
};

const extractRoutedNotifications = (
  presentation: MainPresentationFixture,
): RoutedNotification[] =>
  presentation.queue.state.queue.flatMap((item) => {
    if (!("data" in item) || !("platform" in item)) {
      return [];
    }
    const data =
      item.data && typeof item.data === "object"
        ? (item.data as Record<string, unknown>)
        : {};
    const username = typeof data.username === "string" ? data.username : "";
    return [
      {
        type: item.type,
        platform: item.platform,
        username,
        payload: item.data,
      },
    ];
  });

describe("TikTok follow/share routing", () => {
  const activeFixtures: MainPresentationFixture[] = [];

  afterEach(async () => {
    while (activeFixtures.length > 0) {
      const fixture = activeFixtures.pop();
      if (fixture) {
        await fixture.dispose();
      }
    }
  });

  const createStartedFixture = async (): Promise<MainPresentationFixture> => {
    const presentation = await createMainPresentationFixture();
    activeFixtures.push(presentation);
    presentation.config.logging.file.enabled = false;
    presentation.config.general.followsEnabled = true;
    presentation.config.general.giftsEnabled = true;
    presentation.config.general.messagesEnabled = true;
    presentation.config.general.sharesEnabled = true;
    presentation.config.vfx.filePath = "/synthetic-only";
    await presentation.start();
    presentation.config.tiktok.enabled = true;
    presentation.config.tiktok.followsEnabled = true;
    presentation.config.tiktok.sharesEnabled = true;
    return presentation;
  };

  it("routes follow events through platform:event to PlatformEventRouter", async () => {
    const presentation = await createStartedFixture();

    presentation.bus.emit("platform:event", {
      type: "platform:follow",
      platform: "tiktok",
      data: {
        username: "Follower",
        userId: "user-1",
        timestamp: new Date().toISOString(),
        metadata: {},
      },
    });
    await new Promise((resolve) => setImmediate(resolve));

    const handled = extractRoutedNotifications(presentation);
    const notification = getOnlyHandledNotification(handled);
    expect(notification).toMatchObject({
      type: "platform:follow",
      username: "Follower",
    });
  });

  it("routes share events through platform:event to PlatformEventRouter", async () => {
    const presentation = await createStartedFixture();
    const emitted: PlatformEventPayload[] = [];
    const unsubscribe = presentation.bus.subscribe(
      "platform:event",
      async (payload: unknown) => {
        expect(isPlatformEventPayload(payload)).toBe(true);
        if (!isPlatformEventPayload(payload)) {
          throw new Error("Expected platform event payload");
        }
        emitted.push(payload);
      },
    );

    try {
      presentation.bus.emit("platform:event", {
        type: "platform:share",
        platform: "tiktok",
        data: {
          username: "Sharer",
          userId: "user-2",
          timestamp: new Date().toISOString(),
          metadata: {},
        },
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(emitted.find((p) => p.type === "platform:share")).toBeDefined();
      const handled = extractRoutedNotifications(presentation);
      const notification = getOnlyHandledNotification(handled);
      expect(notification).toMatchObject({
        type: "platform:share",
        username: "Sharer",
      });
    } finally {
      unsubscribe();
    }
  });
});

function isPlatformEventPayload(value: unknown): value is PlatformEventPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const event = value as Record<string, unknown>;
  const data = event.data;
  return (
    typeof event.type === "string" &&
    typeof event.platform === "string" &&
    !!data &&
    typeof data === "object"
  );
}
