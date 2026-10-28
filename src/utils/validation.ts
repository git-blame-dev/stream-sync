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
    EMOJI_UNICODE: /[\u{1F300}-\u{1F9FF}]/gu,
    WHITESPACE_NORMALIZE: /\s+/g
};

function sanitizeUsernameValue(username: unknown, maxLength: number, forTTS: boolean): string {
    let processedUsername = typeof username === 'string' ? username.trim() : '';
    
    if (forTTS) {
        processedUsername = processedUsername.replace(REGEX_PATTERNS.EMOJI_UNICODE, '').trim();
        processedUsername = processedUsername.replace(/[_\-\.@]/g, ' ');
        processedUsername = processedUsername.replace(/[^a-zA-Z0-9 ]/g, '');
        processedUsername = processedUsername.replace(/\d{2,}/g, (match) => match[0] ?? '');
        processedUsername = processedUsername.replace(/\s+/g, ' ').trim();
    } else {
        processedUsername = processedUsername
            .replace(REGEX_PATTERNS.HTML_TAGS, '')
            .replace(REGEX_PATTERNS.JAVASCRIPT_URLS, '')
            .replace(REGEX_PATTERNS.ALERT_CALLS, '')
            .replace(REGEX_PATTERNS.WHITESPACE_NORMALIZE, ' ')
            .trim();
    }
    
    if (!processedUsername) {
        return '';
    }
    
    if (processedUsername.length <= maxLength) {
        return processedUsername;
    }
    
    const words = processedUsername.split(/\s+/);
    let result = '';
    
    for (const word of words) {
        const testResult = result ? `${result} ${word}` : word;
        if (testResult.length <= maxLength) {
            result = testResult;
        } else {
            break;
        }
    }
    
    if (result && result.length > 0) {
        return result;
    }
    
    const clipped = processedUsername.substring(0, maxLength);
    return /[\uD800-\uDBFF]$/.test(clipped) ? clipped.slice(0, -1) : clipped;
}

function formatUsername(username: unknown, maxLength: number, forTTS: boolean): string {
    const limit = Number.isFinite(maxLength) && maxLength >= 0 ? Math.floor(maxLength) : 12;
    if (limit === 0) return '';

    const formatted = sanitizeUsernameValue(username, limit, forTTS);
    if (formatted) return formatted;

    return sanitizeUsernameValue(getFallbackUsername(), limit, forTTS)
        || sanitizeUsernameValue(DEFAULTS.general.fallbackUsername, limit, forTTS);
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
    
    return text
        .replace(REGEX_PATTERNS.HTML_TAGS, '')
        .replace(REGEX_PATTERNS.JAVASCRIPT_URLS, '')
        .replace(REGEX_PATTERNS.WHITESPACE_NORMALIZE, ' ')
        .trim()
        .substring(0, maxLength);
}

export {
    sanitizeDisplayName,
    formatUsername12,
    sanitizeForDisplay,
    getFallbackUsername,
    getAnonymousUsername
};
