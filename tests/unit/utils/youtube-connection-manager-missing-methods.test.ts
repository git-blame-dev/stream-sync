import { vi, describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { noOpLogger } from "../../helpers/mock-factories";
import { YouTubeConnectionManager } from "../../../src/platforms/youtube/youtube-connection-manager";

const setCurrentConnectionReady = (
  connectionManager: YouTubeConnectionManager,
  videoId: string,
): void => {
  const attemptId = connectionManager.getConnectionStatus(videoId)?.attemptId;
  if (attemptId === undefined) {
    throw new Error(`Expected connection attempt for ${videoId}`);
  }
  connectionManager.setConnectionReady(videoId, attemptId);
};

describe("YouTube Connection Manager - Missing Methods", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  let connectionManager: YouTubeConnectionManager;

  beforeEach(() => {
    connectionManager = new YouTubeConnectionManager(noOpLogger);
  });

  describe("Required Methods", () => {
    test("should have getConnectionStatus method", async () => {
      const mockConnection = {};
      await connectionManager.connectToStream(
        "test-video-id",
        async () => mockConnection,
      );
      setCurrentConnectionReady(connectionManager, "test-video-id");

      expect(typeof connectionManager.getConnectionStatus).toBe("function");

      const status = connectionManager.getConnectionStatus("test-video-id");
      expect(status).toEqual(
        expect.objectContaining({
          ready: true,
        }),
      );
    });

    test("should have getAllVideoIds method", async () => {
      await connectionManager.connectToStream("video1", async () => ({
        ready: true,
      }));
      await connectionManager.connectToStream("video2", async () => ({
        ready: false,
      }));

      expect(typeof connectionManager.getAllVideoIds).toBe("function");

      const videoIds = connectionManager.getAllVideoIds();
      expect(Array.isArray(videoIds)).toBe(true);
      expect(videoIds).toContain("video1");
      expect(videoIds).toContain("video2");
    });

    test("getConnectionStatus should return null for non-existent video", () => {
      const status =
        connectionManager.getConnectionStatus("non-existent-video");
      expect(status).toBeNull();
    });

    test("getAllVideoIds should return empty array when no connections", () => {
      const videoIds = connectionManager.getAllVideoIds();
      expect(videoIds).toEqual([]);
    });
  });

  describe("Integration with existing methods", () => {
    test("getAllVideoIds should match getActiveVideoIds", async () => {
      await connectionManager.connectToStream("video1", async () => ({
        ready: true,
      }));
      await connectionManager.connectToStream("video2", async () => ({
        ready: false,
      }));

      const getAllVideoIds = connectionManager.getAllVideoIds();
      const getActiveVideoIds = connectionManager.getActiveVideoIds();

      expect(getAllVideoIds).toEqual(getActiveVideoIds);
    });

    test("getConnectionStatus should provide same info as other methods", async () => {
      const mockConnection = { someProperty: "test" };
      await connectionManager.connectToStream(
        "test-video",
        async () => mockConnection,
      );
      setCurrentConnectionReady(connectionManager, "test-video");

      const status = connectionManager.getConnectionStatus("test-video");
      const isReady = connectionManager.isConnectionReady("test-video");

      expect(status).not.toBeNull();
      if (status === null) throw new Error("Expected connection status");
      expect(status.ready).toBe(isReady);
      expect(status.ready).toBe(true);
      expect(isReady).toBe(true);
    });
  });
});
