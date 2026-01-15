const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

const {
    validateDisplayConfig,
    isGroupsEnabled,
    validateGroupConfig,
    validateBasicGroupScene
} = require('../../../src/utils/configuration-validator');

describe('configuration-validator behavior', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

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

    describe('isGroupsEnabled', () => {
        it('returns true when group name present and scene valid', () => {
            const enabled = isGroupsEnabled({ groupName: 'grp', sceneName: 'main' }, 'chat');
            expect(enabled).toBe(true);
        });

        it('returns false when scene missing', () => {
            const enabled = isGroupsEnabled({ groupName: 'grp' }, 'chat');
            expect(enabled).toBe(false);
        });

        it('returns false when groups intentionally disabled', () => {
            const enabled = isGroupsEnabled({ groupName: '', sceneName: 'main' }, 'notification');
            expect(enabled).toBeFalsy();
        });
    });

    describe('validateGroupConfig', () => {
        it('skips group validation when groups disabled', () => {
            const proceed = validateGroupConfig('', false, 'chat');
            expect(proceed).toBe(false);
        });

        it('rejects when groups enabled but group name missing', () => {
            const proceed = validateGroupConfig('', true, 'chat');
            expect(proceed).toBe(false);
        });

        it('accepts when groups enabled with valid group name', () => {
            const proceed = validateGroupConfig('grp', true, 'chat');
            expect(proceed).toBe(true);
        });
    });

    describe('validateBasicGroupScene', () => {
        it('accepts valid basic configuration', () => {
            const valid = validateBasicGroupScene({ groupName: 'grp', sceneName: 'scene' }, 'notification');
            expect(valid).toBe(true);
        });

        it('rejects missing group or scene', () => {
            const valid = validateBasicGroupScene({ groupName: null, sceneName: '' }, 'chat');
            expect(valid).toBe(false);
        });
    });
});
