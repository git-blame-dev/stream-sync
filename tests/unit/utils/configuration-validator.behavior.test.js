const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

mockModule('../../../src/core/logging', () => {
    const mockLogger = {
        warn: createMockFn(),
        debug: createMockFn()
    };
    return { logger: mockLogger };
});

const { logger } = require('../../../src/core/logging');
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

    beforeEach(() => {
        logger.warn.mockClear();
        logger.debug.mockClear();
    });

    describe('validateDisplayConfig', () => {
        it('accepts valid config with groups enabled', () => {
            const result = validateDisplayConfig({ sourceName: 'text', sceneName: 'main', groupName: 'grp' }, 'chat');

            expect(result).toBe(true);
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('validation successful (groups enabled)'),
                'config-validator',
                expect.objectContaining({ groupsEnabled: true })
            );
        });

        it('accepts valid config when groups disabled via null', () => {
            const result = validateDisplayConfig({ sourceName: 'text', sceneName: 'main', groupName: null }, 'notification');

            expect(result).toBe(true);
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('validation successful (groups disabled)'),
                'config-validator',
                expect.objectContaining({ groupsEnabled: false })
            );
        });

        it('rejects invalid config objects', () => {
            const result = validateDisplayConfig(null, 'chat');

            expect(result).toBe(false);
            expect(logger.warn).toHaveBeenCalled();
        });

        it('rejects missing required source or scene', () => {
            const result = validateDisplayConfig({ sourceName: '', sceneName: null }, 'chat');

            expect(result).toBe(false);
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Missing required chat configuration values'),
                'config-validator',
                expect.objectContaining({
                    missing: expect.objectContaining({ sourceName: true, sceneName: true })
                })
            );
        });

        it('rejects invalid provided groupName when groups enabled', () => {
            const result = validateDisplayConfig({ sourceName: 'text', sceneName: 'main', groupName: '' }, 'chat');

            expect(result).toBe(false);
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Invalid chat groupName'),
                'config-validator',
                expect.objectContaining({
                    groupNameType: 'string'
                })
            );
        });
    });

    describe('isGroupsEnabled', () => {
        it('returns true when group name present and scene valid', () => {
            const enabled = isGroupsEnabled({ groupName: 'grp', sceneName: 'main' }, 'chat');

            expect(enabled).toBe(true);
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('groups enabled'),
                'config-validator',
                expect.objectContaining({ groupName: 'grp' })
            );
        });

        it('returns false when scene missing', () => {
            const enabled = isGroupsEnabled({ groupName: 'grp' }, 'chat');

            expect(enabled).toBe(false);
            expect(logger.warn).toHaveBeenCalled();
        });

        it('returns false and logs debug when groups intentionally disabled', () => {
            const enabled = isGroupsEnabled({ groupName: '', sceneName: 'main' }, 'notification');

            expect(enabled).toBeFalsy();
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('groups disabled'),
                'config-validator',
                expect.objectContaining({ reason: expect.any(String) })
            );
        });
    });

    describe('validateGroupConfig', () => {
        it('skips group validation when groups disabled', () => {
            const proceed = validateGroupConfig('', false, 'chat');

            expect(proceed).toBe(false);
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('group operations skipped'),
                'config-validator',
                expect.any(Object)
            );
        });

        it('rejects when groups enabled but group name missing', () => {
            const proceed = validateGroupConfig('', true, 'chat');

            expect(proceed).toBe(false);
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('group name but groups are enabled'),
                'config-validator',
                expect.objectContaining({ groupsEnabled: true })
            );
        });

        it('accepts when groups enabled with valid group name', () => {
            const proceed = validateGroupConfig('grp', true, 'chat');

            expect(proceed).toBe(true);
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('group validation successful'),
                'config-validator',
                expect.objectContaining({ groupName: 'grp' })
            );
        });
    });

    describe('validateBasicGroupScene', () => {
        it('accepts valid basic configuration', () => {
            const valid = validateBasicGroupScene({ groupName: 'grp', sceneName: 'scene' }, 'notification');

            expect(valid).toBe(true);
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('basic group/scene validation successful'),
                'config-validator',
                expect.objectContaining({ groupName: 'grp', sceneName: 'scene' })
            );
        });

        it('rejects missing group or scene', () => {
            const valid = validateBasicGroupScene({ groupName: null, sceneName: '' }, 'chat');

            expect(valid).toBe(false);
            expect(logger.warn).toHaveBeenCalled();
        });
    });
});
