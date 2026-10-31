import { expect, test } from 'bun:test';
import { TikTokPlatform } from '../../src/platforms/tiktok';
import { PlatformLifecycleService } from '../../src/services/PlatformLifecycleService';
import { createMainPresentationFixture } from '../helpers/main-presentation-fixture';
import { noOpLogger } from '../helpers/mock-factories';
import { waitFor } from '../helpers/event-driven-testing';

for (const action of ['follow', 'share', 'direct-share'] as const) {
  test(`actual TikTok ${action} reaches lifecycle, runtime, and display owners`, async () => {
    const h = await createMainPresentationFixture();
    h.config.tiktok.followsEnabled = true;
    h.config.tiktok.sharesEnabled = true;
    h.config.logging.file.enabled = false;
    let platform: TikTokPlatform | undefined;
    let lifecycle: PlatformLifecycleService | undefined;
    let unsubscribe = () => {};
    try {
      await h.start();
      platform = new TikTokPlatform({ enabled: false, dataLoggingEnabled: false }, { logger: noOpLogger });
      lifecycle = new PlatformLifecycleService({ config: { tiktok: { enabled: true } }, eventBus: h.bus, logger: noOpLogger });
      platform.handlers = lifecycle.createDefaultEventHandlers('tiktok');
      const events: unknown[] = [];
      unsubscribe = h.bus.subscribe('platform:event', event => { events.push(event); });
      const payload = { user: { uniqueId: `synthetic-${action}`, nickname: 'Synthetic Social Viewer' },
        common: { createTime: 1767225600000, msgId: `synthetic-${action}` },
        ...(action === 'direct-share' ? {} : { actionType: action }) };
      if (action === 'direct-share') await platform.handleTikTokShare(payload);
      else await platform.handleTikTokSocial(payload);
      await waitFor(() => h.queue.getQueueLength() === 1, { timeout: 1000, interval: 1 });
      await h.drain();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ platform: 'tiktok', type: action === 'follow' ? 'platform:follow' : 'platform:share',
        data: { userId: `synthetic-${action}`, username: 'Synthetic Social Viewer', timestamp: '2026-01-01T00:00:00.000Z' } });
      expect(h.rows).toHaveLength(1);
      expect(h.rows[0]).toMatchObject({ platform: 'tiktok', type: action === 'follow' ? 'platform:follow' : 'platform:share',
        data: { userId: `synthetic-${action}`, username: 'Synthetic Social Viewer',
          displayMessage: action === 'follow' ? 'Synthetic Social Viewer just followed!' : 'Synthetic Social Viewer shared the stream' } });
    } finally {
      try { await platform?.cleanup(); }
      finally {
        try { lifecycle?.dispose(); }
        finally { unsubscribe(); await h.dispose(); }
      }
    }
  });
}
