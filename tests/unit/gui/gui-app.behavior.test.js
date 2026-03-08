const { describe, it, expect, beforeAll, afterAll } = require('bun:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const TestRenderer = require('react-test-renderer');

const { App } = require('../../../gui/src/shared/App');

let originalConsoleTimeStamp;

beforeAll(() => {
    originalConsoleTimeStamp = console.timeStamp;
    if (typeof console.timeStamp !== 'function') {
        console.timeStamp = () => {};
    }
});

afterAll(() => {
    console.timeStamp = originalConsoleTimeStamp;
});

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
                    createEventFeedImpl,
                    overlayMaxMessages: 3,
                    overlayMaxLinesPerMessage: 3
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

    it('applies overlay max message limit from app configuration', async () => {
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
                    createEventFeedImpl,
                    overlayMaxMessages: 3,
                    overlayMaxLinesPerMessage: 3
                })
            );
        });

        await TestRenderer.act(async () => {
            onEventHandler({
                type: 'chat',
                kind: 'chat',
                platform: 'twitch',
                username: 'test-user-1',
                text: 'message-1',
                avatarUrl: 'https://example.invalid/test-avatar-1.png',
                timestamp: '2024-01-01T00:00:01.000Z'
            });
            onEventHandler({
                type: 'chat',
                kind: 'chat',
                platform: 'twitch',
                username: 'test-user-2',
                text: 'message-2',
                avatarUrl: 'https://example.invalid/test-avatar-2.png',
                timestamp: '2024-01-01T00:00:02.000Z'
            });
            onEventHandler({
                type: 'chat',
                kind: 'chat',
                platform: 'twitch',
                username: 'test-user-3',
                text: 'message-3',
                avatarUrl: 'https://example.invalid/test-avatar-3.png',
                timestamp: '2024-01-01T00:00:03.000Z'
            });
            onEventHandler({
                type: 'chat',
                kind: 'chat',
                platform: 'twitch',
                username: 'test-user-4',
                text: 'message-4',
                avatarUrl: 'https://example.invalid/test-avatar-4.png',
                timestamp: '2024-01-01T00:00:04.000Z'
            });
        });

        const text = JSON.stringify(renderer.toJSON());
        expect(text).toContain('test-user-2');
        expect(text).toContain('test-user-3');
        expect(text).toContain('test-user-4');
        expect(text).not.toContain('test-user-1');
    });

    it('requires overlay limits when rendering overlay mode', () => {
        expect(() => {
            renderToStaticMarkup(
                React.createElement(App, {
                    mode: 'overlay',
                    eventsPath: '/gui/events'
                })
            );
        }).toThrow('Overlay mode requires positive integer overlay limits');
    });
});
