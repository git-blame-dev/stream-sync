import { expect, test } from 'bun:test';
import { createMainPresentationFixture } from '../helpers/main-presentation-fixture';
import type { DisplayQueueItem } from '../../src/interfaces/DisplayQueue';

for (const [bits, formatted] of [
  [100, '00100/10000 bits'], [50, '00050/10000 bits'],
  [1000, '01000/10000 bits'], [10000, '10000/10000 bits'],
] as const) {
  test(`${bits} bits credit the real presented goal exactly once at the original amount`, async () => {
    const h = await createMainPresentationFixture();
    h.config.logging.file.enabled = false;
    try {
      await h.start();
      const initialWrites = h.socket.writes.length;
      await h.runtime.platformEventRouter.routeEvent({ platform: 'twitch', type: 'platform:gift', data: {
        username: 'Synthetic Bits Viewer', userId: 'synthetic-bits-viewer', id: `synthetic-bits-${bits}`,
        timestamp: '2026-01-01T00:00:00.000Z', giftType: 'bits', giftCount: 1, amount: bits, currency: 'bits',
        bits, repeatCount: 1, message: 'Synthetic great stream!', cheermoteInfo: { prefix: 'Cheer', isMixed: false, bits },
      } });
      const items: DisplayQueueItem[] = h.queue.queue.flatMap(entry =>
        'children' in entry ? entry.children as DisplayQueueItem[] : [entry]);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ type: 'platform:gift', platform: 'twitch', data: {
        username: 'Synthetic Bits Viewer', giftCount: 1, amount: bits, currency: 'bits', message: 'Synthetic great stream!',
      } });
      expect(h.nativeGoal()?.current).toBe(0);
      expect(h.socket.writes).toHaveLength(initialWrites);
      await h.drain();
      expect(h.rows).toHaveLength(1);
      expect(h.nativeGoal()).toMatchObject({ current: bits, formatted });
      expect(h.socket.writes.slice(initialWrites).filter(write => write.inputName === 'synthetic-native-goal'))
        .toHaveLength(1);
      expect(h.socket.writes.slice(initialWrites).find(write => write.inputName === 'synthetic-native-goal'))
        .toMatchObject({ inputSettings: { text: formatted } });
    } finally {
      await h.dispose();
    }
  });
}
