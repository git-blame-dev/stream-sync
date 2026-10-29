import { expect, test } from 'bun:test';
import { createMainPresentationFixture } from '../helpers/main-presentation-fixture';

test('Super Sticker reaches actual runtime notification, queue and display owners', async () => {
  const h = await createMainPresentationFixture();
  h.config.logging.file.enabled = false;
  h.config.logging.chat.enabled = false;
  try {
    await h.start();
    expect(await h.runtime.handleGiftNotification('youtube', 'Synthetic Sticker Viewer', {
      type: 'platform:gift', giftType: 'Super Sticker', giftCount: 1, amount: 5, currency: 'USD',
      sticker: 'Shiba dog shaking his hips saying Thank you', userId: 'synthetic-sticker-viewer',
      timestamp: '2026-01-01T00:00:00.000Z', id: 'synthetic-super-sticker',
    })).toMatchObject({ success: true });
    expect(h.queue.getQueueLength()).toBe(1);
    await h.drain();
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({ type: 'platform:gift', platform: 'youtube', data: {
      username: 'Synthetic Sticker Viewer', userId: 'synthetic-sticker-viewer', giftType: 'Super Sticker',
      giftCount: 1, amount: 5, currency: 'USD', sticker: 'Shiba dog shaking his hips saying Thank you',
    } });
  } finally {
    await h.dispose();
  }
});
