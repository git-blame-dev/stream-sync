import { expect, test } from 'bun:test';
import type { DisplayQueueItem } from '../../src/interfaces/DisplayQueue';
import { createMainPresentationFixture } from '../helpers/main-presentation-fixture';

for (const [message, matching] of [
  ['!synthetic-bye\u200B everyone', true],
  ['!synthetic-bye!!! everyone', true],
  ['!synthetic-bye everyone', true],
  ['!synthetic-byeish everyone', false],
] as const) {
  test(`actual router and parser classify ${JSON.stringify(message)}`, async () => {
    const fixture = await createMainPresentationFixture();
    fixture.config.twitch.greetingsEnabled = false;
    fixture.config.twitch.messagesEnabled = true;
    fixture.config.twitch.farewellsEnabled = true;
    fixture.config.farewell.command = '!synthetic-bye';
    fixture.config.logging.file.enabled = false;
    fixture.config.logging.chat.enabled = false;
    try {
      await fixture.start();
      await fixture.runtime.platformEventRouter.routeEvent({ platform: 'twitch', type: 'platform:chat-message', data: {
        username: 'Synthetic Farewell Viewer', userId: 'synthetic-farewell-viewer',
        message: { text: message }, timestamp: '2026-01-01T00:00:00.000Z',
      } });
      const items: DisplayQueueItem[] = fixture.queue.queue.flatMap(entry =>
        'children' in entry ? entry.children as DisplayQueueItem[] : [entry]);
      expect(items.map(item => item.type)).toEqual(matching ? ['chat', 'farewell'] : ['chat']);
      const chat = items[0]!;
      expect(chat.data).toMatchObject({ username: 'Synthetic Farewell Viewer', userId: 'synthetic-farewell-viewer',
        message: { text: message.replace('\u200B', '') }, displayMessage: message.replace('\u200B', '') });
      await fixture.drain();
      expect(fixture.rows.map(row => row.type)).toEqual(matching ? ['chat', 'farewell'] : ['chat']);
      if (matching) {
        expect(items[1]!.data).toMatchObject({ username: 'Synthetic Farewell Viewer', userId: 'synthetic-farewell-viewer',
          displayMessage: 'Goodbye, Synthetic Farewell Viewer! 👋' });
      }
    } finally {
      await fixture.dispose();
    }
  });
}
