import { expect, it } from 'bun:test';
import { OBSConnectionManager } from '../../../src/obs/connection';
import { PRIORITY_LEVELS } from '../../../src/core/constants';
import { DisplayQueue } from '../../../src/obs/display-queue';

it('reports empty, mixed admission and cleared queue lengths through the actual state owner', async () => {
  const obs = new OBSConnectionManager({ config: { enabled: false, password: 'synthetic-only' } });
  let queue: DisplayQueue | undefined;
  try {
    queue = new DisplayQueue(obs as OBSConnectionManager & ConstructorParameters<typeof DisplayQueue>[0], { maxQueueSize: 50, autoProcess: false }, { PRIORITY_LEVELS });
    expect(queue.getQueueLength()).toBe(0);
    queue.addItem({ type: 'chat', priority: 1, platform: 'tiktok', data: { username: 'Synthetic A', message: 'Synthetic text' } });
    queue.addItem({ type: 'platform:gift', priority: 3, platform: 'twitch', data: { username: 'Synthetic B', message: 'Synthetic gift' } });
    expect(queue.getQueueLength()).toBe(2);
    queue.clearQueue();
    expect(queue.getQueueLength()).toBe(0);
  } finally { try { await queue?.stop(); } finally { obs.dispose(); await obs.disconnect(); } }
});
