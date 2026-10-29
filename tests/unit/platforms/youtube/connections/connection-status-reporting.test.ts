import { describe, expect, test } from 'bun:test';
import { YouTubePlatform } from '../../../../../src/platforms/youtube';
import { noOpLogger } from '../../../../helpers/mock-factories';

describe('YouTube connection status through the real platform and manager', () => {
  test('reports only ready streams through acquisition, readiness, retirement and replacement', async () => {
    const platform = new YouTubePlatform({
      enabled: true, username: 'test-only-channel', channelId: 'UC-test-only-channel', multiStreamEnabled: true,
    }, {
      logger: noOpLogger,
      streamDetectionService: { detectLiveStreams: async () => [] },
      notificationDispatcher: { dispatch() {} },
      RawPlatformDataLoggingService: class { logRawPlatformData() {} },
    });
    const manager = platform.connectionManager;
    let retiredAttempt = 0;
    let replacementAttempt = 0;
    // Resources represent the external live-chat connection; neither internal
    // owner nor its readiness/status implementation is replaced.
    try {
      expect(platform.getActiveYouTubeVideoIds()).toEqual([]);
      await manager.connectToStream('test-premiere', async (_id, attempt) => {
        retiredAttempt = attempt;
        return { stop() {} };
      });
      await manager.connectToStream('test-live', async (id, attempt, scope) => {
        const resource = { stop() {} };
        scope.adopt(resource);
        manager.setConnectionReady(id, attempt);
        return resource;
      });
      expect(manager.getAllVideoIds().sort()).toEqual(['test-live', 'test-premiere']);
      expect(manager.getConnectionCount()).toBe(2);
      expect(manager.getReadyConnectionCount()).toBe(1);
      expect(platform.getActiveYouTubeVideoIds()).toEqual(['test-live']);

      manager.setConnectionReady('test-premiere', retiredAttempt);
      expect(platform.getActiveYouTubeVideoIds().sort()).toEqual(['test-live', 'test-premiere']);
      expect(manager.getReadyConnectionCount()).toBe(2);
      await manager.removeConnection('test-premiere');
      expect(platform.getActiveYouTubeVideoIds()).toEqual(['test-live']);

      await manager.connectToStream('test-premiere', async (_id, attempt) => {
        replacementAttempt = attempt;
        return { stop() {} };
      });
      manager.setConnectionReady('test-premiere', retiredAttempt);
      expect(platform.getActiveYouTubeVideoIds()).toEqual(['test-live']);
      manager.setConnectionReady('test-premiere', replacementAttempt);
      expect(platform.getActiveYouTubeVideoIds().sort()).toEqual(['test-live', 'test-premiere']);
      await manager.cleanupAllConnections();
      expect(platform.getActiveYouTubeVideoIds()).toEqual([]);
      expect(manager.getConnectionCount()).toBe(0);
      expect(manager.getReadyConnectionCount()).toBe(0);
    } finally {
      await platform.cleanup();
    }
  });
});
