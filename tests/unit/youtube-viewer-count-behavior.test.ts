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
  const owner = new InnertubeService({ createWithTimeout: async () => ({ getInfo: async (id: string) => {
    requests.push(id);
    if (failed) throw new Error('Synthetic metadata failure');
    return { basic_info: { id, is_live: true, view_count: 321 } };
  } }) }, { logger: noOpLogger });
  const platform = new YouTubePlatform({ enabled: false, enableAPI: false, dataLoggingEnabled: false,
    envFileReadEnabled: false, envFileWriteEnabled: false }, { logger: noOpLogger, innertubeService: owner,
    streamDetectionService: new YouTubeStreamDetectionService(owner, { logger: noOpLogger }),
    viewerExtractionService: new ViewerCountExtractionService(owner, { logger: noOpLogger }) });
  return { platform, requests, fail(value: boolean) { failed = value; },
    async dispose() { try { await platform.cleanup(); } finally { await owner.dispose(); } } };
}

it('per-video lookup reaches the actual provider and metadata owner for the requested ID', async () => {
  const h = fixture();
  try {
    expect(await h.platform.getViewerCountForVideo('synthetic-video')).toBe(321);
    expect(h.requests).toEqual(['synthetic-video']);
  } finally { await h.dispose(); }
});

for (const mode of ['absent provider', 'provider without per-video capability'] as const) {
  it(`per-video lookup is unavailable for ${mode} without a metadata request`, async () => {
    const h = fixture();
    try {
      h.platform.viewerCountProvider = mode === 'absent provider' ? null : new ViewerCountProvider('synthetic', noOpLogger);
      expect(await h.platform.getViewerCountForVideo('synthetic-video')).toBeNull();
      expect(h.requests).toEqual([]);
    } finally { await h.dispose(); }
  });
}

it('external metadata failure is unavailable and the following actual request recovers', async () => {
  const h = fixture();
  try {
    h.fail(true);
    expect(await h.platform.getViewerCountForVideo('synthetic-video')).toBeNull();
    h.fail(false);
    expect(await h.platform.getViewerCountForVideo('synthetic-video')).toBe(321);
    expect(h.requests).toEqual(['synthetic-video', 'synthetic-video']);
  } finally { await h.dispose(); }
});
