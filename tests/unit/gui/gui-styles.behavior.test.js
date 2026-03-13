const { describe, it, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');

function readSharedStyles() {
    const filePath = path.resolve(__dirname, '../../../gui/src/shared/styles.css');
    return fs.readFileSync(filePath, 'utf8');
}

function readCssBlock(cssText, selector) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const blockPattern = new RegExp(`(?:^|\\n)\\s*${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`, 'm');
    const match = cssText.match(blockPattern);
    return match ? match[1] : '';
}

describe('GUI shared styles behavior', () => {
    it('uses a shared 95 percent opacity variable for row cards, no overlay enter fade, auto layout, and readable text sizing', () => {
        const cssText = readSharedStyles();
        const pageBlock = readCssBlock(cssText, 'html, body');
        const rootBlock = readCssBlock(cssText, ':root');
        const overlayShellBlock = readCssBlock(cssText, '.gui-shell--overlay');
        const overlayExitBlock = readCssBlock(cssText, '.gui-row--overlay-exit');
        const rowBlock = readCssBlock(cssText, '.gui-row');
        const paypiggyRowBlock = readCssBlock(cssText, '.gui-row--paypiggy');
        const paypiggyUsernameBlock = readCssBlock(cssText, '.gui-row--paypiggy .gui-row__username');
        const paypiggyTextBlock = readCssBlock(cssText, '.gui-row--paypiggy .gui-row__text');
        const overlayEnterBlock = readCssBlock(cssText, '.gui-row--overlay-enter');
        const avatarBlock = readCssBlock(cssText, '.gui-row__avatar');
        const platformIconBlock = readCssBlock(cssText, '.gui-row__platform-icon');
        const textBlock = readCssBlock(cssText, '.gui-row__text');

        expect(pageBlock).toContain('margin: 0;');
        expect(pageBlock).toContain('padding: 0;');
        expect(rootBlock).toContain('--gui-row-background-opacity: 0.95;');
        expect(overlayShellBlock).toContain('height: 100vh;');
        expect(overlayShellBlock).toContain('overflow: hidden;');
        expect(overlayExitBlock).toContain('position: absolute;');
        expect(overlayExitBlock).toContain('animation: gui-overlay-row-exit 1000ms ease-out forwards;');
        expect(cssText).toContain('@keyframes gui-overlay-row-exit');
        expect(cssText).toContain('translateY(calc(-1 * var(--overlay-exit-travel, 0px)))');
        expect(rowBlock).toContain('grid-template-columns: auto 1fr;');
        expect(rowBlock).toContain('background: rgba(0, 0, 0, var(--gui-row-background-opacity));');
        expect(paypiggyRowBlock).toContain('background: rgba(15, 157, 88, var(--gui-row-background-opacity));');
        expect(paypiggyUsernameBlock).toContain('color: #ffffff;');
        expect(paypiggyTextBlock).toContain('color: #ffffff;');
        expect(overlayEnterBlock).toContain('animation: none;');
        expect(avatarBlock).toContain('width: 45px;');
        expect(avatarBlock).toContain('height: 45px;');
        expect(platformIconBlock).toContain('width: 30px;');
        expect(platformIconBlock).toContain('height: 30px;');
        expect(platformIconBlock).toContain('transform: translateY(1px);');
        expect(textBlock).toContain('font-size: 18px;');
    });
});
