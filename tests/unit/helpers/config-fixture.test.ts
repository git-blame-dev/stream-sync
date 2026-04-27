import { describe, expect, it } from "bun:test";
import {
  createConfigFixture,
  createHandcamConfigFixture,
  createSourcesConfigFixture,
  createStreamElementsConfigFixture,
  createTikTokConfigFixture,
  createTwitchConfigFixture,
  createYouTubeConfigFixture,
  getRawTestConfig,
} from "../../helpers/config-fixture";

describe("config fixtures", () => {
  it("returns raw test config sections", () => {
    const raw = getRawTestConfig();

    expect(raw.general).toBeDefined();
    expect(raw.obs).toBeDefined();
    expect(raw.cooldowns).toBeDefined();
    expect(raw.gui).toBeDefined();
    expect(raw.obs.chatMsgGroup).toBe("test-chat-grp");
  });

  it("merges overrides for source config fixtures", () => {
    const sources = createSourcesConfigFixture({
      chatGroupName: "test-chat-group-override",
    });

    expect(sources.chatGroupName).toBe("test-chat-group-override");
    expect(sources.notificationGroupName).toBe("test-notification-group");
    expect(sources.fadeDelay).toBe(750);
  });

  it("merges overrides for StreamElements config fixture", () => {
    const streamElements = createStreamElementsConfigFixture({
      enabled: false,
      dataLoggingPath: "./test-logs",
    });

    expect(streamElements.enabled).toBe(false);
    expect(streamElements.dataLoggingEnabled).toBe(false);
    expect(streamElements.dataLoggingPath).toBe("./test-logs");
  });

  it("merges overrides for handcam config fixture", () => {
    const handcam = createHandcamConfigFixture({
      sourceName: "test-handcam-override",
      maxSize: 75,
    });

    expect(handcam.sourceName).toBe("test-handcam-override");
    expect(handcam.maxSize).toBe(75);
    expect(handcam.glowFilterName).toBe("test-glow-filter");
  });

  it("creates platform config fixtures with overrides", () => {
    const tiktok = createTikTokConfigFixture({
      username: "test-tiktok-override",
    });
    const twitch = createTwitchConfigFixture({
      channel: "test-twitch-override",
    });
    const youtube = createYouTubeConfigFixture({
      username: "test-youtube-override",
    });

    expect(tiktok.enabled).toBe(true);
    expect(tiktok.username).toBe("test-tiktok-override");
    expect(twitch.channel).toBe("test-twitch-override");
    expect(youtube.username).toBe("test-youtube-override");
    expect(youtube.chatMode).toBe("live");
  });

  it("builds config fixtures with inherited flags and derived timing", () => {
    const config = createConfigFixture({
      general: { messagesEnabled: false },
      tiktok: { enabled: true },
    });

    expect(config.general.messagesEnabled).toBe(false);
    expect(config.tiktok.messagesEnabled).toBe(false);
    expect(config.general.viewerCountPollingIntervalMs).toBe(60000);
    expect(config.gui).toBeDefined();
    expect(config.gui.enableDock).toBe(false);
  });

  it("merges gui overrides without dropping default gui fields", () => {
    const config = createConfigFixture({
      gui: { enableDock: true },
    });

    expect(config.gui.enableDock).toBe(true);
    expect(config.gui.enableOverlay).toBe(false);
    expect(config.gui.port).toBe(3399);
  });
});
