const { describe, it, expect } = require('bun:test');

const { bootstrapDockApp, readDockRuntimeConfig } = require('../../../gui/src/dock/main');

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

describe('Dock main bootstrap behavior', () => {
    it('reads compare mode from runtime config using explicit true value only', () => {
        expect(readDockRuntimeConfig({
            __STREAM_SYNC_GUI_CONFIG__: {
                uiCompareMode: true
            }
        })).toEqual({ uiCompareMode: true });

        expect(readDockRuntimeConfig({
            __STREAM_SYNC_GUI_CONFIG__: {
                uiCompareMode: 'true'
            }
        })).toEqual({ uiCompareMode: false });

        expect(readDockRuntimeConfig({})).toEqual({ uiCompareMode: false });
    });

    it('renders dock app with runtime compare mode config', () => {
        const target = createTarget();
        let renderedElement = null;

        const result = bootstrapDockApp({
            target,
            readDockRuntimeConfigImpl: () => ({
                uiCompareMode: true
            }),
            createRootImpl: () => ({
                render: (element) => {
                    renderedElement = element;
                }
            })
        });

        expect(result).toBe(true);
        expect(renderedElement.props.mode).toBe('dock');
        expect(renderedElement.props.uiCompareMode).toBe(true);
    });

    it('returns false when no target is available', () => {
        const result = bootstrapDockApp({ target: null });
        expect(result).toBe(false);
    });

    it('writes bootstrap error into target when runtime parsing fails', () => {
        const target = createTarget();

        const result = bootstrapDockApp({
            target,
            readDockRuntimeConfigImpl: () => {
                throw new Error('bad dock runtime config');
            },
            createRootImpl: () => ({
                render: () => {}
            })
        });

        expect(result).toBe(false);
        expect(target.getAttribute('data-gui-bootstrap-error')).toBe('true');
        expect(target.textContent).toContain('Dock failed to load: bad dock runtime config');
    });
});
