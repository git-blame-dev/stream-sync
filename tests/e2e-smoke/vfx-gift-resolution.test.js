const { describe, expect, it } = require('bun:test');
const { ConfigValidator } = require('../../src/utils/config-validator');
const { CommandParser } = require('../../src/chat/commands');

describe('VFX gift resolution smoke E2E', () => {
    const createRawConfig = () => ({
        general: {
            giftsEnabled: 'true',
            commandsEnabled: 'true',
            keywordParsingEnabled: 'true'
        },
        obs: { enabled: 'false' },
        commands: {
            enabled: 'true',
            'test-single': '!testsingle, vfx top',
            'test-keyword': '!testkeyword, vfx top, test phrase',
            'test-multi': '!testalpha|!testbravo, vfx center green, alpha|bravo|charlie',
            'test-triple': '!testone|!testtwo|!testthree, vfx bottom green, one|two'
        },
        gifts: {
            command: '!testsingle|!testkeyword|!testalpha|!testone'
        },
        vfx: {
            vfxFilePath: '/test/vfx/path'
        },
        farewell: {
            enabled: 'false',
            command: ''
        }
    });

    it('command definitions survive normalization and reach CommandParser', () => {
        const rawConfig = createRawConfig();

        const normalized = ConfigValidator.normalize(rawConfig);

        expect(normalized.commands.enabled).toBe(true);
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

    it('gift command selection resolves to valid VFX config', () => {
        const rawConfig = createRawConfig();
        const normalized = ConfigValidator.normalize(rawConfig);

        const commandParser = new CommandParser({
            commands: normalized.commands,
            vfx: { filePath: normalized.vfx.vfxFilePath },
            general: normalized.general
        });

        const giftCommands = normalized.gifts.command.split('|').map(c => c.trim());
        
        giftCommands.forEach(giftCommand => {
            const vfxConfig = commandParser.getVFXConfig(giftCommand, giftCommand);
            expect(vfxConfig).not.toBeNull();
            expect(vfxConfig.filename).toBeDefined();
            expect(vfxConfig.mediaSource).toBeDefined();
        });
    });

    it('full path: raw config → normalize → CommandParser → VFX config for gift', () => {
        const rawConfig = createRawConfig();

        const normalized = ConfigValidator.normalize(rawConfig);

        const commandParser = new CommandParser({
            commands: normalized.commands,
            vfx: { filePath: normalized.vfx.vfxFilePath },
            general: normalized.general
        });

        const giftCommands = normalized.gifts.command.split('|');
        const selectedCommand = giftCommands[0];

        const vfxConfig = commandParser.getVFXConfig(selectedCommand, selectedCommand);

        expect(vfxConfig).not.toBeNull();
        expect(vfxConfig.filename).toBe('test-single');
        expect(vfxConfig.mediaSource).toBe('vfx top');
        expect(vfxConfig.vfxFilePath).toBe('/test/vfx/path');
        expect(vfxConfig.commandKey).toBe('test-single');
        expect(vfxConfig.command).toBe('!testsingle');
    });
});
