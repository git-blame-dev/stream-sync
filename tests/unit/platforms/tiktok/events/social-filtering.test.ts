import { describe, expect, test } from 'bun:test';
import { TikTokPlatform } from '../../../../../src/platforms/tiktok';
import { noOpLogger } from '../../../../helpers/mock-factories';

for (const [name, rejected] of [
  ['unsupported action with complete identity', { user: { uniqueId: 'synthetic-social', nickname: 'Synthetic Social' }, actionType: 'poke' }],
  ['follow with missing nickname', { user: { uniqueId: 'synthetic-social' }, actionType: 'follow' }],
] as const) {
  describe('actual TikTok social filtering', () => {
    test(name, async () => {
      const platform = new TikTokPlatform({ enabled: false, dataLoggingEnabled: false }, { logger: noOpLogger });
      const events: Array<{ type: string; data: Record<string, unknown> }> = [];
      platform.on('platform:event', event => { events.push(event); });
      try {
        await platform.handleTikTokSocial({ ...rejected, common: { createTime: 1767225600000, msgId: 'synthetic-rejected' } });
        expect(events).toEqual([]);
        await platform.handleTikTokSocial({ user: { uniqueId: 'synthetic-follow', nickname: 'Synthetic Follow' },
          actionType: 'follow', common: { createTime: 1767225600000, msgId: 'synthetic-follow' } });
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ type: 'platform:follow', data: {
          username: 'Synthetic Follow', userId: 'synthetic-follow', timestamp: '2026-01-01T00:00:00.000Z',
        } });
      } finally {
        await platform.cleanup();
      }
    });
  });
}
