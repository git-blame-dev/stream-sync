import { describe, it, beforeEach, afterAll, expect } from "bun:test";
import { createMockFn, clearAllMocks } from "../../helpers/bun-mock-utils";
import * as ManagerModule from "../../../src/services/innertube-instance-manager.ts";

describe("InnertubeInstanceManager behavior", () => {
  const createManagedInstance = (id: string) => ({
    id,
    dispose: async () => {},
    session: { close: async () => {} },
  });

  const resetManager = async () => {
    await ManagerModule.cleanup();
    ManagerModule._resetInstance();
  };

  beforeEach(async () => {
    clearAllMocks();
    await resetManager();
  });

  afterAll(async () => {
    await resetManager();
  });

  it("caches healthy instances and reuses them", async () => {
    const createFn = createMockFn(async () => createManagedInstance("instance"));
    const createInstance = () => createFn();
    const manager = new ManagerModule.InnertubeInstanceManager({ instanceTimeout: 5000 });

    const first = await manager.getInstance("default", createInstance);
    const second = await manager.getInstance("default", createInstance);

    expect(first).toBe(second);
    expect(createFn).toHaveBeenCalledTimes(1);
    expect(manager.getStats().activeInstances).toBe(1);
  });

  it("creates new instance when cached is unhealthy", async () => {
    const createFn = createMockFn()
      .mockResolvedValueOnce(createManagedInstance("one"))
      .mockResolvedValueOnce(createManagedInstance("two"));
    const createInstance = () => createFn();
    const manager = new ManagerModule.InnertubeInstanceManager({ instanceTimeout: 5000 });

    await manager.getInstance("default", createInstance);
    manager.markInstanceUnhealthy("default");
    const next = await manager.getInstance("default", createInstance);

    expect(next).toMatchObject({ id: "two" });
    expect(createFn).toHaveBeenCalledTimes(2);
  });

  it("cleans up oldest instance when exceeding maxInstances", async () => {
    const first = {
      dispose: createMockFn(async () => {}),
      session: { close: createMockFn(async () => {}) },
    };
    const second = {
      dispose: createMockFn(async () => {}),
      session: { close: createMockFn(async () => {}) },
    };
    const third = {
      dispose: createMockFn(async () => {}),
      session: { close: createMockFn(async () => {}) },
    };
    const createFn = createMockFn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(third);
    const createInstance = () => createFn();

    const manager = new ManagerModule.InnertubeInstanceManager({ instanceTimeout: 5000 });
    manager.maxInstances = 2;

    await manager.getInstance("a", createInstance);
    await manager.getInstance("b", createInstance);
    const firstCached = manager.activeInstances.get("a");
    const secondCached = manager.activeInstances.get("b");
    if (firstCached === undefined || secondCached === undefined) {
      throw new Error("Expected cached instances for cleanup ordering");
    }
    firstCached.lastAccessed = 0;
    secondCached.lastAccessed = 1;
    await manager.getInstance("c", createInstance);

    expect(createFn).toHaveBeenCalledTimes(3);
    expect(manager.getStats().activeInstances).toBe(2);
  });

  it("disposes all instances on cleanup", async () => {
    const inst = {
      dispose: createMockFn(async () => {}),
      session: { close: createMockFn(async () => {}) },
    };
    const manager = new ManagerModule.InnertubeInstanceManager({ instanceTimeout: 5000 });
    manager._cacheInstance("x", inst);

    await manager.cleanup();

    expect(manager.disposed).toBe(true);
    expect(manager.getStats().activeInstances).toBe(0);
  });

  it("rejects non-function importer in setInnertubeImporter", () => {
    expect(() => Reflect.apply(ManagerModule.setInnertubeImporter, null, ["not-a-function"])).toThrow(
      "Innertube importer must be a function",
    );
  });

  it("accepts valid function in setInnertubeImporter", () => {
    const customImporter = () => Promise.resolve({ Innertube: { create: async () => ({}) } });
    expect(() =>
      ManagerModule.setInnertubeImporter(customImporter),
    ).not.toThrow();
    ManagerModule.setInnertubeImporter(null);
  });

  it("installs parser log adapter when parser API is provided by importer", async () => {
    let installCalls = 0;
    const manager = new ManagerModule.InnertubeInstanceManager({ instanceTimeout: 5000 });
    manager.innertubeImporter = async () => ({
      Innertube: {
        create: async () => ({ id: "instance-with-parser" }),
      },
      Parser: {
        setParserErrorHandler: () => {
          installCalls += 1;
        },
      },
    });

    await manager.getInstance("parser-test");

    expect(installCalls).toBe(1);
  });
});
