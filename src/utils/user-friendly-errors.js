
const { createPlatformErrorHandler } = require('./platform-error-handler');

const ERROR_MESSAGES = {
    // Authentication Errors
    'missing_twitch_credentials': {
        title: 'Twitch Setup Required',
        message: 'Your Twitch connection needs to be set up. This is required to use Twitch features.',
        action: 'Please run the setup process to connect your Twitch account.',
        severity: 'error',
        category: 'authentication'
    },
    
    'twitch_token_expired': {
        title: 'Twitch Connection Expired',
        message: 'Your Twitch connection has expired and needs to be refreshed.',
        action: 'The bot will automatically guide you through refreshing your Twitch connection.',
        severity: 'warning',
        category: 'authentication'
    },
    
    'invalid_twitch_token': {
        title: 'Twitch Connection Problem',
        message: 'There\'s an issue with your Twitch connection. This can happen when Twitch updates their security.',
        action: 'Please reconnect your Twitch account to fix this issue.',
        severity: 'error',
        category: 'authentication'
    },
    
    'oauth_flow_failed': {
        title: 'Account Connection Failed',
        message: 'We couldn\'t connect to your Twitch account. This might be due to a browser issue or connection problem.',
        action: 'Please try again, or check if your browser is blocking the connection.',
        severity: 'error',
        category: 'authentication'
    },
    
    // Configuration Errors
    'missing_config_file': {
        title: 'Settings File Missing',
        message: 'The bot\'s settings file couldn\'t be found.',
        action: 'Please make sure the settings file exists in the bot\'s folder.',
        severity: 'error',
        category: 'configuration'
    },
    
    'invalid_config_format': {
        title: 'Settings File Problem',
        message: 'There\'s an issue with your settings file format.',
        action: 'Please check your settings file for any typing errors or missing sections.',
        severity: 'error',
        category: 'configuration'
    },
    
    'missing_required_config': {
        title: 'Setup Incomplete',
        message: 'Some required settings are missing.',
        action: 'Please complete the setup by filling in all required settings in your settings file.',
        severity: 'error',
        category: 'configuration'
    },

    'missing_twitch_username': {
        title: 'Twitch Username Required',
        message: 'Twitch is enabled but the username is missing from your settings.',
        action: 'Add a username under the [twitch] section or disable Twitch.',
        severity: 'error',
        category: 'configuration'
    },

    'missing_youtube_username': {
        title: 'YouTube Username Required',
        message: 'YouTube is enabled but the username is missing from your settings.',
        action: 'Add a username under the [youtube] section or disable YouTube.',
        severity: 'error',
        category: 'configuration'
    },

    'missing_tiktok_username': {
        title: 'TikTok Username Required',
        message: 'TikTok is enabled but the username is missing from your settings.',
        action: 'Add a username under the [tiktok] section or disable TikTok.',
        severity: 'error',
        category: 'configuration'
    },
    
    'youtube_api_key_missing': {
        title: 'YouTube Setup Required',
        message: 'To connect to YouTube, you need to add your YouTube access key.',
        action: 'Please add your YouTube access key to your settings file, or disable YouTube if you don\'t need it.',
        severity: 'warning',
        category: 'configuration'
    },
    
    'tiktok_credentials_missing': {
        title: 'TikTok Setup Required',
        message: 'To connect to TikTok, you need to add your TikTok credentials.',
        action: 'Please add your TikTok access credentials to your settings file, or disable TikTok if you don\'t need it.',
        severity: 'warning',
        category: 'configuration'
    },
    
    // Connection Errors
    'obs_connection_failed': {
        title: 'OBS Connection Problem',
        message: 'The bot cannot connect to OBS Studio. Make sure OBS is running and the connection feature is enabled.',
        action: 'Start OBS Studio and enable the connection server in Tools → Server Settings.',
        severity: 'warning',
        category: 'connection'
    },
    
    'platform_connection_failed': {
        title: 'Platform Connection Problem',
        message: 'The bot cannot connect to one of the streaming platforms.',
        action: 'Please check your internet connection and platform credentials.',
        severity: 'error',
        category: 'connection'
    },
    
    'network_error': {
        title: 'Internet Connection Problem',
        message: 'The bot is having trouble connecting to the internet.',
        action: 'Please check your internet connection and try again.',
        severity: 'error',
        category: 'connection'
    },
    
    // Runtime Errors
    'permission_denied': {
        title: 'File Access Problem',
        message: 'The bot doesn\'t have permission to access a required file or folder.',
        action: 'Please make sure the bot has permission to read and write files in its folder.',
        severity: 'error',
        category: 'system'
    },
    
    'disk_full': {
        title: 'Storage Space Problem',
        message: 'Your computer is running low on storage space.',
        action: 'Please free up some disk space and try again.',
        severity: 'error',
        category: 'system'
    },
    
    'memory_low': {
        title: 'Memory Problem',
        message: 'Your computer is running low on memory.',
        action: 'Please close some other programs and try again.',
        severity: 'warning',
        category: 'system'
    },
    
    // PHASE 5B: Enhanced Platform-Specific Error Messages
    'youtube_connection_timeout': {
        title: 'YouTube Connection Problem',
        message: 'YouTube connection temporarily unavailable. This can happen during high traffic periods.',
        action: 'Please wait a moment and the bot will automatically retry connecting to YouTube.',
        severity: 'warning',
        category: 'connection'
    },
    
    'tiktok_connection_lost': {
        title: 'TikTok Connection Lost',
        message: 'TikTok connection was interrupted. This is usually temporary.',
        action: 'The bot will automatically attempt to reconnect to TikTok.',
        severity: 'warning',
        category: 'connection'
    },
    
    'twitch_rate_limit': {
        title: 'Twitch Connection Busy',
        message: 'Twitch is temporarily limiting connections. This protects your account from being overloaded.',
        action: 'Please wait a few minutes. The bot will automatically resume when the limit clears.',
        severity: 'info',
        category: 'connection'
    },
    
    'streaming_platform_unavailable': {
        title: 'Streaming Platform Unavailable',
        message: 'One of the streaming platforms is currently down for maintenance.',
        action: 'Other platforms will continue working normally. The unavailable platform will reconnect when service resumes.',
        severity: 'info',
        category: 'connection'
    },
    
    'notification_display_error': {
        title: 'Display Problem',
        message: 'There was an issue showing a notification on screen.',
        action: 'Notifications will continue working. If this happens frequently, please restart the bot.',
        severity: 'warning',
        category: 'system'
    },
    
    'international_character_error': {
        title: 'Text Display Issue',
        message: 'Some international characters could not be displayed properly.',
        action: 'The message will still be processed, but some characters may appear differently.',
        severity: 'info',
        category: 'system'
    }
};

const TECHNICAL_ERROR_PATTERNS = [
    {
        patterns: [
            /ENOENT.*config\.ini/i,
            /Cannot find.*config/i,
            /Configuration file.*not found/i
        ],
        errorKey: 'missing_config_file'
    },
    {
        patterns: [
            /Missing clientId or clientSecret/i,
            /Invalid configuration.*missing fields.*clientId/i
        ],
        errorKey: 'missing_twitch_credentials'
    },
    {
        patterns: [
            /401.*Invalid OAuth token/i,
            /Access token expired/i,
            /Token.*expired/i,
            /Twitch access token has expired/i
        ],
        errorKey: 'twitch_token_expired'
    },
    {
        patterns: [
            /Authentication failed/i,
            /Invalid refresh token/i,
            /Token validation failed/i
        ],
        errorKey: 'invalid_twitch_token'
    },
    {
        patterns: [
            /OAuth flow failed/i,
            /Token exchange failed/i,
            /Authorization.*failed/i
        ],
        errorKey: 'oauth_flow_failed'
    },
    {
        patterns: [
            /ENOENT.*config\.ini/i,
            /Cannot find.*config/i,
            /Configuration file.*not found/i
        ],
        errorKey: 'missing_config_file'
    },
    {
        patterns: [
            /Invalid configuration format/i,
            /Failed to load configuration/i,
            /Parse error.*config/i
        ],
        errorKey: 'invalid_config_format'
    },
    {
        patterns: [
            /Missing required configuration: Twitch username/i,
            /Missing.*Twitch.*username/i
        ],
        errorKey: 'missing_twitch_username'
    },
    {
        patterns: [
            /Missing required configuration: YouTube username/i,
            /Missing.*YouTube.*username/i
        ],
        errorKey: 'missing_youtube_username'
    },
    {
        patterns: [
            /Missing required configuration: TikTok username/i,
            /Missing.*TikTok.*username/i
        ],
        errorKey: 'missing_tiktok_username'
    },
    {
        patterns: [
            /Missing required configuration/i,
            /Required.*section.*missing/i
        ],
        errorKey: 'missing_required_config'
    },
    {
        patterns: [
            /YouTube.*API.*key/i,
            /Missing.*YouTube.*configuration/i
        ],
        errorKey: 'youtube_api_key_missing'
    },
    {
        patterns: [
            /TikTok.*credential/i,
            /Missing.*TikTok.*configuration/i
        ],
        errorKey: 'tiktok_credentials_missing'
    },
    {
        patterns: [
            /Failed to connect to OBS/i,
            /OBS.*connection.*failed/i,
            /WebSocket.*OBS.*failed/i
        ],
        errorKey: 'obs_connection_failed'
    },
    {
        patterns: [
            /Failed to connect to platform/i,
            /Platform connection failed/i,
            /Cannot connect.*platform/i
        ],
        errorKey: 'platform_connection_failed'
    },
    {
        patterns: [
            /ECONNREFUSED/i,
            /ECONNRESET/i,
            /ENOTFOUND/i,
            /Network.*error/i,
            /Connection.*timeout/i
        ],
        errorKey: 'network_error'
    },
    {
        patterns: [
            /EACCES/i,
            /Permission denied/i,
            /Access.*denied/i
        ],
        errorKey: 'permission_denied'
    },
    {
        patterns: [
            /ENOSPC/i,
            /No space left/i,
            /Disk.*full/i
        ],
        errorKey: 'disk_full'
    },
    {
        patterns: [
            /ENOMEM/i,
            /Out of memory/i,
            /Memory.*exceeded/i
        ],
        errorKey: 'memory_low'
    },
    // PHASE 5B: Enhanced Platform-Specific Error Patterns
    {
        patterns: [
            /YouTube.*connection.*timeout/i,
            /YouTube.*temporarily unavailable/i,
            /YouTube.*connection.*failed.*timeout/i,
            /timeout.*after.*30000ms.*youtube/i
        ],
        errorKey: 'youtube_connection_timeout'
    },
    {
        patterns: [
            /TikTok.*connection.*lost/i,
            /TikTok.*connection.*interrupted/i,
            /TikTok.*connection.*dropped/i,
            /EulerStream.*connection.*failed/i
        ],
        errorKey: 'tiktok_connection_lost'
    },
    {
        patterns: [
            /Twitch.*rate.*limit/i,
            /429.*too many requests.*twitch/i,
            /Twitch.*connections.*limited/i,
            /Rate limit exceeded.*twitch/i
        ],
        errorKey: 'twitch_rate_limit'
    },
    {
        patterns: [
            /Platform.*unavailable/i,
            /Streaming.*platform.*down/i,
            /Service.*temporarily.*unavailable/i,
            /Platform.*maintenance/i
        ],
        errorKey: 'streaming_platform_unavailable'
    },
    {
        patterns: [
            /Notification.*display.*error/i,
            /Failed.*to.*show.*notification/i,
            /Display.*queue.*error/i,
            /OBS.*text.*source.*error/i
        ],
        errorKey: 'notification_display_error'
    },
    {
        patterns: [
            /International.*character.*error/i,
            /Unicode.*encoding.*error/i,
            /Character.*encoding.*failed/i,
            /Invalid.*UTF-8.*sequence/i
        ],
        errorKey: 'international_character_error'
    }
];

function translateError(technicalError, context = {}) {
    const errorMessage = technicalError instanceof Error ? technicalError.message : String(technicalError);
    
    // Find matching pattern
    for (const { patterns, errorKey } of TECHNICAL_ERROR_PATTERNS) {
        if (patterns.some(pattern => pattern.test(errorMessage))) {
            const friendlyError = ERROR_MESSAGES[errorKey];
            if (friendlyError) {
                return {
                    ...friendlyError,
                    technicalDetails: context.includeTechnical ? errorMessage : undefined,
                    context: context
                };
            }
        }
    }
    
    // Fallback for unrecognized errors
    return {
        title: 'Unexpected Problem',
        message: 'Something unexpected happened. This might be a temporary issue.',
        action: 'Please try again. If the problem continues, check the logs for more details.',
        severity: 'error',
        category: 'unknown',
        technicalDetails: context.includeTechnical ? errorMessage : undefined,
        context: context
    };
}

function formatErrorForConsole(friendlyError, options = {}) {
    const { showTechnical = false, includeActions = true, colorize = true } = options;
    
    let output = '';
    
    // Header with severity indicator
    const severityLabels = {
        error: 'ERROR',
        warning: 'WARNING',
        info: 'INFO'
    };
    
    const severityLabel = severityLabels[friendlyError.severity] || 'ERROR';
    const border = '='.repeat(80);
    
    if (colorize) {
        output += '\n' + border + '\n';
        output += `${severityLabel}: ${friendlyError.title.toUpperCase()}\n`;
        output += border + '\n';
    } else {
        output += `\n${severityLabel}: ${friendlyError.title.toUpperCase()}\n`;
    }
    
    // Main message
    output += `\n${friendlyError.message}\n`;
    
    // Action (if enabled and available)
    if (includeActions && friendlyError.action) {
        output += `\nWhat to do: ${friendlyError.action}\n`;
    }
    
    // Technical details (if requested and available)
    if (showTechnical && friendlyError.technicalDetails) {
        output += `\nTechnical details: ${friendlyError.technicalDetails}\n`;
    }
    
    // Footer
    if (colorize) {
        output += border + '\n';
    }
    
    return output;
}

function formatErrorForLog(friendlyError) {
    let logMessage = `${friendlyError.title}: ${friendlyError.message}`;
    
    if (friendlyError.action) {
        logMessage += ` | Action: ${friendlyError.action}`;
    }
    
    if (friendlyError.technicalDetails) {
        logMessage += ` | Technical: ${friendlyError.technicalDetails}`;
    }
    
    return logMessage;
}

function showUserFriendlyError(technicalError, context = {}, options = {}) {
    const friendlyError = translateError(technicalError, context);
    const consoleMessage = formatErrorForConsole(friendlyError, options);

    if (context.logger && typeof context.logger.console === 'function') {
        context.logger.console(consoleMessage, 'user-friendly-errors');
    } else {
        const output = consoleMessage.endsWith('\n') ? consoleMessage : `${consoleMessage}\n`;
        process.stderr.write(output);
    }
    
    // Log technical details if logger is available
    if (context.logger) {
        const logMessage = formatErrorForLog(friendlyError);
        logUserFriendlyError(context, friendlyError, logMessage, technicalError);
    }
}

function handleUserFacingError(error, context = {}, options = {}) {
    const { 
        showInConsole = true, 
        logTechnical = true, 
        exitOnError = false,
        includeActions = true 
    } = options;
    
    if (showInConsole) {
        showUserFriendlyError(error, context, { includeActions });
    }
    
    if (logTechnical && context.logger) {
        const friendlyError = translateError(error, context);
        const logMessage = formatErrorForLog(friendlyError);
        logUserFriendlyError(context, friendlyError, logMessage, error);
    }
    
    if (exitOnError) {
        process.exit(1);
    }
}

module.exports = {
    translateError,
    formatErrorForConsole,
    formatErrorForLog,
    handleUserFacingError,
    ERROR_MESSAGES,
    TECHNICAL_ERROR_PATTERNS
};

function logUserFriendlyError(context, friendlyError, logMessage, technicalError) {
    const category = context.category || 'user-error';
    const handlerLogger = context.logger;

    if (!handlerLogger || typeof handlerLogger.error !== 'function') {
        return;
    }

    const handler = createPlatformErrorHandler(handlerLogger, 'user-friendly-errors');
    const metadata = {
        category,
        severity: friendlyError.severity,
        userTitle: friendlyError.title,
        technicalErrorMessage: technicalError?.message
    };

    if (friendlyError.severity === 'error') {
        if (technicalError instanceof Error) {
            handler.handleEventProcessingError(
                technicalError,
                'user-friendly-error',
                metadata,
                logMessage,
                category
            );
        } else {
            handler.logOperationalError(logMessage, category, metadata);
        }
        return;
    }

    if (typeof handlerLogger.warn === 'function') {
        handlerLogger.warn(logMessage, context.category || 'user-warning');
    }
}
