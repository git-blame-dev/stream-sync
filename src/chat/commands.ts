import { logger } from '../core/logging';
import { getDefaultEffectsManager } from '../obs/effects';

type ParsedCommandConfig = {
    filename: string;
    mediaSource: string | undefined;
    vfxFilePath: string;
    duration: number;
    commandKey: string;
    primaryCommand: string;
};

type VfxMatchType = 'trigger' | 'keyword';

type VfxRuntimeConfig = Omit<ParsedCommandConfig, 'primaryCommand'> & {
    command: string;
    keyword: string | null;
    matchType: VfxMatchType;
};

type CommandParseData = {
    comment?: unknown;
    message?: unknown;
    username?: unknown;
    platform?: unknown;
};

type RunCommandData = {
    vfx?: Partial<VfxRuntimeConfig> & { waitForCompletion?: boolean };
    filename?: string;
    mediaSource?: string;
    vfxFilePath?: string;
    duration?: number;
    waitForCompletion?: boolean;
};

type ParsedCommands = {
    triggers: Map<string, ParsedCommandConfig>;
    keywords: Map<string, ParsedCommandConfig>;
};

type ParsedFarewellCommands = {
    triggers: Set<string>;
    keywords: Set<string>;
};

type CommandParserConfig = {
    commands: Record<string, unknown>;
    farewell: Record<string, unknown>;
    vfx?: {
        filePath?: string;
    };
    general?: {
        keywordParsingEnabled?: boolean;
    };
};

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}


class CommandParser {
    commands: Record<string, unknown>;
    farewellCommands: Record<string, unknown>;
    vfxFilePath: string;
    keywordParsingEnabled: boolean;
    parsedCommands: ParsedCommands;
    parsedFarewellCommands: ParsedFarewellCommands;
    regexCache: Map<string, RegExp>;

    constructor(config: CommandParserConfig) {
        this.commands = config.commands;
        this.farewellCommands = config.farewell;
        this.vfxFilePath = config.vfx?.filePath || '';
        this.keywordParsingEnabled = !!(config.general?.keywordParsingEnabled);
        this.parsedCommands = this.parseCommandConfigurations();
        this.parsedFarewellCommands = this.parseFarewellConfigurations();
        this.regexCache = new Map();
    }

    parseDuration(parts: string[]): number {
        for (let i = 2; i < parts.length; i++) {
            const parsed = parseInt(parts[i] ?? '', 10);
            if (!isNaN(parsed) && parsed > 0) {
                return parsed;
            }
        }
        return 5000;
    }

    parseCommandConfigurations() {
        const parsed: ParsedCommands = {
            triggers: new Map<string, ParsedCommandConfig>(),
            keywords: new Map<string, ParsedCommandConfig>()
        };

        for (const [key, configLine] of Object.entries(this.commands)) {
            if (typeof configLine !== 'string') continue;

            const parts = configLine.split(',').map(p => p.trim());
            const triggerPart = parts[0] ?? '';
            const triggers = triggerPart.split('|').map(t => t.trim().toLowerCase());
            const keywords = (parts.length > 2) ? (parts[2] ?? '').split('|').map(k => k.trim().toLowerCase()).filter(k => k) : [];

            const config = {
                filename: key,
                mediaSource: parts[1],
                vfxFilePath: this.vfxFilePath,
                duration: this.parseDuration(parts),
                commandKey: key,
                primaryCommand: triggers[0] ?? ''
            };

            triggers.forEach(trigger => {
                parsed.triggers.set(trigger, config);
            });

            keywords.forEach(keyword => {
                if (keyword) {
                    parsed.keywords.set(keyword, config);
                }
            });
        }

        return parsed;
    }

    parseFarewellConfigurations() {
        const parsed = {
            triggers: new Set<string>(),
            keywords: new Set<string>()
        };

        let hasFarewellConfigText = false;

        for (const [key, configLine] of Object.entries(this.farewellCommands)) {
            if (key !== 'command' || typeof configLine !== 'string') continue;

            if (configLine.trim().length > 0) {
                hasFarewellConfigText = true;
            }

            const parts = configLine.split(',').map(p => p.trim());
            const triggers = (parts[0] || '').split('|').map(t => t.trim().toLowerCase());
            const keywords = (parts.length > 1) ? (parts[1] || '').split('|').map(k => k.trim().toLowerCase()) : [];

            triggers.forEach(trigger => {
                if (trigger) parsed.triggers.add(trigger);
            });

            keywords.forEach(keyword => {
                if (keyword) parsed.keywords.add(keyword);
            });
        }

        if (hasFarewellConfigText && parsed.triggers.size === 0 && parsed.keywords.size === 0) {
            logger.warn('[CommandParser] Farewell configuration contains no usable triggers or keywords', 'command-parser');
        }

        return parsed;
    }

    getCompiledRegex(keyword: string): RegExp {
        if (!this.regexCache.has(keyword)) {
            const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            this.regexCache.set(keyword, new RegExp(`\\b${escapedKeyword}\\b`, 'i'));
        }
        const regex = this.regexCache.get(keyword);
        if (!regex) {
            throw new Error(`Regex cache did not retain keyword: ${keyword}`);
        }
        return regex;
    }

    _createVFXConfig(baseConfig: ParsedCommandConfig, matchedText: string, matchType: VfxMatchType): VfxRuntimeConfig {
        return {
            filename: baseConfig.filename,
            mediaSource: baseConfig.mediaSource,
            vfxFilePath: baseConfig.vfxFilePath,
            duration: baseConfig.duration || 5000,
            commandKey: baseConfig.commandKey,

            command: baseConfig.primaryCommand,
            keyword: matchType === 'keyword' ? matchedText : null,
            matchType: matchType
        };
    }

    getVFXConfig(commandTrigger: unknown, message: unknown): VfxRuntimeConfig | null {
        if (!this.parsedCommands) {
            return null;
        }

        if (!commandTrigger || typeof commandTrigger !== 'string') {
            return null;
        }

        const normalizedMessage = typeof message === 'string' ? message : '';
        const triggerLower = commandTrigger.toLowerCase();

        const triggerConfig = this.parsedCommands.triggers.get(triggerLower);
        if (triggerConfig) {
            const vfxConfig = this._createVFXConfig(triggerConfig, commandTrigger, 'trigger');
            return vfxConfig;
        }

        if (this.keywordParsingEnabled && normalizedMessage) {
            for (const [keyword, config] of this.parsedCommands.keywords) {
                const regex = this.getCompiledRegex(keyword);
                if (regex.test(normalizedMessage)) {
                    const vfxConfig = this._createVFXConfig(config, keyword, 'keyword');
                    return vfxConfig;
                }
            }
        }
        return null;
    }

    getMatchingFarewell(message: string, commandTrigger: string): string | null {
        if (!this.parsedFarewellCommands || !message) {
            return null;
        }

        const triggerLower = commandTrigger.toLowerCase();

        if (this.parsedFarewellCommands.triggers.has(triggerLower)) {
            return commandTrigger;
        }

        if (this.keywordParsingEnabled) {
            for (const keyword of this.parsedFarewellCommands.keywords) {
                const regex = this.getCompiledRegex(keyword);
                if (regex.test(message)) {
                    return keyword;
                }
            }
        } else {
            logger.debug('[CommandParser] Keyword parsing disabled, skipping farewell keyword checks', 'command-parser');
        }

        return null;
    }

    parse(data: CommandParseData, isFirst: boolean) {
        const { comment, message, username } = data;
        const messageText = comment || message;
        if (!messageText || typeof messageText !== 'string') {
            return null;
        }

        const commandTrigger = (messageText.split(' ')[0] ?? '').toLowerCase();
        
        const farewellMatch = this.getMatchingFarewell(messageText, commandTrigger);
        if (farewellMatch) {
            return {
                type: 'farewell',
                username: username,
                platform: data.platform,
                trigger: farewellMatch
            };
        }

        const vfx = this.getVFXConfig(commandTrigger, messageText);
        if (vfx) {
            return { 
                type: 'vfx',
                filename: vfx.filename,
                mediaSource: vfx.mediaSource,
                vfxFilePath: vfx.vfxFilePath,
                duration: vfx.duration,
                commandKey: vfx.commandKey,
                
                command: vfx.command,
                keyword: vfx.keyword,
                matchType: vfx.matchType,
                username: username,
                platform: data.platform,
                isFirst: isFirst
            };
        }

        return null;
    }

    updateConfig(newConfig: Partial<CommandParserConfig>) {
        this.commands = newConfig.commands || this.commands;
        this.farewellCommands = newConfig.farewell || this.farewellCommands;
        this.vfxFilePath = newConfig.vfx?.filePath ?? this.vfxFilePath;
        if (typeof newConfig.general?.keywordParsingEnabled === 'boolean') {
            this.keywordParsingEnabled = newConfig.general.keywordParsingEnabled;
        }
        
        this.parsedCommands = this.parseCommandConfigurations();
        this.parsedFarewellCommands = this.parseFarewellConfigurations();
        
        this.regexCache.clear();
        
    }

    getStats() {
        const totalCommands = Object.keys(this.commands).length;
        const totalTriggers = this.parsedCommands ? this.parsedCommands.triggers.size : 0;
        const totalKeywords = this.parsedCommands ? this.parsedCommands.keywords.size : 0;
        
        return {
            totalCommands: totalCommands,
            totalTriggers: totalTriggers,
            totalKeywords: totalKeywords,
            keywordParsingEnabled: this.keywordParsingEnabled,
            vfxFilePath: this.vfxFilePath,
            commands: this.commands
        };
    }
}

async function runCommand(commandData: RunCommandData, vfxFilePath: string, effectsManager = getDefaultEffectsManager()) {
    let vfxData: RunCommandData | RunCommandData['vfx'];

    if (commandData.vfx) {
        ({ vfx: vfxData } = commandData);
    } else {
        vfxData = commandData;
    }

    if (!vfxData || (!vfxData.filename && !vfxData.mediaSource)) {
        return;
    }

    try {
        const commandConfig: { mediaSource?: string; filename?: string; vfxFilePath: string; duration: number } = {
            vfxFilePath: vfxData.vfxFilePath || vfxFilePath,
            duration: vfxData.duration || 5000
        };
        if (vfxData.mediaSource !== undefined) commandConfig.mediaSource = vfxData.mediaSource;
        if (vfxData.filename !== undefined) commandConfig.filename = vfxData.filename;

        const waitForCompletion = vfxData.waitForCompletion !== false;

        await effectsManager.playMediaInOBS(commandConfig, waitForCompletion);
    } catch (error) {
        logger.debug(`[runCommand] Failed to execute VFX for ${vfxData.filename || vfxData.mediaSource}. Error: ${getErrorMessage(error)}`, 'command-parser');
        throw error;
    }
}

export { CommandParser, runCommand };
