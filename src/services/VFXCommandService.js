
const crypto = require('crypto');
const { logger } = require('../core/logging');
const { CommandParser, runCommand } = require('../chat/commands');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { PlatformEvents } = require('../interfaces/PlatformEvents');

const vfxCommandErrorHandler = createPlatformErrorHandler(logger, 'vfx-service');

function handleVFXCommandError(message, error, eventType) {
    if (!eventType) {
        throw new Error('handleVFXCommandError requires eventType');
    }
    if (error instanceof Error) {
        vfxCommandErrorHandler.handleEventProcessingError(error, eventType, null, message);
    } else {
        vfxCommandErrorHandler.logOperationalError(message, 'vfx-service', error);
    }
}

class VFXCommandService {
    constructor(configService, eventBus) {
        if (!configService) {
            throw new Error('VFXCommandService requires configService');
        }
        this.configService = configService;
        this.eventBus = eventBus;
        
        // Initialize CommandParser with current config
        this.commandParser = null;
        this._initializeCommandParser();
        
        // Cooldown management
        this.userLastCommand = new Map();
        this.globalCommandCooldowns = new Map();
        this.userCommandTimestamps = new Map();
        
        // Command execution queue
        this.commandQueue = [];
        this.isProcessing = false;
        
        // Performance monitoring
        this.stats = {
            totalCommands: 0,
            successfulCommands: 0,
            failedCommands: 0,
            cooldownBlocked: 0,
            avgExecutionTime: 0
        };
        
        logger.debug('[VFXCommandService] Initialized', 'vfx-service', {
            hasConfigService: !!configService,
            hasEventBus: !!eventBus,
            hasCommandParser: !!this.commandParser
        });
    }

    async executeCommand(command, context) {
        const startTime = Date.now();
        this.stats.totalCommands++;
        
        try {
            if (!context || typeof context !== 'object') {
                throw new Error('executeCommand requires context');
            }
            const { username, platform, userId, skipCooldown, correlationId } = context;
            if (!platform || !userId || typeof skipCooldown !== 'boolean') {
                throw new Error('executeCommand requires platform, userId, and skipCooldown');
            }
            const commandUser = (typeof username === 'string') ? username.trim() : '';
            if (!commandUser) {
                return {
                    success: false,
                    error: 'Missing username',
                    command,
                    platform
                };
            }
            
            // Parse command to get VFX configuration
            const vfxConfig = await this.selectVFXCommand(command, command);
            if (!vfxConfig) {
                return {
                    success: false,
                    error: 'Command not found',
                    command,
                    username: commandUser,
                    platform
                };
            }

            // Check cooldowns unless skipped
            if (!skipCooldown) {
                if (!vfxConfig.commandKey) {
                    throw new Error('VFX config requires commandKey for cooldown checks');
                }
                const cooldownCheck = this.checkCommandCooldown(userId, vfxConfig.commandKey);
                if (!cooldownCheck.allowed) {
                    this.stats.cooldownBlocked++;
                    
                    if (this.eventBus) {
                        try {
                            this.eventBus.emit('vfx:cooldown-blocked', {
                                command,
                                username: commandUser,
                                platform,
                                cooldownInfo: cooldownCheck
                            });
                        } catch (eventError) {
                            handleVFXCommandError(`[VFXCommandService] EventBus error: ${eventError.message}`, eventError, 'event-bus');
                            // Don't re-throw here since we still want to return cooldown error
                        }
                    }
                    
                    return {
                        success: false,
                        error: 'Command on cooldown',
                        cooldownInfo: cooldownCheck,
                        command,
                        username: commandUser,
                        platform
                    };
                }
            }

            // Execute the command
            const executionResult = await this._executeVFXCommand(vfxConfig, { username: commandUser, platform });
            
            if (executionResult.success) {
                this.stats.successfulCommands++;
                
                // Update cooldowns after successful execution (only when cooldowns are enforced)
                if (!skipCooldown) {
                    this._updateCooldowns(userId, vfxConfig.commandKey);
                }
                
                if (this.eventBus) {
                    try {
                        if (!correlationId) {
                            throw new Error('executeCommand requires correlationId when emitting events');
                        }
                        const eventPayload = {
                            command,
                            commandKey: vfxConfig.commandKey,
                            filename: vfxConfig.filename,
                            mediaSource: vfxConfig.mediaSource,
                            username: commandUser,
                            platform,
                            userId,
                            correlationId,
                            vfxConfig,
                            result: executionResult,
                            duration: Date.now() - startTime,
                            context: { ...context, correlationId }
                        };

                        this.eventBus.emit(PlatformEvents.VFX_COMMAND_EXECUTED, eventPayload);
                        this.eventBus.emit(PlatformEvents.VFX_EFFECT_COMPLETED, eventPayload);
                    } catch (eventError) {
                        handleVFXCommandError(`[VFXCommandService] EventBus error: ${eventError.message}`, eventError, 'event-bus');
                        throw eventError; // Re-throw to be caught by outer catch
                    }
                }
            } else {
                this.stats.failedCommands++;
                
                if (this.eventBus) {
                    try {
                        this.eventBus.emit(PlatformEvents.VFX_COMMAND_FAILED, {
                            command,
                            username: commandUser,
                            platform,
                            vfxConfig,
                            error: executionResult.error
                        });
                    } catch (eventError) {
                        handleVFXCommandError(`[VFXCommandService] EventBus error: ${eventError.message}`, eventError, 'event-bus');
                        throw eventError; // Re-throw to be caught by outer catch
                    }
                }
            }
            
            // Update average execution time with weighted calculation
            const executionTime = Math.max(1, Date.now() - startTime); // Ensure minimum 1ms for tracking
            if (this.stats.totalCommands === 1) {
                this.stats.avgExecutionTime = executionTime;
            } else {
                // Running average: (oldAvg * (n-1) + newValue) / n
                this.stats.avgExecutionTime = ((this.stats.avgExecutionTime * (this.stats.totalCommands - 1)) + executionTime) / this.stats.totalCommands;
            }
            
            // Return enhanced result with command context for better user experience
            return {
                ...executionResult,
                command,
                username: commandUser,
                platform
            };

        } catch (error) {
            this.stats.failedCommands++;
            handleVFXCommandError(`[VFXCommandService] Command execution error: ${error.message}`, error, 'command-execution');
            const safeContext = context && typeof context === 'object' ? context : {};
            return {
                success: false,
                error: error.message,
                command,
                username: (typeof safeContext.username === 'string' && safeContext.username.trim()) ? safeContext.username.trim() : null,
                platform: (typeof safeContext.platform === 'string') ? safeContext.platform : null
            };
        }
    }


    async selectVFXCommand(message, contextMessage) {
        if (!this.commandParser) {
            throw new Error('VFXCommandService requires commandParser');
        }
        if (arguments.length < 2) {
            throw new Error('selectVFXCommand requires contextMessage (use null when none)');
        }
        if (!message) {
            throw new Error('VFXCommandService requires message');
        }
        if (contextMessage !== null && typeof contextMessage !== 'string') {
            throw new Error('VFXCommandService contextMessage must be a string or null');
        }

        try {
            // Use existing CommandParser to get VFX config
            const parserMessage = contextMessage !== null && contextMessage !== undefined
                ? contextMessage
                : message;
            const vfxConfig = this.commandParser.getVFXConfig(message, parserMessage);
            
            if (vfxConfig) {
                logger.debug(`[VFXCommandService] Command found: ${vfxConfig.filename}`, 'vfx-service');
                return vfxConfig;
            }
            
            return null;

        } catch (error) {
            handleVFXCommandError(`[VFXCommandService] Error selecting VFX command: ${error.message}`, error, 'select-command');
            throw error;
        }
    }

    async getVFXConfig(commandKey, message) {
        if (arguments.length < 2) {
            throw new Error('getVFXConfig requires message (use null when none)');
        }
        if (!commandKey || typeof commandKey !== 'string') {
            throw new Error('getVFXConfig requires commandKey');
        }
        if (message !== null && typeof message !== 'string') {
            throw new Error('getVFXConfig message must be a string or null');
        }

        try {
            // Get command from configuration
            const command = this.configService.getCommand(commandKey);
            
            if (!command) {
                logger.debug(`[VFXCommandService] No command configured for key: ${commandKey}`, 'vfx-service');
                return null;
            }

            const selectedCommand = this._selectCommandVariant(command);
            if (!selectedCommand) {
                logger.debug(`[VFXCommandService] No valid command variant for key: ${commandKey}`, 'vfx-service');
                return null;
            }

            // Parse the command to get VFX config  
            const contextMessage = message !== null ? message : selectedCommand;
            return await this.selectVFXCommand(selectedCommand, contextMessage);

        } catch (error) {
            handleVFXCommandError(`[VFXCommandService] Error getting VFX config for ${commandKey}: ${error.message}`, error, 'get-config');
            throw error;
        }
    }

    async executeCommandForKey(commandKey, context) {
        try {
            if (!commandKey) {
                return {
                    success: false,
                    reason: 'Missing command key'
                };
            }
            if (!context || typeof context !== 'object') {
                throw new Error('executeCommandForKey requires context');
            }
            const { username, platform, userId, skipCooldown, correlationId } = context;
            if (!platform || !userId || typeof skipCooldown !== 'boolean') {
                throw new Error('executeCommandForKey requires platform, userId, and skipCooldown');
            }
            if (this.eventBus && !correlationId) {
                throw new Error('executeCommandForKey requires correlationId when events are enabled');
            }
            const commandUser = (typeof username === 'string') ? username.trim() : '';
            if (!commandUser) {
                throw new Error('executeCommandForKey requires username');
            }

            const command = this.configService.getCommand(commandKey);
            if (!command) {
                return {
                    success: false,
                    reason: `No VFX configured for ${commandKey}`
                };
            }

            const commandMessage = Object.prototype.hasOwnProperty.call(context, 'message')
                ? context.message
                : null;
            const vfxConfig = await this.getVFXConfig(commandKey, commandMessage);
            if (!vfxConfig) {
                return {
                    success: false,
                    reason: `No VFX configured for ${commandKey}`
                };
            }

            const resolvedCommand = vfxConfig.command;
            if (!resolvedCommand) {
                throw new Error('VFX config requires command');
            }
            return await this.executeCommand(resolvedCommand, {
                ...context,
                skipCooldown: context.skipCooldown
            });
        } catch (error) {
            handleVFXCommandError(`[VFXCommandService] Error executing command for key ${commandKey}: ${error.message}`, error, 'notification');
            return {
                success: false,
                reason: error.message
            };
        }
    }

    checkCommandCooldown(userId, command) {
        try {
            const now = Date.now();
            const userCooldownSecRaw = this.configService.get('general', 'cmdCoolDown');
            const globalCooldownMsRaw = this.configService.get('general', 'globalCmdCooldownMs');
            const userCooldownSec = Number(userCooldownSecRaw);
            const globalCooldownMs = Number(globalCooldownMsRaw);
            if (!Number.isFinite(userCooldownSec) || !Number.isFinite(globalCooldownMs)) {
                throw new Error('Cooldown config values must be numeric');
            }
            const userCooldownMs = userCooldownSec * 1000;
            
            // Check user cooldown
            const hasUserCommand = this.userLastCommand.has(userId);
            const lastUserCommand = this.userLastCommand.get(userId);
            if (hasUserCommand && userCooldownMs > 0 && (now - lastUserCommand) < userCooldownMs) {
                return {
                    allowed: false,
                    type: 'user',
                    remainingMs: userCooldownMs - (now - lastUserCommand),
                    cooldownMs: userCooldownMs
                };
            }
            
            // Check global command cooldown
            const hasGlobalCommand = this.globalCommandCooldowns.has(command);
            const lastGlobalCommand = this.globalCommandCooldowns.get(command);
            if (hasGlobalCommand && globalCooldownMs > 0 && (now - lastGlobalCommand) < globalCooldownMs) {
                return {
                    allowed: false,
                    type: 'global',
                    remainingMs: globalCooldownMs - (now - lastGlobalCommand),
                    cooldownMs: globalCooldownMs
                };
            }
            
            return {
                allowed: true,
                type: 'none'
            };

        } catch (error) {
            handleVFXCommandError(`[VFXCommandService] Error checking cooldown: ${error.message}`, error, 'cooldown');
            throw error;
        }
    }

    getStatus() {
        return {
            isActive: !!this.commandParser,
            queueLength: this.commandQueue.length,
            isProcessing: this.isProcessing,
            activeCooldowns: {
                users: this.userLastCommand.size,
                globalCommands: this.globalCommandCooldowns.size
            },
            stats: { ...this.stats }
        };
    }

    reloadConfig() {
        try {
            const oldParser = this.commandParser;
            this._initializeCommandParser();
            
            // Check if initialization was successful
            if (!this.commandParser && this.configService) {
                // Restore old parser on failure
                this.commandParser = oldParser;
                return false;
            }
            
            logger.info('[VFXCommandService] Configuration reloaded', 'vfx-service');
            return true;
        } catch (error) {
            handleVFXCommandError(`[VFXCommandService] Error reloading config: ${error.message}`, error, 'config-reload');
            return false;
        }
    }

    // Private methods

    _initializeCommandParser() {
        try {
            // Get configuration in format expected by CommandParser
            const config = {
                commands: this.configService.get('commands'),
                farewell: this.configService.get('farewell'),
                vfx: {
                    filePath: this.configService.get('vfx', 'filePath')
                },
                general: this.configService.get('general')
            };

            this.commandParser = new CommandParser(config);
            logger.debug('[VFXCommandService] CommandParser initialized', 'vfx-service');

        } catch (error) {
            handleVFXCommandError(`[VFXCommandService] Error initializing CommandParser: ${error.message}`, error, 'parser-init');
            this.commandParser = null;
        }
    }

    async _executeVFXCommand(vfxConfig, context) {
        try {
            // Prepare command data in format expected by runCommand
            const commandData = {
                vfx: vfxConfig,
                username: context.username,
                platform: context.platform
            };

            // Use existing runCommand function
            await runCommand(commandData, vfxConfig.vfxFilePath);
            
            return {
                success: true,
                vfxConfig,
                executedAt: Date.now()
            };

        } catch (error) {
            handleVFXCommandError(`[VFXCommandService] VFX execution failed: ${error.message}`, error, 'execution');
            return {
                success: false,
                error: error.message,
                vfxConfig
            };
        }
    }

    _updateCooldowns(userId, command) {
        const now = Date.now();
        
        // Update user cooldown
        this.userLastCommand.set(userId, now);
        
        // Update user command timestamps for tracking
        if (!this.userCommandTimestamps.has(userId)) {
            this.userCommandTimestamps.set(userId, []);
        }
        this.userCommandTimestamps.get(userId).push(now);
        
        // Keep only recent timestamps (last hour)
        const oneHourAgo = now - (60 * 60 * 1000);
        const timestamps = this.userCommandTimestamps.get(userId);
        this.userCommandTimestamps.set(userId, timestamps.filter(t => t > oneHourAgo));
        
        // Update global command cooldown
        this.globalCommandCooldowns.set(command, now);
        
        // Clean up old global cooldowns (older than 10 minutes)
        const tenMinutesAgo = now - (10 * 60 * 1000);
        for (const [cmd, timestamp] of this.globalCommandCooldowns) {
            if (timestamp < tenMinutesAgo) {
                this.globalCommandCooldowns.delete(cmd);
            }
        }
    }

    _selectCommandVariant(commandSpec) {
        if (!commandSpec || typeof commandSpec !== 'string') {
            return null;
        }

        const normalizedSpec = commandSpec.trim();
        if (!normalizedSpec) {
            return null;
        }

        if (!normalizedSpec.includes('|')) {
            return normalizedSpec;
        }

        const options = normalizedSpec
            .split('|')
            .map(option => option.trim())
            .filter(option => option.length > 0);

        if (!options.length) {
            return null;
        }

        const randomIndex = crypto.randomInt(options.length);
        return options[randomIndex];
    }

}

function createVFXCommandService(configService, eventBus = null) {
    if (arguments.length < 2) {
        throw new Error('createVFXCommandService requires configService and eventBus (use null when none)');
    }
    return new VFXCommandService(configService, eventBus);
}

// Export the class and factory
module.exports = {
    VFXCommandService,
    createVFXCommandService
};
