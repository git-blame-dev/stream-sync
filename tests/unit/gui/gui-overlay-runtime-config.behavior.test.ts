const { describe, it, expect } = require('bun:test');

const { readOverlayRuntimeConfig } = require('../../../gui/src/overlay/runtime-config');

describe('Overlay runtime config behavior', () => {
    it('reads positive integer overlay limits from runtime config', () => {
        const runtimeConfig = readOverlayRuntimeConfig({
            __STREAM_SYNC_GUI_CONFIG__: {
                overlayMaxMessages: 7,
                overlayMaxLinesPerMessage: 4
            }
        });

        expect(runtimeConfig).toEqual({
            overlayMaxMessages: 7,
            overlayMaxLinesPerMessage: 4
        });
    });

    it('throws when runtime config object is missing', () => {
        expect(() => readOverlayRuntimeConfig({})).toThrow('Overlay runtime config is required');
    });

    it('throws when runtime config contains invalid overlay limits', () => {
        expect(() => {
            readOverlayRuntimeConfig({
                __STREAM_SYNC_GUI_CONFIG__: {
                    overlayMaxMessages: 0,
                    overlayMaxLinesPerMessage: 2
                }
            });
        }).toThrow('Overlay runtime config requires positive integer overlayMaxMessages');
    });
});
