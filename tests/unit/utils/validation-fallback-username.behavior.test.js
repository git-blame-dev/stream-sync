const { describe, test, expect, it, afterEach } = require('bun:test');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

describe('validation fallback username behavior', () => {
    afterEach(() => {
        restoreAllModuleMocks();
    });

    it('uses configured fallback username for invalid inputs', () => {
mockModule('../../../src/core/config', () => ({
            config: {
                general: {
                    fallbackUsername: 'Guest'
                }
            }
        }));

        const {
            formatUsername12,
            formatUsernameForTTSGreeting,
            getFirstWord
        } = require('../../../src/utils/validation');

        expect(formatUsername12(null)).toBe('Guest');
        expect(formatUsernameForTTSGreeting('!!!')).toBe('Guest');
        expect(getFirstWord('!!!')).toBe('Guest');
    });
});
