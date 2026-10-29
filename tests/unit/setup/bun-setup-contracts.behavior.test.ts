import { describe, expect, it } from "bun:test";
import { isMockFunction } from "../../helpers/bun-mock-utils";

import {
  registerModuleMocks,
  createWebSocketMock,
  createAxiosMock,
  createTikTokConnectorMock,
  createYoutubeiMock,
} from "../../setup/bun.setup";

type TestGlobal = typeof globalThis & {
  originalConsole: Console;
  restoreConsole: () => void;
};

describe("bun setup contracts behavior", () => {
  it("allows repeated module mock registration and retains usable registered mocks", async () => {
    expect(() => registerModuleMocks()).not.toThrow();
    // Axios has distinct ESM/CJS entries; consume the ESM entry registered by mock.module.
    const firstRegistration = await import("axios") as unknown as ReturnType<typeof createAxiosMock>;
    if (!isMockFunction(firstRegistration.get)) throw new Error("Expected registered mock HTTP boundary");
    const firstGet = firstRegistration.get;
    expect(() => registerModuleMocks()).not.toThrow();
    const registered = await import("axios") as unknown as ReturnType<typeof createAxiosMock>;
    if (!isMockFunction(registered.get)) throw new Error("Expected registered mock HTTP boundary");
    expect(registered.get).not.toBe(firstGet);
    expect(await registered.get()).toEqual({ data: { data: [] } });
    expect(registered.get).toHaveBeenCalledTimes(1);
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
    const previousConsole = global.console;
    try {
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
    } finally {
      global.console = previousConsole;
    }
  });

});
