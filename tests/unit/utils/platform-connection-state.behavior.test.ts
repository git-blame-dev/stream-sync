import { describe, expect, test } from "bun:test";
import { ConnectionState, ConnectionStateFactory } from "../../../src/utils/platform-connection-state";

describe("platform connection state", () => {
  test.each([1, "true", {}, false, undefined])("requires literal true for connected state: %s", (isConnected) => {
    const state = new ConnectionState({ isConnected, channel: "synthetic-channel", username: "synthetic-user" });
    expect(state.isConnected).toBe(false);
    expect(state.isApiReady()).toBe(false);
  });

  test("normalizes identities and rejects blank identity readiness", () => {
    const state = new ConnectionState({ isConnected: true, platform: "synthetic", channel: " channel ", username: " user " });
    expect(state.isApiReady()).toBe(true);
    expect(state.getDebugInfo()).toMatchObject({ channel: "channel", username: "user", platform: "synthetic" });
    expect(new ConnectionState({ isConnected: true, channel: " ", username: "user" }).isApiReady()).toBe(false);
    expect(new ConnectionState({ isConnected: true, channel: "channel", username: " " }).isApiReady()).toBe(false);
    expect(new ConnectionState({ isConnected: true, channel: 1 as unknown as string, username: "user" }).isApiReady()).toBe(false);
    expect(new ConnectionState({ isConnected: true, channel: "channel", username: {} as unknown as string }).isApiReady()).toBe(false);
  });

  test("preserves Twitch explicit identity and YouTube stream-ID keyed map semantics", () => {
    const twitch = ConnectionStateFactory.createTwitchState({ channel: " channel " }, { isActive: () => true });
    expect(twitch.channel).toBe("channel");
    expect(twitch.username).toBeUndefined();
    expect(twitch.isApiReady()).toBe(false);
    const youtube = ConnectionStateFactory.createYouTubeState({ username: " synthetic-user " }, { "synthetic-stream-id": {} });
    expect(youtube.isApiReady()).toBe(true);
    expect(youtube.username).toBe("synthetic-user");
    expect(ConnectionStateFactory.createYouTubeState({ username: "synthetic-user" }, {}).isConnected).toBe(false);
    expect(ConnectionStateFactory.createYouTubeState({ username: "synthetic-user" }, null).isConnected).toBe(false);
  });

  test("keeps TikTok truth strict and trims its identity", () => {
    expect(ConnectionStateFactory.createTikTokState({ username: " synthetic-user " }, { connected: true }).isApiReady()).toBe(true);
    expect(ConnectionStateFactory.createTikTokState({ username: "synthetic-user" }, { connected: 1 }).isConnected).toBe(false);
    expect(ConnectionStateFactory.createTikTokState({ username: " " }, { connected: true }).isApiReady()).toBe(false);
    expect(ConnectionStateFactory.createTikTokState({}, null).isConnected).toBe(false);
  });
});
