const { describe, it, expect } = require('bun:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const TestRenderer = require('react-test-renderer');

const { App } = require('../../../gui/src/shared/App');

describe('GUI app behavior', () => {
    it('renders shell container for dock mode', () => {
        const html = renderToStaticMarkup(
            React.createElement(App, {
                mode: 'dock',
                eventsPath: '/gui/events'
            })
        );

        expect(html).toContain('gui-shell');
        expect(html).toContain('gui-shell--dock');
    });

    it('wires event feed through useEffect in app component', async () => {
        let onEventHandler = null;
        const createEventFeedImpl = ({ onEvent }) => {
            onEventHandler = onEvent;
            return () => {};
        };

        let renderer;
        await TestRenderer.act(async () => {
            renderer = TestRenderer.create(
                React.createElement(App, {
                    mode: 'overlay',
                    eventsPath: '/gui/events',
                    createEventFeedImpl
                })
            );
        });

        expect(typeof onEventHandler).toBe('function');

        await TestRenderer.act(async () => {
            onEventHandler({
                type: 'chat',
                kind: 'chat',
                platform: 'twitch',
                username: 'test-user',
                text: 'hello',
                avatarUrl: 'https://example.invalid/test-avatar.png',
                timestamp: '2024-01-01T00:00:00.000Z'
            });
        });

        const text = JSON.stringify(renderer.toJSON());
        expect(text).toContain('gui-shell--overlay');
        expect(text).toContain('test-user');
    });
});
