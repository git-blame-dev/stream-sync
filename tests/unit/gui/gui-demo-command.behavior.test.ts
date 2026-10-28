import { describe, expect, it } from "bun:test";

import { buildGuiDemoConfig, runGuiDemo } from "../../../scripts/local/gui-demo";
import { EventEmitter } from 'node:events';
import { DEMO_CHARACTER_CATALOG } from "../../../gui/src/demo/demo-catalog";

describe("GUI demo command behavior", () => {
  it('runs demo-only transport with synthetic defaults and existing signal shutdown', async () => {
    const signals = new EventEmitter();
    const exits: Array<string | number | null | undefined> = [];
    const writes: string[] = [];
    let stopped = 0;
    let finishExits: () => void = () => {};
    const finished = new Promise<void>((resolve) => { finishExits = resolve; });
    const hostProcess = {
      once: signals.once.bind(signals),
      exit: (code: number) => { exits.push(code); if (exits.length === 2) finishExits(); },
      stdout: { write: (text: string) => { writes.push(text); return true; } },
    };
    await runGuiDemo({
      logger: {},
      process: hostProcess,
      createGuiTransportServiceImpl(options) {
        expect(options.demoOnly).toBe(true);
        expect(options.config.gui).toMatchObject({ enableOperator: false, overlayMaxMessages: 6 });
        return {
          start: async () => {},
          stop: async () => { stopped += 1; },
          getAddress: () => ({ port: 4567 }),
        };
      },
    });
    expect(writes).toEqual(['Demo URL: http://127.0.0.1:4567/demo\n']);
    signals.emit('SIGINT');
    signals.emit('SIGTERM');
    await finished;
    expect(stopped).toBe(2);
    expect(exits).toEqual([0, 0]);
  });
  it("exposes the shared Goku, Naruto, and Ichigo demo avatar catalog", () => {
    expect(DEMO_CHARACTER_CATALOG).toEqual({
      Goku: "https://myanimelist.net/images/characters/2/344142.jpg",
      Naruto: "https://myanimelist.net/images/characters/15/570333.jpg",
      Ichigo: "https://myanimelist.net/images/characters/13/473588.jpg",
    });
  });
  it("disables operator mode without mutating the source config", () => {
    const source = {
      gui: {
        enableOperator: true,
        host: "127.0.0.1",
        port: 3399,
      },
    };

    const demoConfig = buildGuiDemoConfig(source);

    expect(demoConfig.gui).toMatchObject({
      enableOperator: false,
      host: "127.0.0.1",
      port: 3399,
    });
    expect(source.gui.enableOperator).toBe(true);
  });
});
