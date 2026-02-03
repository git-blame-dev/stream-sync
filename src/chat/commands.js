const { logger } = require('../core/logging');
const { getDefaultEffectsManager } = require('../obs/effects');


class CommandParser {
    constructor(config) {
        this.commands = config.commands || {};
        this.farewellCommands = config.farewell || {};
        
        // Use the configured VFX file path
        this.vfxFilePath = config.vfx?.filePath || '';
        
        // Keyword parsing configuration
        this.keywordParsingEnabled = this.getKeywordParsingSetting(config);
        
        // Only log essential configuration issues, not every configuration detail
        
        // Performance optimization: Pre-parse command configurations
        this.parsedCommands = this.parseCommandConfigurations();
        this.parsedFarewellCommands = this.parseFarewellConfigurations();
        
        // Cache for compiled regex patterns
        this.regexCache = new Map();
    }

    getKeywordParsingSetting(config) {
        // Check command line argument first (highest priority)
        if (config.cliArgs && config.cliArgs.disableKeywordParsing) {
            return false;
        }
        
        // Check config file setting
        if (config.general && config.general.keywordParsingEnabled !== undefined) {
            return config.general.keywordParsingEnabled;
        }
        
        // Default to enabled for backward compatibility
        return true;
    }

    parseDuration(parts) {
        // Check if there's a duration specified in the 3rd or 4th part
        for (let i = 2; i < parts.length; i++) {
            const parsed = parseInt(parts[i], 10);
            if (!isNaN(parsed) && parsed > 0) {
                return parsed;
            }
        }
        return 5000; // Default duration
    }

    parseCommandConfigurations() {
        const parsed = {
            triggers: new Map(), // trigger -> config
            keywords: new Map()  // keyword -> config
        };

        for (const [key, configLine] of Object.entries(this.commands)) {
            if (typeof configLine !== 'string') continue;

            const parts = configLine.split(',').map(p => p.trim());
            const triggers = parts[0].split('|').map(t => t.trim().toLowerCase());
            const keywords = (parts.length > 2) ? parts[2].split('|').map(k => k.trim().toLowerCase()).filter(k => k) : [];

            const config = {
                filename: key,           // Standardized: VFX file name
                mediaSource: parts[1],   // Standardized: OBS media source name
                vfxFilePath: this.vfxFilePath, // Standardized: Full path to VFX files directory
                duration: this.parseDuration(parts), // Standardized: Duration in milliseconds
                commandKey: key,         // Standardized: Command that triggers this VFX
                primaryCommand: triggers[0] // Store first trigger as primary command for display
            };

            // Index by triggers
            triggers.forEach(trigger => {
                parsed.triggers.set(trigger, config);
            });

            // Index by keywords
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
            triggers: new Set(),
            keywords: new Set()
        };

        for (const [key, configLine] of Object.entries(this.farewellCommands)) {
            if (key === 'enabled' || typeof configLine !== 'string') continue;

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

        return parsed;
    }

    getCompiledRegex(keyword) {
        if (!this.regexCache.has(keyword)) {
            // Escape special regex characters in the keyword
            const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // For multi-word keywords, use word boundaries around the entire phrase
            this.regexCache.set(keyword, new RegExp(`\\b${escapedKeyword}\\b`, 'i'));
        }
        return this.regexCache.get(keyword);
    }

    _createVFXConfig(baseConfig, matchedText, matchType) {
        return {
            // Standardized VFX config properties
            filename: baseConfig.filename,        // Standardized: VFX file name
            mediaSource: baseConfig.mediaSource,  // Standardized: OBS media source name
            vfxFilePath: baseConfig.vfxFilePath,  // Standardized: Full path to VFX files directory
            duration: baseConfig.duration || 5000, // Standardized: Duration in milliseconds
            commandKey: baseConfig.commandKey,    // Standardized: Command that triggers this VFX
            
            // Additional properties for backward compatibility and debugging
            command: baseConfig.primaryCommand,   // Always use primary command for display
            keyword: matchType === 'keyword' ? matchedText : null,
            matchType: matchType                  // Keep original match type
        };
    }

    getVFXConfig(commandTrigger, message) {
        if (!this.parsedCommands) {
            return null;
        }

        // Handle null/undefined commandTrigger
        if (!commandTrigger || typeof commandTrigger !== 'string') {
            return null;
        }

        const normalizedMessage = typeof message === 'string' ? message : '';
        const triggerLower = commandTrigger.toLowerCase();

        // Check triggers first (fastest lookup)
        const triggerConfig = this.parsedCommands.triggers.get(triggerLower);
        if (triggerConfig) {
            const vfxConfig = this._createVFXConfig(triggerConfig, commandTrigger, 'trigger');
            return vfxConfig;
        }

        // Check keywords (slower but necessary for keyword-based commands)
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

    getMatchingFarewell(message, commandTrigger) {
        if (!this.parsedFarewellCommands || !message) {
            return null;
        }

        const triggerLower = commandTrigger.toLowerCase();

        // Check triggers first (fastest lookup)
        if (this.parsedFarewellCommands.triggers.has(triggerLower)) {
            return commandTrigger;
        }

        // Check keywords
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

    parse(data, isFirst) {
        const { comment, message, username } = data;
        const messageText = comment || message; // Support both comment and message fields
        if (!messageText || typeof messageText !== 'string') {
            return null;
        }

        const commandTrigger = messageText.split(' ')[0].toLowerCase();
        
        // Check for farewell commands first
        const farewellMatch = this.getMatchingFarewell(messageText, commandTrigger);
        if (farewellMatch) {
            return {
                type: 'farewell',
                username: username,
                platform: data.platform,
                trigger: farewellMatch
            };
        }

        // Check for regular VFX commands
        const vfx = this.getVFXConfig(commandTrigger, messageText);
        if (vfx) {
            return { 
                type: 'vfx',
                // Standardized VFX config properties
                filename: vfx.filename,        // Standardized: VFX file name
                mediaSource: vfx.mediaSource,  // Standardized: OBS media source name
                vfxFilePath: vfx.vfxFilePath,  // Standardized: Full path to VFX files directory
                duration: vfx.duration,        // Standardized: Duration in milliseconds
                commandKey: vfx.commandKey,    // Standardized: Command that triggers this VFX
                
                // Additional properties
                command: vfx.command,
                keyword: vfx.keyword,
                matchType: vfx.matchType,
                username: username,
                platform: data.platform,
                isFirst: isFirst
            };
        }

        return null; // Not a command
    }

    updateConfig(newConfig) {
        this.commands = newConfig.commands || this.commands;
        this.farewellCommands = newConfig.farewell || this.farewellCommands;
        this.vfxFilePath = newConfig.vfx?.filePath ?? this.vfxFilePath;
        
        // Re-parse configurations
        this.parsedCommands = this.parseCommandConfigurations();
        this.parsedFarewellCommands = this.parseFarewellConfigurations();
        
        // Clear regex cache to prevent memory leaks
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
            commands: this.commands // Include commands object
        };
    }
}

async function runCommand(commandData, vfxFilePath, effectsManager = getDefaultEffectsManager()) {
    // Handle both old and new calling signatures
    let vfxData;

    if (commandData.vfx) {
        // New signature: structured object
        ({ vfx: vfxData } = commandData);
    } else {
        // Old signature: commandData is the VFX config directly
        vfxData = commandData;
    }

    // Validate standardized VFX config structure
    if (!vfxData || (!vfxData.filename && !vfxData.mediaSource)) {
        return;
    }

    try {
        const commandConfig = {
            mediaSource: vfxData.mediaSource,
            filename: vfxData.filename,
            vfxFilePath: vfxData.vfxFilePath || vfxFilePath,
            duration: vfxData.duration || 5000
        };

        // Standardize wait behavior (default true unless explicitly false)
        const waitForCompletion = vfxData.waitForCompletion !== false;

        await effectsManager.playMediaInOBS(commandConfig, waitForCompletion);
    } catch (error) {
        // Re-throw the error for test expectations
        logger.debug(`[runCommand] Failed to execute VFX for ${vfxData.filename || vfxData.mediaSource}. Error: ${error.message}`, 'command-parser');
        throw error;
    }
}

module.exports = { CommandParser, runCommand }; 
