const { describe, it, expect, beforeAll, afterAll } = require('bun:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const TestRenderer = require('react-test-renderer');

const { App } = require('../../../gui/src/shared/App');
const { GuiShell } = require('../../../gui/src/shared/components/GuiShell');

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

    it('propagates compare mode to rendered dock rows', async () => {
        let onEventHandler = null;
        const createEventFeedImpl = ({ onEvent }) => {
            onEventHandler = onEvent;
            return () => {};
        };

        let renderer;
        await TestRenderer.act(async () => {
            renderer = TestRenderer.create(
                React.createElement(App, {
                    mode: 'dock',
                    eventsPath: '/gui/events',
                    uiCompareMode: true,
                    createEventFeedImpl
                })
            );
        });

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
        expect(text).toContain('gui-row-compare-shell');
        expect(text).toContain('test-user');
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

    it('routes effect events separately from row feed updates', async () => {
        let onEventHandler = null;
        const createEventFeedImpl = ({ onEvent }) => {
            onEventHandler = onEvent;
            return () => {};
        };

        let renderer;
        await TestRenderer.act(async () => {
            renderer = TestRenderer.create(
                React.createElement(App, {
                    mode: 'dock',
                    eventsPath: '/gui/events',
                    createEventFeedImpl
                })
            );
        });

        await TestRenderer.act(async () => {
            onEventHandler({
                __guiEvent: 'effect',
                effectType: 'tiktok-gift-animation',
                playbackId: 'effect-1',
                durationMs: 2500,
                assetUrl: '/gui/runtime/test.mp4',
                config: {
                    profileName: 'portrait',
                    sourceWidth: 960,
                    sourceHeight: 864,
                    renderWidth: 480,
                    renderHeight: 854,
                    rgbFrame: [0, 0, 480, 854],
                    aFrame: [480, 0, 480, 854]
                }
            });
        });

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
        expect(text).toContain('test-user');
        expect(text).toContain('gui-shell__effect-layer');
    });

    it('ignores malformed gift effect payloads missing config shape', async () => {
        let onEventHandler = null;
        const createEventFeedImpl = ({ onEvent }) => {
            onEventHandler = onEvent;
            return () => {};
        };

        let renderer;
        await TestRenderer.act(async () => {
            renderer = TestRenderer.create(
                React.createElement(App, {
                    mode: 'dock',
                    eventsPath: '/gui/events',
                    createEventFeedImpl
                })
            );
        });

        await TestRenderer.act(async () => {
            onEventHandler({
                __guiEvent: 'effect',
                effectType: 'tiktok-gift-animation',
                playbackId: 'effect-1',
                durationMs: 2500,
                assetUrl: '/gui/runtime/test.mp4'
            });
        });

        const text = JSON.stringify(renderer.toJSON());
        expect(text).not.toContain('gui-shell__effect-layer');
    });

    it('ignores malformed gift effect payloads with string duration', async () => {
        let onEventHandler = null;
        const createEventFeedImpl = ({ onEvent }) => {
            onEventHandler = onEvent;
            return () => {};
        };

        let renderer;
        await TestRenderer.act(async () => {
            renderer = TestRenderer.create(
                React.createElement(App, {
                    mode: 'dock',
                    eventsPath: '/gui/events',
                    createEventFeedImpl
                })
            );
        });

        await TestRenderer.act(async () => {
            onEventHandler({
                __guiEvent: 'effect',
                effectType: 'tiktok-gift-animation',
                playbackId: 'effect-bad-duration',
                durationMs: '2500',
                assetUrl: '/gui/runtime/test.mp4',
                config: {
                    profileName: 'portrait',
                    sourceWidth: 960,
                    sourceHeight: 864,
                    renderWidth: 480,
                    renderHeight: 854,
                    rgbFrame: [0, 0, 480, 854],
                    aFrame: [480, 0, 480, 854]
                }
            });
        });

        const text = JSON.stringify(renderer.toJSON());
        expect(text).not.toContain('gui-shell__effect-layer');
    });

    it('queues gift effects and advances only after active playback completion', async () => {
        let onEventHandler = null;
        const createEventFeedImpl = ({ onEvent }) => {
            onEventHandler = onEvent;
            return () => {};
        };

        let renderer;
        await TestRenderer.act(async () => {
            renderer = TestRenderer.create(
                React.createElement(App, {
                    mode: 'dock',
                    eventsPath: '/gui/events',
                    createEventFeedImpl
                })
            );
        });

        await TestRenderer.act(async () => {
            onEventHandler({
                __guiEvent: 'effect',
                effectType: 'tiktok-gift-animation',
                playbackId: 'effect-1',
                durationMs: 2500,
                assetUrl: '/gui/runtime/test-1.mp4',
                config: {
                    profileName: 'portrait',
                    sourceWidth: 960,
                    sourceHeight: 864,
                    renderWidth: 480,
                    renderHeight: 854,
                    rgbFrame: [0, 0, 480, 854],
                    aFrame: [480, 0, 480, 854]
                }
            });
            onEventHandler({
                __guiEvent: 'effect',
                effectType: 'tiktok-gift-animation',
                playbackId: 'effect-2',
                durationMs: 2600,
                assetUrl: '/gui/runtime/test-2.mp4',
                config: {
                    profileName: 'portrait',
                    sourceWidth: 960,
                    sourceHeight: 864,
                    renderWidth: 480,
                    renderHeight: 854,
                    rgbFrame: [0, 0, 480, 854],
                    aFrame: [480, 0, 480, 854]
                }
            });
        });

        let shell = renderer.root.findByType(GuiShell);
        expect(shell.props.activeEffect.playbackId).toBe('effect-1');

        await TestRenderer.act(async () => {
            shell.props.onEffectComplete('effect-1');
        });

        shell = renderer.root.findByType(GuiShell);
        expect(shell.props.activeEffect.playbackId).toBe('effect-2');
    });

    it('ignores gift animation effects in overlay mode', async () => {
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
                __guiEvent: 'effect',
                effectType: 'tiktok-gift-animation',
                playbackId: 'effect-ignored-overlay',
                durationMs: 2500,
                assetUrl: '/gui/runtime/test.mp4',
                config: {
                    profileName: 'portrait',
                    sourceWidth: 960,
                    sourceHeight: 864,
                    renderWidth: 480,
                    renderHeight: 854,
                    rgbFrame: [0, 0, 480, 854],
                    aFrame: [480, 0, 480, 854]
                }
            });
        });

        const text = JSON.stringify(renderer.toJSON());
        expect(text).not.toContain('gui-shell__effect-layer');
    });

    it('renders only gift animation effects in tiktok-animations mode', async () => {
        let onEventHandler = null;
        const createEventFeedImpl = ({ onEvent }) => {
            onEventHandler = onEvent;
            return () => {};
        };

        let renderer;
        await TestRenderer.act(async () => {
            renderer = TestRenderer.create(
                React.createElement(App, {
                    mode: 'tiktok-animations',
                    eventsPath: '/gui/events',
                    createEventFeedImpl
                })
            );
        });

        await TestRenderer.act(async () => {
            onEventHandler({
                type: 'chat',
                kind: 'chat',
                platform: 'twitch',
                username: 'test-user-ignored',
                text: 'hidden-row',
                avatarUrl: 'https://example.invalid/test-avatar.png',
                timestamp: '2024-01-01T00:00:00.000Z'
            });
            onEventHandler({
                __guiEvent: 'effect',
                effectType: 'tiktok-gift-animation',
                playbackId: 'effect-tiktok-only',
                durationMs: 2500,
                assetUrl: '/gui/runtime/test.mp4',
                config: {
                    profileName: 'portrait',
                    sourceWidth: 960,
                    sourceHeight: 864,
                    renderWidth: 480,
                    renderHeight: 854,
                    rgbFrame: [0, 0, 480, 854],
                    aFrame: [480, 0, 480, 854]
                }
            });
        });

        const text = JSON.stringify(renderer.toJSON());
        expect(text).toContain('gui-shell__effect-layer');
        expect(text).not.toContain('hidden-row');
    });
});
