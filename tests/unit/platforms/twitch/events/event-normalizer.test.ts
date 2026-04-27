import { describe, test, expect } from "bun:test";
const {
  applyNotificationMetadataFallback,
  applyTimestampFallback,
} = require("../../../../../src/platforms/twitch/events/event-normalizer.ts");

describe("twitch event timestamp normalization", () => {
  test("uses metadata message timestamp for chat notifications", () => {
    const event = { message: { text: "hi" } };
    const result = applyTimestampFallback(
      event,
      {
        message_timestamp: "2024-01-01T00:00:00.987654321Z",
      },
      "channel.chat.message",
    );

    expect(result.timestamp).toBe("2024-01-01T00:00:00.987Z");
    expect(event.timestamp).toBeUndefined();
  });

  test("keeps chat body message id when envelope metadata id is also present", () => {
    const result = applyNotificationMetadataFallback(
      {
        message_id: "chat-body-id",
      },
      {
        message_id: "eventsub-envelope-id",
        message_timestamp: "2024-01-01T00:00:00.123456789Z",
      },
      "channel.chat.message",
    );

    expect(result.message_id).toBe("chat-body-id");
    expect(result.id).toBeUndefined();
    expect(result.timestamp).toBe("2024-01-01T00:00:00.123Z");
  });

  test("derives canonical bits id from metadata message id", () => {
    const result = applyNotificationMetadataFallback(
      {
        bits: 25,
        user_name: "test-cheerer",
        user_login: "test-cheerer",
      },
      {
        message_id: "eventsub-bits-message-id",
        message_timestamp: "2024-01-01T00:00:00.999999999Z",
      },
      "channel.bits.use",
    );

    expect(result.id).toBe("eventsub-bits-message-id");
    expect(result.message_id).toBeUndefined();
    expect(result.timestamp).toBe("2024-01-01T00:00:00.999Z");
  });

  test("uses followed_at for follow notifications", () => {
    const result = applyTimestampFallback(
      {
        user_name: "follower",
        followed_at: "2024-01-02T00:00:00.111222333Z",
      },
      {
        message_timestamp: "2024-01-02T00:00:05.000000000Z",
      },
      "channel.follow",
    );

    expect(result.timestamp).toBe("2024-01-02T00:00:00.111Z");
  });

  test("uses started_at for stream online notifications", () => {
    const result = applyTimestampFallback(
      {
        id: "stream-1",
        started_at: "2024-01-03T00:00:00Z",
      },
      {
        message_timestamp: "2024-01-03T00:00:20.000000000Z",
      },
      "stream.online",
    );

    expect(result.timestamp).toBe("2024-01-03T00:00:00.000Z");
  });

  test("does not use payload timestamp for subscription notifications", () => {
    const result = applyTimestampFallback(
      {
        user_name: "subber",
        timestamp: "2024-01-04T00:00:00Z",
      },
      undefined,
      "channel.subscribe",
    );

    expect(result.timestamp).toBeUndefined();
  });

  test("uses metadata timestamp for stream offline notifications", () => {
    const result = applyTimestampFallback(
      {
        id: "stream-1",
      },
      {
        message_timestamp: "2024-01-05T00:00:00.123456789Z",
      },
      "stream.offline",
    );

    expect(result.timestamp).toBe("2024-01-05T00:00:00.123Z");
  });

  test("drops timestamp for strict subscriptions when required source is invalid", () => {
    const result = applyTimestampFallback(
      {
        user_name: "subber",
        timestamp: "2024-01-04T00:00:00Z",
      },
      {
        message_timestamp: "invalid",
      },
      "channel.subscribe",
    );

    expect(result.timestamp).toBeUndefined();
  });

  test("rejects non-rfc3339 metadata timestamp values", () => {
    const secondsResult = applyTimestampFallback(
      {
        message: { text: "hello" },
      },
      {
        message_timestamp: "1704067200",
      },
      "channel.chat.message",
    );

    const microsecondsResult = applyTimestampFallback(
      {
        message: { text: "hello" },
      },
      {
        message_timestamp: "1704067200123456",
      },
      "channel.chat.message",
    );

    expect(secondsResult.timestamp).toBeUndefined();
    expect(microsecondsResult.timestamp).toBeUndefined();
  });

  test("keeps unknown subscription events unchanged", () => {
    const inputEvent = {
      user_name: "viewer",
      timestamp: "2024-01-06T00:00:00Z",
    };

    const result = applyTimestampFallback(
      inputEvent,
      {
        message_timestamp: "2024-01-06T00:00:10.000000000Z",
      },
      "channel.unknown",
    );

    expect(result).toEqual(inputEvent);
  });
});
