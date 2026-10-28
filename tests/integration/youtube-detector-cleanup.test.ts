import { expect, test } from 'bun:test';
import { YouTubePlatform } from '../../src/platforms/youtube';
import { InnertubeService } from '../../src/services/innertube-service';
import { YouTubeStreamDetectionService } from '../../src/services/youtube-stream-detection-service';
import { noOpLogger } from '../helpers/mock-factories';

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

test('platform retirement fences its detector before chat joins without retiring the shared metadata owner', async () => {
    const started = deferred();
    const transport = deferred();
    const chat = deferred();
    const viewer = deferred();
    const owner = new InnertubeService({ createWithTimeout: async () => ({
        getInfo: async () => ({ synthetic: true }),
        getChannel: async () => { started.resolve(); await transport.promise; return { videos: [] }; }
    }) }, { logger: noOpLogger });
    const detection = new YouTubeStreamDetectionService(owner, { logger: noOpLogger });
    const platform = new YouTubePlatform({}, { logger: noOpLogger, streamDetectionService: detection,
        viewerService: { cleanup: () => viewer.promise } });
    // The external chat stop boundary remains held while the platform domain retires.
    await platform.connectionManager.connectToStream('synthetic-chat', async () => ({ stop: () => chat.promise }));
    const pending = detection.detectLiveStreams('UCabcdefghijklmnopqrstuv');
    await started.promise;
    const cleanup = platform.cleanup();
    expect(detection.isActive()).toBe(false);
    expect(await pending).toMatchObject({ success: false });
    expect(detection.getUsageMetrics()).toMatchObject({ totalRequests: 0, successfulRequests: 0, failedRequests: 0 });
    const replacement = new YouTubeStreamDetectionService(owner, { logger: noOpLogger });
    platform.streamDetectionService = replacement;
    expect(await owner.withMetadataOperation({}, client => client.getInfo())).toEqual({ synthetic: true });
    let joined = false;
    void cleanup.then(() => { joined = true; });
    chat.resolve();
    await Promise.resolve();
    expect(joined).toBe(false);
    viewer.resolve();
    await cleanup;
    expect(replacement.isActive()).toBe(true);
    let physicallyJoined = false;
    const disposal = owner.dispose().then(() => { physicallyJoined = true; });
    await Promise.resolve();
    expect(physicallyJoined).toBe(false);
    transport.resolve();
    await disposal;
    await replacement.cleanup();
});

test('cleanup and reporting faults cannot skip captured consumers or initialization retirement', async () => {
    const calls: string[] = [];
    const platform = new YouTubePlatform({}, { logger: noOpLogger,
        streamDetectionService: { detectLiveStreams: async () => ({}), cleanup: () => {
            calls.push('detector'); throw new Error('synthetic detector cleanup');
        } }, viewerService: { cleanup: async () => { calls.push('viewer'); } } });
    await platform.connectionManager.connectToStream('synthetic-chat', async () => ({ stop: () => { calls.push('chat'); } }));
    platform.isInitialized = true;
    platform.errorHandler = { handleCleanupError: () => { throw new Error('synthetic reporting failure'); } };
    await expect(platform.cleanup()).rejects.toThrow('synthetic reporting failure');
    expect(calls).toEqual(['detector', 'chat', 'viewer']);
    expect(platform.isInitialized).toBe(false);
});

test('joins asynchronous detector and viewer cleanup despite debug reporting failure', async () => {
    const detector = deferred();
    const viewer = deferred();
    const viewerFinished = deferred();
    let replacementCleanups = 0;
    const platform = new YouTubePlatform({}, { logger: noOpLogger,
        streamDetectionService: { detectLiveStreams: async () => ({}), cleanup: () => detector.promise },
        viewerService: { cleanup: async () => { await viewer.promise; viewerFinished.resolve(); } } });
    platform.logger = { ...noOpLogger, debug: () => { throw new Error('synthetic debug reporting failure'); } };
    let settled = false;
    const cleanup = platform.cleanup().catch(error => { settled = true; return error as Error; });
    platform.viewerService = { cleanup: () => { replacementCleanups++; } };
    viewer.resolve();
    await viewerFinished.promise;
    expect(settled).toBe(false);
    detector.resolve();
    expect(await cleanup).toEqual(new Error('synthetic debug reporting failure'));
    expect(replacementCleanups).toBe(0);
});
