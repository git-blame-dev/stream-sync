import { expect, it } from 'bun:test';
import { expectNoTechnicalArtifacts } from '../helpers/assertion-helpers';
import { createMainPresentationFixture } from '../helpers/main-presentation-fixture';

for (const complete of [true, false]) {
  it(`presents ${complete ? 'complete' : 'minimal'} gifted subscriptions through actual notification and queue owners`, async () => {
    const h = await createMainPresentationFixture();
    h.config.logging.file.enabled = false;
    h.config.logging.chat.enabled = false;
    try {
      await h.start();
      const count = complete ? 5 : 2;
      expect(await h.runtime.notificationManager!.handleNotification('platform:giftpaypiggy', 'twitch', {
        userId: 'synthetic-gifter', username: 'Synthetic Gifter', giftCount: count,
        ...(complete ? { displayName: 'Synthetic Gifter', tier: '1000', cumulativeTotal: 7, isAnonymous: false } : {}),
      })).toMatchObject({ success: true });
      expect(h.queue.getQueueLength()).toBe(1);
      await h.drain();
      expect(h.rows).toHaveLength(1);
      expect(h.rows[0]).toMatchObject({ type: 'platform:giftpaypiggy', platform: 'twitch', data: {
        username: 'Synthetic Gifter', userId: 'synthetic-gifter', giftCount: count,
        displayMessage: `Synthetic Gifter gifted ${count} subscriptions!`,
        ttsMessage: `Synthetic Gifter gifted ${count} subscriptions`,
      } });
      expectNoTechnicalArtifacts(h.rows[0]!.data.displayMessage as string);
      expectNoTechnicalArtifacts(h.rows[0]!.data.ttsMessage as string);
    } finally { await h.dispose(); }
  });
}
