const { describe, it, expect } = require('bun:test');

const { createGuiTransportService } = require('../../src/services/gui/gui-transport-service');
const { TestEventBus, getAvailablePort } = require('../helpers/gui-transport-test-utils');
const { createConfigFixture } = require('../helpers/config-fixture');

describe('gui transport smoke', () => {
    it('serves dock and overlay routes correctly across enabled and disabled combinations', async () => {
        const cases = [
            { enableDock: true, enableOverlay: false, expectDockEnabled: true, expectOverlayEnabled: false, expectServiceActive: true },
            { enableDock: false, enableOverlay: true, expectDockEnabled: false, expectOverlayEnabled: true, expectServiceActive: true },
            { enableDock: true, enableOverlay: true, expectDockEnabled: true, expectOverlayEnabled: true, expectServiceActive: true },
            { enableDock: false, enableOverlay: false, expectDockEnabled: false, expectOverlayEnabled: false, expectServiceActive: false }
        ];

        for (const testCase of cases) {
            const port = await getAvailablePort();
            const config = createConfigFixture({
                gui: {
                    enableDock: testCase.enableDock,
                    enableOverlay: testCase.enableOverlay,
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
                expect(service.isActive()).toBe(testCase.expectServiceActive);
                if (!testCase.expectServiceActive) {
                    continue;
                }

                const dockResponse = await fetch(`http://127.0.0.1:${port}/dock`);
                const dockBody = await dockResponse.text();
                expect(dockResponse.status).toBe(200);
                if (testCase.expectDockEnabled) {
                    expect(dockBody).toContain('/gui/events');
                    expect(dockBody).toContain('/gui/assets/dock.js');
                    expect(dockBody).toContain('/gui/assets/styles.css');
                } else {
                    expect(dockBody).toContain('data-gui-disabled="true"');
                    expect(dockBody).not.toContain('/gui/events');
                }

                const overlayResponse = await fetch(`http://127.0.0.1:${port}/overlay`);
                const overlayBody = await overlayResponse.text();
                expect(overlayResponse.status).toBe(200);
                if (testCase.expectOverlayEnabled) {
                    expect(overlayBody).toContain('/gui/events');
                    expect(overlayBody).toContain('/gui/assets/overlay.js');
                    expect(overlayBody).toContain('/gui/assets/styles.css');
                } else {
                    expect(overlayBody).toContain('data-gui-disabled="true"');
                    expect(overlayBody).not.toContain('/gui/events');
                }
            } finally {
                await service.stop();
            }
        }
    });
});
