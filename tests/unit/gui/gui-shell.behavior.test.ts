// @ts-nocheck
const { describe, it, expect } = require('bun:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const TestRenderer = require('react-test-renderer');

const { GuiShell } = require('../../../gui/src/shared/components/GuiShell');

function createDockShellMock({ scrollTop = 0, clientHeight = 120, scrollHeight = 320 } = {}) {
    const listenersByEvent = new Map();

    return {
        scrollTop,
        clientHeight,
        scrollHeight,
        addEventListener: (eventName, handler) => {
            listenersByEvent.set(eventName, handler);
        },
        removeEventListener: (eventName, handler) => {
            if (listenersByEvent.get(eventName) === handler) {
                listenersByEvent.delete(eventName);
            }
        },
        emitScroll: () => {
            const handler = listenersByEvent.get('scroll');
            if (typeof handler === 'function') {
                handler();
            }
        }
    };
}

function createGuiRow(index) {
    return {
        type: 'chat',
        kind: 'chat',
        platform: 'twitch',
        username: `test-user-${index}`,
        text: `message-${index}`,
        avatarUrl: `https://example.invalid/test-avatar-${index}.png`,
        timestamp: `2024-01-01T00:00:0${index}.000Z`
    };
}

function createOverlayNodeMocks(layoutByAvatarUrl, shellClientHeight = 220) {
    function extractAvatarUrl(element) {
        if (!element || !element.props) {
            return '';
        }

        if (
            typeof element.type === 'string'
            && element.type === 'img'
            && typeof element.props.className === 'string'
            && element.props.className.includes('gui-row__avatar')
            && typeof element.props.src === 'string'
        ) {
            return element.props.src;
        }

        const children = Array.isArray(element.props.children)
            ? element.props.children
            : [element.props.children];
        for (const child of children) {
            const childAvatarUrl = extractAvatarUrl(child);
            if (childAvatarUrl) {
                return childAvatarUrl;
            }
        }

        return '';
    }

    const shell = {
        clientHeight: shellClientHeight,
        getBoundingClientRect: () => ({ top: 0 })
    };

    return {
        shell,
        createNodeMock: (element) => {
            if (element.type === 'main') {
                return shell;
            }

            const avatarUrl = extractAvatarUrl(element);
            const layout = layoutByAvatarUrl[avatarUrl] || { offsetTop: 0, offsetHeight: 24 };

            return {
                style: {
                    transition: '',
                    transform: ''
                },
                get offsetTop() {
                    return layout.offsetTop;
                },
                get offsetHeight() {
                    return layout.offsetHeight;
                },
                getBoundingClientRect: () => ({ top: layout.offsetTop })
            };
        }
    };
}

function findOverlayExitNodes(renderer) {
    return renderer.root.findAll((node) => {
        if (node.type !== 'div') {
            return false;
        }

        const className = typeof node.props.className === 'string' ? node.props.className : '';
        return className.includes('gui-row--overlay-exit');
    });
}

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

    it('applies dock scroll container style contract', () => {
        const html = renderToStaticMarkup(
            React.createElement(GuiShell, {
                mode: 'dock',
                overlayMaxLinesPerMessage: 3,
                rows: []
            })
        );

        expect(html).toContain('gui-shell--dock');
        expect(html).toContain('height:100vh');
        expect(html).toContain('overflow-y:auto');
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

    it('handles overlay row refs across mount and unmount lifecycle', async () => {
        const previousTimeStamp = console.timeStamp;
        console.timeStamp = previousTimeStamp || (() => {});
        let renderer;

        try {
            await TestRenderer.act(async () => {
                renderer = TestRenderer.create(
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
                    }),
                    {
                        createNodeMock: () => ({
                            style: {
                                transition: '',
                                transform: ''
                            },
                            offsetHeight: 24,
                            getBoundingClientRect: () => ({ top: 100 })
                        })
                    }
                );
            });

            expect(renderer.toJSON()).not.toBeNull();

            await TestRenderer.act(async () => {
                renderer.unmount();
            });
        } finally {
            if (previousTimeStamp) {
                console.timeStamp = previousTimeStamp;
            } else {
                delete console.timeStamp;
            }
        }
    });

    it('keeps clipped top overlay row rendered in an exit layer until exit animation ends', async () => {
        const previousTimeStamp = console.timeStamp;
        console.timeStamp = previousTimeStamp || (() => {});

        let renderer;
        const layoutByAvatarUrl = {
            'https://example.invalid/test-avatar-1.png': { offsetTop: -18, offsetHeight: 60 },
            'https://example.invalid/test-avatar-2.png': { offsetTop: 52, offsetHeight: 60 },
            'https://example.invalid/test-avatar-3.png': { offsetTop: 122, offsetHeight: 60 }
        };
        const overlayNodeMocks = createOverlayNodeMocks(layoutByAvatarUrl, 220);

        try {
            await TestRenderer.act(async () => {
                renderer = TestRenderer.create(
                    React.createElement(GuiShell, {
                        mode: 'overlay',
                        overlayMaxLinesPerMessage: 3,
                        rows: [createGuiRow(1), createGuiRow(2), createGuiRow(3)]
                    }),
                    {
                        createNodeMock: overlayNodeMocks.createNodeMock
                    }
                );
            });

            let rendered = JSON.stringify(renderer.toJSON());
            expect(rendered).toContain('test-user-1');
            expect(rendered).toContain('test-user-2');
            expect(rendered).toContain('test-user-3');

            const exitNodes = findOverlayExitNodes(renderer);
            expect(exitNodes.length).toBe(1);

            await TestRenderer.act(async () => {
                exitNodes[0].props.onAnimationEnd({ animationName: 'gui-overlay-row-exit' });
            });

            rendered = JSON.stringify(renderer.toJSON());
            expect(rendered).not.toContain('test-user-1');
            expect(rendered).toContain('test-user-2');
            expect(rendered).toContain('test-user-3');
        } finally {
            if (renderer) {
                await TestRenderer.act(async () => {
                    renderer.unmount();
                });
            }

            if (previousTimeStamp) {
                console.timeStamp = previousTimeStamp;
            } else {
                delete console.timeStamp;
            }
        }
    });

    it('keeps all overlay rows when every row fully fits the shell height', async () => {
        const previousTimeStamp = console.timeStamp;
        console.timeStamp = previousTimeStamp || (() => {});

        let renderer;
        const layoutByAvatarUrl = {
            'https://example.invalid/test-avatar-1.png': { offsetTop: 20, offsetHeight: 50 },
            'https://example.invalid/test-avatar-2.png': { offsetTop: 80, offsetHeight: 50 },
            'https://example.invalid/test-avatar-3.png': { offsetTop: 140, offsetHeight: 50 }
        };
        const overlayNodeMocks = createOverlayNodeMocks(layoutByAvatarUrl, 220);

        try {
            await TestRenderer.act(async () => {
                renderer = TestRenderer.create(
                    React.createElement(GuiShell, {
                        mode: 'overlay',
                        overlayMaxLinesPerMessage: 3,
                        rows: [createGuiRow(1), createGuiRow(2), createGuiRow(3)]
                    }),
                    {
                        createNodeMock: overlayNodeMocks.createNodeMock
                    }
                );
            });

            const rendered = JSON.stringify(renderer.toJSON());
            expect(rendered).toContain('test-user-1');
            expect(rendered).toContain('test-user-2');
            expect(rendered).toContain('test-user-3');
        } finally {
            if (renderer) {
                await TestRenderer.act(async () => {
                    renderer.unmount();
                });
            }

            if (previousTimeStamp) {
                console.timeStamp = previousTimeStamp;
            } else {
                delete console.timeStamp;
            }
        }
    });

    it('recomputes overlay row visibility after window resize', async () => {
        const previousTimeStamp = console.timeStamp;
        const previousWindow = global.window;
        console.timeStamp = previousTimeStamp || (() => {});

        let renderer;
        const resizeListeners = new Set();
        global.window = {
            addEventListener: (eventName, handler) => {
                if (eventName === 'resize') {
                    resizeListeners.add(handler);
                }
            },
            removeEventListener: (eventName, handler) => {
                if (eventName === 'resize') {
                    resizeListeners.delete(handler);
                }
            }
        };

        const layoutByAvatarUrl = {
            'https://example.invalid/test-avatar-1.png': { offsetTop: 20, offsetHeight: 50 },
            'https://example.invalid/test-avatar-2.png': { offsetTop: 80, offsetHeight: 50 },
            'https://example.invalid/test-avatar-3.png': { offsetTop: 140, offsetHeight: 50 }
        };
        const overlayNodeMocks = createOverlayNodeMocks(layoutByAvatarUrl, 220);

        try {
            await TestRenderer.act(async () => {
                renderer = TestRenderer.create(
                    React.createElement(GuiShell, {
                        mode: 'overlay',
                        overlayMaxLinesPerMessage: 3,
                        rows: [createGuiRow(1), createGuiRow(2), createGuiRow(3)]
                    }),
                    {
                        createNodeMock: overlayNodeMocks.createNodeMock
                    }
                );
            });

            let rendered = JSON.stringify(renderer.toJSON());
            expect(rendered).toContain('test-user-1');

            layoutByAvatarUrl['https://example.invalid/test-avatar-1.png'].offsetTop = -16;

            await TestRenderer.act(async () => {
                for (const listener of resizeListeners) {
                    listener();
                }
            });

            rendered = JSON.stringify(renderer.toJSON());
            expect(rendered).toContain('test-user-1');
            expect(rendered).toContain('test-user-2');
            expect(rendered).toContain('test-user-3');
            expect(findOverlayExitNodes(renderer).length).toBeGreaterThanOrEqual(1);
        } finally {
            if (renderer) {
                await TestRenderer.act(async () => {
                    renderer.unmount();
                });
            }

            if (previousWindow !== undefined) {
                global.window = previousWindow;
            } else {
                delete global.window;
            }

            if (previousTimeStamp) {
                console.timeStamp = previousTimeStamp;
            } else {
                delete console.timeStamp;
            }
        }
    });

    it('keeps an evicted top row in overlay exit layer until animation ends', async () => {
        const previousTimeStamp = console.timeStamp;
        console.timeStamp = previousTimeStamp || (() => {});

        let renderer;
        const layoutByAvatarUrl = {
            'https://example.invalid/test-avatar-1.png': { offsetTop: 18, offsetHeight: 50 },
            'https://example.invalid/test-avatar-2.png': { offsetTop: 78, offsetHeight: 50 },
            'https://example.invalid/test-avatar-3.png': { offsetTop: 138, offsetHeight: 50 },
            'https://example.invalid/test-avatar-4.png': { offsetTop: 138, offsetHeight: 50 }
        };
        const overlayNodeMocks = createOverlayNodeMocks(layoutByAvatarUrl, 220);

        try {
            await TestRenderer.act(async () => {
                renderer = TestRenderer.create(
                    React.createElement(GuiShell, {
                        mode: 'overlay',
                        overlayMaxLinesPerMessage: 3,
                        rows: [createGuiRow(1), createGuiRow(2), createGuiRow(3)]
                    }),
                    {
                        createNodeMock: overlayNodeMocks.createNodeMock
                    }
                );
            });

            let rendered = JSON.stringify(renderer.toJSON());
            expect(rendered).toContain('test-user-1');
            expect(rendered).toContain('test-user-2');
            expect(rendered).toContain('test-user-3');

            await TestRenderer.act(async () => {
                renderer.update(
                    React.createElement(GuiShell, {
                        mode: 'overlay',
                        overlayMaxLinesPerMessage: 3,
                        rows: [createGuiRow(2), createGuiRow(3), createGuiRow(4)]
                    })
                );
            });

            rendered = JSON.stringify(renderer.toJSON());
            expect(rendered).toContain('test-user-1');
            expect(rendered).toContain('test-user-2');
            expect(rendered).toContain('test-user-3');
            expect(rendered).toContain('test-user-4');
            expect(findOverlayExitNodes(renderer).length).toBeGreaterThanOrEqual(1);

            const exitNodes = findOverlayExitNodes(renderer);
            await TestRenderer.act(async () => {
                for (const exitNode of exitNodes) {
                    exitNode.props.onAnimationEnd({ animationName: 'gui-overlay-row-exit' });
                }
            });

            rendered = JSON.stringify(renderer.toJSON());
            expect(rendered).not.toContain('test-user-1');
            expect(rendered).toContain('test-user-2');
            expect(rendered).toContain('test-user-3');
            expect(rendered).toContain('test-user-4');
        } finally {
            if (renderer) {
                await TestRenderer.act(async () => {
                    renderer.unmount();
                });
            }

            if (previousTimeStamp) {
                console.timeStamp = previousTimeStamp;
            } else {
                delete console.timeStamp;
            }
        }
    });

    it('keeps both evicted and clipped top rows in exit layer for restricted overlay height', async () => {
        const previousTimeStamp = console.timeStamp;
        console.timeStamp = previousTimeStamp || (() => {});

        let renderer;
        const layoutByAvatarUrl = {
            'https://example.invalid/test-avatar-1.png': { offsetTop: 4, offsetHeight: 40 },
            'https://example.invalid/test-avatar-2.png': { offsetTop: 52, offsetHeight: 40 },
            'https://example.invalid/test-avatar-3.png': { offsetTop: 100, offsetHeight: 80 },
            'https://example.invalid/test-avatar-4.png': { offsetTop: 132, offsetHeight: 80 }
        };
        const overlayNodeMocks = createOverlayNodeMocks(layoutByAvatarUrl, 220);

        try {
            await TestRenderer.act(async () => {
                renderer = TestRenderer.create(
                    React.createElement(GuiShell, {
                        mode: 'overlay',
                        overlayMaxLinesPerMessage: 3,
                        rows: [createGuiRow(1), createGuiRow(2), createGuiRow(3)]
                    }),
                    {
                        createNodeMock: overlayNodeMocks.createNodeMock
                    }
                );
            });

            layoutByAvatarUrl['https://example.invalid/test-avatar-2.png'].offsetTop = -8;

            await TestRenderer.act(async () => {
                renderer.update(
                    React.createElement(GuiShell, {
                        mode: 'overlay',
                        overlayMaxLinesPerMessage: 3,
                        rows: [createGuiRow(2), createGuiRow(3), createGuiRow(4)]
                    })
                );
            });

            const exitNodes = findOverlayExitNodes(renderer);
            expect(exitNodes.length).toBeGreaterThanOrEqual(2);

            await TestRenderer.act(async () => {
                for (const exitNode of exitNodes) {
                    exitNode.props.onAnimationEnd({ animationName: 'gui-overlay-row-exit' });
                }
            });

            const rendered = JSON.stringify(renderer.toJSON());
            expect(rendered).not.toContain('test-user-1');
            expect(rendered).not.toContain('test-user-2');
            expect(rendered).toContain('test-user-3');
            expect(rendered).toContain('test-user-4');
        } finally {
            if (renderer) {
                await TestRenderer.act(async () => {
                    renderer.unmount();
                });
            }

            if (previousTimeStamp) {
                console.timeStamp = previousTimeStamp;
            } else {
                delete console.timeStamp;
            }
        }
    });

    it('does not render overlay exit rows in dock mode', async () => {
        const previousTimeStamp = console.timeStamp;
        console.timeStamp = previousTimeStamp || (() => {});
        let renderer;

        try {
            await TestRenderer.act(async () => {
                renderer = TestRenderer.create(
                    React.createElement(GuiShell, {
                        mode: 'dock',
                        overlayMaxLinesPerMessage: 3,
                        rows: [createGuiRow(1), createGuiRow(2), createGuiRow(3)]
                    }),
                    {
                        createNodeMock: (element) => {
                            if (element.type === 'main') {
                                return createDockShellMock();
                            }

                            return {
                                style: {
                                    transition: '',
                                    transform: ''
                                },
                                offsetHeight: 24,
                                getBoundingClientRect: () => ({ top: 100 })
                            };
                        }
                    }
                );
            });

            expect(findOverlayExitNodes(renderer).length).toBe(0);
        } finally {
            if (renderer) {
                await TestRenderer.act(async () => {
                    renderer.unmount();
                });
            }

            if (previousTimeStamp) {
                console.timeStamp = previousTimeStamp;
            } else {
                delete console.timeStamp;
            }
        }
    });

    it('auto-scrolls dock shell to latest rows when messages update', async () => {
        const previousTimeStamp = console.timeStamp;
        console.timeStamp = previousTimeStamp || (() => {});
        let renderer;
        const dockShell = createDockShellMock();

        try {
            await TestRenderer.act(async () => {
                renderer = TestRenderer.create(
                    React.createElement(GuiShell, {
                        mode: 'dock',
                        overlayMaxLinesPerMessage: 3,
                        rows: [
                            {
                                type: 'chat',
                                kind: 'chat',
                                platform: 'twitch',
                                username: 'test-user',
                                text: 'first message',
                                avatarUrl: 'https://example.invalid/test-avatar.png',
                                timestamp: '2024-01-01T00:00:00.000Z'
                            }
                        ]
                    }),
                    {
                        createNodeMock: (element) => {
                            if (element.type === 'main') {
                                return dockShell;
                            }

                            return {
                                style: {
                                    transition: '',
                                    transform: ''
                                },
                                offsetHeight: 24,
                                getBoundingClientRect: () => ({ top: 100 })
                            };
                        }
                    }
                );
            });

            expect(dockShell.scrollTop).toBe(320);

            dockShell.scrollTop = 200;
            dockShell.scrollHeight = 320;
            dockShell.emitScroll();
            dockShell.scrollHeight = 640;

            await TestRenderer.act(async () => {
                renderer.update(
                    React.createElement(GuiShell, {
                        mode: 'dock',
                        overlayMaxLinesPerMessage: 3,
                        rows: [
                            {
                                type: 'chat',
                                kind: 'chat',
                                platform: 'twitch',
                                username: 'test-user',
                                text: 'first message',
                                avatarUrl: 'https://example.invalid/test-avatar.png',
                                timestamp: '2024-01-01T00:00:00.000Z'
                            },
                            {
                                type: 'chat',
                                kind: 'chat',
                                platform: 'twitch',
                                username: 'test-user-2',
                                text: 'second message',
                                avatarUrl: 'https://example.invalid/test-avatar-2.png',
                                timestamp: '2024-01-01T00:00:01.000Z'
                            }
                        ]
                    })
                );
            });

            expect(dockShell.scrollTop).toBe(640);
        } finally {
            if (renderer) {
                await TestRenderer.act(async () => {
                    renderer.unmount();
                });
            }

            if (previousTimeStamp) {
                console.timeStamp = previousTimeStamp;
            } else {
                delete console.timeStamp;
            }
        }
    });

    it('keeps dock scroll position when user is reading older rows', async () => {
        const previousTimeStamp = console.timeStamp;
        console.timeStamp = previousTimeStamp || (() => {});
        let renderer;
        const dockShell = createDockShellMock({ scrollTop: 40 });

        try {
            await TestRenderer.act(async () => {
                renderer = TestRenderer.create(
                    React.createElement(GuiShell, {
                        mode: 'dock',
                        overlayMaxLinesPerMessage: 3,
                        rows: [
                            {
                                type: 'chat',
                                kind: 'chat',
                                platform: 'twitch',
                                username: 'test-user',
                                text: 'first message',
                                avatarUrl: 'https://example.invalid/test-avatar.png',
                                timestamp: '2024-01-01T00:00:00.000Z'
                            }
                        ]
                    }),
                    {
                        createNodeMock: (element) => {
                            if (element.type === 'main') {
                                return dockShell;
                            }

                            return {
                                style: {
                                    transition: '',
                                    transform: ''
                                },
                                offsetHeight: 24,
                                getBoundingClientRect: () => ({ top: 100 })
                            };
                        }
                    }
                );
            });

            expect(dockShell.scrollTop).toBe(320);

            dockShell.scrollTop = 200;
            dockShell.scrollHeight = 320;
            dockShell.emitScroll();
            dockShell.scrollHeight = 640;

            await TestRenderer.act(async () => {
                renderer.update(
                    React.createElement(GuiShell, {
                        mode: 'dock',
                        overlayMaxLinesPerMessage: 3,
                        rows: [
                            {
                                type: 'chat',
                                kind: 'chat',
                                platform: 'twitch',
                                username: 'test-user',
                                text: 'first message',
                                avatarUrl: 'https://example.invalid/test-avatar.png',
                                timestamp: '2024-01-01T00:00:00.000Z'
                            },
                            {
                                type: 'chat',
                                kind: 'chat',
                                platform: 'twitch',
                                username: 'test-user-2',
                                text: 'second message',
                                avatarUrl: 'https://example.invalid/test-avatar-2.png',
                                timestamp: '2024-01-01T00:00:01.000Z'
                            }
                        ]
                    })
                );
            });

            expect(dockShell.scrollTop).toBe(640);

            dockShell.scrollTop = 511;
            dockShell.scrollHeight = 640;
            dockShell.emitScroll();
            dockShell.scrollHeight = 760;

            await TestRenderer.act(async () => {
                renderer.update(
                    React.createElement(GuiShell, {
                        mode: 'dock',
                        overlayMaxLinesPerMessage: 3,
                        rows: [
                            {
                                type: 'chat',
                                kind: 'chat',
                                platform: 'twitch',
                                username: 'test-user',
                                text: 'first message',
                                avatarUrl: 'https://example.invalid/test-avatar.png',
                                timestamp: '2024-01-01T00:00:00.000Z'
                            },
                            {
                                type: 'chat',
                                kind: 'chat',
                                platform: 'twitch',
                                username: 'test-user-2',
                                text: 'second message',
                                avatarUrl: 'https://example.invalid/test-avatar-2.png',
                                timestamp: '2024-01-01T00:00:01.000Z'
                            },
                            {
                                type: 'chat',
                                kind: 'chat',
                                platform: 'twitch',
                                username: 'test-user-3',
                                text: 'third message',
                                avatarUrl: 'https://example.invalid/test-avatar-3.png',
                                timestamp: '2024-01-01T00:00:02.000Z'
                            }
                        ]
                    })
                );
            });

            expect(dockShell.scrollTop).toBe(511);
        } finally {
            if (renderer) {
                await TestRenderer.act(async () => {
                    renderer.unmount();
                });
            }

            if (previousTimeStamp) {
                console.timeStamp = previousTimeStamp;
            } else {
                delete console.timeStamp;
            }
        }
    });

    it('pins dock when user is within 8px of the bottom', async () => {
        const previousTimeStamp = console.timeStamp;
        console.timeStamp = previousTimeStamp || (() => {});
        let renderer;
        const dockShell = createDockShellMock();

        try {
            await TestRenderer.act(async () => {
                renderer = TestRenderer.create(
                    React.createElement(GuiShell, {
                        mode: 'dock',
                        overlayMaxLinesPerMessage: 3,
                        rows: [
                            {
                                type: 'chat',
                                kind: 'chat',
                                platform: 'twitch',
                                username: 'test-user',
                                text: 'first message',
                                avatarUrl: 'https://example.invalid/test-avatar.png',
                                timestamp: '2024-01-01T00:00:00.000Z'
                            }
                        ]
                    }),
                    {
                        createNodeMock: (element) => {
                            if (element.type === 'main') {
                                return dockShell;
                            }

                            return {
                                style: {
                                    transition: '',
                                    transform: ''
                                },
                                offsetHeight: 24,
                                getBoundingClientRect: () => ({ top: 100 })
                            };
                        }
                    }
                );
            });

            expect(dockShell.scrollTop).toBe(320);

            dockShell.scrollTop = 200;
            dockShell.scrollHeight = 320;
            dockShell.emitScroll();
            dockShell.scrollHeight = 640;

            await TestRenderer.act(async () => {
                renderer.update(
                    React.createElement(GuiShell, {
                        mode: 'dock',
                        overlayMaxLinesPerMessage: 3,
                        rows: [
                            {
                                type: 'chat',
                                kind: 'chat',
                                platform: 'twitch',
                                username: 'test-user',
                                text: 'first message',
                                avatarUrl: 'https://example.invalid/test-avatar.png',
                                timestamp: '2024-01-01T00:00:00.000Z'
                            },
                            {
                                type: 'chat',
                                kind: 'chat',
                                platform: 'twitch',
                                username: 'test-user-2',
                                text: 'second message',
                                avatarUrl: 'https://example.invalid/test-avatar-2.png',
                                timestamp: '2024-01-01T00:00:01.000Z'
                            }
                        ]
                    })
                );
            });

            expect(dockShell.scrollTop).toBe(640);

            dockShell.scrollTop = 512;
            dockShell.scrollHeight = 640;
            dockShell.emitScroll();
            dockShell.scrollHeight = 760;

            await TestRenderer.act(async () => {
                renderer.update(
                    React.createElement(GuiShell, {
                        mode: 'dock',
                        overlayMaxLinesPerMessage: 3,
                        rows: [
                            {
                                type: 'chat',
                                kind: 'chat',
                                platform: 'twitch',
                                username: 'test-user',
                                text: 'first message',
                                avatarUrl: 'https://example.invalid/test-avatar.png',
                                timestamp: '2024-01-01T00:00:00.000Z'
                            },
                            {
                                type: 'chat',
                                kind: 'chat',
                                platform: 'twitch',
                                username: 'test-user-2',
                                text: 'second message',
                                avatarUrl: 'https://example.invalid/test-avatar-2.png',
                                timestamp: '2024-01-01T00:00:01.000Z'
                            },
                            {
                                type: 'chat',
                                kind: 'chat',
                                platform: 'twitch',
                                username: 'test-user-3',
                                text: 'third message',
                                avatarUrl: 'https://example.invalid/test-avatar-3.png',
                                timestamp: '2024-01-01T00:00:02.000Z'
                            }
                        ]
                    })
                );
            });

            expect(dockShell.scrollTop).toBe(760);
        } finally {
            if (renderer) {
                await TestRenderer.act(async () => {
                    renderer.unmount();
                });
            }

            if (previousTimeStamp) {
                console.timeStamp = previousTimeStamp;
            } else {
                delete console.timeStamp;
            }
        }
    });

    it('pins dock shell to bottom again on animation frame when dock is pinned', async () => {
        const previousTimeStamp = console.timeStamp;
        const previousRequestAnimationFrame = global.requestAnimationFrame;
        console.timeStamp = previousTimeStamp || (() => {});

        const dockShell = createDockShellMock({ clientHeight: 200, scrollHeight: 200 });
        let rafCalls = 0;
        let renderer;

        global.requestAnimationFrame = (callback) => {
            rafCalls += 1;
            dockShell.scrollHeight = 420;
            callback();
            return 1;
        };

        try {
            await TestRenderer.act(async () => {
                renderer = TestRenderer.create(
                    React.createElement(GuiShell, {
                        mode: 'dock',
                        overlayMaxLinesPerMessage: 3,
                        rows: []
                    }),
                    {
                        createNodeMock: (element) => {
                            if (element.type === 'main') {
                                return dockShell;
                            }

                            return {
                                style: {
                                    transition: '',
                                    transform: ''
                                },
                                offsetHeight: 24,
                                getBoundingClientRect: () => ({ top: 100 })
                            };
                        }
                    }
                );
            });

            expect(rafCalls).toBeGreaterThan(0);
            expect(dockShell.scrollTop).toBe(420);
        } finally {
            if (renderer) {
                await TestRenderer.act(async () => {
                    renderer.unmount();
                });
            }

            if (typeof previousRequestAnimationFrame === 'function') {
                global.requestAnimationFrame = previousRequestAnimationFrame;
            } else {
                delete global.requestAnimationFrame;
            }

            if (previousTimeStamp) {
                console.timeStamp = previousTimeStamp;
            } else {
                delete console.timeStamp;
            }
        }
    });

    it('keeps dock position when unpinned as new rows arrive', async () => {
        const previousTimeStamp = console.timeStamp;
        const previousRequestAnimationFrame = global.requestAnimationFrame;
        console.timeStamp = previousTimeStamp || (() => {});

        const dockShell = createDockShellMock();
        let renderer;

        global.requestAnimationFrame = (callback) => {
            dockShell.scrollHeight += 100;
            callback();
            return 1;
        };

        try {
            await TestRenderer.act(async () => {
                renderer = TestRenderer.create(
                    React.createElement(GuiShell, {
                        mode: 'dock',
                        overlayMaxLinesPerMessage: 3,
                        rows: [
                            {
                                type: 'chat',
                                kind: 'chat',
                                platform: 'twitch',
                                username: 'test-user',
                                text: 'first message',
                                avatarUrl: 'https://example.invalid/test-avatar.png',
                                timestamp: '2024-01-01T00:00:00.000Z'
                            }
                        ]
                    }),
                    {
                        createNodeMock: (element) => {
                            if (element.type === 'main') {
                                return dockShell;
                            }

                            return {
                                style: {
                                    transition: '',
                                    transform: ''
                                },
                                offsetHeight: 24,
                                getBoundingClientRect: () => ({ top: 100 })
                            };
                        }
                    }
                );
            });

            dockShell.scrollTop = 80;
            dockShell.scrollHeight = 320;
            dockShell.emitScroll();
            dockShell.scrollHeight = 480;

            await TestRenderer.act(async () => {
                renderer.update(
                    React.createElement(GuiShell, {
                        mode: 'dock',
                        overlayMaxLinesPerMessage: 3,
                        rows: [
                            {
                                type: 'chat',
                                kind: 'chat',
                                platform: 'twitch',
                                username: 'test-user',
                                text: 'first message',
                                avatarUrl: 'https://example.invalid/test-avatar.png',
                                timestamp: '2024-01-01T00:00:00.000Z'
                            },
                            {
                                type: 'chat',
                                kind: 'chat',
                                platform: 'twitch',
                                username: 'test-user-2',
                                text: 'second message',
                                avatarUrl: 'https://example.invalid/test-avatar-2.png',
                                timestamp: '2024-01-01T00:00:01.000Z'
                            }
                        ]
                    })
                );
            });

            expect(dockShell.scrollTop).toBe(80);
        } finally {
            if (renderer) {
                await TestRenderer.act(async () => {
                    renderer.unmount();
                });
            }

            if (typeof previousRequestAnimationFrame === 'function') {
                global.requestAnimationFrame = previousRequestAnimationFrame;
            } else {
                delete global.requestAnimationFrame;
            }

            if (previousTimeStamp) {
                console.timeStamp = previousTimeStamp;
            } else {
                delete console.timeStamp;
            }
        }
    });

    it('keeps dock pinned when geometry drifts after a pinned scroll event', async () => {
        const previousTimeStamp = console.timeStamp;
        console.timeStamp = previousTimeStamp || (() => {});
        let renderer;
        const dockShell = createDockShellMock();

        try {
            await TestRenderer.act(async () => {
                renderer = TestRenderer.create(
                    React.createElement(GuiShell, {
                        mode: 'dock',
                        overlayMaxLinesPerMessage: 3,
                        rows: [
                            {
                                type: 'chat',
                                kind: 'chat',
                                platform: 'twitch',
                                username: 'test-user',
                                text: 'first message',
                                avatarUrl: 'https://example.invalid/test-avatar.png',
                                timestamp: '2024-01-01T00:00:00.000Z'
                            }
                        ]
                    }),
                    {
                        createNodeMock: (element) => {
                            if (element.type === 'main') {
                                return dockShell;
                            }

                            return {
                                style: {
                                    transition: '',
                                    transform: ''
                                },
                                offsetHeight: 24,
                                getBoundingClientRect: () => ({ top: 100 })
                            };
                        }
                    }
                );
            });

            expect(dockShell.scrollTop).toBe(320);

            dockShell.scrollTop = 200;
            dockShell.scrollHeight = 320;
            dockShell.emitScroll();

            dockShell.scrollTop = 50;
            dockShell.scrollHeight = 640;

            await TestRenderer.act(async () => {
                renderer.update(
                    React.createElement(GuiShell, {
                        mode: 'dock',
                        overlayMaxLinesPerMessage: 3,
                        rows: [
                            {
                                type: 'chat',
                                kind: 'chat',
                                platform: 'twitch',
                                username: 'test-user',
                                text: 'first message',
                                avatarUrl: 'https://example.invalid/test-avatar.png',
                                timestamp: '2024-01-01T00:00:00.000Z'
                            },
                            {
                                type: 'chat',
                                kind: 'chat',
                                platform: 'twitch',
                                username: 'test-user-2',
                                text: 'second message',
                                avatarUrl: 'https://example.invalid/test-avatar-2.png',
                                timestamp: '2024-01-01T00:00:01.000Z'
                            }
                        ]
                    })
                );
            });

            expect(dockShell.scrollTop).toBe(640);
        } finally {
            if (renderer) {
                await TestRenderer.act(async () => {
                    renderer.unmount();
                });
            }

            if (previousTimeStamp) {
                console.timeStamp = previousTimeStamp;
            } else {
                delete console.timeStamp;
            }
        }
    });

});
