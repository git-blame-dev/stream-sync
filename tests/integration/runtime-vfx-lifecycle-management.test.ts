import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestAppRuntime } from '../helpers/runtime-test-harness';
import { withTimeout } from '../../src/utils/timeout-wrapper';
import { waitFor } from '../helpers/event-driven-testing';
import { EventBus } from '../../src/core/EventBus';
import { VFXCommandService } from '../../src/services/VFXCommandService';

const owners: Array<{ runtime: ReturnType<typeof createTestAppRuntime>['runtime']; dir: string; unsubscribers: Array<() => void> }> = [];
afterEach(async () => {
  const results = await Promise.allSettled(owners.splice(0).map(async ({ runtime, dir, unsubscribers }) => {
    try { await runtime.shutdown(); } finally {
      try { for (const unsubscribe of unsubscribers) unsubscribe(); }
      finally { await rm(dir, { recursive: true, force: true }); }
    }
  }));
  const failed = results.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
});

async function fixture(commandsEnabled = true) {
  const dir = await mkdtemp(join(tmpdir(), 'synthetic-runtime-vfx-'));
  try {
    await writeFile(join(dir, 'synthetic-confetti.mp4'), 'synthetic media fixture; OBS transport is simulated');
    const owner = createTestAppRuntime({
      general: { commandsEnabled }, vfx: { filePath: dir },
      commands: { 'synthetic-confetti': '!hello, synthetic-media-source' },
      gifts: { command: '!hello' },
    });
    const unsubscribers: Array<() => void> = [];
    owners.push({ runtime: owner.runtime, dir, unsubscribers });
    const executed: Record<string, unknown>[] = [];
    const completed: Record<string, unknown>[] = [];
    for (const [eventName, events] of [['vfx:command-executed', executed], ['vfx:effect-completed', completed]] as const) {
      const unsubscribe = owner.eventBus.subscribe(eventName, value => { events.push(value); });
      if (typeof unsubscribe === 'function') unsubscribers.push(unsubscribe);
    }
    const emit = (overrides: Record<string, unknown> = {}) => owner.eventBus.emit?.('vfx:command-received', {
      command: '!hello', username: 'SyntheticViewer', userId: 'synthetic-viewer-id', platform: 'twitch',
      context: { skipCooldown: true, correlationId: 'synthetic-vfx-correlation' }, ...overrides,
    });
    const waitForCompletion = (count = 1) => withTimeout(waitFor(() => completed.length === count), 2000);
    return { ...owner, dir, executed, completed, emit, waitForCompletion };
  } catch (error) { await rm(dir, { recursive: true, force: true }); throw error; }
}

describe('constructed runtime VFX routing, resolution and lifecycle', () => {
  for (const commandsEnabled of [false, true]) {
    test(`resolves text and key commands through real effects with commandsEnabled=${commandsEnabled}`, async () => {
      const h = await fixture(commandsEnabled);
      await h.runtime.start();
      h.emit();
      await h.waitForCompletion();
      h.emit({ command: undefined, commandKey: 'gifts', platform: 'youtube', userId: 'synthetic-key-viewer',
        context: { skipCooldown: true, correlationId: 'synthetic-key-correlation' } });
      await h.waitForCompletion(2);
      expect(h.executed.map(event => ({ command: event.command, commandKey: event.commandKey, platform: event.platform, userId: event.userId }))).toEqual([
        { command: '!hello', commandKey: 'synthetic-confetti', platform: 'twitch', userId: 'synthetic-viewer-id' },
        { command: '!hello', commandKey: 'synthetic-confetti', platform: 'youtube', userId: 'synthetic-key-viewer' },
      ]);
      expect(h.executed[1]?.context).toMatchObject({ source: 'eventbus', skipCooldown: true, correlationId: 'synthetic-key-correlation' });
      expect(h.remoteObs.calls).toEqual([1, 2].flatMap(() => [
        { method: 'SetInputSettings', data: { inputName: 'synthetic-media-source', inputSettings: { local_file: join(h.dir, 'synthetic-confetti.mp4'), looping: false }, overlay: false } },
        { method: 'TriggerMediaInputAction', data: { inputName: 'synthetic-media-source', mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART' } },
      ]));
    });
  }

  test('canonical automatic context omits absent userId and overrides nested identity', async () => {
    const h = await fixture();
    h.emit({ command: undefined, commandKey: 'gifts', userId: undefined,
      context: { skipCooldown: true, correlationId: 'synthetic-automatic', platform: 'nested-invalid', username: 'nested-invalid', userId: 'nested-invalid' } });
    await h.waitForCompletion();
    expect(h.executed[0]?.context).toMatchObject({ username: 'SyntheticViewer', platform: 'twitch', skipCooldown: true, correlationId: 'synthetic-automatic', source: 'eventbus' });
    expect(h.executed[0]?.context).not.toHaveProperty('userId');
    expect(h.executed[0]).not.toHaveProperty('userId');
  });

  for (const [name, overrides] of [
    ['service recursion', { source: 'vfx-service' }],
    ['eventbus recursion', { source: 'eventbus' }],
    ['missing command', { command: undefined }],
    ['conflicting correlation', { correlationId: 'synthetic-conflict' }],
    ['anonymous cooldown', { userId: undefined, context: { skipCooldown: false, correlationId: 'synthetic-no-user' } }],
  ] as const) {
    test(`rejects ${name} before a separately correlated valid request`, async () => {
      const h = await fixture();
      const bus = h.eventBus;
      const service = h.runtime.vfxCommandService;
      if (!(bus instanceof EventBus) || !(service instanceof VFXCommandService)) {
        throw new TypeError('Expected constructed VFX routing owners');
      }
      const settledCount = () => {
        const stats = bus.getEventStats()['vfx:command-received'];
        return (stats?.success ?? 0) + (stats?.error ?? 0);
      };
      const settledBefore = settledCount();
      const commandsBefore = service.getStatus().stats.totalCommands;
      const callsBefore = [...h.remoteObs.calls];
      h.emit(overrides);
      await waitFor(() => settledCount() === settledBefore + 1);
      expect(service.getStatus().stats.totalCommands).toBe(commandsBefore);
      expect(h.remoteObs.calls).toEqual(callsBefore);
      expect(h.executed).toEqual([]);
      expect(h.completed).toEqual([]);

      const correlationId = `synthetic-valid-after-${name.replaceAll(' ', '-')}`;
      h.emit({ context: { skipCooldown: true, correlationId } });
      await h.waitForCompletion();
      expect(service.getStatus().stats.totalCommands).toBe(commandsBefore + 1);
      expect(h.executed).toHaveLength(1);
      expect(h.completed).toHaveLength(1);
      expect(h.completed[0]).toMatchObject({ correlationId, context: { correlationId } });
      expect(h.remoteObs.calls.filter(call => call.method === 'TriggerMediaInputAction')).toHaveLength(1);
    });
  }

  test('external OBS failure publishes no completed effect and later command recovers', async () => {
    const h = await fixture();
    h.remoteObs.failure = new Error('synthetic OBS failure');
    h.emit();
    await waitFor(() => typeof h.runtime.vfxCommandService.getStatus === 'function' &&
      (h.runtime.vfxCommandService.getStatus as () => { stats: { failedCommands: number } })().stats.failedCommands === 1);
    expect(h.executed).toEqual([]);
    expect(h.completed).toEqual([]);
    h.remoteObs.failure = undefined;
    h.emit();
    await h.waitForCompletion();
    expect(h.remoteObs.calls.filter(call => call.method === 'TriggerMediaInputAction')).toHaveLength(1);
    expect(h.executed[0]?.vfxConfig).toMatchObject({ filename: 'synthetic-confetti', mediaSource: 'synthetic-media-source', vfxFilePath: h.dir });
  });

  test('actual cooldown blocks a repeat and shutdown retires event admission and OBS listeners', async () => {
    const h = await fixture();
    const controlled = { context: { skipCooldown: false, correlationId: 'synthetic-controlled' } };
    h.emit(controlled);
    await h.waitForCompletion();
    h.emit(controlled);
    await waitFor(() => (h.runtime.vfxCommandService.getStatus as () => { stats: { cooldownBlocked: number } })().stats.cooldownBlocked === 1);
    expect(h.executed).toHaveLength(1);
    await h.runtime.shutdown();
    h.emit();
    expect(h.remoteObs.eventNames()).toEqual([]);
    expect(h.remoteObs.calls.filter(call => call.method === 'TriggerMediaInputAction')).toHaveLength(1);
    expect(h.completed).toHaveLength(1);
  });
});
