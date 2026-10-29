import { afterEach, expect, it, spyOn } from 'bun:test';
import { OBSConnectionManager } from '../../../src/obs/connection';
import { DisplayQueue, initializeDisplayQueue, resetDisplayQueue } from '../../../src/obs/display-queue';
import { PRIORITY_LEVELS } from '../../../src/core/constants';
import { createOBSSourcesManager } from '../../../src/obs/sources';
import { createOBSGoalsManager } from '../../../src/obs/goals';
import { createGoalTracker } from '../../../src/utils/goal-tracker';
import { createConfigFixture } from '../../helpers/config-fixture';

const queues = new Set<DisplayQueue>();
const managers = new Set<OBSConnectionManager>();
type QueueOBS = OBSConnectionManager & ConstructorParameters<typeof DisplayQueue>[0];
function manager() {
  const owner = new OBSConnectionManager({ config: { enabled: false, password: 'synthetic-only' } });
  managers.add(owner);
  return owner as QueueOBS;
}
function initialize(owner: QueueOBS, dependencies: ConstructorParameters<typeof DisplayQueue>[4] = {}) {
  const queue = initializeDisplayQueue(owner, { autoProcess: false }, { PRIORITY_LEVELS }, null, dependencies);
  queues.add(queue);
  return queue;
}
afterEach(async () => {
  resetDisplayQueue();
  try { await Promise.all([...queues].map(queue => queue.stop())); }
  finally {
    queues.clear();
    for (const owner of managers) owner.dispose();
    try { await Promise.all([...managers].map(owner => owner.disconnect())); } finally { managers.clear(); }
  }
});

it('requires an OBS manager in the constructor', () => {
  expect(() => Reflect.construct(DisplayQueue, [null, {}, {}, null, {}])).toThrow(/OBSConnectionManager/);
});
it('accepts an item through the singleton with an actual supplied OBS owner', () => {
  const queue = initialize(manager());
  queue.addItem({ type: 'chat', platform: 'twitch', data: { username: 'Synthetic User', message: 'Synthetic text' } });
  expect(queue.getQueueLength()).toBe(1);
  expect(queue.queue[0]).toMatchObject({ type: 'chat', platform: 'twitch', data: { message: 'Synthetic text' } });
});
it('preserves a dependency DTO getter failure during construction', () => {
  const dependencies = Object.defineProperty({}, 'sourcesManager', { get() { throw new Error('Synthetic getter failure'); } });
  expect(() => new DisplayQueue(manager(), { autoProcess: false }, { PRIORITY_LEVELS }, null, dependencies))
    .toThrow('Synthetic getter failure');
});
it('passes actual source and goal owners through singleton construction', () => {
  const obs = manager();
  const config = createConfigFixture();
  Object.assign(config.goals, { enabled: true, tiktokGoalEnabled: true, tiktokGoalTarget: 500, tiktokGoalCurrency: 'coins' });
  const tracker = createGoalTracker({ config });
  tracker.initializeGoalTracker();
  expect(tracker.addDonationToGoal('tiktok', 100, 'coins')).toMatchObject({ success: true });
  const sources = createOBSSourcesManager(obs);
  const goals = createOBSGoalsManager(obs, { config, goalTracker: tracker, updateTextSource: sources.updateTextSource });
  const queue = initialize(obs, { sourcesManager: sources, goalsManager: goals });
  expect(queue.sourcesManager).toBe(sources);
  expect(queue.goalsManager).toBe(goals);
  expect(queue.effects.goalsManager).toBe(goals);
  expect(queue.goalsManager.getCurrentGoalStatus('tiktok')).toMatchObject({ current: 100, target: 500 });
});
it('rebinds both queue and guarded effects to a subsequent actual OBS owner', async () => {
  const first = manager(), second = manager();
  const queue = initialize(first);
  expect(initialize(second)).toBe(queue);
  expect(queue.obsManager).toBe(second);
  const oldCalls = spyOn(first, 'call');
  const newCalls = spyOn(second, 'call');
  try {
    await expect(queue.effects.obsManager.call('GetVersion', {})).rejects.toThrow();
    expect(newCalls).toHaveBeenCalledWith('GetVersion', {});
    expect(oldCalls).not.toHaveBeenCalled();
  } finally { oldCalls.mockRestore(); newCalls.mockRestore(); }
});
it('reset acquires a distinct queue and retires both owners', () => {
  const obs = manager();
  const first = initialize(obs);
  resetDisplayQueue();
  expect(initialize(obs)).not.toBe(first);
});
