import { describe, expect, it } from 'bun:test';
import { DEFAULTS } from '../../../../src/core/config-schema';
import { ConfigValidator } from '../../../../src/utils/config-validator';
import { buildGuiRuntimeConfig } from '../../../../src/services/gui/gui-runtime-config';

describe('GUI overlay default consumption', () => {
    it('preserves six rows and three lines through schema normalization and runtime fallback', () => {
        const normalized = ConfigValidator.normalize({ gui: {} });
        const expected = { overlayMaxMessages: 6, overlayMaxLinesPerMessage: 3 };

        expect(DEFAULTS.gui).toMatchObject(expected);
        expect(normalized.gui).toMatchObject(expected);
        expect(buildGuiRuntimeConfig(normalized.gui)).toMatchObject(expected);
        expect(buildGuiRuntimeConfig({})).toMatchObject(expected);
    });

    it.each([undefined, null, 0, -1, 1.5, '12', NaN, Infinity, -Infinity])(
        'falls back to schema defaults for invalid runtime limits: %s',
        value => {
            expect(buildGuiRuntimeConfig({
                overlayMaxMessages: value,
                overlayMaxLinesPerMessage: value
            })).toMatchObject({
                overlayMaxMessages: DEFAULTS.gui.overlayMaxMessages,
                overlayMaxLinesPerMessage: DEFAULTS.gui.overlayMaxLinesPerMessage
            });
        }
    );

    it('preserves explicit positive limits through normalization and runtime construction', () => {
        const normalized = ConfigValidator.normalize({ gui: {
            overlayMaxMessages: '12',
            overlayMaxLinesPerMessage: '5'
        } });
        expect(buildGuiRuntimeConfig(normalized.gui)).toMatchObject({
            overlayMaxMessages: 12,
            overlayMaxLinesPerMessage: 5
        });
    });
});
