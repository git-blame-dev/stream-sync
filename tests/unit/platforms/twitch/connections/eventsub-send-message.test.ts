import { describe, it, expect, afterEach } from "bun:test";
import { createMockFn } from "../../../../helpers/bun-mock-utils";
import { noOpLogger } from "../../../../helpers/mock-factories";

import { TwitchEventSub } from "../../../../../src/platforms/twitch-eventsub.ts";
import {
  secrets,
  _resetForTesting,
  initializeStaticSecrets,
} from "../../../../../src/core/secrets";

const createTwitchAuth = () => ({
  isReady: () => true,
  getUserId: () => "test-user-123456",
  refreshTokens: async () => true,
});

type AxiosPostPayload = {
  message: string;
};

const isAxiosPostPayload = (value: unknown): value is AxiosPostPayload =>
  typeof value === "object" &&
  value !== null &&
  "message" in value &&
  typeof value.message === "string";

const expectFirstPostCall = (mockAxios: { post: { mock: { calls: unknown[][] } } }) => {
  const call = mockAxios.post.mock.calls[0];
  if (!call) {
    throw new Error("Expected an axios post call");
  }
  const [url, payload] = call;
  expect(typeof url).toBe("string");
  if (!isAxiosPostPayload(payload)) {
    throw new Error("Expected axios post payload with a message");
  }
  return { url, payload };
};

describe("TwitchEventSub chat sending", () => {
  let eventSub: InstanceType<typeof TwitchEventSub> | undefined;

  afterEach(() => {
    if (eventSub?.cleanup) {
      eventSub.cleanup().catch(() => {});
    }
    _resetForTesting();
    initializeStaticSecrets();
  });

  it("sends chat messages through the EventSub transport", async () => {
    const mockAxios = {
      post: createMockFn().mockResolvedValue({ data: { data: [{ message_id: "synthetic-message", is_sent: true }] } }),
      get: createMockFn().mockResolvedValue({ data: {} }),
      delete: createMockFn().mockResolvedValue({ data: {} }),
    };

    _resetForTesting();
    initializeStaticSecrets();
    secrets.twitch.accessToken = "test-access-token";
    eventSub = new TwitchEventSub(
      {
        clientId: "test-client-id",
        channel: "teststreamer",
        username: "teststreamer",
        broadcasterId: "test-broadcaster-id",
        dataLoggingEnabled: false,
      },
      {
        twitchAuth: createTwitchAuth(),
        logger: noOpLogger,
        axios: mockAxios,
        WebSocketCtor: class {
          readyState = 1;
          on() {}
          close() {}
          removeAllListeners() {}
        },
        RawPlatformDataLoggingService: class {
          async logRawPlatformData() {}
        },
      },
    );

    const result = await eventSub.sendMessage("hello world");

    expect(result).toMatchObject({ success: true, platform: "twitch" });
    expect(mockAxios.post.mock.calls).toHaveLength(1);
    const postCall = expectFirstPostCall(mockAxios);
    expect(postCall.url).toBe("https://api.twitch.tv/helix/chat/messages");
    expect(postCall.payload.message).toBe("hello world");
  });

  it("rejects when message is empty", async () => {
    const mockAxios = {
      post: createMockFn().mockResolvedValue({ data: {} }),
      get: createMockFn().mockResolvedValue({ data: {} }),
      delete: createMockFn().mockResolvedValue({ data: {} }),
    };

    _resetForTesting();
    initializeStaticSecrets();
    secrets.twitch.accessToken = "test-access-token";
    eventSub = new TwitchEventSub(
      {
        clientId: "test-client-id",
        channel: "teststreamer",
        username: "teststreamer",
        broadcasterId: "test-broadcaster-id",
        dataLoggingEnabled: false,
      },
      {
        twitchAuth: createTwitchAuth(),
        logger: noOpLogger,
        axios: mockAxios,
        WebSocketCtor: class {
          readyState = 1;
          on() {}
          close() {}
          removeAllListeners() {}
        },
        RawPlatformDataLoggingService: class {
          async logRawPlatformData() {}
        },
      },
    );

    await expect(eventSub.sendMessage("")).rejects.toThrow(/non-empty/i);
    await expect(eventSub.sendMessage("   ")).rejects.toThrow(/non-empty/i);
  });

  it("rejects when user ID is missing", async () => {
    const mockAxios = {
      post: createMockFn().mockResolvedValue({ data: {} }),
      get: createMockFn().mockResolvedValue({ data: {} }),
      delete: createMockFn().mockResolvedValue({ data: {} }),
    };

    _resetForTesting();
    initializeStaticSecrets();
    secrets.twitch.accessToken = "test-access-token";
    eventSub = new TwitchEventSub(
      {
        clientId: "test-client-id",
        channel: "teststreamer",
        username: "teststreamer",
        broadcasterId: "test-broadcaster-id",
        dataLoggingEnabled: false,
      },
      {
        twitchAuth: {
          isReady: () => true,
          getUserId: () => null,
          refreshTokens: async () => true,
        },
        logger: noOpLogger,
        axios: mockAxios,
        WebSocketCtor: class {
          readyState = 1;
          on() {}
          close() {}
          removeAllListeners() {}
        },
        RawPlatformDataLoggingService: class {
          async logRawPlatformData() {}
        },
      },
    );

    await expect(eventSub.sendMessage("hello")).rejects.toThrow(/user ID/i);
  });
});

for (const response of [undefined, {}, { data: [] }, { data: [null] },
  { data: [{ is_sent: 'true' }] }, { data: [{ is_sent: false, drop_reason: { code: 'synthetic-refusal' } }] },
  { data: [{ is_sent: true }, { is_sent: true }] }]) {
  it(`rejects unconfirmed Helix result ${JSON.stringify(response)} without retry`, async () => {
    secrets.twitch.accessToken = 'synthetic-token';
    let posts = 0;
    let refreshes = 0;
    const sender = new TwitchEventSub({ clientId: 'synthetic-client', broadcasterId: 'synthetic-channel' }, {
      logger: noOpLogger, WebSocketCtor: class extends EventTarget {},
      twitchAuth: { ...createTwitchAuth(), refreshTokens: async () => { refreshes++; return true; } },
      axios: { post: async () => { posts++; return { data: response }; } },
    });
    await expect(sender.sendMessage('synthetic message')).rejects.toThrow('send failed');
    expect(posts).toBe(1);
    expect(refreshes).toBe(0);
    await sender.cleanup();
  });
}
it('validates the refreshed Helix response and does not retry ambiguous POST failures', async () => {
  for (const afterRefresh of [true, false]) {
    secrets.twitch.accessToken = 'synthetic-token';
    let posts = 0;
    let refreshes = 0;
    const sender = new TwitchEventSub({ clientId: 'synthetic-client', broadcasterId: 'synthetic-channel' }, {
      logger: noOpLogger, WebSocketCtor: class extends EventTarget {},
      twitchAuth: { ...createTwitchAuth(), refreshTokens: async () => { refreshes++; return true; } },
      axios: { post: async () => {
        posts++;
        if (posts === 1) throw { response: { status: 401 } };
        return { data: { data: [{ is_sent: afterRefresh }] } };
      } },
    });
    if (afterRefresh) expect((await sender.sendMessage('synthetic message')).success).toBe(true);
    else await expect(sender.sendMessage('synthetic message')).rejects.toThrow('send failed');
    expect(posts).toBe(2);
    expect(refreshes).toBe(1);
    await sender.cleanup();
  }
  let posts = 0;
  const sender = new TwitchEventSub({ clientId: 'synthetic-client', broadcasterId: 'synthetic-channel' }, {
    logger: noOpLogger, WebSocketCtor: class extends EventTarget {}, twitchAuth: createTwitchAuth(),
    axios: { post: async () => { posts++; throw new Error('synthetic connection lost after POST'); } },
  });
  await expect(sender.sendMessage('synthetic message')).rejects.toThrow('send failed');
  expect(posts).toBe(1);
  await sender.cleanup();
});
