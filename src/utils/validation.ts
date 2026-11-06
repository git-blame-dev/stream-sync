import { utf16BudgetPrefix, wordBudgetPrefix } from './utf16-budget-prefix';
import { formatTtsUsername } from './tts-text';
import { config } from '../core/config';
import { DEFAULTS } from '../core/config-schema';

type ValidationGeneralConfig = {
    fallbackUsername: string;
    anonymousUsername: string;
};

function getGeneralConfig(): ValidationGeneralConfig {
    return config.general as ValidationGeneralConfig;
}

const getFallbackUsername = (): string => getGeneralConfig().fallbackUsername;
const getAnonymousUsername = (): string => getGeneralConfig().anonymousUsername;

const REGEX_PATTERNS = {
    HTML_TAGS: /<[^>]*>/g,
    JAVASCRIPT_URLS: /javascript:/gi,
    ALERT_CALLS: /alert\([^)]*\)/g,
    WHITESPACE_NORMALIZE: /\s+/g
};

function sanitizeUsernameValue(username: unknown, maxLength: number): string {
    let processedUsername = typeof username === 'string' ? username.trim() : '';
    
    processedUsername = processedUsername
        .replace(REGEX_PATTERNS.HTML_TAGS, '')
        .replace(REGEX_PATTERNS.JAVASCRIPT_URLS, '')
        .replace(REGEX_PATTERNS.ALERT_CALLS, '')
        .replace(REGEX_PATTERNS.WHITESPACE_NORMALIZE, ' ')
        .trim();
    
    if (!processedUsername) {
        return '';
    }
    
    return wordBudgetPrefix(processedUsername, maxLength);
}

function formatUsername(username: unknown, maxLength: number, forTTS: boolean): string {
    const limit = Number.isFinite(maxLength) && maxLength >= 0 ? Math.floor(maxLength) : 12;
    if (limit === 0) return '';
    if (forTTS) return formatTtsUsername(username, limit, getFallbackUsername());

    const formatted = sanitizeUsernameValue(username, limit);
    if (formatted) return formatted;

    return sanitizeUsernameValue(getFallbackUsername(), limit)
        || sanitizeUsernameValue(DEFAULTS.general.fallbackUsername, limit);
}

function formatUsername12(username: unknown, forTTS = false): string {
    return formatUsername(username, 12, forTTS);
}

function sanitizeDisplayName(displayName: unknown, maxLength = 12): string {
    return formatUsername(displayName, maxLength, false);
}

function sanitizeForDisplay(text: unknown, maxLength = 200): string {
    if (!text || typeof text !== 'string') {
        return '';
    }
    
    return utf16BudgetPrefix(text
        .replace(REGEX_PATTERNS.HTML_TAGS, '')
        .replace(REGEX_PATTERNS.JAVASCRIPT_URLS, '')
        .replace(REGEX_PATTERNS.WHITESPACE_NORMALIZE, ' ')
        .trim(), maxLength);
}

export {
    sanitizeDisplayName,
    formatUsername12,
    sanitizeForDisplay,
    getFallbackUsername,
    getAnonymousUsername
};
