const { describe, it, expect } = require('bun:test');

type UnknownRecord = Record<string, any>;

type PreviewAdapter = 'twitch' | 'youtube' | 'tiktok';

type ScenarioEvent = {
    adapter: PreviewAdapter;
    rawEvent: UnknownRecord;
};

type PreviewPipeline = {
    eventBus: {
        subscribe: (eventName: string, handler: (payload: UnknownRecord) => void) => () => void;
    };
    dispose: () => Promise<void>;
    emitIngestEvent: (event: UnknownRecord) => void;
};

type PreviewAdapters = Record<PreviewAdapter, { ingest: (rawEvent: UnknownRecord) => Promise<void> }>;

type PreviewModule = {
    buildPreviewConfig: (baseConfig?: UnknownRecord) => UnknownRecord;
    buildPreviewScenarioEvents: (durationMs?: number, intervalMs?: number) => ScenarioEvent[];
    createPreviewPipeline: (options?: UnknownRecord) => PreviewPipeline;
    createPreviewIngestAdapters: (options: {
        config?: UnknownRecord;
        logger?: UnknownRecord;
        emitPlatformEvent: (event: UnknownRecord) => void;
        [key: string]: unknown;
    }) => PreviewAdapters;
};

const {
    buildPreviewConfig,
    buildPreviewScenarioEvents,
    createPreviewPipeline,
    createPreviewIngestAdapters
} = require('../../scripts/local/gui-preview.ts') as PreviewModule;
const { waitForDelay } = require('../helpers/time-utils');

describe('GUI preview pipeline boundary integration', () => {
    it('maps ingest scenario events into required gui row types', async () => {
        const config = buildPreviewConfig();
        const logger = {
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {},
            console: () => {}
        };

        const pipeline = createPreviewPipeline({
            config,
            logger,
            giftAnimationResolver: {
                async resolveFromNotificationData() {
                    return null;
                }
            }
        });
        const rows: UnknownRecord[] = [];
        const unsubscribe = pipeline.eventBus.subscribe('display:row', (row: UnknownRecord) => {
            rows.push(row);
        });

        const adapters = createPreviewIngestAdapters({
            config,
            logger,
            emitPlatformEvent: (event: UnknownRecord) => pipeline.emitIngestEvent(event)
        });

        const scenarioEvents = buildPreviewScenarioEvents(32000, 2000);
        for (const event of scenarioEvents) {
            await adapters[event.adapter].ingest(event.rawEvent);
        }

        for (let attempt = 0; attempt < 80; attempt += 1) {
            const emittedTypes = new Set(rows.map((row) => row.type));
            if (emittedTypes.has('command') && emittedTypes.has('farewell') && emittedTypes.has('platform:giftpaypiggy')) {
                break;
            }
            await waitForDelay(1);
        }

        const emittedTypes = new Set(rows.map((row) => row.type));
        expect(emittedTypes.has('chat')).toBe(true);
        expect(emittedTypes.has('command')).toBe(true);
        expect(emittedTypes.has('greeting')).toBe(true);
        expect(emittedTypes.has('farewell')).toBe(true);
        expect(emittedTypes.has('platform:follow')).toBe(true);
        expect(emittedTypes.has('platform:gift')).toBe(true);
        expect(emittedTypes.has('platform:raid')).toBe(true);
        expect(emittedTypes.has('platform:share')).toBe(true);
        expect(emittedTypes.has('platform:paypiggy')).toBe(true);
        expect(emittedTypes.has('platform:giftpaypiggy')).toBe(true);

        unsubscribe();
        await pipeline.dispose();
    });
});
