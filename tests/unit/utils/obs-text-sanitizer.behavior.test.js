const { describe, test, expect, it, afterEach } = require('bun:test');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

const {
    sanitizeForOBS,
    isOBSSafe,
    sanitizeUsernameForOBS,
    sanitizeChatForOBS
} = require('../../../src/utils/obs-text-sanitizer');

describe('obs-text-sanitizer behavior', () => {
    afterEach(() => {
        restoreAllModuleMocks();
    });

    it('removes unsafe characters and keeps printable ASCII', () => {
        expect(sanitizeForOBS('Coolguy✗o🥭')).toBe('Coolguyo');
        expect(isOBSSafe('Hello World!')).toBe(true);
        expect(isOBSSafe('Hello 🌍!')).toBe(false);
    });

    it('falls back to safe defaults for invalid input', () => {
        expect(sanitizeForOBS(null)).toBe('');
        expect(sanitizeUsernameForOBS('🔥💯')).toBe('Unknown User');
        expect(sanitizeChatForOBS(undefined)).toBe('');
    });

    it('preserves structure while stripping unicode noise', () => {
        expect(sanitizeChatForOBS('User: Hello! 😊')).toBe('User: Hello! ');
        expect(sanitizeUsernameForOBS('NormalUser')).toBe('NormalUser');
    });

    it('uses configured fallback username when sanitized output is empty', () => {
mockModule('../../../src/core/config', () => ({
            config: {
                general: {
                    fallbackUsername: 'Guest'
                }
            }
        }));

        const { sanitizeUsernameForOBS: sanitizeWithFallback } = require('../../../src/utils/obs-text-sanitizer');
        expect(sanitizeWithFallback('🔥💯')).toBe('Guest');
    });
});
