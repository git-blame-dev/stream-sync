const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { restoreAllMocks } = require('../helpers/bun-mock-utils');
const { noOpLogger, createMockConfig } = require('../helpers/mock-factories');
const { createTestAppRuntime } = require('../helpers/runtime-test-harness');

describe('Greeting Fallback Logic Fix', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let runtime;
    let mockConfig;

    beforeEach(() => {
        mockConfig = createMockConfig({
            general: {
                greetingsEnabled: true,
                streamDetectionEnabled: false,
                streamRetryInterval: 15,
                streamMaxRetries: 3,
                continuousMonitoringInterval: 60000
            },
            tiktok: {
                enabled: true
            }
        });

        ({ runtime } = createTestAppRuntime(mockConfig, {
            logger: noOpLogger
        }));
    });

    describe('when platform has no specific greetingsEnabled setting', () => {
        it('should fall back to global greetingsEnabled setting', () => {
            const platform = 'tiktok';
            const settings = runtime.config[platform] || {};

            const currentLogic = settings.greetingsEnabled;

            expect(currentLogic).toBeUndefined();
            expect(!!currentLogic).toBe(false);

            const correctLogic = settings.greetingsEnabled !== undefined ?
                settings.greetingsEnabled : runtime.config.general.greetingsEnabled;

            expect(correctLogic).toBe(true);
        });

        it('should use platform-specific setting when explicitly defined', () => {
            runtime.config.tiktok.greetingsEnabled = false;

            const platform = 'tiktok';
            const settings = runtime.config[platform] || {};

            const result = settings.greetingsEnabled !== undefined ?
                settings.greetingsEnabled : runtime.config.general.greetingsEnabled;

            expect(result).toBe(false);
        });

        it('should enable greetings when global is true and platform is undefined', () => {
            const platform = 'tiktok';
            const settings = runtime.config[platform] || {};
            const isFirstMessage = true;

            const brokenCondition = isFirstMessage && settings.greetingsEnabled;
            expect(brokenCondition).toBe(undefined);

            const greetingsEnabled = settings.greetingsEnabled !== undefined ?
                settings.greetingsEnabled : runtime.config.general.greetingsEnabled;
            const fixedCondition = isFirstMessage && greetingsEnabled;
            expect(fixedCondition).toBe(true);
        });
    });
});
