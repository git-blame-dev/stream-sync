import { describe, expect, it } from "bun:test";

import {
  registerModuleMocks,
  createWebSocketMock,
  createAxiosMock,
  createTikTokConnectorMock,
  createYoutubeiMock,
  toHaveLengthGreaterThan,
  toBeValidNotification,
  toBeValidUser,
} from "../../setup/bun.setup";

type TestGlobal = typeof globalThis & {
  originalConsole: Console;
  restoreConsole: () => void;
};

type SetupMatcherAssertions = ReturnType<typeof expect> & {
  not: SetupMatcherAssertions;
  toHaveLengthGreaterThan: (expected: number) => void;
  toBeValidNotification: () => void;
  toBeValidUser: () => void;
};

const expectWithSetupMatchers = (received: unknown): SetupMatcherAssertions =>
  expect(received) as SetupMatcherAssertions;

describe("bun setup contracts behavior", () => {
  it("allows module mock registration to run repeatedly", () => {
    expect(() => registerModuleMocks()).not.toThrow();
  });

  it("builds websocket mock factory contract", () => {
    const webSocketFactory = createWebSocketMock();
    const socket = webSocketFactory();

    expect(webSocketFactory.CONNECTING).toBe(0);
    expect(webSocketFactory.OPEN).toBe(1);
    expect(socket.readyState).toBe(1);
    expect(typeof socket.on).toBe("function");
  });

  it("builds axios mock factory contract", async () => {
    const axiosMock = createAxiosMock();

    expect((await axiosMock.get()).data.data).toEqual([]);
    expect((await axiosMock.post()).data.data).toEqual([]);
    const axiosInstance = axiosMock.create();
    expect((await axiosInstance.delete()).data.data).toEqual([]);
  });

  it("builds tiktok and youtube mock module contracts", async () => {
    const tiktokMock = createTikTokConnectorMock();
    const youtubeMock = createYoutubeiMock();

    const tiktokClient = new tiktokMock.WebcastPushConnection();
    expect(await tiktokClient.connect()).toBe(true);
    expect(tiktokMock.__esModule).toBe(true);

    const innertube = await youtubeMock.Innertube.create();
    expect(innertube.session.context.client.clientName).toBe("WEB");
    expect((await innertube.getBasicInfo()).basic_info.view_count).toBe(1000);
  });

  it("restores console through global helper", () => {
    const testGlobal = globalThis as TestGlobal;
    const originalConsole = testGlobal.originalConsole;
    global.console = {
      ...originalConsole,
      log: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };

    testGlobal.restoreConsole();

    expect(global.console).toBe(originalConsole);
  });

  it("supports toHaveLengthGreaterThan matcher behavior", () => {
    expectWithSetupMatchers([1, 2]).toHaveLengthGreaterThan(1);
    expectWithSetupMatchers([1]).not.toHaveLengthGreaterThan(3);
    expect(toHaveLengthGreaterThan([1, 2], 1).pass).toBe(true);
    expect(toHaveLengthGreaterThan([1], 3).pass).toBe(false);
  });

  it("supports toBeValidNotification matcher behavior", () => {
    const notification = {
      id: "test-id",
      type: "message",
      username: "test-user",
      platform: "test-platform",
      displayMessage: "test-display",
      ttsMessage: "test-tts",
    };

    expectWithSetupMatchers(notification).toBeValidNotification();
    expectWithSetupMatchers({}).not.toBeValidNotification();
    expect(
      toBeValidNotification(notification).pass,
    ).toBe(true);
    expect(toBeValidNotification({}).pass).toBe(false);
  });

  it("supports toBeValidUser matcher behavior", () => {
    expectWithSetupMatchers({ username: "test-user" }).toBeValidUser();
    expectWithSetupMatchers({}).not.toBeValidUser();
    expect(toBeValidUser({ username: "test-user" }).pass).toBe(true);
    expect(toBeValidUser({}).pass).toBe(false);
  });
});
