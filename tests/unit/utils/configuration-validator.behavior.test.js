const { describe, expect, it } = require('bun:test');
const { validateDisplayConfig } = require('../../../src/utils/configuration-validator');

describe('configuration-validator behavior', () => {
    describe('validateDisplayConfig', () => {
        it('accepts valid config with groups enabled', () => {
            const result = validateDisplayConfig({ sourceName: 'text', sceneName: 'main', groupName: 'grp' }, 'chat');
            expect(result).toBe(true);
        });

        it('accepts valid config when groups disabled via null', () => {
            const result = validateDisplayConfig({ sourceName: 'text', sceneName: 'main', groupName: null }, 'notification');
            expect(result).toBe(true);
        });

        it('rejects invalid config objects', () => {
            const result = validateDisplayConfig(null, 'chat');
            expect(result).toBe(false);
        });

        it('rejects missing required source or scene', () => {
            const result = validateDisplayConfig({ sourceName: '', sceneName: null }, 'chat');
            expect(result).toBe(false);
        });

        it('rejects invalid provided groupName when groups enabled', () => {
            const result = validateDisplayConfig({ sourceName: 'text', sceneName: 'main', groupName: '' }, 'chat');
            expect(result).toBe(false);
        });
    });
});
