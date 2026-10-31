import { describe, expect, test } from 'bun:test';
import { NotificationBuilder } from '../../src/utils/notification-builder';
import { createMainPresentationFixture } from '../helpers/main-presentation-fixture';
import type { DisplayQueueItem } from '../../src/interfaces/DisplayQueue';

describe('actual greeting admission and canonical notification copy', () => {
  test('main preserves the canonical username through greeting preparation and display', async () => {
    const fixture = await createMainPresentationFixture();
    fixture.config.twitch.greetingsEnabled = true;
    fixture.config.logging.file.enabled = false;
    try {
      await fixture.start();
      await fixture.runtime.platformEventRouter.routeEvent({ type: 'platform:chat-message', platform: 'twitch', data: {
        username: 'Synthetic Viewer', displayName: 'Synthetic Alternate Name', userId: 'synthetic-greeting-viewer',
        message: { text: 'synthetic hello' }, timestamp: '2026-01-01T00:00:00.000Z',
      } });
      const items: DisplayQueueItem[] = fixture.queue.queue.flatMap(entry =>
        'children' in entry ? entry.children as DisplayQueueItem[] : [entry]);
      expect(items.map(item => item.type)).toEqual(['chat', 'greeting']);
      expect(items[1]!.data).toMatchObject({ username: 'Synthetic Viewer', userId: 'synthetic-greeting-viewer',
        displayMessage: 'Welcome, Synthetic Viewer! 👋', ttsMessage: 'Hi Synthetic Viewer', logMessage: 'Greeting: Synthetic Viewer' });
      await fixture.drain();
      expect(fixture.rows.map(row => row.type)).toEqual(['chat', 'greeting']);
      expect(fixture.rows[1]!.data.displayMessage).toBe('Welcome, Synthetic Viewer! 👋');
    } finally {
      await fixture.dispose();
    }
  });

  test('the actual builder rejects absent identity and invalid notification inputs', () => {
    for (const input of [null, undefined, {}, { user: {} },
      { type: 'greeting', platform: 'twitch', displayName: 'Synthetic Alternate Name' },
      { type: 'greeting', platform: 'twitch', name: 'Synthetic Alternate Name' }]) {
      expect(NotificationBuilder.build(input)).toBeNull();
    }
  });

  for (const { input, logMessage } of [
    { input: { type: 'platform:follow', platform: 'twitch' }, logMessage: 'New follower: Synthetic Viewer' },
    { input: { type: 'platform:paypiggy', platform: 'twitch', tier: '1000' }, logMessage: 'New subscriber: Synthetic Viewer!' },
    { input: { type: 'platform:raid', platform: 'twitch', viewerCount: 10 }, logMessage: 'Incoming raid from Synthetic Viewer with 10 viewers!' },
    { input: { type: 'platform:gift', platform: 'tiktok', giftType: 'Synthetic Rose', giftCount: 2, amount: 20, currency: 'coins' },
      logMessage: 'TikTok Gift: 2x Synthetic Rose (20 coins) from Synthetic Viewer' },
    { input: { type: 'farewell', platform: 'twitch' }, logMessage: 'Farewell: Synthetic Viewer' },
  ]) {
    test(`${input.type} generates its own canonical log copy`, () => {
      expect(NotificationBuilder.build({ ...input, username: 'Synthetic Viewer', userId: 'synthetic-viewer' }))
        .toMatchObject({ type: input.type, platform: input.platform, username: 'Synthetic Viewer', logMessage });
    });
  }
});
