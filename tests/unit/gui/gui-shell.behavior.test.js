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
