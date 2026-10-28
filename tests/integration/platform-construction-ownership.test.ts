import { describe, expect, it } from 'bun:test';
import { PlatformLifecycleService, type PlatformConstructor } from '../../src/services/PlatformLifecycleService';
import { DependencyFactory } from '../../src/utils/dependency-factory';
import { InnertubeService } from '../../src/services/innertube-service';
import { YouTubeStreamDetectionService } from '../../src/services/youtube-stream-detection-service';
import { createConfigFixture } from '../helpers/config-fixture';
import { noOpLogger } from '../helpers/mock-factories';

describe('provisional YouTube construction ownership', () => {
    it('cancels only the failed attempt detection domain and preserves the real shared metadata owner for replacement', async () => {
        const entered = Promise.withResolvers<void>();
        const aborted = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const finished = Promise.withResolvers<void>();
        let physicalWorkFinished = false;
        const root = new InnertubeService({
            createWithTimeout: async () => { throw new Error('Expected raw SDK creation'); },
            createWithConfig: async options => {
                const fetch = options?.fetch as typeof globalThis.fetch;
                return {
                    getInfo: async (_videoId: string) => ({ synthetic: true }),
                    getChannel: async () => {
                        await fetch('https://synthetic.example.test/channel');
                        return { videos: [{ id: 'synthetic-live', is_live: true }] };
                    }
                };
            }
        }, {
            logger: noOpLogger,
            fetch: async (_input, init) => {
                entered.resolve();
                await new Promise<void>(resolve => init!.signal!.addEventListener('abort', () => {
                    aborted.resolve(); resolve();
                }, { once: true }));
                await release.promise;
                physicalWorkFinished = true;
                finished.resolve();
                throw new Error('Synthetic request cancelled');
            }
        });
        const factory = new DependencyFactory();
        const options = { logger: noOpLogger, config: createConfigFixture(), innertubeService: root };
        const deps = factory.createYoutubeDependencies({ streamDetectionMethod: 'youtubei' }, options);
        const detection = deps.streamDetectionService as YouTubeStreamDetectionService;
        const pending = detection.detectLiveStreams('UCabcdefghijklmnopqrstuv');
        const failure = new Error('Synthetic platform constructor failure');
        let constructorDetection: ReturnType<YouTubeStreamDetectionService['detectLiveStreams']> | undefined;
        class ThrowingPlatform {
            constructor() {
                constructorDetection = detection.detectLiveStreams('UCabcdefghijklmnopqrstuv');
                throw failure;
            }
        }
        const lifecycle = new PlatformLifecycleService({ logger: noOpLogger,
            sharedDependencies: { innertubeService: root },
            dependencyFactory: { createYoutubeDependencies: () => deps }
        });
        try {
            await entered.promise;
            await expect(lifecycle.createPlatformInstance('youtube', ThrowingPlatform as unknown as PlatformConstructor, {})).rejects.toBe(failure);
            await aborted.promise;
            expect(detection.isActive()).toBe(false);
            expect((await pending).success).toBe(false);
            expect((await constructorDetection)!.success).toBe(false);
            // Domain cleanup fences publication and signals cancellation; it is
            // not a physical transport join. The shared root still owns that work.
            expect(physicalWorkFinished).toBe(false);
            expect(await root.withMetadataOperation({}, async () => 'synthetic-root-usable')).toBe('synthetic-root-usable');
            const replacement = factory.createYoutubeDependencies({ streamDetectionMethod: 'youtubei' }, options);
            expect(replacement.innertubeService).toBe(root);
            const replacementDetection = replacement.streamDetectionService as YouTubeStreamDetectionService;
            expect(replacementDetection).not.toBe(detection);
            expect(replacementDetection.isActive()).toBe(true);
            await replacementDetection.cleanup();
            expect(await root.withMetadataOperation({}, client => client.getInfo('synthetic-video'))).toEqual({ synthetic: true });
            release.resolve();
            await finished.promise;
            expect((await pending).videoIds).toEqual([]);
        } finally {
            release.resolve();
            await detection.cleanup();
            await root.dispose();
        }
    });
});
