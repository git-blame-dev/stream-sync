
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { restoreAllMocks, spyOn } = require('../../helpers/bun-mock-utils');
const { configManager } = require('../../../src/core/config');

describe('Keyword Parsing Configuration', () => {
    beforeEach(() => {
        restoreAllMocks();
        configManager.isLoaded = false;
        configManager.config = null;
    });

    describe('Default Configuration', () => {
        test('should enable keyword parsing by default when not specified', () => {
            const keywordParsingEnabled = configManager.getBoolean('general', 'keywordParsingEnabled', true);
            expect(keywordParsingEnabled).toBe(true);
        });

        test('should enable keyword parsing when explicitly set to true', () => {
            spyOn(configManager, 'getBoolean').mockReturnValue(true);

            const keywordParsingEnabled = configManager.getBoolean('general', 'keywordParsingEnabled', true);
            expect(keywordParsingEnabled).toBe(true);
        });

        test('should disable keyword parsing when explicitly set to false', () => {
            spyOn(configManager, 'getBoolean').mockReturnValue(false);

            const keywordParsingEnabled = configManager.getBoolean('general', 'keywordParsingEnabled', true);
            expect(keywordParsingEnabled).toBe(false);
        });
    });

    describe('Configuration Validation', () => {
        test('should handle string "true" as boolean true', () => {
            spyOn(configManager, 'get').mockReturnValue('true');

            const keywordParsingEnabled = configManager.getBoolean('general', 'keywordParsingEnabled', true);
            expect(keywordParsingEnabled).toBe(true);
        });

        test('should handle string "false" as boolean false', () => {
            spyOn(configManager, 'get').mockReturnValue('false');

            const keywordParsingEnabled = configManager.getBoolean('general', 'keywordParsingEnabled', true);
            expect(keywordParsingEnabled).toBe(false);
        });

        test('should handle case-insensitive boolean strings', () => {
            spyOn(configManager, 'get').mockReturnValue('TRUE');

            const keywordParsingEnabled = configManager.getBoolean('general', 'keywordParsingEnabled', true);
            expect(keywordParsingEnabled).toBe(true);
        });

        test('should default to true for invalid boolean values', () => {
            spyOn(configManager, 'get').mockReturnValue('invalid');

            const keywordParsingEnabled = configManager.getBoolean('general', 'keywordParsingEnabled', true);
            expect(keywordParsingEnabled).toBe(false);
        });
    });

    describe('Configuration Inheritance', () => {
        test('should inherit keyword parsing setting from general section', () => {
            spyOn(configManager, 'getBoolean')
                .mockImplementation((section, key, defaultValue) => {
                    if (section === 'general' && key === 'keywordParsingEnabled') {
                        return false;
                    }
                    return defaultValue;
                });

            const generalSetting = configManager.getBoolean('general', 'keywordParsingEnabled', true);
            const twitchSetting = configManager.getBoolean('twitch', 'keywordParsingEnabled', generalSetting);

            expect(generalSetting).toBe(false);
            expect(twitchSetting).toBe(false);
        });

        test('should allow platform-specific override of keyword parsing setting', () => {
            spyOn(configManager, 'getBoolean')
                .mockImplementation((section, key, defaultValue) => {
                    if (section === 'general' && key === 'keywordParsingEnabled') {
                        return true;
                    }
                    if (section === 'twitch' && key === 'keywordParsingEnabled') {
                        return false;
                    }
                    return defaultValue;
                });

            const generalSetting = configManager.getBoolean('general', 'keywordParsingEnabled', true);
            const twitchSetting = configManager.getBoolean('twitch', 'keywordParsingEnabled', generalSetting);

            expect(generalSetting).toBe(true);
            expect(twitchSetting).toBe(false);
        });
    });

    describe('Backward Compatibility', () => {
        test('should not break existing configuration when keyword parsing setting is missing', () => {
            spyOn(configManager, 'getBoolean')
                .mockImplementation((section, key, defaultValue) => {
                    if (section === 'general' && key === 'keywordParsingEnabled') {
                        return defaultValue;
                    }
                    return defaultValue;
                });

            spyOn(configManager, 'get')
                .mockImplementation((section, key, defaultValue) => {
                    if (section === 'general' && key === 'cmdCoolDown') {
                        return '60';
                    }
                    if (section === 'general' && key === 'viewerCountPollingInterval') {
                        return '60';
                    }
                    return defaultValue;
                });

            const keywordParsingEnabled = configManager.getBoolean('general', 'keywordParsingEnabled', true);
            const cmdCoolDown = configManager.get('general', 'cmdCoolDown');
            const viewerCountPollingInterval = configManager.get('general', 'viewerCountPollingInterval');

            expect(keywordParsingEnabled).toBe(true);
            expect(cmdCoolDown).toBe('60');
            expect(viewerCountPollingInterval).toBe('60');
        });

        test('should preserve all existing general settings when adding keyword parsing', () => {
            spyOn(configManager, 'getBoolean')
                .mockImplementation((section, key, defaultValue) => {
                    if (section === 'general' && key === 'keywordParsingEnabled') {
                        return false;
                    }
                    if (section === 'general' && key === 'messagesEnabled') {
                        return true;
                    }
                    return defaultValue;
                });

            spyOn(configManager, 'get')
                .mockImplementation((section, key, defaultValue) => {
                    if (section === 'general' && key === 'cmdCoolDown') {
                        return '60';
                    }
                    if (section === 'general' && key === 'viewerCountPollingInterval') {
                        return '60';
                    }
                    return defaultValue;
                });

            const keywordParsingEnabled = configManager.getBoolean('general', 'keywordParsingEnabled', true);
            const cmdCoolDown = configManager.get('general', 'cmdCoolDown');
            const viewerCountPollingInterval = configManager.get('general', 'viewerCountPollingInterval');
            const messagesEnabled = configManager.getBoolean('general', 'messagesEnabled', false);

            expect(keywordParsingEnabled).toBe(false);
            expect(cmdCoolDown).toBe('60');
            expect(viewerCountPollingInterval).toBe('60');
            expect(messagesEnabled).toBe(true);
        });
    });

    afterEach(() => {
        restoreAllMocks();
        configManager.isLoaded = false;
        configManager.config = null;
    });
}); 