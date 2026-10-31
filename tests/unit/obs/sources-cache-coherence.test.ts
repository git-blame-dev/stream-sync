import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { OBSConnectionManager } from '../../../src/obs/connection';
import { createOBSSubsystem } from '../../../src/obs/subsystem';
import { createOBSEventService } from '../../../src/obs/obs-event-service';
import { createEventBus } from '../../../src/core/EventBus';
import { createConfigFixture } from '../../helpers/config-fixture';
import { noOpLogger } from '../../helpers/mock-factories';

class Socket extends EventEmitter {
  id = 7;
  lookups = 0;
  outputs: unknown[] = [];
  lookup: ((payload?: Record<string, unknown>) => Promise<{ sceneItemId: number }>) | undefined;
  async connect() { this.emit('Identified'); return {}; }
  async disconnect() {}
  async call(type: string, payload?: Record<string, unknown>) {
    if (type === 'GetSceneItemId') {
      this.lookups++;
      return this.lookup ? this.lookup(payload) : { sceneItemId: this.id };
    }
    if (type === 'SetSceneItemEnabled') this.outputs.push(payload);
    return {};
  }
}

function setup() {
  const socket = new Socket();
  const manager = new OBSConnectionManager({ obs: socket, config: {
    enabled: true, password: 'synthetic-only', address: 'ws://synthetic.invalid', connectionTimeoutMs: 5000,
  } });
  const bus = createEventBus();
  const config = createConfigFixture();
  expect(config.general.envFileReadEnabled).toBe(false);
  expect(config.general.envFileWriteEnabled).toBe(false);
  const subsystem = createOBSSubsystem({ config, logger: noOpLogger as never, eventBus: bus,
    getOBSConnectionManager: () => manager, createOBSEventService: createOBSEventService as never });
  return { socket, manager, sources: subsystem.sourcesManager, async cleanup() {
    (subsystem.obsEventService as { destroy(): void }).destroy();
    subsystem.effectsManager.dispose();
    bus.reset();
    manager.dispose();
    await manager.disconnect();
    expect(socket.eventNames()).toEqual([]);
  } };
}

const scene = 'synthetic-scene';
const source = 'synthetic-source';

test('subsystem forwards class invalidation and retains normal source cache hits', async () => {
  const f = setup();
  try {
    await f.manager.connect();
    await f.sources.setSourceVisibility(scene, source, false);
    await f.sources.setSourceVisibility(scene, source, true);
    expect(f.socket.lookups).toBe(1);
    f.socket.id = 8;
    f.socket.emit('SceneItemRemoved');
    await f.sources.setSourceVisibility(scene, source, true);
    expect(f.socket.lookups).toBe(2);
    expect(f.socket.outputs).toEqual([
      { sceneName: scene, sceneItemId: 7, sceneItemEnabled: false },
      { sceneName: scene, sceneItemId: 7, sceneItemEnabled: true },
      { sceneName: scene, sceneItemId: 8, sceneItemEnabled: true },
    ]);
  } finally { await f.cleanup(); }
});

test.each([false, true])('distinct colon and Unicode tuples remain distinct in either order: %s', async (reverse) => {
  const f = setup();
  const pairs = [{ scene: '測:a', source: 'b', id: 11 }, { scene: '測', source: 'a:b', id: 22 }];
  if (reverse) pairs.reverse();
  f.socket.lookup = async payload => ({ sceneItemId: pairs.find(pair => pair.scene === payload?.sceneName && pair.source === payload?.sourceName)!.id });
  try {
    await f.manager.connect();
    const writeAll = async () => {
      for (const pair of pairs) await f.sources.setSourceVisibility(pair.scene, pair.source, true);
    };
    const expected = pairs.map(pair => ({ sceneName: pair.scene, sceneItemId: pair.id, sceneItemEnabled: true }));
    await writeAll();
    await writeAll();
    expect(f.socket.lookups).toBe(2);
    expect(f.socket.outputs).toEqual([...expected, ...expected]);
    f.sources.clearSceneItemCache();
    await writeAll();
    expect(f.socket.lookups).toBe(4);
    f.socket.emit('SceneItemRemoved');
    await writeAll();
    expect(f.socket.lookups).toBe(6);
    expect(f.socket.outputs).toEqual([...expected, ...expected, ...expected, ...expected]);
  } finally { await f.cleanup(); }
});

test('held old lookup cannot repopulate cache or dispatch obsolete visibility', async () => {
  const f = setup();
  let release!: (value: { sceneItemId: number }) => void;
  const held = new Promise<{ sceneItemId: number }>(resolve => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  f.socket.lookup = () => { f.socket.lookup = undefined; entered(); return held; };
  try {
    await f.manager.connect();
    const pending = f.sources.setSourceVisibility(scene, source, true);
    await started;
    f.socket.id = 8;
    f.socket.emit('SceneItemRemoved');
    release({ sceneItemId: 7 });
    await pending;
    expect(await f.sources.getSceneItemId(scene, source)).toEqual({ sceneName: scene, sceneItemId: 8 });
    expect(f.socket.lookups).toBe(2);
    expect(f.socket.outputs).toEqual([{ sceneName: scene, sceneItemId: 8, sceneItemEnabled: true }]);
  } finally { release({ sceneItemId: 7 }); await f.cleanup(); }
});

test('repeated invalidation is bounded and reports an error without a visibility write', async () => {
  const f = setup();
  f.socket.lookup = async () => { f.socket.emit('SceneItemRemoved'); return { sceneItemId: 7 }; };
  try {
    await f.manager.connect();
    await expect(f.sources.setSourceVisibility(scene, source, true)).rejects.toThrow('changed');
    expect(f.socket.lookups).toBe(2);
    expect(f.socket.outputs).toEqual([]);
    await expect(f.sources.getSceneItemId(scene, source)).rejects.toThrow('changed');
    expect(f.socket.lookups).toBe(4);
  } finally { await f.cleanup(); }
});

// Enumerate microtask interleavings, including the cached-hit await continuation.
// No timer or internal owner is replaced; invalidation arrives from the SDK.
for (let boundary = 0; boundary <= 8; boundary += 1) {
  test(`cached visibility tolerates SDK invalidation at microtask boundary ${boundary}`, async () => {
    const f = setup();
    try {
      await f.manager.connect();
      await f.sources.getSceneItemId(scene, source);
      const pending = f.sources.setSourceVisibility(scene, source, true);
      for (let step = 0; step < boundary; step += 1) await Promise.resolve();
      const alreadyDispatched = f.socket.outputs.length;
      f.socket.id = 8;
      f.socket.emit('SceneItemRemoved');
      await pending;
      expect(f.socket.outputs.slice(alreadyDispatched)).toEqual(alreadyDispatched === 0
        ? [{ sceneName: scene, sceneItemId: 8, sceneItemEnabled: true }]
        : []);
      expect(await f.sources.getSceneItemId(scene, source)).toEqual({ sceneName: scene, sceneItemId: 8 });
    } finally { await f.cleanup(); }
  });
}
