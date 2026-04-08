import { describe, expect, afterEach, it } from 'bun:test';
import { createRequire } from 'node:module';

const load = createRequire(__filename);
const { createMockFn, restoreAllMocks } = load('../../helpers/bun-mock-utils');
const { noOpLogger } = load('../../helpers/mock-factories');
const { createConfigFixture } = load('../../helpers/config-fixture');

type ViewerCountUpdatePayload = {
    platform: string;
    count: number;
    previousCount: number;
    isStreamLive: boolean;
    timestamp: Date;
};

describe('ViewerCountSystem polling observer notifications', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        restoreAllMocks();
        process.env.NODE_ENV = originalEnv;
    });

    function createSystemWithPlatform(counts = [5, 7]) {
        process.env.NODE_ENV = 'test';

        const platform = {
            getViewerCount: createMockFn()
                .mockResolvedValueOnce(counts[0])
                .mockResolvedValueOnce(counts[1])
        };

        const { ViewerCountSystem } = load('../../../src/utils/viewer-count.ts');
        const system = new ViewerCountSystem({
            platforms: { youtube: platform },
            logger: noOpLogger,
            config: createConfigFixture()
        });

        system.streamStatus.youtube = true;

        return { system };
    }

    it('notifies observers on polling updates with previousCount context', async () => {
        const { system } = createSystemWithPlatform([10, 4]);

        const updates: ViewerCountUpdatePayload[] = [];
        system.addObserver({
            getObserverId: () => 'obs-poll',
            onViewerCountUpdate: (payload: ViewerCountUpdatePayload) => updates.push(payload)
        });

        await system.pollPlatform('youtube');
        await system.pollPlatform('youtube');

        expect(updates).toHaveLength(2);
        expect(updates[0]).toEqual(expect.objectContaining({
            platform: 'youtube',
            count: 10,
            previousCount: 0,
            isStreamLive: true
        }));
        expect(updates[1]).toEqual(expect.objectContaining({
            platform: 'youtube',
            count: 4,
            previousCount: 10,
            isStreamLive: true
        }));
    });

    it('skips notifications when stream is offline', async () => {
        const { system } = createSystemWithPlatform();
        system.streamStatus.youtube = false;

        const updates: ViewerCountUpdatePayload[] = [];
        system.addObserver({
            getObserverId: () => 'obs-offline',
            onViewerCountUpdate: (payload: ViewerCountUpdatePayload) => updates.push(payload)
        });

        await system.pollPlatform('youtube');

        expect(updates).toEqual([]);
        expect(system.counts.youtube).toBe(0);
    });

    it('preserves count when polling unknown platform', async () => {
        const { system } = createSystemWithPlatform([1]);

        await system.pollPlatform('unknown');

        expect(system.counts.youtube).toBe(0);
    });

    it('preserves count when platform lacks getViewerCount', async () => {
        process.env.NODE_ENV = 'test';
        const { ViewerCountSystem } = load('../../../src/utils/viewer-count.ts');
        const system = new ViewerCountSystem({
            platforms: { twitch: { notAGetter: true } },
            logger: noOpLogger,
            config: createConfigFixture()
        });
        system.streamStatus.twitch = true;

        await system.pollPlatform('twitch');

        expect(system.counts.twitch).toBe(0);
    });

    it('preserves count when platform returns null viewer count', async () => {
        process.env.NODE_ENV = 'test';
        const platform = { getViewerCount: createMockFn().mockResolvedValue(null) };
        const { ViewerCountSystem } = load('../../../src/utils/viewer-count.ts');
        const system = new ViewerCountSystem({
            platforms: { youtube: platform },
            logger: noOpLogger,
            config: createConfigFixture()
        });
        system.streamStatus.youtube = true;

        await system.pollPlatform('youtube');

        expect(system.counts.youtube).toBe(0);
    });

    it('continues when polling throws', async () => {
        process.env.NODE_ENV = 'test';
        const platform = { getViewerCount: createMockFn().mockRejectedValue(new Error('boom')) };
        const { ViewerCountSystem } = load('../../../src/utils/viewer-count.ts');
        const system = new ViewerCountSystem({
            platforms: { youtube: platform },
            logger: noOpLogger,
            config: createConfigFixture()
        });
        system.streamStatus.youtube = true;

        await expect(system.pollPlatform('youtube')).resolves.toBeUndefined();
        expect(system.counts.youtube).toBe(0);
    });
});
