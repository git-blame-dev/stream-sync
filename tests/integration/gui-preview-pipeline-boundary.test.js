const { describe, it, expect } = require('bun:test');

const {
    buildPreviewConfig,
    buildPreviewScenarioEvents,
    createPreviewPipeline,
    createPreviewIngestAdapters
} = require('../../scripts/local/gui-preview');
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

        const pipeline = createPreviewPipeline({ config, logger });
        const rows = [];
        const unsubscribe = pipeline.eventBus.subscribe('display:row', (row) => {
            rows.push(row);
        });

        const adapters = createPreviewIngestAdapters({
            config,
            logger,
            emitPlatformEvent: (event) => pipeline.emitIngestEvent(event)
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
