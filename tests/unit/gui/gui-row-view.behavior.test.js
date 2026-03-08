const { describe, it, expect } = require('bun:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const { GuiRow } = require('../../../gui/src/shared/components/GuiRow');

describe('GuiRow rendering behavior', () => {
    it('renders avatar first with circular avatar class', () => {
        const html = renderToStaticMarkup(
            React.createElement(GuiRow, {
                mode: 'dock',
                row: {
                    type: 'chat',
                    kind: 'chat',
                    platform: 'twitch',
                    username: 'test-user',
                    text: 'hello',
                    avatarUrl: 'https://example.invalid/test-avatar.png',
                    timestamp: '2024-01-01T00:00:00.000Z'
                }
            })
        );

        const avatarIndex = html.indexOf('class="gui-row__avatar');
        const textIndex = html.indexOf('class="gui-row__text');
        expect(avatarIndex).toBeGreaterThan(-1);
        expect(textIndex).toBeGreaterThan(-1);
        expect(avatarIndex).toBeLessThan(textIndex);
        expect(html).toContain('gui-row__avatar--circle');
    });

    it('renders notification text with white text class', () => {
        const html = renderToStaticMarkup(
            React.createElement(GuiRow, {
                mode: 'dock',
                row: {
                    type: 'platform:follow',
                    kind: 'notification',
                    platform: 'twitch',
                    username: 'test-follower',
                    text: 'test-follower followed',
                    avatarUrl: 'https://example.invalid/test-follow-avatar.png',
                    timestamp: '2024-01-01T00:00:00.000Z'
                }
            })
        );

        expect(html).toContain('gui-row__text--notification');
    });
});
