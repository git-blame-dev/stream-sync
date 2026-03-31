const { describe, it, expect, beforeEach } = require('bun:test');
const React = require('react');
const TestRenderer = require('react-test-renderer');

const { GiftAnimationLayer } = require('../../../gui/src/shared/components/GiftAnimationLayer');
const { createMockFn } = require('../../helpers/bun-mock-utils');

function createEffect(overrides: Record<string, any> = {}) {
    const baseConfig = {
        profileName: 'portrait',
        sourceWidth: 960,
        sourceHeight: 864,
        renderWidth: 480,
        renderHeight: 854,
        rgbFrame: [0, 0, 480, 854],
        aFrame: [480, 0, 480, 854]
    };

    return {
        __guiEvent: 'effect',
        effectType: 'tiktok-gift-animation',
        playbackId: 'test-playback-id',
        durationMs: 2400,
        assetUrl: '/gui/runtime/test.mp4',
        ...overrides,
        config: {
            ...baseConfig,
            ...(overrides.config || {})
        }
    };
}

function createCanvasContext(overrides: Record<string, any> = {}) {
    return {
        clearRect: createMockFn(),
        drawImage: createMockFn(),
        getImageData: createMockFn(() => ({ data: new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]) })),
        createImageData: createMockFn((width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) })),
        putImageData: createMockFn(),
        ...overrides
    };
}

type VideoNode = {
    readyState: number;
    paused: boolean;
    ended: boolean;
    currentTime: number;
    muted: boolean;
    playsInline: boolean;
    src: string;
    onended: (() => void) | null;
    onerror: (() => void) | null;
    onloadeddata: (() => void) | null;
    play: ReturnType<typeof createMockFn>;
    pause: ReturnType<typeof createMockFn>;
    removeAttribute: ReturnType<typeof createMockFn>;
    load: ReturnType<typeof createMockFn>;
};

function createVideoNode(): VideoNode {
    return {
        readyState: 2,
        paused: false,
        ended: false,
        currentTime: 0,
        muted: false,
        playsInline: false,
        src: '',
        onended: null,
        onerror: null,
        onloadeddata: null,
        play: createMockFn().mockResolvedValue(undefined),
        pause: createMockFn(),
        removeAttribute: createMockFn(),
        load: createMockFn()
    };
}

function createCanvasNode(context: any) {
    return {
        width: 0,
        height: 0,
        getContext: () => context
    };
}

function installDomRuntime(options: { createElement?: (tagName: string) => any } = {}) {
    const previousWindow = global.window;
    const previousDocument = global.document;
    const previousHtmlMediaElement = global.HTMLMediaElement;
    const previousTimeStamp = console.timeStamp;
    const rafCallbacks: FrameRequestCallback[] = [];
    const timeoutCallbacks: Array<() => void> = [];

    const windowMock = {
        requestAnimationFrame: (callback: FrameRequestCallback) => {
            rafCallbacks.push(callback);
            return rafCallbacks.length;
        },
        cancelAnimationFrame: createMockFn(),
        setTimeout: (callback: () => void) => {
            timeoutCallbacks.push(callback);
            return timeoutCallbacks.length;
        },
        clearTimeout: createMockFn()
    };

    global.window = windowMock as unknown as Window & typeof globalThis;
    global.document = ({
        createElement: options.createElement || ((tagName: string) => {
            if (tagName === 'canvas') {
                return createCanvasNode(createCanvasContext());
            }

            return {};
        })
    }) as unknown as Document;
    global.HTMLMediaElement = { HAVE_CURRENT_DATA: 2 } as unknown as typeof HTMLMediaElement;
    console.timeStamp = previousTimeStamp || (() => {});

    return {
        windowMock,
        runNextAnimationFrame() {
            const callback = rafCallbacks.shift();
            if (typeof callback === 'function') {
                callback(0);
            }
        },
        runLatestTimeout() {
            const callback = timeoutCallbacks[timeoutCallbacks.length - 1];
            if (typeof callback === 'function') {
                callback();
            }
        },
        restore() {
            if (previousWindow !== undefined) {
                global.window = previousWindow;
            } else {
                Reflect.deleteProperty(global, 'window');
            }

            if (previousDocument !== undefined) {
                global.document = previousDocument;
            } else {
                Reflect.deleteProperty(global, 'document');
            }

            if (previousHtmlMediaElement !== undefined) {
                global.HTMLMediaElement = previousHtmlMediaElement;
            } else {
                Reflect.deleteProperty(global, 'HTMLMediaElement');
            }

            if (previousTimeStamp) {
                console.timeStamp = previousTimeStamp;
            } else {
                Reflect.deleteProperty(console, 'timeStamp');
            }
        }
    };
}

describe('GiftAnimationLayer behavior', () => {
    beforeEach(() => {
        global.console.timeStamp = global.console.timeStamp || (() => {});
    });

    it('renders nothing when no effect is active', async () => {
        let renderer: any = null;

        await TestRenderer.act(async () => {
            renderer = TestRenderer.create(
                React.createElement(GiftAnimationLayer, {
                    effect: null,
                    onComplete: () => {}
                })
            );
        });

        expect(renderer.toJSON()).toBeNull();

        await TestRenderer.act(async () => {
            renderer.unmount();
        });
    });

    it('completes immediately when canvas context is unavailable', async () => {
        const harness = installDomRuntime({
            createElement: (tagName: string) => {
                if (tagName === 'canvas') {
                    return createCanvasNode(createCanvasContext());
                }

                return {};
            }
        });
        const onCompleteCalls: string[] = [];
        const videoNode = createVideoNode();
        let renderer: any = null;

        try {
            await TestRenderer.act(async () => {
                renderer = TestRenderer.create(
                    React.createElement(GiftAnimationLayer, {
                        effect: createEffect(),
                        onComplete: (playbackId: string) => onCompleteCalls.push(playbackId)
                    }),
                    {
                        createNodeMock: (element: any) => {
                            if (element.type === 'video') {
                                return videoNode;
                            }

                            if (element.type === 'canvas') {
                                return createCanvasNode(null);
                            }

                            return {};
                        }
                    }
                );
            });

            expect(onCompleteCalls).toEqual(['test-playback-id']);
        } finally {
            if (renderer) {
                await TestRenderer.act(async () => {
                    renderer.unmount();
                });
            }
            harness.restore();
        }
    });

    it('renders RGB-only frames and completes on video end when alpha metadata is absent', async () => {
        const harness = installDomRuntime({
            createElement: (tagName: string) => {
                if (tagName === 'canvas') {
                    return createCanvasNode(createCanvasContext());
                }

                return {};
            }
        });
        const onCompleteCalls: string[] = [];
        const canvasContext = createCanvasContext();
        const videoNode = createVideoNode();
        let renderer: any = null;

        try {
            await TestRenderer.act(async () => {
                renderer = TestRenderer.create(
                    React.createElement(GiftAnimationLayer, {
                        effect: createEffect({
                            config: {
                                aFrame: null
                            }
                        }),
                        onComplete: (playbackId: string) => onCompleteCalls.push(playbackId)
                    }),
                    {
                        createNodeMock: (element: any) => {
                            if (element.type === 'video') {
                                return videoNode;
                            }

                            if (element.type === 'canvas') {
                                return createCanvasNode(canvasContext);
                            }

                            return {};
                        }
                    }
                );
            });

            await TestRenderer.act(async () => {
                videoNode.onloadeddata!();
            });

            await TestRenderer.act(async () => {
                harness.runNextAnimationFrame();
            });

            expect(onCompleteCalls).toHaveLength(0);
            expect(canvasContext.drawImage.mock.calls.length).toBeGreaterThan(0);

            await TestRenderer.act(async () => {
                videoNode.onended!();
            });

            expect(onCompleteCalls).toEqual(['test-playback-id']);
        } finally {
            if (renderer) {
                await TestRenderer.act(async () => {
                    renderer.unmount();
                });
            }
            harness.restore();
        }
    });

    it('composites alpha frames, ignores stale completions, and completes active playback from timeout', async () => {
        const rgbBufferContext = createCanvasContext({
            getImageData: createMockFn(() => ({ data: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]) }))
        });
        const alphaBufferContext = createCanvasContext({
            getImageData: createMockFn(() => ({ data: new Uint8ClampedArray([7, 0, 0, 255, 8, 0, 0, 255]) }))
        });
        let createdCanvasCount = 0;
        const harness = installDomRuntime({
            createElement: (tagName: string) => {
                if (tagName !== 'canvas') {
                    return {};
                }

                createdCanvasCount += 1;
                return createdCanvasCount === 1
                    ? createCanvasNode(rgbBufferContext)
                    : createCanvasNode(alphaBufferContext);
            }
        });
        const onCompleteCalls: string[] = [];
        const videoNode = createVideoNode();
        const canvasContext = createCanvasContext({
            drawImage: createMockFn(),
            clearRect: createMockFn()
        });
        let renderer: any = null;
        let staleOnEnded: (() => void) | null = null;

        try {
            await TestRenderer.act(async () => {
                renderer = TestRenderer.create(
                    React.createElement(GiftAnimationLayer, {
                        effect: createEffect({
                            config: {
                                sourceWidth: 4,
                                sourceHeight: 1,
                                renderWidth: 2,
                                renderHeight: 1,
                                rgbFrame: [0, 0, 2, 1],
                                aFrame: [2, 0, 2, 1]
                            }
                        }),
                        onComplete: (playbackId: string) => onCompleteCalls.push(playbackId)
                    }),
                    {
                        createNodeMock: (element: any) => {
                            if (element.type === 'video') {
                                return videoNode;
                            }

                            if (element.type === 'canvas') {
                                return createCanvasNode(canvasContext);
                            }

                            return {};
                        }
                    }
                );
            });

            await TestRenderer.act(async () => {
                videoNode.onloadeddata!();
            });

            await TestRenderer.act(async () => {
                harness.runNextAnimationFrame();
            });

            staleOnEnded = videoNode.onended;

            await TestRenderer.act(async () => {
                renderer.update(
                    React.createElement(GiftAnimationLayer, {
                        effect: createEffect({
                            playbackId: 'test-playback-id-2'
                        }),
                        onComplete: (playbackId: string) => onCompleteCalls.push(playbackId)
                    })
                );
            });

            await TestRenderer.act(async () => {
                staleOnEnded!();
            });

            expect(onCompleteCalls).toHaveLength(0);
            expect(rgbBufferContext.putImageData.mock.calls.length).toBeGreaterThan(0);

            await TestRenderer.act(async () => {
                harness.runLatestTimeout();
            });

            expect(onCompleteCalls).toEqual(['test-playback-id-2']);
        } finally {
            if (renderer) {
                await TestRenderer.act(async () => {
                    renderer.unmount();
                });
            }
            harness.restore();
        }
    });

    it('composites large alpha frames with full-size buffers', async () => {
        const rgbBufferContext = createCanvasContext();
        const alphaBufferContext = createCanvasContext();
        let createdCanvasCount = 0;
        const harness = installDomRuntime({
            createElement: (tagName: string) => {
                if (tagName !== 'canvas') {
                    return {};
                }

                createdCanvasCount += 1;
                return createdCanvasCount === 1
                    ? createCanvasNode(rgbBufferContext)
                    : createCanvasNode(alphaBufferContext);
            }
        });
        const videoNode = createVideoNode();
        const canvasContext = createCanvasContext();
        let renderer: any = null;

        try {
            await TestRenderer.act(async () => {
                renderer = TestRenderer.create(
                    React.createElement(GiftAnimationLayer, {
                        effect: createEffect({
                            config: {
                                sourceWidth: 1440,
                                sourceHeight: 1280,
                                renderWidth: 720,
                                renderHeight: 1280,
                                rgbFrame: [0, 0, 720, 1280],
                                aFrame: [720, 0, 720, 1280]
                            }
                        }),
                        onComplete: () => {}
                    }),
                    {
                        createNodeMock: (element: any) => {
                            if (element.type === 'video') {
                                return videoNode;
                            }

                            if (element.type === 'canvas') {
                                return createCanvasNode(canvasContext);
                            }

                            return {};
                        }
                    }
                );
            });

            await TestRenderer.act(async () => {
                videoNode.onloadeddata!();
            });

            await TestRenderer.act(async () => {
                harness.runNextAnimationFrame();
            });

            expect(alphaBufferContext.drawImage.mock.calls.length).toBeGreaterThan(0);
            expect(rgbBufferContext.putImageData.mock.calls.length).toBeGreaterThan(0);
            expect(rgbBufferContext.createImageData.mock.calls[0][0]).toBe(720);
            expect(rgbBufferContext.createImageData.mock.calls[0][1]).toBe(1280);
            expect(canvasContext.drawImage.mock.calls.length).toBeGreaterThan(0);
        } finally {
            if (renderer) {
                await TestRenderer.act(async () => {
                    renderer.unmount();
                });
            }
            harness.restore();
        }
    });

    it('does not restart active playback when only onComplete identity changes', async () => {
        const harness = installDomRuntime({
            createElement: (tagName: string) => {
                if (tagName === 'canvas') {
                    return createCanvasNode(createCanvasContext());
                }

                return {};
            }
        });
        const activeEffect = createEffect();
        const videoNode = createVideoNode();
        const canvasContext = createCanvasContext();
        let renderer: any = null;

        try {
            await TestRenderer.act(async () => {
                renderer = TestRenderer.create(
                    React.createElement(GiftAnimationLayer, {
                        effect: activeEffect,
                        onComplete: () => {}
                    }),
                    {
                        createNodeMock: (element: any) => {
                            if (element.type === 'video') {
                                return videoNode;
                            }

                            if (element.type === 'canvas') {
                                return createCanvasNode(canvasContext);
                            }

                            return {};
                        }
                    }
                );
            });

            await TestRenderer.act(async () => {
                videoNode.onloadeddata!();
            });

            const pauseCallsBeforeRerender = videoNode.pause.mock.calls.length;
            const loadCallsBeforeRerender = videoNode.load.mock.calls.length;

            await TestRenderer.act(async () => {
                renderer.update(
                    React.createElement(GiftAnimationLayer, {
                        effect: activeEffect,
                        onComplete: () => {}
                    })
                );
            });

            expect(videoNode.pause.mock.calls.length).toBe(pauseCallsBeforeRerender);
            expect(videoNode.load.mock.calls.length).toBe(loadCallsBeforeRerender);
        } finally {
            if (renderer) {
                await TestRenderer.act(async () => {
                    renderer.unmount();
                });
            }
            harness.restore();
        }
    });

    it('retries video playback when paused mid-animation', async () => {
        const harness = installDomRuntime({
            createElement: (tagName: string) => {
                if (tagName === 'canvas') {
                    return createCanvasNode(createCanvasContext());
                }

                return {};
            }
        });
        const videoNode = createVideoNode();
        const canvasContext = createCanvasContext();
        let renderer: any = null;

        try {
            await TestRenderer.act(async () => {
                renderer = TestRenderer.create(
                    React.createElement(GiftAnimationLayer, {
                        effect: createEffect(),
                        onComplete: () => {}
                    }),
                    {
                        createNodeMock: (element: any) => {
                            if (element.type === 'video') {
                                return videoNode;
                            }

                            if (element.type === 'canvas') {
                                return createCanvasNode(canvasContext);
                            }

                            return {};
                        }
                    }
                );
            });

            await TestRenderer.act(async () => {
                videoNode.onloadeddata!();
            });

            const playCallsAfterLoad = videoNode.play.mock.calls.length;
            videoNode.paused = true;

            await TestRenderer.act(async () => {
                harness.runNextAnimationFrame();
            });

            expect(videoNode.play.mock.calls.length).toBeGreaterThan(playCallsAfterLoad);
        } finally {
            if (renderer) {
                await TestRenderer.act(async () => {
                    renderer.unmount();
                });
            }
            harness.restore();
        }
    });
});
