const { describe, it, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');

function readSharedStyles() {
    const filePath = path.resolve(__dirname, '../../../gui/src/shared/styles.css');
    return fs.readFileSync(filePath, 'utf8');
}

function readCssBlock(cssText, selector) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const blockPattern = new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`);
    const match = cssText.match(blockPattern);
    return match ? match[1] : '';
}

describe('GUI shared styles behavior', () => {
    it('uses 90 percent opaque cards, no overlay enter fade, auto layout, and readable text sizing', () => {
        const cssText = readSharedStyles();
        const rowBlock = readCssBlock(cssText, '.gui-row');
        const overlayEnterBlock = readCssBlock(cssText, '.gui-row--overlay-enter');
        const avatarBlock = readCssBlock(cssText, '.gui-row__avatar');
        const platformIconBlock = readCssBlock(cssText, '.gui-row__platform-icon');
        const textBlock = readCssBlock(cssText, '.gui-row__text');

        expect(rowBlock).toContain('grid-template-columns: auto 1fr;');
        expect(rowBlock).toContain('background: rgba(0, 0, 0, 0.9);');
        expect(overlayEnterBlock).toContain('animation: none;');
        expect(avatarBlock).toContain('width: 45px;');
        expect(avatarBlock).toContain('height: 45px;');
        expect(platformIconBlock).toContain('width: 25px;');
        expect(platformIconBlock).toContain('height: 25px;');
        expect(textBlock).toContain('font-size: 18px;');
    });
});
