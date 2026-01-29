const { describe, it, beforeEach, expect } = require('bun:test');
const { createMockFn, clearAllMocks } = require('../../helpers/bun-mock-utils');

const { ConfigService, createConfigService } = require('../../../src/services/ConfigService');

describe('ConfigService', () => {
    let configService;
    let configFixture;
    let mockEventBus;

    beforeEach(() => {
        clearAllMocks();

        mockEventBus = {
            emit: createMockFn()
        };

        configFixture = {
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
                follows: '!follow',
                custom: '!custom'
            },
            greetings: {
                command: '!greet'
            },
            paypiggies: {
                command: '!member'
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
                enabled: true
            },
            spam: {
                enabled: true,
                maxLength: 500
            }
        };
    });

    describe('Constructor', () => {
        it('should initialize with config and EventBus', () => {
            configService = new ConfigService(configFixture, mockEventBus);

            expect(configService.config).toBe(configFixture);
            expect(configService.eventBus).toBe(mockEventBus);
            expect(configService.cache).toBeInstanceOf(Map);
        });

        it('should initialize without EventBus', () => {
            configService = new ConfigService(configFixture);

            expect(configService.config).toBe(configFixture);
            expect(configService.eventBus).toBeNull();
        });
    });

    describe('Factory Function', () => {
        it('should create ConfigService instance', () => {
            const service = createConfigService(configFixture, mockEventBus);

            expect(service).toBeInstanceOf(ConfigService);
            expect(service.config).toBe(configFixture);
            expect(service.eventBus).toBe(mockEventBus);
        });

        it('should create ConfigService without EventBus', () => {
            const service = createConfigService(configFixture);

            expect(service).toBeInstanceOf(ConfigService);
            expect(service.eventBus).toBeNull();
        });
    });

    describe('get() - Direct Path Access', () => {
        beforeEach(() => {
            configService = new ConfigService(configFixture, mockEventBus);
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
            configFixture.deep = { nested: { value: 'test' } };

            const result = configService.get('deep.nested.value');
            expect(result).toBe('test');
        });

        it('should throw for invalid deep paths', () => {
            expect(() => configService.get('deep.invalid.path')).toThrow('Missing config path');
        });
    });

    describe('get() - Section Key Access', () => {
        beforeEach(() => {
            configService = new ConfigService(configFixture, mockEventBus);
        });

        it('should get value by section and key', () => {
            const result = configService.get('general', 'debugEnabled');
            expect(result).toBe(true);
        });

        it('should throw when section is missing', () => {
            expect(() => configService.get('nonExistent', 'key')).toThrow('Missing config section');
        });

        it('should throw when key is missing in section', () => {
            expect(() => configService.get('general', 'nonExistentKey')).toThrow('Missing config');
        });
    });

    describe('get() - Section Access', () => {
        beforeEach(() => {
            configService = new ConfigService(configFixture, mockEventBus);
        });

        it('should return entire section', () => {
            const result = configService.get('general');
            expect(result).toBe(configFixture.general);
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
            configService = new ConfigService(configFixture, mockEventBus);
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
            configService = new ConfigService(configFixture, mockEventBus);
        });

        it('should check platform-specific notifications', () => {
            const result = configService.areNotificationsEnabled('followsEnabled', 'twitch');
            expect(result).toBe(false);
        });

        it('should fallback to general notifications when platform setting missing', () => {
            const result = configService.areNotificationsEnabled('giftsEnabled', 'youtube');
            expect(result).toBe(true);
        });

        it('should throw when no setting is found', () => {
            expect(() => configService.areNotificationsEnabled('unknownType', 'twitch')).toThrow('Missing notification config');
        });

        it('should use general setting when platform not specified', () => {
            const result = configService.areNotificationsEnabled('followsEnabled');
            expect(result).toBe(true);
        });
    });

    describe('getTTSConfig()', () => {
        beforeEach(() => {
            configService = new ConfigService(configFixture, mockEventBus);
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
            delete configFixture.tts;
            expect(() => configService.getTTSConfig()).toThrow('Missing tts config');
        });

        it('should return TTS config even when partial', () => {
            configFixture.tts = { voice: 'custom' };
            const result = configService.getTTSConfig();
            expect(result.enabled).toBe(true);
            expect(result.voice).toBe('custom');
            expect(result.deduplicationEnabled).toBeUndefined();
        });
    });

    describe('getTimingConfig()', () => {
        beforeEach(() => {
            configService = new ConfigService(configFixture, mockEventBus);
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
            delete configFixture.timing;
            expect(() => configService.getTimingConfig()).toThrow('Missing config section: timing');
        });

        it('should return timing config when partial', () => {
            configFixture.timing = { greetingDuration: 10000 };
            const result = configService.getTimingConfig();
            expect(result.greetingDuration).toBe(10000);
            expect(result.commandDuration).toBeUndefined();
        });
    });

    describe('getCommand()', () => {
        beforeEach(() => {
            configService = new ConfigService(configFixture, mockEventBus);
        });

        it('should get event command from section config', () => {
            const result = configService.getCommand('greetings');
            expect(result).toBe('!greet');
        });

        it('should get non-event command from commands map', () => {
            const result = configService.getCommand('custom');
            expect(result).toBe('!custom');
        });

        it('should throw for missing command', () => {
            expect(() => configService.getCommand('nonExistent')).toThrow('Missing command config');
        });

        it('should throw when commands section is missing for non-event command', () => {
            delete configFixture.commands;
            expect(() => configService.getCommand('custom')).toThrow('Missing command config');
        });

        it('should use section-level command for event keys even when commands map has entry', () => {
            configFixture.commands.greetings = '!deprecated-command';
            const result = configService.getCommand('greetings');
            expect(result).toBe('!greet');
        });

        it('should throw when event section command is missing', () => {
            delete configFixture.greetings.command;
            expect(() => configService.getCommand('greetings')).toThrow('Missing command config');
        });

        it('uses section command for paypiggies', () => {
            const result = configService.getCommand('paypiggies');
            expect(result).toBe('!member');
        });
    });

    describe('isDebugEnabled()', () => {
        beforeEach(() => {
            configService = new ConfigService(configFixture, mockEventBus);
        });

        it('should return debug enabled status', () => {
            const result = configService.isDebugEnabled();
            expect(result).toBe(true);
        });

        it('should return false when debug not configured', () => {
            delete configFixture.general.debugEnabled;

            expect(() => configService.isDebugEnabled()).toThrow('Missing general.debugEnabled config');
        });
    });

    describe('getSpamConfig()', () => {
        beforeEach(() => {
            configService = new ConfigService(configFixture, mockEventBus);
        });

        it('should return spam configuration', () => {
            const result = configService.getSpamConfig();
            expect(result).toEqual({
                enabled: true,
                maxLength: 500
            });
        });

        it('should throw when spam config is missing', () => {
            delete configFixture.spam;
            expect(() => configService.getSpamConfig()).toThrow('Missing config section: spam');
        });
    });

    describe('set()', () => {
        beforeEach(() => {
            configService = new ConfigService(configFixture, mockEventBus);
        });

        it('should set value and emit change event', () => {
            const result = configService.set('general', 'debugEnabled', false);

            expect(result).toBe(true);
            expect(configFixture.general.debugEnabled).toBe(false);
            expect(configService.cache.size).toBe(0);
            expect(mockEventBus.emit).toHaveBeenCalledWith('config:changed', {
                section: 'general',
                key: 'debugEnabled',
                value: false
            });
        });

        it('should set new key in existing section', () => {
            const result = configService.set('general', 'newKey', 'testNewValue');

            expect(configFixture.general.newKey).toBe('testNewValue');
            expect(result).toBe(true);
            expect(mockEventBus.emit).toHaveBeenCalledWith('config:changed', {
                section: 'general',
                key: 'newKey',
                value: 'testNewValue'
            });
        });

        it('should create new section when missing', () => {
            const result = configService.set('newSection', 'key', 'testValue');

            expect(configFixture.newSection).toEqual({ key: 'testValue' });
            expect(result).toBe(true);
        });

        it('should handle null config gracefully', () => {
            configService = new ConfigService(null, mockEventBus);

            const result = configService.set('general', 'key', 'testValue');

            expect(result).toBe(false);
            expect(mockEventBus.emit).not.toHaveBeenCalled();
        });

        it('should work without EventBus', () => {
            configService = new ConfigService(configFixture);

            const result = configService.set('general', 'key', 'testValue');

            expect(result).toBe(true);
            expect(configFixture.general.key).toBe('testValue');
        });
    });

    describe('reload()', () => {
        beforeEach(() => {
            configService = new ConfigService(configFixture, mockEventBus);
        });

        it('should clear cache and emit reloaded event', () => {
            configService.cache.set('test', 'testValue');

            const result = configService.reload();

            expect(result).toBe(true);
            expect(configService.cache.size).toBe(0);
            expect(mockEventBus.emit).toHaveBeenCalledWith('config:reloaded');
        });

        it('should work without EventBus', () => {
            configService = new ConfigService(configFixture);

            const result = configService.reload();

            expect(result).toBe(true);
        });
    });

    describe('getConfigSummary()', () => {
        beforeEach(() => {
            configService = new ConfigService(configFixture, mockEventBus);
        });

        it('should return configuration summary', () => {
            const result = configService.getConfigSummary();

            expect(result).toEqual({
                hasConfig: true,
                configType: 'Object',
                sections: expect.arrayContaining(['general', 'tts', 'commands']),
                hasEventBus: true,
                cacheSize: 0
            });
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
            configService = new ConfigService(configFixture, mockEventBus);
        });

        it('should handle errors in get() gracefully', () => {
            const errorConfig = {
                get general() { throw new Error('Test error'); }
            };
            configService = new ConfigService(errorConfig);

            expect(() => configService.get('general')).toThrow('Test error');
        });

        it('should handle errors in set() gracefully', () => {
            const frozenConfig = Object.freeze({ general: Object.freeze({}) });
            configService = new ConfigService(frozenConfig, mockEventBus);

            const result = configService.set('general', 'key', 'testValue');
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
            configService = new ConfigService(configFixture, mockEventBus);
        });

        it('should emit config:changed event on set', () => {
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
            configService = new ConfigService(configFixture);

            configService.set('general', 'key', 'testValue');
            configService.reload();

            expect(true).toBe(true);
        });
    });

    describe('Performance and Memory', () => {
        beforeEach(() => {
            configService = new ConfigService(configFixture, mockEventBus);
        });

        it('should clear cache on configuration changes', () => {
            configService.cache.set('test', 'testValue');
            expect(configService.cache.size).toBe(1);

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
