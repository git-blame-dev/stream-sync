import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { TwitchPlatform } from '../../../src/platforms/twitch';
import { TwitchAuth } from '../../../src/auth/TwitchAuth';
import { PlatformLifecycleService } from '../../../src/services/PlatformLifecycleService';
import { createMainPresentationFixture } from '../../helpers/main-presentation-fixture';
import { createTwitchConfigFixture } from '../../helpers/config-fixture';
import { noOpLogger } from '../../helpers/mock-factories';
import { waitFor } from '../../helpers/event-driven-testing';

for (const { method, handler, type, fields } of [
  { method: 'handleFollowEvent', handler: 'onFollow', type: 'platform:follow', fields: {} },
  { method: 'handlePaypiggyEvent', handler: 'onPaypiggy', type: 'platform:paypiggy', fields: { tier: '1000' } },
  { method: 'handleRaidEvent', handler: 'onRaid', type: 'platform:raid', fields: { viewerCount: 42 } },
  { method: 'handleGiftEvent', handler: 'onGift', type: 'platform:gift', fields: {
    giftType: 'bits', giftCount: 1, amount: 100, currency: 'bits', message: 'Synthetic great stream!',
  } },
] as const) {
  test(`${method} uses the actual ${handler} lifecycle callback and produces its canonical row`, async () => {
    const h = await createMainPresentationFixture();
    h.config.logging.file.enabled = false;
    h.config.logging.chat.enabled = false;
    let auth: TwitchAuth | undefined;
    let platform: TwitchPlatform | undefined;
    let lifecycle: PlatformLifecycleService | undefined;
    try {
      auth = new TwitchAuth({ tokenStorePath: join(h.dir, 'synthetic-handler-tokens.json'),
        clientId: 'synthetic-client', expectedUsername: 'synthetic-user', logger: noOpLogger });
      const axios = { get: async () => ({ data: { data: [] } }), post: async () => ({ data: {} }), delete: async () => ({ data: {} }) };
      platform = new TwitchPlatform(createTwitchConfigFixture({ enabled: false, clientId: 'synthetic-client' }),
        { twitchAuth: auth, axios, logger: noOpLogger });
      await h.start();
      lifecycle = new PlatformLifecycleService({ config: { twitch: { enabled: true } }, eventBus: h.bus, logger: noOpLogger });
      platform.handlers = lifecycle.createDefaultEventHandlers('twitch');
      expect(typeof platform.handlers[handler]).toBe('function');
      await platform[method]({ username: 'Synthetic Handler Viewer', userId: 'synthetic-handler-viewer',
        timestamp: '2026-01-01T00:00:00.000Z', id: 'synthetic-handler-event', ...fields });
      await waitFor(() => h.queue.getQueueLength() === 1, { timeout: 1000, interval: 1 });
      await h.drain();
      expect(h.rows).toHaveLength(1);
      expect(h.rows[0]!.data.isError).not.toBe(true);
      expect(h.rows[0]).toMatchObject({ type, platform: 'twitch', data: {
        username: 'Synthetic Handler Viewer', userId: 'synthetic-handler-viewer', ...fields,
      } });
    } finally {
      try { await platform?.cleanup(); }
      finally {
        try { lifecycle?.dispose(); }
        finally {
          try { await h.dispose(); }
          finally { await auth?.dispose(); }
        }
      }
    }
  });
}
