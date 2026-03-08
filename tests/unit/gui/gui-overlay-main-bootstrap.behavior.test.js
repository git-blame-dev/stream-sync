const { describe, it, expect } = require('bun:test');

const { bootstrapOverlayApp } = require('../../../gui/src/overlay/main');

function createTarget() {
    const attributes = {};
    return {
        textContent: '',
        setAttribute(name, value) {
            attributes[name] = value;
        },
        getAttribute(name) {
            return attributes[name] || null;
        }
    };
}

describe('Overlay main bootstrap behavior', () => {
    it('renders overlay app when runtime config is valid', () => {
        const target = createTarget();
        let renderedElement = null;

        const result = bootstrapOverlayApp({
            target,
            readOverlayRuntimeConfigImpl: () => ({
                overlayMaxMessages: 5,
                overlayMaxLinesPerMessage: 4
            }),
            createRootImpl: () => ({
                render: (element) => {
                    renderedElement = element;
                }
            })
        });

        expect(result).toBe(true);
        expect(renderedElement.props.mode).toBe('overlay');
        expect(renderedElement.props.overlayMaxMessages).toBe(5);
        expect(renderedElement.props.overlayMaxLinesPerMessage).toBe(4);
    });

    it('returns false when no target is available', () => {
        const result = bootstrapOverlayApp({ target: null });
        expect(result).toBe(false);
    });

    it('writes explicit bootstrap error into target when config parsing fails', () => {
        const target = createTarget();

        const result = bootstrapOverlayApp({
            target,
            readOverlayRuntimeConfigImpl: () => {
                throw new Error('bad runtime config');
            },
            createRootImpl: () => ({
                render: () => {}
            })
        });

        expect(result).toBe(false);
        expect(target.getAttribute('data-gui-bootstrap-error')).toBe('true');
        expect(target.textContent).toContain('Overlay failed to load: bad runtime config');
    });
});
