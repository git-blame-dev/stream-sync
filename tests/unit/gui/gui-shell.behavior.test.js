const { describe, it, expect } = require('bun:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const { GuiShell } = require('../../../gui/src/shared/components/GuiShell');

describe('GuiShell behavior', () => {
    it('renders rows and mode class', () => {
        const html = renderToStaticMarkup(
            React.createElement(GuiShell, {
                mode: 'overlay',
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
});
