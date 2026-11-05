import { expect, test } from 'bun:test';
import { TikTokPlatform } from '../../src/platforms/tiktok';
import { adaptTikTokEvent } from '../../src/platforms/tiktok/tiktok-event-adapter';
import { PlatformLifecycleService } from '../../src/services/PlatformLifecycleService';
import { EnhancedPlatformEvents } from '../../src/interfaces/PlatformEvents';
import { createMainPresentationFixture } from '../helpers/main-presentation-fixture';
import { noOpLogger } from '../helpers/mock-factories';
import { waitFor } from '../helpers/event-driven-testing';

function social(action: 'share' | 'repost' | 'unknown', id: string, actor = 'synthetic-social-actor') {
  return adaptTikTokEvent('social', {
    user: { id: `synthetic-numeric-${actor}`, displayId: actor, nickname: 'Synthetic Repost Viewer' },
    common: {
      msgId: id, createTime: '1767225600000',
      displayText: action === 'repost'
        ? { key: 'ttlive_repost_commentsArea_repostedUsername_im', defaultPattern: '{0:user} reposted' }
        : action === 'share'
          ? { key: 'pm_mt_guidance_share', defaultPattern: '{0:user} shared the LIVE' }
          : { key: 'synthetic_unknown_social', defaultPattern: '{0:user} did something else' },
    },
  });
}

for (const order of [['repost', 'share'], ['share', 'repost']] as const) {
  test(`${order.join(' then ')} from one actor produces two distinct notifications without duplicates`, async () => {
    const h = await createMainPresentationFixture();
    h.config.tiktok.sharesEnabled = true;
    h.config.tiktok.repostsEnabled = true;
    const platform = new TikTokPlatform({ enabled: false, dataLoggingEnabled: false }, { logger: noOpLogger });
    const lifecycle = new PlatformLifecycleService({ eventBus: { emit: (...args) => h.bus.emit(...args) }, logger: noOpLogger });
    try {
      await h.start();
      platform.handlers = lifecycle.createDefaultEventHandlers('tiktok');
      for (const action of order) {
        const payload = social(action, `synthetic-${action}-original`);
        await platform.handleTikTokSocial(payload);
        await platform.handleTikTokSocial(payload);
        await platform.handleTikTokSocial(social(action, `synthetic-${action}-second-id`));
      }
      await platform.handleTikTokSocial(social('unknown', 'synthetic-unknown'));
      await waitFor(() => h.queue.getQueueLength() === 2, { timeout: 1000, interval: 1 });
      await h.drain();
      expect(h.rows.map(row => row.type)).toEqual(order.map(action => `platform:${action}`));
      const repost = h.rows.find(row => row.type === 'platform:repost');
      expect(repost).toMatchObject({ data: {
        displayMessage: 'Synthetic Repost Viewer reposted the LIVE',
        ttsMessage: 'Synthetic Repost Viewer reposted the LIVE',
        logMessage: 'Repost from Synthetic Repost Viewer',
      } });
      expect(EnhancedPlatformEvents.validateEvent({ type: 'platform:repost', platform: 'tiktok', username: 'Synthetic Viewer',
        userId: 'synthetic-id', timestamp: '2026-01-01T00:00:00.000Z' })).toBe(true);
    } finally {
      await platform.cleanup();
      lifecycle.dispose();
      await h.dispose();
    }
  });
}

for (const enabled of ['share', 'repost'] as const) {
  test(`${enabled} enable control is independent of the other action`, async () => {
    const h = await createMainPresentationFixture();
    h.config.tiktok.sharesEnabled = enabled === 'share';
    h.config.tiktok.repostsEnabled = enabled === 'repost';
    const platform = new TikTokPlatform({ enabled: false, dataLoggingEnabled: false }, { logger: noOpLogger });
    const lifecycle = new PlatformLifecycleService({ eventBus: { emit: (...args) => h.bus.emit(...args) }, logger: noOpLogger });
    try {
      await h.start();
      platform.handlers = lifecycle.createDefaultEventHandlers('tiktok');
      await platform.handleTikTokSocial(social('repost', 'synthetic-repost-toggle'));
      await platform.handleTikTokSocial(social('share', 'synthetic-share-toggle'));
      await waitFor(() => h.queue.getQueueLength() === 1, { timeout: 1000, interval: 1 });
      await h.drain();
      expect(h.rows.map(row => row.type)).toEqual([`platform:${enabled}`]);
    } finally {
      await platform.cleanup();
      lifecycle.dispose();
      await h.dispose();
    }
  });
}

test('repost tracking survives a transient error and resets for a new stream', async () => {
  const platform = new TikTokPlatform({ enabled: false, dataLoggingEnabled: false }, { logger: noOpLogger });
  const events: unknown[] = [];
  platform.handlers = { onRepost: payload => events.push(payload) };
  try {
    await platform.handleTikTokSocial(social('repost', 'synthetic-first-stream-a'));
    platform.handleConnectionError(new Error('Synthetic network failure'));
    await platform.handleTikTokSocial(social('repost', 'synthetic-first-stream-b'));
    expect(events).toHaveLength(1);
    platform.handleConnectionError({ message: 'Synthetic stream not live', code: 4404 });
    await platform.handleTikTokSocial(social('repost', 'synthetic-next-stream'));
    expect(events).toHaveLength(2);
  } finally {
    await platform.cleanup();
  }
});


test('duplicate message IDs are rejected independently of actor suppression', async () => {
  const platform = new TikTokPlatform({ enabled: false, dataLoggingEnabled: false }, { logger: noOpLogger });
  const events: unknown[] = [];
  platform.handlers = { onRepost: payload => events.push(payload) };
  try {
    await platform.handleTikTokSocial(social('repost', 'synthetic-same-message', 'synthetic-actor-a'));
    await platform.handleTikTokSocial(social('repost', 'synthetic-same-message', 'synthetic-actor-b'));
    expect(events).toHaveLength(1);
    await platform.handleTikTokSocial(social('repost', 'synthetic-fresh-message', 'synthetic-actor-b'));
    expect(events).toHaveLength(2);
  } finally {
    await platform.cleanup();
  }
});

test('repost notifications resolve their own effect command through the real runtime', async () => {
  const h = await createMainPresentationFixture();
  h.config.tiktok.repostsEnabled = true;
  h.config.tiktok.sharesEnabled = true;
  h.config.vfx.filePath = '/synthetic-only';
  h.config.commands.repostEffect = '!synthetic-repost,Synthetic Repost Effect,,5000';
  h.config.commands.shareEffect = '!synthetic-share,Synthetic Share Effect,,5000';
  h.config.reposts.command = '!synthetic-repost';
  h.config.shares.command = '!synthetic-share';
  try {
    await h.start();
    const payload = { userId: 'synthetic-effect-actor', timestamp: '2026-01-01T00:00:00.000Z' };
    expect(await h.runtime.handleRepostNotification('tiktok', 'Synthetic Viewer', payload)).toMatchObject({ success: true });
    expect(await h.runtime.handleShareNotification('tiktok', 'Synthetic Viewer', payload)).toMatchObject({ success: true });
    const queued = h.queue.state.queue;
    expect(queued.find(item => item.type === 'platform:repost')).toMatchObject({ vfxConfig: { commandKey: 'repostEffect', mediaSource: 'Synthetic Repost Effect' } });
    expect(queued.find(item => item.type === 'platform:share')).toMatchObject({ vfxConfig: { commandKey: 'shareEffect', mediaSource: 'Synthetic Share Effect' } });
  } finally {
    await h.dispose();
  }
});
