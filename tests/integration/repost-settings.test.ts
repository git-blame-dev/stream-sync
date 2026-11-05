import { expect, test } from 'bun:test';
import { parse } from 'ini';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigValidator } from '../../src/utils/config-validator';
import { buildConfig } from '../../src/core/config-builders';
import { createEventToGuiContractMapper } from '../../src/services/gui/event-to-gui-contract-mapper';
import { createOperatorControlService, OPERATOR_CONTROL_KEYS } from '../../src/services/operator/operator-control-service';
import { parseOperatorState } from '../../gui/src/operator/model';
import { createMainPresentationFixture } from '../helpers/main-presentation-fixture';

for (const platformOverride of ['', 'repostsEnabled = true', 'repostsEnabled = false']) {
  test(`INI repost controls inherit independently and retain override: ${platformOverride || 'unset'}`, () => {
    const config = buildConfig(ConfigValidator.normalize(parse(`
[general]
sharesEnabled = true
repostsEnabled = false
[tiktok]
${platformOverride}
[reposts]
command = !synthetic-repost
[shares]
command = !synthetic-share
[gui]
showShares = true
showReposts = false
`)));
    expect(config.general.repostsEnabled).toBe(false);
    expect(config.tiktok.repostsEnabled).toBe(platformOverride.endsWith('true'));
    expect(config.tiktok.sharesEnabled).toBe(true);
    expect(config.reposts.command).toBe('!synthetic-repost');
    expect(config.shares.command).toBe('!synthetic-share');
    expect(config.gui.showReposts).toBe(false);
    expect(config.gui.showShares).toBe(true);
  });
}

test('missing repost options use independent enabled defaults and no effect command', () => {
  const config = buildConfig(ConfigValidator.normalize({ general: { sharesEnabled: false } }));
  expect(config.tiktok.sharesEnabled).toBe(false);
  expect(config.tiktok.repostsEnabled).toBe(true);
  expect(config.gui.showReposts).toBe(true);
  expect(config.reposts.command).toBeNull();
});

for (const enabled of ['share', 'repost'] as const) {
  test(`GUI shows ${enabled} independently of the other action`, async () => {
    const mapper = createEventToGuiContractMapper({ config: { gui: { showShares: enabled === 'share', showReposts: enabled === 'repost' } } });
    for (const action of ['share', 'repost'] as const) {
      const row = await mapper.mapDisplayRow({ type: `platform:${action}`, platform: 'tiktok',
        data: { username: 'Synthetic Viewer', userId: 'synthetic-id', displayMessage: `Synthetic ${action}` } });
      if (action === enabled) expect(row).toMatchObject({ kind: 'notification', type: `platform:${action}` });
      else expect(row).toBeNull();
    }
  });
}

test('operator persists repost control independently and its state parses in the GUI', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'synthetic-repost-controls-'));
  const defaults = buildConfig(ConfigValidator.normalize({})).general;
  const filePath = join(dir, 'controls.json');
  try {
    const controls = await createOperatorControlService({ defaults, filePath });
    await controls.setEnabled('repostsEnabled', false);
    expect(controls.isEnabled('sharesEnabled')).toBe(true);
    expect(controls.isEnabled('repostsEnabled')).toBe(false);
    const restarted = await createOperatorControlService({ defaults, filePath });
    expect(restarted.isEnabled('repostsEnabled')).toBe(false);
    const parsed = parseOperatorState({ revision: restarted.revision,
      controls: OPERATOR_CONTROL_KEYS.map(key => ({ key, label: key, enabled: restarted.isEnabled(key), overridden: restarted.overriddenKeys.includes(key) })) });
    expect(parsed?.controls.find(control => control.key === 'repostsEnabled')).toMatchObject({ enabled: false, overridden: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

for (const platformEnabled of [false, true]) {
  test(`operator repost defaults and reset honor TikTok override ${platformEnabled}`, async () => {
    const h = await createMainPresentationFixture({ operator: true });
    h.config.general.repostsEnabled = !platformEnabled;
    h.config.tiktok.repostsEnabled = platformEnabled;
    try {
      await h.start();
      const controls = h.runtime.dependencies.operatorControls!;
      expect(controls.isEnabled('repostsEnabled')).toBe(platformEnabled);
      await h.runtime.handleRepostNotification('tiktok', 'Synthetic Override Viewer', {
        userId: 'synthetic-override-viewer', timestamp: '2026-01-01T00:00:00.000Z',
      });
      await h.drain();
      expect(h.rows.filter(row => row.type === 'platform:repost')).toHaveLength(platformEnabled ? 1 : 0);
      await controls.setEnabled('repostsEnabled', !platformEnabled);
      expect(controls.isEnabled('repostsEnabled')).toBe(!platformEnabled);
      await controls.reset();
      expect(controls.isEnabled('repostsEnabled')).toBe(platformEnabled);
    } finally { await h.dispose(); }
  });
}
