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

    it('renders platform icon before username for known platforms', () => {
        const html = renderToStaticMarkup(
            React.createElement(GuiRow, {
                mode: 'dock',
                row: {
                    type: 'chat',
                    kind: 'chat',
                    platform: 'youtube',
                    username: 'test-youtube-user',
                    text: 'hello',
                    avatarUrl: 'https://example.invalid/test-avatar.png',
                    timestamp: '2024-01-01T00:00:00.000Z'
                }
            })
        );

        const platformIconIndex = html.indexOf('class="gui-row__platform-icon"');
        const usernameIndex = html.indexOf('class="gui-row__username"');
        expect(platformIconIndex).toBeGreaterThan(-1);
        expect(usernameIndex).toBeGreaterThan(-1);
        expect(platformIconIndex).toBeLessThan(usernameIndex);
        expect(html).toContain('src="/gui/assets/platform-icons/youtube-icon.png"');
    });

    it('renders platform icon for trimmed mixed-case platform identifiers', () => {
        const html = renderToStaticMarkup(
            React.createElement(GuiRow, {
                mode: 'dock',
                row: {
                    type: 'chat',
                    kind: 'chat',
                    platform: '  YouTube  ',
                    username: 'test-youtube-user',
                    text: 'hello',
                    avatarUrl: 'https://example.invalid/test-avatar.png',
                    timestamp: '2024-01-01T00:00:00.000Z'
                }
            })
        );

        expect(html).toContain('class="gui-row__platform-icon"');
        expect(html).toContain('src="/gui/assets/platform-icons/youtube-icon.png"');
    });

    it('does not render platform icon for unknown platform ids', () => {
        const html = renderToStaticMarkup(
            React.createElement(GuiRow, {
                mode: 'dock',
                row: {
                    type: 'chat',
                    kind: 'chat',
                    platform: 'unknown-platform',
                    username: 'test-user',
                    text: 'hello',
                    avatarUrl: 'https://example.invalid/test-avatar.png',
                    timestamp: '2024-01-01T00:00:00.000Z'
                }
            })
        );

        expect(html).not.toContain('class="gui-row__platform-icon"');
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

    it('renders inline emotes in order with text parts when parts are provided', () => {
        const html = renderToStaticMarkup(
            React.createElement(GuiRow, {
                mode: 'dock',
                row: {
                    type: 'chat',
                    kind: 'chat',
                    platform: 'tiktok',
                    username: 'test-user',
                    text: '',
                    parts: [
                        {
                            type: 'text',
                            text: 'hello '
                        },
                        {
                            type: 'emote',
                            platform: 'tiktok',
                            emoteId: '1234512345',
                            imageUrl: 'https://example.invalid/tiktok-emote.webp'
                        },
                        {
                            type: 'text',
                            text: ' world'
                        }
                    ],
                    avatarUrl: 'https://example.invalid/test-avatar.png',
                    timestamp: '2024-01-01T00:00:00.000Z'
                }
            })
        );

        expect(html).toContain('hello ');
        expect(html).toContain('world');
        expect(html).toContain('class="gui-row__emote"');
        expect(html).toContain('src="https://example.invalid/tiktok-emote.webp"');
    });
});
