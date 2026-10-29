import { afterEach, expect, test, spyOn } from 'bun:test';
import fs from 'node:fs';
import { YouTubePlatform } from '../../../../src/platforms/youtube';
import { InnertubeService } from '../../../../src/services/innertube-service';
import { YouTubeStreamDetectionService } from '../../../../src/services/youtube-stream-detection-service';
import { ViewerCountExtractionService } from '../../../../src/services/viewer-count-extraction-service';
import { createYouTubeConfigFixture } from '../../../helpers/config-fixture';
import { noOpLogger } from '../../../helpers/mock-factories';

const retirements: Array<() => Promise<void>> = [];
afterEach(async () => {
  const outcomes = await Promise.allSettled(retirements.splice(0).reverse().map(retire => retire()));
  const failed = outcomes.find(outcome => outcome.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
});
function platform(overrides: Record<string, unknown> = {}, logger = noOpLogger) {
  const metadata = new InnertubeService({ createWithTimeout: async () => ({
    getInfo: async () => ({}),
    getChannel: async () => ({ videos: [], getLiveStreams: async () => ({ videos: [] }) }),
  }) }, { logger });
  const detector = new YouTubeStreamDetectionService(metadata, { logger });
  let owner: YouTubePlatform | undefined;
  retirements.push(async () => {
    try { await owner?.cleanup(); } finally { try { await detector.cleanup(); } finally { await metadata.dispose(); } }
  });
  owner = new YouTubePlatform(createYouTubeConfigFixture({ enabled: true, username: 'synthetic-channel',
    dataLoggingPath: '', dataLoggingEnabled: false, envFileReadEnabled: false, envFileWriteEnabled: false, ...overrides }),
  { logger, innertubeService: metadata, streamDetectionService: detector,
    viewerExtractionService: new ViewerCountExtractionService(metadata, { logger }) });
  return owner;
}

test('required camelCase username makes the actual platform configured without an API key', () => {
  const owner = platform({ apiKey: undefined });
  expect(owner.isConfigured()).toBe(true);
  expect(owner.config.username).toBe('synthetic-channel');
  expect(owner.config.apiKey).toBeUndefined();
});
for (const overrides of [{ enabled: false }, { username: '' }]) {
  test(`configuration is unavailable for ${JSON.stringify(overrides)}`, () => {
    expect(platform(overrides).isConfigured()).toBe(false);
  });
}
test('disabled initialization acquires no monitoring and reports initialized', async () => {
  const owner = platform({ enabled: false, username: '' });
  await owner.initialize();
  expect(owner.isInitialized).toBe(true);
  expect(owner.monitoringInterval).toBeNull();
  expect(owner.connectionManager.getConnectionCount()).toBe(0);
});
test('forced stream-detection validation rejects absence before constructing a usable platform', () => {
  expect(() => new YouTubePlatform({ dataLoggingPath: '' }, { logger: noOpLogger,
    streamDetectionService: null, forceStreamDetectionValidation: true })).toThrow(/stream detection/i);
});
test('actual detector and metadata owner discover the synthetic SDK live stream', async () => {
  const id = 'synthetic-live-video';
  const video = { id, video_id: id, title: { text: 'Synthetic stream' }, is_live: true,
    author: { name: 'Synthetic Channel' } };
  const sdk = {
    resolveURL: async () => ({ payload: { browseId: `UC${'s'.repeat(22)}` } }),
    getInfo: async () => ({}),
    getChannel: async () => ({ videos: [], getLiveStreams: async () => ({ videos: [video] }) }),
  };
  const metadata = new InnertubeService({ createWithTimeout: async () => sdk }, { logger: noOpLogger });
  const detector = new YouTubeStreamDetectionService(metadata, { logger: noOpLogger });
  let owner: YouTubePlatform | undefined;
  try {
    owner = new YouTubePlatform({ enabled: true, username: 'synthetic-channel', dataLoggingPath: '',
      dataLoggingEnabled: false, envFileReadEnabled: false, envFileWriteEnabled: false }, {
      logger: noOpLogger, innertubeService: metadata, streamDetectionService: detector,
      viewerExtractionService: new ViewerCountExtractionService(metadata, { logger: noOpLogger }),
    });
    expect(await owner.getLiveVideoIdsByYoutubei()).toEqual([id]);
    expect(owner.getDetectedStreamIds()).toEqual([id]);
  } finally {
    try { await owner?.cleanup(); } finally { try { await detector.cleanup(); } finally { await metadata.dispose(); } }
  }
});
test('external filesystem failure reaches the actual data-logging error handler and warning sink', async () => {
  const errors: unknown[][] = [], warnings: unknown[][] = [];
  const mkdir = spyOn(fs, 'mkdirSync').mockImplementation(() => { throw new Error('Synthetic disk full'); });
  let owner: YouTubePlatform | undefined;
  try {
    owner = platform({ enabled: false, dataLoggingPath: '/tmp/synthetic-youtube-log-unwritten' },
      { ...noOpLogger, error: (...args: unknown[]) => { errors.push(args); },
        warn: (...args: unknown[]) => { warnings.push(args); } },
    );
    expect(mkdir).toHaveBeenCalledWith('/tmp/synthetic-youtube-log-unwritten', { recursive: true });
    expect(JSON.stringify(errors)).toContain('Synthetic disk full');
    expect(JSON.stringify(warnings)).toContain('Failed to prepare data logging path');
    expect(owner.connectionManager.getConnectionCount()).toBe(0);
  } finally { try { await owner?.cleanup(); } finally { mkdir.mockRestore(); } }
});
