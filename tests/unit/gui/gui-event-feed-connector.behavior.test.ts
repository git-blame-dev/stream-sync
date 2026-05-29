import { describe, expect, it } from "bun:test";

import { createEventFeed } from "../../../gui/src/shared/create-event-feed";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

describe("GUI event feed connector behavior", () => {
  it("parses JSON events and ignores malformed payloads", () => {
    const received: Array<Record<string, unknown>> = [];
    const source = {
      closeCalled: 0,
      onmessage: null as null | ((event: MessageEvent<string>) => void),
      close() {
        this.closeCalled += 1;
      },
    };

    const dispose = createEventFeed({
      url: "/gui/events",
      onEvent: (payload: unknown) => {
        if (isRecord(payload)) {
          received.push(payload);
        }
      },
      eventSourceFactory: () => source,
    });

    source.onmessage?.(new MessageEvent("message", { data: '{"type":"chat","kind":"chat"}' }));
    source.onmessage?.(new MessageEvent("message", { data: "{bad-json" }));

    expect(received.length).toBe(1);
    const [firstReceived] = received;
    if (!firstReceived) {
      throw new Error("expected one parsed event");
    }
    expect(firstReceived.type).toBe("chat");

    dispose();
    expect(source.closeCalled).toBe(1);
  });
});
