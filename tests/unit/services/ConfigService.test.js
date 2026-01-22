const { describe, it, beforeEach, expect } = require('bun:test');
const { createMockFn, clearAllMocks } = require('../../helpers/bun-mock-utils');

const { ConfigService, createConfigService } = require('../../../src/services/ConfigService');

describe('ConfigService', () => {
    let configService;
    let mockConfig;
    let mockEventBus;

    beforeEach(() => {
        clearAllMocks();

        mockEventBus = {
            emit: createMockFn()
        };

        mockConfig = {
            get: createMockFn(),
            set: createMockFn(),
            reload: createMockFn(),
            general: {
                debugEnabled: true,
                filterOldMessages: true,
                greetingsEnabled: true,
                globalCmdCooldownMs: 60000,
                cliGreetingsOverride: false,
                giftsEnabled: true,
                followsEnabled: true,
                ttsEnabled: true
            },
            tts: {
                deduplicationEnabled: true,
                debugDeduplication: false,
                onlyForGifts: false,
                voice: 'default',
                rate: 1.0,
                volume: 0.8
            },
            timing: {
                greetingDuration: 5000,
                defaultNotificationDuration: 3000,
                chatMessageDuration: 8000
            },
            commands: {
                greetings: '!hello',
                gifts: '!gift',
                follows: '!follow'
            },
            notifications: {
                followsEnabled: true,
                giftsEnabled: true,
                subsEnabled: true
            },
            twitch: {
                followsEnabled: false
            },
            youtube: {
                apiKey: 'test-youtube-key'
            },
            spam: {
                enabled: true,
                maxLength: 500
            }
        };
    });

    describe('Constructor', () => {
        it('should initialize with config and EventBus', () => {
            configService = new ConfigService(mockConfig, mockEventBus);

            expect(configService.config).toBe(mockConfig);
            expect(configService.eventBus).toBe(mockEventBus);
            expect(configService.cache).toBeInstanceOf(Map);
        });

        it('should initialize without EventBus', () => {
            configService = new ConfigService(mockConfig);

            expect(configService.config).toBe(mockConfig);
            expect(configService.eventBus).toBeNull();
        });
    });

    describe('Factory Function', () => {
        it('should create ConfigService instance', () => {
            const service = createConfigService(mockConfig, mockEventBus);

            expect(service).toBeInstanceOf(ConfigService);
            expect(service.config).toBe(mockConfig);
            expect(service.eventBus).toBe(mockEventBus);
        });

        it('should create ConfigService without EventBus', () => {
            const service = createConfigService(mockConfig);

            expect(service).toBeInstanceOf(ConfigService);
            expect(service.eventBus).toBeNull();
        });
    });

    describe('get() - Direct Path Access', () => {
        beforeEach(() => {
            configService = new ConfigService(mockConfig, mockEventBus);
        });

        it('should get value by dot notation path', () => {
            const result = configService.get('general.debugEnabled');
            expect(result).toBe(true);
        });

        it('should throw when a direct path is missing', () => {
            expect(() => configService.get('general.nonExistent')).toThrow('Missing config path');
        });

        it('should throw when required config sections are missing', () => {
            const partialConfig = { tts: { enabled: true } };
            configService = new ConfigService(partialConfig);

            expect(() => configService.get('general.debugEnabled')).toThrow('Missing config path');
        });

        it('should handle deep nested paths', () => {
            mockConfig.deep = { nested: { value: 'test' } };

            const result = configService.get('deep.nested.value');
            expect(result).toBe('test');
        });

        it('should throw for invalid deep paths', () => {
            expect(() => configService.get('deep.invalid.path')).toThrow('Missing config path');
        });
    });

    describe('get() - ConfigManager Style', () => {
        beforeEach(() => {
            configService = new ConfigService(mockConfig, mockEventBus);
        });

        it('should use ConfigManager get method when available', () => {
            mockConfig.get.mockReturnValue('testConfigManagerValue');

            const result = configService.get('general', 'debugEnabled');

            expect(result).toBe('testConfigManagerValue');
        });

        it('should fallback to direct property access when ConfigManager unavailable', () => {
            delete mockConfig.get;

            const result = configService.get('general', 'debugEnabled');
            expect(result).toBe(true);
        });

        it('should throw when section is missing', () => {
            delete mockConfig.get;

            expect(() => configService.get('nonExistent', 'key')).toThrow('Missing config section');
        });
    });

    describe('get() - Section Access', () => {
        beforeEach(() => {
            configService = new ConfigService(mockConfig, mockEventBus);
        });

        it('should return entire section', () => {
            const result = configService.get('general');
            expect(result).toBe(mockConfig.general);
        });

        it('should throw for missing section', () => {
            expect(() => configService.get('nonExistent')).toThrow('Missing config section');
        });

        it('should handle null config gracefully', () => {
            configService = new ConfigService(null);

            expect(() => configService.get('general')).toThrow('ConfigService requires config');
        });
    });

    describe('getPlatformConfig()', () => {
        beforeEach(() => {
            configService = new ConfigService(mockConfig, mockEventBus);
        });

        it('should return platform-specific config when available', () => {
            const result = configService.getPlatformConfig('twitch', 'followsEnabled');
            expect(result).toBe(false);
        });

        it('should throw when platform-specific config is missing', () => {
            expect(() => configService.getPlatformConfig('twitch', 'greetingsEnabled')).toThrow('Missing platform config');
        });

        it('should throw when platform section is missing', () => {
            expect(() => configService.getPlatformConfig('discord', 'followsEnabled')).toThrow('Missing platform config');
        });
    });

    describe('areNotificationsEnabled()', () => {
        beforeEach(() => {
            configService = new ConfigService(mockConfig, mockEventBus);
        });

        it('should check platform-specific notifications (ConfigManager style)', () => {
            mockConfig.get.mockImplementation((section, key) => {
                if (section === 'twitch' && key === 'followsEnabled') return false;
                if (section === 'notifications' && key === 'followsEnabled') return true;
                return undefined;
            });

            const result = configService.areNotificationsEnabled('followsEnabled', 'twitch');
            expect(result).toBe(false);
        });

        it('should fallback to general notifications (ConfigManager style)', () => {
            mockConfig.get.mockImplementation((section, key) => {
                if (section === 'youtube' && key === 'followsEnabled') return undefined;
                if (section === 'notifications' && key === 'followsEnabled') return true;
                return undefined;
            });

            const result = configService.areNotificationsEnabled('followsEnabled', 'youtube');
            expect(result).toBe(true);
        });

        it('should check platform-specific notifications (direct access)', () => {
            delete mockConfig.get;

            const result = configService.areNotificationsEnabled('followsEnabled', 'twitch');
            expect(result).toBe(false);
        });

        it('should fallback to general notifications (direct access)', () => {
            delete mockConfig.get;

            const result = configService.areNotificationsEnabled('giftsEnabled', 'youtube');
            expect(result).toBe(true);
        });

        it('should throw when no setting is found', () => {
            delete mockConfig.get;
            delete mockConfig.notifications;

            expect(() => configService.areNotificationsEnabled('unknownType', 'twitch')).toThrow('Missing notification config');
        });

        it('should throw when platform is not specified', () => {
            delete mockConfig.get;
            expect(() => configService.areNotificationsEnabled('followsEnabled')).toThrow('Missing notification config');
        });
    });

    describe('getTTSConfig()', () => {
        beforeEach(() => {
            configService = new ConfigService(mockConfig, mockEventBus);
        });

        it('should return complete TTS configuration', () => {
            const result = configService.getTTSConfig();

            expect(result).toEqual({
                enabled: true,
                deduplicationEnabled: true,
                debugDeduplication: false,
                onlyForGifts: false,
                voice: 'default',
                rate: 1.0,
                volume: 0.8
            });
        });

        it('should throw when TTS config is missing', () => {
            delete mockConfig.tts;
            expect(() => configService.getTTSConfig()).toThrow('Missing config section: tts');
        });

        it('should return TTS config even when partial', () => {
            mockConfig.tts = { voice: 'custom' };
            const result = configService.getTTSConfig();
            expect(result.enabled).toBe(true);
            expect(result.voice).toBe('custom');
            expect(result.deduplicationEnabled).toBeUndefined();
        });
    });

    describe('getTimingConfig()', () => {
        beforeEach(() => {
            configService = new ConfigService(mockConfig, mockEventBus);
        });

        it('should return complete timing configuration', () => {
            const result = configService.getTimingConfig();

            expect(result).toEqual({
                greetingDuration: 5000,
                commandDuration: 3000,
                chatDuration: 8000,
                notificationDuration: 3000
            });
        });

        it('should throw when timing config is missing', () => {
            delete mockConfig.timing;
            expect(() => configService.getTimingConfig()).toThrow('Missing config section: timing');
        });

        it('should return timing config when partial', () => {
            mockConfig.timing = { greetingDuration: 10000 };
            const result = configService.getTimingConfig();
            expect(result.greetingDuration).toBe(10000);
            expect(result.commandDuration).toBeUndefined();
        });
    });

    describe('getCommand()', () => {
        beforeEach(() => {
            configService = new ConfigService(mockConfig, mockEventBus);
        });

        it('should get event command from section config', () => {
            mockConfig.get.mockImplementation((section, key) => {
                if (section === 'greetings' && key === 'command') {
                    return '!testCustomGreeting';
                }
                return null;
            });

            const result = configService.getCommand('greetings');

            expect(result).toBe('!testCustomGreeting');
        });

        it('should get event command using direct property access', () => {
            delete mockConfig.get;
            mockConfig.greetings = { command: '!hello' };

            const result = configService.getCommand('greetings');
            expect(result).toBe('!hello');
        });

        it('should get non-event command from commands map', () => {
            mockConfig.get.mockReturnValue('!testCustomCommand');

            const result = configService.getCommand('custom');

            expect(result).toBe('!testCustomCommand');
        });

        it('should throw for missing command', () => {
            delete mockConfig.get;
            expect(() => configService.getCommand('nonExistent')).toThrow('Missing command config');
        });

        it('should throw when commands section is missing for non-event command', () => {
            delete mockConfig.get;
            delete mockConfig.commands;
            expect(() => configService.getCommand('custom')).toThrow('Missing command config');
        });

        it('should use section-level command for event keys even when commands map has entry', () => {
            delete mockConfig.get;
            mockConfig.greetings = { command: '!hello' };
            mockConfig.commands.greetings = '!deprecated-command';

            const result = configService.getCommand('greetings');

            expect(result).toBe('!hello');
        });

        it('should throw when event section command is missing even if commands map has entry', () => {
            mockConfig.get.mockImplementation((section, key) => {
                if (section === 'commands' && key === 'greetings') {
                    return '!deprecated-command';
                }
                if (section === 'greetings' && key === 'command') {
                    return null;
                }
                return null;
            });

            expect(() => configService.getCommand('greetings')).toThrow('Missing command config');
        });

        it('uses section command for paypiggies', () => {
            mockConfig.get.mockImplementation((section, key) => {
                if (section === 'paypiggies' && key === 'command') {
                    return '!member';
                }
                return null;
            });

            const result = configService.getCommand('paypiggies');

            expect(result).toBe('!member');
        });
    });

    describe('isDebugEnabled()', () => {
        beforeEach(() => {
            configService = new ConfigService(mockConfig, mockEventBus);
        });

        it('should return debug enabled status', () => {
            const result = configService.isDebugEnabled();
            expect(result).toBe(true);
        });

        it('should return false when debug not configured', () => {
            delete mockConfig.general.debugEnabled;

            expect(() => configService.isDebugEnabled()).toThrow('Missing general.debugEnabled config');
        });
    });

    describe('getSpamConfig()', () => {
        beforeEach(() => {
            configService = new ConfigService(mockConfig, mockEventBus);
        });

        it('should return spam configuration', () => {
            const result = configService.getSpamConfig();
            expect(result).toEqual({
                enabled: true,
                maxLength: 500
            });
        });

        it('should throw when spam config is missing', () => {
            delete mockConfig.spam;
            expect(() => configService.getSpamConfig()).toThrow('Missing config section: spam');
        });
    });

    describe('set()', () => {
        beforeEach(() => {
            configService = new ConfigService(mockConfig, mockEventBus);
        });

        it('should set value using ConfigManager style', () => {
            mockConfig.set.mockReturnValue(true);

            const result = configService.set('general', 'debugEnabled', false);

            expect(result).toBe(true);
            expect(configService.cache.size).toBe(0);
            expect(mockEventBus.emit).toHaveBeenCalledWith('config:changed', {
                section: 'general',
                key: 'debugEnabled',
                value: false
            });
        });

        it('should set value using direct property modification', () => {
            delete mockConfig.set;

            const result = configService.set('general', 'newKey', 'testNewValue');

            expect(mockConfig.general.newKey).toBe('testNewValue');
            expect(result).toBe(true);
            expect(mockEventBus.emit).toHaveBeenCalledWith('config:changed', {
                section: 'general',
                key: 'newKey',
                value: 'testNewValue'
            });
        });

        it('should create new section when missing (direct access)', () => {
            delete mockConfig.set;

            const result = configService.set('newSection', 'key', 'testValue');

            expect(mockConfig.newSection).toEqual({ key: 'testValue' });
            expect(result).toBe(true);
        });

        it('should handle null config gracefully', () => {
            configService = new ConfigService(null, mockEventBus);

            const result = configService.set('general', 'key', 'testValue');

            expect(result).toBe(false);
            expect(mockEventBus.emit).not.toHaveBeenCalled();
        });

        it('should work without EventBus', () => {
            configService = new ConfigService(mockConfig);
            delete mockConfig.set;

            const result = configService.set('general', 'key', 'testValue');

            expect(result).toBe(true);
            expect(mockConfig.general.key).toBe('testValue');
        });
    });

    describe('reload()', () => {
        beforeEach(() => {
            configService = new ConfigService(mockConfig, mockEventBus);
        });

        it('should reload configuration when supported', () => {
            mockConfig.reload.mockReturnValue(true);

            const result = configService.reload();

            expect(result).toBe(true);
            expect(configService.cache.size).toBe(0);
            expect(mockEventBus.emit).toHaveBeenCalledWith('config:reloaded');
        });

        it('should clear cache even without reload method', () => {
            delete mockConfig.reload;
            configService.cache.set('test', 'testValue');

            const result = configService.reload();

            expect(result).toBe(true);
            expect(configService.cache.size).toBe(0);
            expect(mockEventBus.emit).toHaveBeenCalledWith('config:reloaded');
        });

        it('should work without EventBus', () => {
            configService = new ConfigService(mockConfig);

            const result = configService.reload();

            expect(result).toBe(true);
        });
    });

    describe('getConfigSummary()', () => {
        beforeEach(() => {
            configService = new ConfigService(mockConfig, mockEventBus);
        });

        it('should return configuration summary with ConfigManager', () => {
            const result = configService.getConfigSummary();

            expect(result).toEqual({
                hasConfig: true,
                configType: 'ConfigManager',
                sections: expect.arrayContaining(['general', 'tts', 'commands']),
                hasEventBus: true,
                cacheSize: 0
            });
        });

        it('should return configuration summary with direct access', () => {
            delete mockConfig.get;

            const result = configService.getConfigSummary();

            expect(result.configType).toBe('Object');
            expect(result.hasConfig).toBe(true);
        });

        it('should handle null config', () => {
            configService = new ConfigService(null);

            const result = configService.getConfigSummary();

            expect(result).toEqual({
                hasConfig: false,
                configType: 'Object',
                sections: [],
                hasEventBus: false,
                cacheSize: 0
            });
        });
    });

    describe('Error Handling', () => {
        beforeEach(() => {
            configService = new ConfigService(mockConfig, mockEventBus);
        });

        it('should handle errors in get() gracefully', () => {
            const errorConfig = {
                get general() { throw new Error('Test error'); }
            };
            configService = new ConfigService(errorConfig);

            expect(() => configService.get('general')).toThrow('Test error');
        });

        it('should handle errors in set() gracefully', () => {
            mockConfig.set.mockImplementation(() => {
                throw new Error('Set error');
            });

            const result = configService.set('general', 'key', 'testValue');
            expect(result).toBe(false);
        });

        it('should handle errors in reload() gracefully', () => {
            mockConfig.reload.mockImplementation(() => {
                throw new Error('Reload error');
            });

            const result = configService.reload();
            expect(result).toBe(false);
        });

        it('should handle errors in getTTSConfig() gracefully', () => {
            const errorConfig = {
                get tts() { throw new Error('TTS error'); }
            };
            configService = new ConfigService(errorConfig);

            expect(() => configService.getTTSConfig()).toThrow('TTS error');
        });

        it('should handle errors in getTimingConfig() gracefully', () => {
            const errorConfig = {
                get timing() { throw new Error('Timing error'); }
            };
            configService = new ConfigService(errorConfig);

            expect(() => configService.getTimingConfig()).toThrow('Timing error');
        });
    });

    describe('EventBus Integration', () => {
        beforeEach(() => {
            configService = new ConfigService(mockConfig, mockEventBus);
        });

        it('should emit config:changed event on set', () => {
            delete mockConfig.set;

            configService.set('general', 'key', 'testValue');

            expect(mockEventBus.emit).toHaveBeenCalledWith('config:changed', {
                section: 'general',
                key: 'key',
                value: 'testValue'
            });
        });

        it('should emit config:reloaded event on reload', () => {
            configService.reload();

            expect(mockEventBus.emit).toHaveBeenCalledWith('config:reloaded');
        });

        it('should not emit events without EventBus', () => {
            configService = new ConfigService(mockConfig);
            delete mockConfig.set;

            configService.set('general', 'key', 'testValue');
            configService.reload();

            expect(true).toBe(true);
        });
    });

    describe('Performance and Memory', () => {
        beforeEach(() => {
            configService = new ConfigService(mockConfig, mockEventBus);
        });

        it('should clear cache on configuration changes', () => {
            configService.cache.set('test', 'testValue');
            expect(configService.cache.size).toBe(1);

            delete mockConfig.set;
            configService.set('general', 'key', 'testValue');

            expect(configService.cache.size).toBe(0);
        });

        it('should clear cache on reload', () => {
            configService.cache.set('test', 'testValue');
            expect(configService.cache.size).toBe(1);

            configService.reload();

            expect(configService.cache.size).toBe(0);
        });
    });
});
