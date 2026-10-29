import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createMainPresentationFixture } from '../../helpers/main-presentation-fixture';
import { captureStdout, captureStderr } from '../../helpers/output-capture';

let h: Awaited<ReturnType<typeof createMainPresentationFixture>>;
let stdout: ReturnType<typeof captureStdout>;
let stderr: ReturnType<typeof captureStderr>;
beforeEach(async () => {
  stdout = captureStdout(); stderr = captureStderr();
  h = await createMainPresentationFixture();
  h.config.logging.file.enabled = false;
  h.config.logging.chat.enabled = false;
  h.config.farewell.command = '!bye';
  await h.start();
});
afterEach(async () => {
  try { await h?.dispose(); }
  finally { stdout.restore(); stderr.restore(); }
});
const options = { command: '!bye', userId: 'synthetic-user', timestamp: '2024-01-01T00:00:00.000Z' };

describe('AppRuntime notification preparation with the root-created manager', () => {
  it('uses unified validation and real payload construction without enqueueing', async () => {
    const result = await h.runtime.prepareFarewellNotification('twitch', 'synthetic-viewer', options);
    expect(result).toMatchObject({ success: true, item: { type: 'farewell', platform: 'twitch', data: {
      command: '!bye', username: 'synthetic-viewer', platform: 'twitch', userId: options.userId,
    } } });
    expect(h.queue.state.queue).toHaveLength(0);
    expect(h.rows).toHaveLength(0);
  });

  it('keeps normal farewell handling on the real enqueueing path', async () => {
    expect(await h.runtime.handleFarewellNotification('twitch', 'synthetic-viewer', options)).toMatchObject({ success: true });
    expect(h.queue.state.queue).toHaveLength(1);
    expect(h.queue.state.queue[0]).toMatchObject({ type: 'farewell', data: { username: 'synthetic-viewer', command: '!bye' } });
  });

  it('rejects invalid preparation without admission and recovers with complete identity', async () => {
    expect(await h.runtime.prepareFarewellNotification('twitch', 'synthetic-viewer', { ...options, userId: undefined })).toMatchObject({ success: false });
    expect(h.queue.state.queue).toHaveLength(0);
    expect(await h.runtime.prepareFarewellNotification('twitch', 'synthetic-viewer', options)).toMatchObject({ success: true });
    expect(h.queue.state.queue).toHaveLength(0);
  });
});
