import { describe, it, expect } from "bun:test";
import { TestEventBus } from "../helpers/gui-transport-test-utils";
import { createConfigFixture } from "../helpers/config-fixture";
import { createGuiTransportService } from "../../src/services/gui/gui-transport-service";
import { safeSetTimeout } from "../../src/utils/timeout-validator";

function getBaseUrl(service: any) {
  const address = service.getAddress();
  if (
    !address ||
    typeof address !== "object" ||
    typeof address.port !== "number"
  ) {
    throw new Error("Expected GUI transport service to expose a bound address");
  }
  return `http://127.0.0.1:${address.port}`;
}

function createSseReader(response: any) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const readWithTimeout = async (timeoutMs = 2000) => {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timeoutHandle = safeSetTimeout(
          () => reject(new Error("Timed out waiting for SSE event")),
          timeoutMs,
        );
      }),
    ]).finally(() => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    });
  };

  return {
    async readEvent() {
      while (true) {
        const { value, done } = await readWithTimeout();
        if (done) {
          throw new Error("SSE stream ended before receiving an event");
        }

        buffer += decoder.decode(value, { stream: true });
        const separatorIndex = buffer.indexOf("\n\n");
        if (separatorIndex === -1) {
          continue;
        }

        const chunk = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const dataLine = chunk
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.startsWith("data:"));

        if (!dataLine) {
          continue;
        }

        const dataText = dataLine.slice("data:".length).trim();
        return JSON.parse(dataText);
      }
    },
  };
}

describe("gui transport smoke", () => {
  it("serves dock and overlay routes correctly across enabled and disabled combinations", async () => {
    const cases = [
      {
        enableDock: true,
        enableOverlay: false,
        expectDockEnabled: true,
        expectOverlayEnabled: false,
        expectServiceActive: true,
      },
      {
        enableDock: false,
        enableOverlay: true,
        expectDockEnabled: false,
        expectOverlayEnabled: true,
        expectServiceActive: true,
      },
      {
        enableDock: true,
        enableOverlay: true,
        expectDockEnabled: true,
        expectOverlayEnabled: true,
        expectServiceActive: true,
      },
      {
        enableDock: false,
        enableOverlay: false,
        expectDockEnabled: false,
        expectOverlayEnabled: false,
        expectServiceActive: false,
      },
    ];

    for (const testCase of cases) {
      const config = createConfigFixture({
        gui: {
          enableDock: testCase.enableDock,
          enableOverlay: testCase.enableOverlay,
          host: "127.0.0.1",
          port: 0,
        },
      });

      const service = createGuiTransportService({
        config,
        eventBus: new TestEventBus(),
        logger: null,
      });

      await service.start();
      try {
        expect(service.isActive()).toBe(testCase.expectServiceActive);
        if (!testCase.expectServiceActive) {
          continue;
        }
        const baseUrl = getBaseUrl(service);

        const dockResponse = await fetch(`${baseUrl}/dock`);
        const dockBody = await dockResponse.text();
        expect(dockResponse.status).toBe(200);
        if (testCase.expectDockEnabled) {
          expect(dockBody).toContain("/gui/events");
          expect(dockBody).toContain("/gui/assets/dock.js");
          expect(dockBody).toContain("/gui/assets/styles.css");
        } else {
          expect(dockBody).toContain('data-gui-disabled="true"');
          expect(dockBody).not.toContain("/gui/events");
        }

        const overlayResponse = await fetch(`${baseUrl}/overlay`);
        const overlayBody = await overlayResponse.text();
        expect(overlayResponse.status).toBe(200);
        if (testCase.expectOverlayEnabled) {
          expect(overlayBody).toContain("/gui/events");
          expect(overlayBody).toContain("/gui/assets/overlay.js");
          expect(overlayBody).toContain("/gui/assets/styles.css");
        } else {
          expect(overlayBody).toContain('data-gui-disabled="true"');
          expect(overlayBody).not.toContain("/gui/events");
        }
      } finally {
        await service.stop();
      }
    }
  });

  it("delivers badgeImages in chat SSE payloads", async () => {
    const eventBus = new TestEventBus();
    const config = createConfigFixture({
      gui: {
        enableDock: true,
        enableOverlay: false,
        host: "127.0.0.1",
        port: 0,
        messageCharacterLimit: 0,
      },
    });

    const service = createGuiTransportService({
      config,
      eventBus,
      logger: null,
    });

    await service.start();
    const abortController = new AbortController();
    try {
      const response = await fetch(`${getBaseUrl(service)}/gui/events`, {
        signal: abortController.signal,
      });
      expect(response.status).toBe(200);

      const reader = createSseReader(response);
      eventBus.emit("display:row", {
        type: "platform:chat-message",
        platform: "youtube",
        data: {
          username: "test-youtube-user",
          userId: "test-youtube-user-id",
          avatarUrl: "https://example.invalid/test-avatar.png",
          message: { text: "hello" },
          badgeImages: [
            {
              imageUrl: "https://example.invalid/badge-1.png",
              source: "youtube",
              label: "member",
            },
          ],
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      });

      const event = await reader.readEvent();
      expect(event.badgeImages).toEqual([
        {
          imageUrl: "https://example.invalid/badge-1.png",
          source: "youtube",
          label: "member",
        },
      ]);
    } finally {
      abortController.abort();
      await service.stop();
    }
  });
});
