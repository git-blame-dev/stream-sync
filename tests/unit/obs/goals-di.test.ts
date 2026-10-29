import { afterEach, describe, expect, it } from 'bun:test';
import * as goals from '../../../src/obs/goals';
import { OBSGoalsManager, createOBSGoalsManager, getDefaultGoalsManager, resetDefaultGoalsManager } from '../../../src/obs/goals';
import { createGoalTracker } from '../../../src/utils/goal-tracker';
import { createOBSSourcesManager } from '../../../src/obs/sources';
import { createMainPresentationFixture } from '../../helpers/main-presentation-fixture';

afterEach(() => resetDefaultGoalsManager());

describe('OBS goals concrete dependency injection', () => {
  it('exports the public goals construction and singleton API', () => {
    expect(Object.keys(goals).sort()).toEqual([
      'OBSGoalsManager', 'createOBSGoalsManager', 'getDefaultGoalsManager', 'resetDefaultGoalsManager',
    ]);
  });

  it('requires an OBS manager in the constructor', () => {
    expect(() => Reflect.construct(OBSGoalsManager, [])).toThrow('OBSGoalsManager requires OBSConnectionManager');
  });

  for (const [kind, text] of [['factory', '25/100'], ['singleton', '30/100']] as const) {
    it(`${kind} preserves the supplied concrete tracker and source projection`, async () => {
      const h = await createMainPresentationFixture();
      h.config.logging.file.enabled = false;
      h.config.logging.chat.enabled = false;
      Object.assign(h.config.goals, { tiktokGoalEnabled: true, tiktokGoalTarget: 500,
        tiktokGoalCurrency: 'coins', tiktokGoalSource: `synthetic-${kind}-goal` });
      try {
        await h.start();
        const tracker = createGoalTracker({ config: h.config });
        tracker.initializeGoalTracker();
        expect(tracker.addDonationToGoal('tiktok', 100, 'coins')).toMatchObject({ success: true, newTotal: 100 });
        const sources = createOBSSourcesManager(h.obs);
        const dependencies = { config: h.config, goalTracker: tracker, updateTextSource: sources.updateTextSource };
        const manager = kind === 'factory' ? createOBSGoalsManager(h.obs, dependencies)
          : getDefaultGoalsManager({ ...dependencies, obsManager: h.obs });
        expect(manager.getCurrentGoalStatus('tiktok')).toEqual(tracker.getGoalState('tiktok'));
        expect(manager.getCurrentGoalStatus('tiktok')).toMatchObject({ current: 100, target: 500, formatted: '100/500 coins' });
        const before = h.socket.writes.length;
        await manager.updateGoalDisplay('tiktok', text);
        expect(h.socket.writes.slice(before)).toEqual([{ inputName: `synthetic-${kind}-goal`,
          inputSettings: { font: { face: 'Synthetic font' }, color: 123, text }, overlay: false }]);
      } finally {
        resetDefaultGoalsManager();
        await h.dispose();
      }
    });
  }

  it('resetting the default manager acquires a different actual owner', async () => {
    const h = await createMainPresentationFixture();
    h.config.logging.file.enabled = false;
    h.config.logging.chat.enabled = false;
    try {
      await h.start();
      const dependencies = { config: h.config, obsManager: h.obs,
        updateTextSource: createOBSSourcesManager(h.obs).updateTextSource };
      const first = getDefaultGoalsManager(dependencies);
      resetDefaultGoalsManager();
      const second = getDefaultGoalsManager(dependencies);
      expect(second).not.toBe(first);
    } finally {
      resetDefaultGoalsManager();
      await h.dispose();
    }
  });
});
