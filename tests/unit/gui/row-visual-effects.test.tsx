import { describe, expect, it } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RowVisualEffects } from '../../../gui/src/shared/components/RowVisualEffects';

describe('row visual effects', () => {
    it('uses configured effect order as paint order', () => {
        const html = renderToStaticMarkup(React.createElement(RowVisualEffects, {
            presentation: {
                role: 'member',
                theme: 'red',
                effects: ['particles', 'sheen']
            },
            seed: 'test-effect-order'
        }));

        expect(html).toMatch(/class="gui-row__effect" style="z-index:0"><canvas/);
        expect(html).toContain('class="gui-row__effect gui-row__effect--sheen" style="z-index:1"');
    });

    it('reverses paint order when configuration order is reversed', () => {
        const html = renderToStaticMarkup(React.createElement(RowVisualEffects, {
            presentation: {
                role: 'member',
                theme: 'green',
                effects: ['sheen', 'particles']
            },
            seed: 'test-reverse-effect-order'
        }));

        expect(html).toContain('class="gui-row__effect gui-row__effect--sheen" style="z-index:0"');
        expect(html).toMatch(/class="gui-row__effect" style="z-index:1"><canvas/);
    });
});
