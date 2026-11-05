import { expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { YouTubePlatform } from '../../../../../src/platforms/youtube';
import { InnertubeService } from '../../../../../src/services/innertube-service';
import { YouTubeStreamDetectionService } from '../../../../../src/services/youtube-stream-detection-service';
import { ViewerCountExtractionService } from '../../../../../src/services/viewer-count-extraction-service';
import { noOpLogger } from '../../../../helpers/mock-factories';

it('reports actual acquired connections, monitoring and removal in state and stats', async () => {
  const stopped: string[] = [];
  const owner = new InnertubeService({ createWithTimeout: async () => ({
    getChannel: async () => { throw new Error('Synthetic discovery unavailable'); },
    getInfo: async (id: string) => {
      const chat = new EventEmitter();
      return { basic_info: { id, is_live: true },
        page: [{}, { current_video_endpoint: { payload: { videoId: id } } }],
        livechat: { continuation: 'SYNTHETIC_CHAT_CONTINUATION', is_replay: false }, getLiveChat: async () => Object.assign(chat, {
        start() { chat.emit('start', {}); },
        stop() { stopped.push(id); },
      }) };
    },
  }) }, { logger: noOpLogger });
  const detector = new YouTubeStreamDetectionService(owner, { logger: noOpLogger });
  const platform = new YouTubePlatform({ enabled: true, username: 'synthetic-channel', enableAPI: false,
    dataLoggingEnabled: false, envFileReadEnabled: false, envFileWriteEnabled: false,
    streamPollingInterval: 600, fullCheckInterval: 60000, maxStreams: 2 }, {
    logger: noOpLogger, innertubeService: owner, streamDetectionService: detector,
    viewerExtractionService: new ViewerCountExtractionService(owner, { logger: noOpLogger }),
  });
  try {
    expect(platform.getConnectionState()).toEqual({ isConnected: false, isMonitoring: false,
      activeConnections: [], totalConnections: 0 });
    for (const id of ['synthetic-video-1', 'synthetic-video-2']) {
      expect(await platform.connectToYouTubeStream(id)).toBe(true);
      expect(platform.connectionManager.isConnectionReady(id)).toBe(true);
    }
    await platform.startMultiStreamMonitoring();
    expect(platform.getConnectionState()).toEqual({ isConnected: true, isMonitoring: true,
      activeConnections: ['synthetic-video-1', 'synthetic-video-2'], totalConnections: 2 });
    expect(platform.getStats()).toEqual({ platform: 'youtube', enabled: true, connected: true,
      monitoring: true, activeConnections: 2, totalConnections: 2 });
    await platform.connectionManager.removeConnection('synthetic-video-1');
    expect(stopped).toEqual(['synthetic-video-1']);
    expect(platform.getConnectionState()).toEqual({ isConnected: true, isMonitoring: true,
      activeConnections: ['synthetic-video-2'], totalConnections: 1 });
    expect(platform.getStats()).toEqual({ platform: 'youtube', enabled: true, connected: true,
      monitoring: true, activeConnections: 1, totalConnections: 1 });
  } finally {
    try { await platform.cleanup(); } finally { try { await detector.cleanup(); } finally { await owner.dispose(); } }
  }
  expect(stopped).toEqual(['synthetic-video-1', 'synthetic-video-2']);
  expect(platform.getConnectionState()).toEqual({ isConnected: false, isMonitoring: false,
    activeConnections: [], totalConnections: 0 });
});
