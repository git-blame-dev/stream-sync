import { vi, describe, expect, it, afterEach } from 'bun:test';

import { noOpLogger } from "../../../helpers/mock-factories";

import { YouTubePlatform } from "../../../../src/platforms/youtube";

describe("YouTubePlatform live validation (modern signals)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const streamDetectionService = { detectLiveStreams: vi.fn<(...args: unknown[]) => unknown>() };
  const rawPlatformDataLoggingService = {
    logChatMessage: vi.fn<(...args: unknown[]) => unknown>(),
    close: vi.fn<(...args: unknown[]) => unknown>(),
  };

  const baseConfig = {
    enabled: true,
    username: "demo_channel",
  };

  const createPlatform = () =>
    new YouTubePlatform(baseConfig, {
      logger: noOpLogger,
      streamDetectionService,
      rawPlatformDataLoggingService,
    });

  it("rejects contradictory false live state even with HLS/live_status", () => {
    const platform = createPlatform();
    const info = {
      basic_info: {
        id: "abc123",
        title: "Synthetic stream",
        is_live: false,
        is_live_content: false,
        is_upcoming: false,
        live_status: "LIVE",
      },
      streaming_data: {
        hls_manifest_url: "https://www.youtube.example.invalid/hls/manifest",
      },
      playability_status: {
        status: "OK",
        liveStreamability: { enabled: true },
      },
    };

    const result = platform._validateVideoForConnection("abc123", info);
    expect(result.shouldConnect).toBe(false);
  });

  for (const basic of [
    { is_live_content: true, is_live_dvr_enabled: true, end_timestamp: new Date(1000) },
    { is_live: true, end_timestamp: new Date(1000) },
    { is_live: true, is_upcoming: true },
    { is_live_content: true, is_live_dvr_enabled: true },
    { is_live: true, id: 'synthetic_other' },
    { is_live: true, end_timestamp: new Date('synthetic-invalid') },
  ]) {
    it(`rejects ended, ambiguous or mismatched SDK state: ${JSON.stringify(basic)}`, () => {
      const platform = createPlatform();
      expect(platform._validateVideoForConnection('synthetic_A', {
        basic_info: { id: 'synthetic_A', ...basic },
        streaming_data: { hls_manifest_url: 'https://synthetic.invalid/hls' },
        playability_status: { status: 'OK' }
      }).shouldConnect).toBe(false);
    });
  }

  it('admits a playable matching live SDK response', () => {
    expect(createPlatform()._validateVideoForConnection('synthetic_A', {
      basic_info: { id: 'synthetic_A', is_live: true }, playability_status: { status: 'OK' }
    }).shouldConnect).toBe(true);
  });

  for (const status of ['ERROR', 'UNPLAYABLE', 'LOGIN_REQUIRED']) {
    it(`rejects live metadata with playability ${status}`, () => {
      expect(createPlatform()._validateVideoForConnection('synthetic_A', {
        basic_info: { id: 'synthetic_A', is_live: true }, playability_status: { status }
      }).shouldConnect).toBe(false);
    });
  }

  it('rejects an ended response parsed by the installed SDK', async () => {
    const packageRoot = `${import.meta.dir}/../../../../node_modules/youtubei.js`;
    const sdk = await import(`${packageRoot}/dist/src/platform/node.js?live-validation`);
    const client = await sdk.Innertube.create({
      generate_session_locally: true, retrieve_innertube_config: false,
      retrieve_player: false, enable_session_cache: false,
      fetch: async () => { throw new Error('synthetic fixture must remain offline'); }
    });
    const info = new sdk.YT.VideoInfo([{ success: true, status_code: 200, data: {
      playabilityStatus: { status: 'OK' },
      videoDetails: { videoId: 'synthetic_A', title: 'Synthetic ended stream',
        lengthSeconds: '1', viewCount: '1', thumbnail: { thumbnails: [] },
        isLive: false, isLiveContent: true, isPostLiveDvr: true },
      microformat: { playerMicroformatRenderer: {
        title: { simpleText: 'Synthetic ended stream' }, description: { simpleText: 'Synthetic fixture' },
        thumbnail: { thumbnails: [] }, lengthSeconds: '1', viewCount: '1',
        liveBroadcastDetails: { startTimestamp: '2020-01-01T00:00:00Z', endTimestamp: '2020-01-01T01:00:00Z' }
      } }
    } }], client.actions, 'synthetic-cpn');
    expect(info.basic_info.end_timestamp).toBeInstanceOf(Date);
    expect(info.basic_info.is_live_content).toBe(true);
    expect(createPlatform()._validateVideoForConnection('synthetic_A', info).shouldConnect).toBe(false);
  });

  it("blocks upcoming streams until they are live", () => {
    const platform = createPlatform();
    const info = {
      basic_info: {
        id: "upcoming123",
        is_live: false,
        is_live_content: false,
        is_upcoming: true,
        live_status: "UPCOMING",
      },
      playability_status: { status: "OK" },
    };

    const result = platform._validateVideoForConnection("upcoming123", info);
    expect(result.shouldConnect).toBe(false);
    expect(result.reason).toBe("Stream is upcoming but not yet live");
  });

  it("treats VOD/replay without live signals as not live", () => {
    const platform = createPlatform();
    const info = {
      basic_info: {
        id: "vod123",
        is_live: false,
        is_live_content: false,
        is_upcoming: false,
        live_status: "NONE",
      },
      playability_status: { status: "OK" },
    };

    const result = platform._validateVideoForConnection("vod123", info);
    expect(result.shouldConnect).toBe(false);
    expect(result.reason).toBe("Video is not live content (replay/VOD)");
  });
});
