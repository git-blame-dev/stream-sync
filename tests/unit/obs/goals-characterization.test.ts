import { expect, test } from 'bun:test';
import { createMainPresentationFixture } from '../../helpers/main-presentation-fixture';
import { createOBSGoalsManager } from '../../../src/obs/goals';
import { createOBSSourcesManager } from '../../../src/obs/sources';
import { createGoalTracker } from '../../../src/utils/goal-tracker';

test('an explicitly supplied real tracker owns goal state and OBS projections', async () => {
  const h = await createMainPresentationFixture();
  h.config.logging.file.enabled = false;
  Object.assign(h.config.goals, {
    tiktokGoalEnabled: true, tiktokGoalTarget: 1000,
    tiktokGoalCurrency: 'coins', tiktokGoalSource: 'synthetic-tiktok-goal',
  });
  try {
    await h.start();
    const tracker = createGoalTracker({ config: h.config });
    const sources = createOBSSourcesManager(h.obs);
    const goals = createOBSGoalsManager(h.obs, {
      config: h.config, goalTracker: tracker, updateTextSource: sources.updateTextSource,
    });
    await goals.initializeGoalDisplay();
    h.socket.writes.length = 0;
    expect(tracker.addDonationToGoal('tiktok', 300, 'coins')).toMatchObject({ success: true, newTotal: 300 });
    expect(goals.getCurrentGoalStatus('tiktok')).toMatchObject({ current: 300, formatted: '0300/1000 coins' });
    expect(await goals.processDonationGoal('tiktok', 200, 'coins')).toMatchObject({ success: true, newTotal: 500 });
    expect(tracker.getGoalState('tiktok')).toMatchObject({ current: 500, formatted: '0500/1000 coins' });
    expect(h.socket.writes).toEqual([{
      inputName: 'synthetic-tiktok-goal',
      inputSettings: { font: { face: 'Synthetic font' }, color: 123, text: '0500/1000 coins' },
      overlay: false,
    }]);
    expect(await goals.processDonationGoal(null, 100)).toEqual({ success: false, error: 'Invalid platform passed to processDonationGoal' });
    expect(await goals.processDonationGoal('tiktok', 0, 'coins')).toMatchObject({ success: false, error: 'Donation amount must be positive number, received: 0' });
    expect(await goals.processPaypiggyGoal('tiktok', 0)).toMatchObject({ success: false, error: 'Paypiggy count must be a positive integer, received: 0' });
    expect(await goals.processDonationGoal('youtube', 100, 'USD')).toMatchObject({ success: false, error: 'youtube goal tracking is disabled in configuration' });
    expect(await goals.processPaypiggyGoal('youtube', 1)).toMatchObject({ success: false, error: 'youtube goal tracking is disabled in configuration' });
    await goals.updateGoalDisplay('youtube');
    expect(h.socket.writes).toHaveLength(1);
  } finally { await h.dispose(); }
});

test('five memberships update the real tracker without output while OBS is disconnected', async () => {
  const h = await createMainPresentationFixture();
  h.config.logging.file.enabled = false;
  Object.assign(h.config.goals, {
    tiktokGoalEnabled: true, tiktokGoalTarget: 1000,
    tiktokGoalCurrency: 'coins', tiktokGoalSource: 'synthetic-tiktok-goal',
  });
  try {
    await h.start();
    const tracker = createGoalTracker({ config: h.config });
    const sources = createOBSSourcesManager(h.obs);
    const goals = createOBSGoalsManager(h.obs, {
      config: h.config, goalTracker: tracker, updateTextSource: sources.updateTextSource,
    });
    await goals.initializeGoalDisplay();
    h.socket.writes.length = 0;
    await h.obs.disconnect();
    await goals.updateAllGoalDisplays();
    expect(h.socket.writes).toEqual([]);
    expect(await goals.processPaypiggyGoal('tiktok', 5)).toMatchObject({ success: true, newTotal: 2100 });
    expect(tracker.getGoalState('tiktok')).toMatchObject({ current: 2100, formatted: '2100/1000 coins' });
    expect(h.socket.writes).toEqual([]);
    await h.obs.connect();
    await goals.updateGoalDisplay('tiktok');
    expect(h.socket.writes).toEqual([{
      inputName: 'synthetic-tiktok-goal',
      inputSettings: { font: { face: 'Synthetic font' }, color: 123, text: '2100/1000 coins' },
      overlay: false,
    }]);
  } finally { await h.dispose(); }
});

test('goal status and state survive a missing configured source and an actual failed OBS write', async () => {
  const h = await createMainPresentationFixture();
  h.config.logging.file.enabled = false;
  Object.assign(h.config.goals, { enabled: true, tiktokGoalEnabled: true, youtubeGoalEnabled: true, twitchGoalEnabled: true,
    tiktokGoalSource: '', youtubeGoalSource: 'synthetic-youtube-goal', twitchGoalSource: 'synthetic-twitch-goal' });
  try {
    await h.start();
    const tracker = createGoalTracker({ config: h.config });
    const sources = createOBSSourcesManager(h.obs);
    const goals = createOBSGoalsManager(h.obs, { config: h.config, goalTracker: tracker, updateTextSource: sources.updateTextSource });
    await goals.initializeGoalDisplay();
    h.socket.writes.length = 0;
    await goals.updateGoalDisplay('tiktok');
    expect(h.socket.writes).toEqual([]);
    expect(Object.keys(goals.getAllCurrentGoalStatuses()).sort()).toEqual(['tiktok', 'twitch', 'youtube']);
    const before = goals.getCurrentGoalStatus('tiktok');
    expect(before).not.toBeNull();
    Object.assign(h.config.goals, { tiktokGoalSource: 'synthetic-tiktok-goal' });
    const call = h.socket.call.bind(h.socket);
    h.socket.call = async (method, data) => {
      if (method === 'SetInputSettings') throw new Error('Synthetic OBS write failure');
      return call(method, data);
    };
    expect(await goals.processDonationGoal('tiktok', 1, 'coins')).toMatchObject({ success: true });
    expect(goals.getCurrentGoalStatus('tiktok')?.current).not.toBe(before?.current);
    expect(h.socket.writes).toEqual([]);
    h.socket.call = call;
    await goals.updateGoalDisplay('tiktok');
    expect(h.socket.writes).toHaveLength(1);
    h.config.goals.enabled = false;
    expect(goals.getCurrentGoalStatus('tiktok')).toBeNull();
    expect(goals.getAllCurrentGoalStatuses()).toEqual({});
    expect(await goals.processDonationGoal('tiktok', 1, 'coins')).toMatchObject({ success: false });
    expect(await goals.processPaypiggyGoal('tiktok')).toMatchObject({ success: false });
  } finally { await h.dispose(); }
});
