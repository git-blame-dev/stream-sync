const { describe, expect, it } = require('bun:test');
const { ConfigValidator } = require('../../src/utils/config-validator');
const { CommandParser } = require('../../src/chat/commands');
const { VFXCommandService } = require('../../src/services/VFXCommandService');

describe('VFX chat command resolution smoke E2E', () => {
    const createRawConfig = () => ({
        general: {
            giftsEnabled: 'true',
            commandsEnabled: 'true',
            keywordParsingEnabled: 'true'
        },
        obs: { enabled: 'false' },
        commands: {
            'test-single': '!testsingle, vfx top',
            'test-keyword': '!testkeyword, vfx top, test phrase',
            'test-multi': '!testalpha|!testbravo, vfx center green, alpha|bravo|charlie',
            'test-triple': '!testone|!testtwo|!testthree, vfx bottom green, one|two'
        },
        gifts: {},
        vfx: {
            vfxFilePath: '/test/vfx/path'
        },
        farewell: {
            command: ''
        }
    });

    it('command definitions survive normalization and reach CommandParser', () => {
        const rawConfig = createRawConfig();

        const normalized = ConfigValidator.normalize(rawConfig);

        expect(normalized.commands['test-single']).toBe('!testsingle, vfx top');
        expect(normalized.commands['test-keyword']).toBe('!testkeyword, vfx top, test phrase');
        expect(normalized.commands['test-multi']).toBe('!testalpha|!testbravo, vfx center green, alpha|bravo|charlie');
        expect(normalized.commands['test-triple']).toBe('!testone|!testtwo|!testthree, vfx bottom green, one|two');
    });

    it('CommandParser populates triggers Map from normalized config', () => {
        const rawConfig = createRawConfig();
        const normalized = ConfigValidator.normalize(rawConfig);

        const commandParser = new CommandParser({
            commands: normalized.commands,
            vfx: { filePath: normalized.vfx.vfxFilePath },
            general: normalized.general
        });

        expect(commandParser.parsedCommands.triggers.size).toBeGreaterThan(0);
        expect(commandParser.parsedCommands.triggers.has('!testsingle')).toBe(true);
        expect(commandParser.parsedCommands.triggers.has('!testkeyword')).toBe(true);
        expect(commandParser.parsedCommands.triggers.has('!testalpha')).toBe(true);
        expect(commandParser.parsedCommands.triggers.has('!testbravo')).toBe(true);
        expect(commandParser.parsedCommands.triggers.has('!testone')).toBe(true);
        expect(commandParser.parsedCommands.triggers.has('!testtwo')).toBe(true);
        expect(commandParser.parsedCommands.triggers.has('!testthree')).toBe(true);
    });

    it('CommandParser populates keywords Map from normalized config', () => {
        const rawConfig = createRawConfig();
        const normalized = ConfigValidator.normalize(rawConfig);

        const commandParser = new CommandParser({
            commands: normalized.commands,
            vfx: { filePath: normalized.vfx.vfxFilePath },
            general: normalized.general
        });

        expect(commandParser.parsedCommands.keywords.size).toBeGreaterThan(0);
        expect(commandParser.parsedCommands.keywords.has('test phrase')).toBe(true);
        expect(commandParser.parsedCommands.keywords.has('alpha')).toBe(true);
        expect(commandParser.parsedCommands.keywords.has('bravo')).toBe(true);
        expect(commandParser.parsedCommands.keywords.has('charlie')).toBe(true);
        expect(commandParser.parsedCommands.keywords.has('one')).toBe(true);
        expect(commandParser.parsedCommands.keywords.has('two')).toBe(true);
    });

    it('getVFXConfig returns correct config for single trigger command', () => {
        const rawConfig = createRawConfig();
        const normalized = ConfigValidator.normalize(rawConfig);

        const commandParser = new CommandParser({
            commands: normalized.commands,
            vfx: { filePath: normalized.vfx.vfxFilePath },
            general: normalized.general
        });

        const vfxConfig = commandParser.getVFXConfig('!testsingle', '!testsingle');

        expect(vfxConfig).not.toBeNull();
        expect(vfxConfig.filename).toBe('test-single');
        expect(vfxConfig.mediaSource).toBe('vfx top');
        expect(vfxConfig.vfxFilePath).toBe('/test/vfx/path');
        expect(vfxConfig.commandKey).toBe('test-single');
    });

    it('getVFXConfig returns correct config for multi-trigger command', () => {
        const rawConfig = createRawConfig();
        const normalized = ConfigValidator.normalize(rawConfig);

        const commandParser = new CommandParser({
            commands: normalized.commands,
            vfx: { filePath: normalized.vfx.vfxFilePath },
            general: normalized.general
        });

        const vfxConfigOne = commandParser.getVFXConfig('!testone', '!testone');
        const vfxConfigTwo = commandParser.getVFXConfig('!testtwo', '!testtwo');
        const vfxConfigThree = commandParser.getVFXConfig('!testthree', '!testthree');

        expect(vfxConfigOne).not.toBeNull();
        expect(vfxConfigTwo).not.toBeNull();
        expect(vfxConfigThree).not.toBeNull();

        expect(vfxConfigOne.filename).toBe('test-triple');
        expect(vfxConfigTwo.filename).toBe('test-triple');
        expect(vfxConfigThree.filename).toBe('test-triple');
    });

    it('getVFXConfig returns correct config for keyword match', () => {
        const rawConfig = createRawConfig();
        const normalized = ConfigValidator.normalize(rawConfig);

        const commandParser = new CommandParser({
            commands: normalized.commands,
            vfx: { filePath: normalized.vfx.vfxFilePath },
            general: normalized.general
        });

        const vfxConfig = commandParser.getVFXConfig('!nomatch', 'that was a test phrase moment');

        expect(vfxConfig).not.toBeNull();
        expect(vfxConfig.filename).toBe('test-keyword');
        expect(vfxConfig.keyword).toBe('test phrase');
        expect(vfxConfig.matchType).toBe('keyword');
    });
});

describe('VFX notification resolution smoke E2E', () => {
    const createRawConfig = () => ({
        general: {
            giftsEnabled: 'true',
            commandsEnabled: 'true',
            keywordParsingEnabled: 'true'
        },
        obs: { enabled: 'false' },
        commands: {
            'test-gift-vfx': '!testgift, vfx top',
            'test-follow-vfx': '!testfollow, vfx bottom green',
            'test-raid-vfx': '!testraid, vfx center green'
        },
        gifts: {
            command: '!testgift'
        },
        follows: {
            command: '!testfollow'
        },
        raids: {
            command: '!testraid'
        },
        paypiggies: {
            command: ''
        },
        greetings: {
            command: ''
        },
        shares: {
            command: ''
        },
        vfx: {
            vfxFilePath: '/test/vfx/path'
        },
        farewell: {
            command: ''
        }
    });

    it('gifts.command survives config normalization', () => {
        const rawConfig = createRawConfig();
        const normalized = ConfigValidator.normalize(rawConfig);

        expect(normalized.gifts.command).toBe('!testgift');
    });

    it('follows.command survives config normalization', () => {
        const rawConfig = createRawConfig();
        const normalized = ConfigValidator.normalize(rawConfig);

        expect(normalized.follows.command).toBe('!testfollow');
    });

    it('raids.command survives config normalization', () => {
        const rawConfig = createRawConfig();
        const normalized = ConfigValidator.normalize(rawConfig);

        expect(normalized.raids.command).toBe('!testraid');
    });

    it('VFXCommandService.getVFXConfig returns valid config for gifts', async () => {
        const rawConfig = createRawConfig();
        const normalized = ConfigValidator.normalize(rawConfig);
        const vfxService = new VFXCommandService(normalized, null);

        const vfxConfig = await vfxService.getVFXConfig('gifts', null);

        expect(vfxConfig).not.toBeNull();
        expect(vfxConfig.filename).toBe('test-gift-vfx');
        expect(vfxConfig.mediaSource).toBe('vfx top');
    });

    it('VFXCommandService.getVFXConfig returns valid config for follows', async () => {
        const rawConfig = createRawConfig();
        const normalized = ConfigValidator.normalize(rawConfig);
        const vfxService = new VFXCommandService(normalized, null);

        const vfxConfig = await vfxService.getVFXConfig('follows', null);

        expect(vfxConfig).not.toBeNull();
        expect(vfxConfig.filename).toBe('test-follow-vfx');
        expect(vfxConfig.mediaSource).toBe('vfx bottom green');
    });

    it('VFXCommandService.getVFXConfig returns valid config for raids', async () => {
        const rawConfig = createRawConfig();
        const normalized = ConfigValidator.normalize(rawConfig);
        const vfxService = new VFXCommandService(normalized, null);

        const vfxConfig = await vfxService.getVFXConfig('raids', null);

        expect(vfxConfig).not.toBeNull();
        expect(vfxConfig.filename).toBe('test-raid-vfx');
        expect(vfxConfig.mediaSource).toBe('vfx center green');
    });

    it('VFXCommandService.getVFXConfig returns null when no command configured', async () => {
        const rawConfig = createRawConfig();
        const normalized = ConfigValidator.normalize(rawConfig);
        const vfxService = new VFXCommandService(normalized, null);

        const vfxConfig = await vfxService.getVFXConfig('paypiggies', null);

        expect(vfxConfig).toBeNull();
    });
});
