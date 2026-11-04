import { expect, it } from 'bun:test';
import { YouTubePlatform } from '../../src/platforms/youtube';
import { InnertubeService } from '../../src/services/innertube-service';
import { YouTubeStreamDetectionService } from '../../src/services/youtube-stream-detection-service';
import { ViewerCountExtractionService } from '../../src/services/viewer-count-extraction-service';
import { ViewerCountProvider } from '../../src/utils/viewer-count-providers';
import { noOpLogger } from '../helpers/mock-factories';

function fixture() {
  const requests: string[] = [];
  let failed = false;
  const owner = new InnertubeService({ createWithTimeout: async () => ({
    getChannel: async () => ({ videos: [], getLiveStreams: async () => ({ videos: [{ id: 'test0000001', is_live: true }] }) }),
    getInfo: async (id: string) => {
    requests.push(id);
    if (failed) throw new Error('Synthetic metadata failure');
    return { page: [{}, { current_video_endpoint: { payload: { videoId: id } } }], basic_info: { id, is_live: true }, primary_info: { view_count: { is_live: true, original_view_count: 321 } } };
  } }) }, { logger: noOpLogger });
  const platform = new YouTubePlatform({ username: `UC${'s'.repeat(22)}`, enabled: false, enableAPI: false, dataLoggingEnabled: false,
    envFileReadEnabled: false, envFileWriteEnabled: false }, { logger: noOpLogger, innertubeService: owner,
    streamDetectionService: new YouTubeStreamDetectionService(owner, { logger: noOpLogger }),
    viewerExtractionService: new ViewerCountExtractionService(owner, { logger: noOpLogger }) });
  return { platform, requests, fail(value: boolean) { failed = value; },
    async dispose() { try { await platform.cleanup(); } finally { await owner.dispose(); } } };
}

it('complete membership reaches the actual provider and metadata owner', async () => {
  const h = fixture();
  try {
    await h.platform.getLiveVideoIds();
    expect(await h.platform.getViewerCount()).toBe(321);
    expect(h.requests).toEqual(['test0000001', 'test0000001']);
  } finally { await h.dispose(); }
});

for (const mode of ['absent provider', 'provider without observation capability'] as const) {
  it(`membership count is unavailable for ${mode} without a metadata request`, async () => {
    const h = fixture();
    try {
      h.platform.viewerCountProvider = mode === 'absent provider' ? null : new ViewerCountProvider('synthetic', noOpLogger);
      expect(await h.platform.getViewerCount()).toBeNull();
      expect(h.requests).toEqual([]);
    } finally { await h.dispose(); }
  });
}

it('external metadata failure is unavailable and the following actual request recovers', async () => {
  const h = fixture();
  try {
    await h.platform.getLiveVideoIds();
    h.fail(true);
    expect(await h.platform.getViewerCount()).toBeNull();
    h.fail(false);
    expect(await h.platform.getViewerCount()).toBe(321);
    expect(h.requests).toEqual(['test0000001', 'test0000001', 'test0000001']);
  } finally { await h.dispose(); }
});
