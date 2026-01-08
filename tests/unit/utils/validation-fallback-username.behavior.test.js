describe('validation fallback username behavior', () => {
    it('uses configured fallback username for invalid inputs', () => {
        jest.resetModules();
        jest.doMock('../../../src/core/config', () => ({
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
