const { describe, it, expect } = require('bun:test');

const { createGuiTransportService } = require('../../src/services/gui/gui-transport-service');
const { TestEventBus, getAvailablePort } = require('../helpers/gui-transport-test-utils');
const { createConfigFixture } = require('../helpers/config-fixture');

describe('gui transport smoke', () => {
    it('serves dock route when dock is enabled', async () => {
        const port = await getAvailablePort();
        const config = createConfigFixture({
            gui: {
                enableDock: true,
                enableOverlay: false,
                host: '127.0.0.1',
                port
            }
        });

        const service = createGuiTransportService({
            config,
            eventBus: new TestEventBus(),
            logger: null
        });

        await service.start();
        try {
            const response = await fetch(`http://127.0.0.1:${port}/dock`);
            const body = await response.text();
            expect(response.status).toBe(200);
            expect(body).toContain('/gui/events');
        } finally {
            await service.stop();
        }
    });
});
