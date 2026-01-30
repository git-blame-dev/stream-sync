const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn } = require('../../../helpers/bun-mock-utils');
const { createConfigFixture } = require('../../../helpers/config-fixture');

const crypto = require('crypto');
const { VFXCommandService } = require('../../../../src/services/VFXCommandService');

describe('VFXCommandService random variant selection', () => {
    const originalRandomInt = crypto.randomInt;
    let mockEffectsManager;
    let capturedCommands;

    const createConfig = (commandValue) => createConfigFixture({
        gifts: { command: commandValue },
        farewell: {},
        vfx: { filePath: '/tmp' },
        general: { cmdCoolDown: 60, globalCmdCooldownMs: 60000 }
    });

    beforeEach(() => {
        capturedCommands = [];
        mockEffectsManager = {
            playMediaInOBS: createMockFn().mockImplementation((config) => {
                capturedCommands.push(config);
                return Promise.resolve();
            })
        };
    });

    afterEach(() => {
        crypto.randomInt = originalRandomInt;
    });

    test('selects a single variant based on deterministic random value', async () => {
        const config = createConfig('!one | !two | !three');
        crypto.randomInt = createMockFn().mockReturnValue(1); // picks index 1 => !two

        const service = new VFXCommandService(config, null, {
            effectsManager: mockEffectsManager
        });
        service.commandParser = {
            getVFXConfig: createMockFn((message) => ({
                command: message,
                commandKey: message,
                filename: `${message}.mp4`,
                mediaSource: 'VFX Source',
                vfxFilePath: `${message}.vfx`,
                duration: 5000
            }))
        };

        const result = await service.executeCommandForKey('gifts', {
            username: 'testUser1',
            platform: 'tiktok',
            userId: 'test-user-123',
            skipCooldown: true
        });

        expect(result.success).toBe(true);
        expect(capturedCommands.length).toBe(1);
        expect(capturedCommands[0].filename).toBe('!two.mp4');
    });

    test('returns friendly failure when command key is missing from config', async () => {
        const config = createConfig(null);

        const service = new VFXCommandService(config, null, {
            effectsManager: mockEffectsManager
        });
        const result = await service.executeCommandForKey('gifts', {
            username: 'testUser1',
            platform: 'tiktok',
            userId: 'test-user-123',
            skipCooldown: true
        });

        expect(result.success).toBe(false);
        expect(result.reason).toBe('No VFX configured for gifts');
        expect(capturedCommands.length).toBe(0);
    });
});
