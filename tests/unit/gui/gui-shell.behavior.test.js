const { describe, it, expect } = require('bun:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const { GuiShell } = require('../../../gui/src/shared/components/GuiShell');

describe('GuiShell behavior', () => {
    it('renders rows and mode class', () => {
        const html = renderToStaticMarkup(
            React.createElement(GuiShell, {
                mode: 'overlay',
                overlayMaxLinesPerMessage: 3,
                rows: [
                    {
                        type: 'chat',
                        kind: 'chat',
                        platform: 'twitch',
                        username: 'test-user',
                        text: 'hello',
                        avatarUrl: 'https://example.invalid/test-avatar.png',
                        timestamp: '2024-01-01T00:00:00.000Z'
                    }
                ]
            })
        );

        expect(html).toContain('gui-shell--overlay');
        expect(html).toContain('test-user');
        expect(html).toContain('hello');
    });

    it('applies overlay line-clamp contract when configured', () => {
        const html = renderToStaticMarkup(
            React.createElement(GuiShell, {
                mode: 'overlay',
                overlayMaxLinesPerMessage: 3,
                rows: [
                    {
                        type: 'chat',
                        kind: 'chat',
                        platform: 'twitch',
                        username: 'test-user',
                        text: 'line one line two line three line four',
                        avatarUrl: 'https://example.invalid/test-avatar.png',
                        timestamp: '2024-01-01T00:00:00.000Z'
                    }
                ]
            })
        );

        expect(html).toContain('style="--overlay-line-clamp:3"');
        expect(html).toContain('gui-row__text--overlay-clamp');
    });

    it('renders overlay rows with transition class for upward motion', () => {
        const html = renderToStaticMarkup(
            React.createElement(GuiShell, {
                mode: 'overlay',
                overlayMaxLinesPerMessage: 3,
                rows: [
                    {
                        type: 'chat',
                        kind: 'chat',
                        platform: 'twitch',
                        username: 'test-user',
                        text: 'hello',
                        avatarUrl: 'https://example.invalid/test-avatar.png',
                        timestamp: '2024-01-01T00:00:00.000Z'
                    }
                ]
            })
        );

        expect(html).toContain('gui-row--overlay-enter');
    });

});
