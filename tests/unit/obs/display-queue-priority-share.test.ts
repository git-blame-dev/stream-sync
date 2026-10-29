import { expect, test } from 'bun:test';
import { OBSConnectionManager } from '../../../src/obs/connection';
import { PRIORITY_LEVELS } from '../../../src/core/constants';
import { DisplayQueue } from '../../../src/obs/display-queue';

test('mapped display item types use their expected priority levels', async () => {
  const obs = new OBSConnectionManager({ config: { enabled: false, password: 'synthetic-only' } });
  let queue: DisplayQueue | undefined;
  try {
    queue = new DisplayQueue(obs as OBSConnectionManager & ConstructorParameters<typeof DisplayQueue>[0], { autoProcess: false }, { PRIORITY_LEVELS });
    const priorities = {
      'platform:share': PRIORITY_LEVELS.SHARE, 'platform:paypiggy': PRIORITY_LEVELS.PAYPIGGY,
      'platform:giftpaypiggy': PRIORITY_LEVELS.GIFTPAYPIGGY, 'platform:envelope': PRIORITY_LEVELS.ENVELOPE,
      'platform:chat-message': PRIORITY_LEVELS.CHAT, chat: PRIORITY_LEVELS.CHAT,
    };
    for (const [type, expected] of Object.entries(priorities)) expect(queue.getTypePriority(type)).toBe(expected);
  } finally { try { await queue?.stop(); } finally { obs.dispose(); await obs.disconnect(); } }
});
