import { expect, test } from 'bun:test';
import { createMainPresentationFixture } from '../helpers/main-presentation-fixture';

const gift = { giftType: 'Rose', giftCount: 3, amount: 3, currency: 'coins', repeatCount: 1,
  type: 'platform:gift', userId: 'synthetic-gift-viewer', timestamp: '2026-01-01T00:00:00.000Z', id: 'synthetic-config-gift' };

for (const mode of ['missing config', 'incomplete gift'] as const) {
  test(`actual runtime rejects ${mode} before admission and processes a healthy following gift`, async () => {
    const h = await createMainPresentationFixture();
    h.config.logging.file.enabled = false;
    h.config.logging.chat.enabled = false;
    try {
      await h.start();
      const originalConfig = h.runtime.config;
      try {
        if (mode === 'missing config') Reflect.set(h.runtime, 'config', undefined);
        const input = mode === 'incomplete gift'
          ? { ...gift, giftType: undefined, giftCount: undefined, amount: undefined, currency: undefined, repeatCount: undefined }
          : gift;
        await expect(h.runtime.handleGiftNotification('tiktok', 'Synthetic Gift Viewer', input)).rejects.toThrow(
          mode === 'missing config' ? 'AppRuntime config unavailable for gift notifications'
            : 'Gift notification requires giftType, giftCount, amount, and currency');
        expect(h.queue.getQueueLength()).toBe(0);
        expect(h.rows).toEqual([]);
      } finally {
        Reflect.set(h.runtime, 'config', originalConfig);
      }
      expect(await h.runtime.handleGiftNotification('tiktok', 'Synthetic Gift Viewer', gift)).toMatchObject({ success: true });
      await h.drain();
      expect(h.rows).toHaveLength(1);
      expect(h.rows[0]).toMatchObject({ type: 'platform:gift', platform: 'tiktok', data: {
        username: 'Synthetic Gift Viewer', amount: 3, giftCount: 3, currency: 'coins',
      } });
    } finally {
      await h.dispose();
    }
  });
}
