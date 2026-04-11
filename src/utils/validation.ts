import { config } from '../core/config';

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

function formatUsername12(username: unknown, forTTS = false): string {
    if (!username || typeof username !== 'string') {
        return getFallbackUsername();
    }

    let processedUsername = username.trim();
    
    if (forTTS) {
        processedUsername = processedUsername.replace(REGEX_PATTERNS.EMOJI_UNICODE, '').trim();
        processedUsername = processedUsername.replace(/[_\-\.@]/g, ' ');
        processedUsername = processedUsername.replace(/[^a-zA-Z0-9 ]/g, '');
        processedUsername = processedUsername.replace(/\d{2,}/g, (match) => match[0]);
        processedUsername = processedUsername.replace(/\s+/g, ' ').trim();
        
        if (!processedUsername) {
            return getFallbackUsername();
        }
    } else {
        processedUsername = processedUsername
            .replace(REGEX_PATTERNS.HTML_TAGS, '')
            .replace(REGEX_PATTERNS.JAVASCRIPT_URLS, '')
            .replace(REGEX_PATTERNS.ALERT_CALLS, '')
            .replace(REGEX_PATTERNS.WHITESPACE_NORMALIZE, ' ')
            .trim();
    }
    
    if (!processedUsername) {
        return getFallbackUsername();
    }
    
    if (processedUsername.length <= 12) {
        return processedUsername;
    }
    
    const words = processedUsername.split(/\s+/);
    let result = '';
    
    for (const word of words) {
        const testResult = result ? `${result} ${word}` : word;
        if (testResult.length <= 12) {
            result = testResult;
        } else {
            break;
        }
    }
    
    if (result && result.length > 0) {
        return result;
    }
    
    return processedUsername.substring(0, 12);
}

function sanitizeDisplayName(displayName: unknown, maxLength = 12): string {
    return formatUsername12(displayName, false);
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
