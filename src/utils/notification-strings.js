
const { getCodeToSymbolMap } = require('./currency-utils');

function resolvePaypiggyCopy(data = {}) {
    const platform = (data.platform || '').toLowerCase();
    const isSuperfan = data.isSuperfan || data.tier === 'superfan';

    if (isSuperfan) {
        return {
            paypiggyVariant: 'superfan',
            paypiggyAction: 'became a SuperFan',
            paypiggyActionTts: 'became a SuperFan',
            paypiggyResubAction: 'renewed SuperFan',
            paypiggyResubActionTts: 'renewed SuperFan',
            paypiggyNoun: 'SuperFan',
            paypiggyNounPlural: 'SuperFans',
            paypiggyLogLabel: 'superfan'
        };
    }

    if (platform === 'youtube') {
        return {
            paypiggyVariant: 'membership',
            paypiggyAction: 'just became a member',
            paypiggyActionTts: 'just became a member',
            paypiggyResubAction: 'renewed membership',
            paypiggyResubActionTts: 'renewed membership',
            paypiggyNoun: 'membership',
            paypiggyNounPlural: 'memberships',
            paypiggyLogLabel: 'membership'
        };
    }

    return {
        paypiggyVariant: 'subscriber',
        paypiggyAction: 'just subscribed',
        paypiggyActionTts: 'just subscribed',
        paypiggyResubAction: 'renewed subscription',
        paypiggyResubActionTts: 'renewed subscription',
        paypiggyNoun: 'subscription',
        paypiggyNounPlural: 'subscriptions',
        paypiggyLogLabel: 'paypiggy'
    };
}

function createPaypiggyTemplates() {
    return {
        display: `{username} {paypiggyAction}!`,
        displayWithTier: `{username} {paypiggyAction}! (Tier {tier})`,
        displayResub: `{username} {paypiggyResubAction} for {months} months!`,
        displayResubWithTier: `{username} {paypiggyResubAction} for {months} months! (Tier {tier})`,
        displayGift: `{username} gifted a {paypiggyNoun}!`,
        displayGiftWithTier: `{username} gifted a {paypiggyNoun}! (Tier {tier})`,
        tts: `{ttsUsername} {paypiggyActionTts}`,
        ttsResub: `{ttsUsername} {paypiggyResubActionTts} for {formattedMonths}`,
        ttsGift: `{ttsUsername} gifted a {paypiggyNoun}`,
        log: `New {paypiggyLogLabel}: {username}! (Tier: {tier})`,
        logResub: `{username} {paypiggyResubAction} for {months} months! (Tier: {tier})`,
        logGift: `{username} gifted a {paypiggyNoun}! (Tier: {tier})`
    };
}

const NOTIFICATION_TEMPLATES = {
    // Gift notifications with singular/plural and coin formatting
    gift: {
        display: '{username} sent {formattedGiftCountForDisplay}',
        displayWithCoins: '{username} sent {formattedCoins} [{formattedGiftCountForDisplay}]',
        tts: '{ttsUsername} sent {formattedGiftCount}',
        ttsWithCoins: '{ttsUsername} sent {formattedCoins} with {formattedGiftCount}',
        log: 'Gift from {username}: {formattedGiftCount}'
    },
    
    // Follow notifications
    follow: {
        display: '{username} just followed!',
        tts: '{ttsUsername} just followed',
        log: 'New follower: {username}'
    },
    
    // Paypiggy canonical (platform-specific wording determined upstream; SuperFan handled via metadata)
    paypiggy: createPaypiggyTemplates(),
    
    // Raid notifications with viewer counts
    raid: {
        display: 'Incoming raid from {username} with {viewerCount} viewers!',
        tts: 'Incoming raid from {ttsUsername} with {formattedViewerCount}',
        log: 'Incoming raid from {username} with {viewerCount} viewers!'
    },
    
    // Envelope notifications (TikTok treasure chest events)
    envelope: {
        display: '{username} sent a treasure chest!',
        displayWithCoins: '{username} sent {formattedCoins} treasure chest!',
        tts: '{ttsUsername} sent a treasure chest',
        ttsWithCoins: '{ttsUsername} sent {formattedCoins} treasure chest',
        log: 'Treasure chest from {username}: {formattedCoins}'
    },
    
    // Greeting notifications for first-time chatters
    greeting: {
        display: 'Welcome, {username}! 👋',
        tts: 'Hi {ttsUsername}',
        log: 'Greeting: {username}'
    },
    
    // Farewell notifications
    farewell: {
        display: 'Goodbye, {username}! 👋',
        tts: 'Goodbye {ttsUsername}',
        log: 'Farewell: {username}'
    },
    
    // Command notifications
    command: {
        display: '{username} used command {command}',
        tts: '{ttsUsername} used command {commandName}',
        log: 'Command {command} triggered by {username}'
    },
    
    // Redemption notifications (Twitch channel points)
    redemption: {
        display: '{username} redeemed {rewardTitle}!',
        displayWithCost: '{username} redeemed {rewardTitle} ({rewardCost} points)!',
        tts: '{ttsUsername} redeemed {rewardTitle}',
        log: 'Redemption by {username}: {rewardTitle} ({rewardCost} points)'
    }
};

function formatCoins(coins) {
    // Handle invalid or missing values
    if (coins === null || coins === undefined || isNaN(coins) || !isFinite(coins)) {
        return '0 coins';
    }
    
    const numericCoins = Math.max(0, Math.floor(Number(coins)));
    if (numericCoins === 0) return '0 coins';
    return numericCoins === 1 ? '1 coin' : `${numericCoins} coins`;
}

function formatSuperChatAmount(amount, currency = '$') {
    // Validate amount to prevent NaN/Infinity in user content
    const validAmount = getValidNumber(amount);
    if (validAmount === null) {
        return `${getCurrencySymbol(currency)}0.00`; // Zero to surface bad data
    }
    if (validAmount === 0) {
        return `${getCurrencySymbol(currency)}0.00`; // Zero amount shown explicitly
    }
    
    // For currencies that share symbols with USD, use currency code for clarity
    if (shouldUseCurrencyCode(currency)) {
        return `${currency}${validAmount.toFixed(2)}`;
    }
    
    return `${getCurrencySymbol(currency)}${validAmount.toFixed(2)}`;
}

function shouldUseCurrencyCode(currency) {
    // Use currency code for currencies that share symbols with others to avoid confusion
    // Currencies with unique symbols can use their symbols for familiar UX
    if (!currency || !/^[A-Z]{3}$/.test(currency)) return false;
    
    // Currencies with unique symbols use the symbol
    const uniqueSymbolCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'INR'];
    if (uniqueSymbolCurrencies.includes(currency)) return false;
    
    // Currencies that share symbols use currency codes for clarity
    return true;
}

function getCurrencySymbol(currencyCode) {
    if (!currencyCode) return '$';
    
    // If it's already a symbol (not alphanumeric), return as-is
    if (!/^[A-Z]{3}$/.test(currencyCode)) {
        return currencyCode;
    }
    
    const symbol = getCodeToSymbolMap().get(currencyCode);
    return symbol || currencyCode;
}

function formatCurrencyForTTS(amount, currency = '$') {
    // Validate amount to prevent NaN/Infinity in TTS content
    const validAmount = getValidNumber(amount);
    if (validAmount === null) {
        return '0'; // Surface zero in TTS for bad data
    }
    if (validAmount === 0) {
        return '0'; // Explicit zero amount
    }
    
    const currencyWord = getCurrencyWord(currency);
    const dollars = Math.floor(validAmount);
    const cents = Math.round((validAmount - dollars) * 100);
    
    if (cents === 0) {
        return dollars === 1 ? `1 ${getSingularCurrency(currencyWord)}` : `${dollars} ${currencyWord}`;
    } else {
        return `${dollars} ${currencyWord} ${cents}`;
    }
}

function getSingularCurrency(currencyWord) {
    const singularMap = {
        'dollars': 'dollar',
        'euros': 'euro',
        'pounds': 'pound',
        'yen': 'yen', // Same for singular/plural
        'yuan': 'yuan', // Same for singular/plural
        'rupees': 'rupee',
        'canadian dollars': 'canadian dollar',
        'australian dollars': 'australian dollar',
        'new zealand dollars': 'new zealand dollar',
        'swiss francs': 'swiss franc',
        'brazilian reais': 'brazilian real',
        'argentine pesos': 'argentine peso',
        'chilean pesos': 'chilean peso',
        'colombian pesos': 'colombian peso',
        'mexican pesos': 'mexican peso',
        'philippine pesos': 'philippine peso',
        'uruguayan pesos': 'uruguayan peso',
        'dominican pesos': 'dominican peso',
        'cuban pesos': 'cuban peso',
        'korean won': 'korean won' // Same for singular/plural
    };
    
    return singularMap[currencyWord] || currencyWord.replace(/s$/, '');
}

function getCurrencyWord(currency) {
    const currencyMap = {
        // Major currencies confirmed supported by YouTube
        '$': 'dollars',
        'USD': 'dollars',
        '€': 'euros',
        'EUR': 'euros',
        '£': 'pounds',
        'GBP': 'pounds',
        '¥': 'yen',
        'JPY': 'yen',
        'CNY': 'yuan',
        
        // Other currencies likely supported based on YouTube's global reach
        '₹': 'rupees',
        'INR': 'rupees',
        'CAD': 'canadian dollars',
        'AUD': 'australian dollars',
        'NZD': 'new zealand dollars',
        'CHF': 'swiss francs',
        'SEK': 'swedish krona',
        'NOK': 'norwegian kroner',
        'DKK': 'danish kroner',
        'PLN': 'polish zloty',
        'CZK': 'czech koruna',
        'HUF': 'hungarian forint',
        'RON': 'romanian leu',
        'BGN': 'bulgarian lev',
        'HRK': 'croatian kuna',
        'RSD': 'serbian dinar',
        'TRY': 'turkish lira',
        'ILS': 'israeli shekels',
        'AED': 'emirati dirhams',
        'SAR': 'saudi riyals',
        'QAR': 'qatari riyals',
        'KWD': 'kuwaiti dinars',
        'BHD': 'bahraini dinars',
        'OMR': 'omani rials',
        'EGP': 'egyptian pounds',
        'ZAR': 'south african rand',
        'NGN': 'nigerian naira',
        'KES': 'kenyan shillings',
        'GHS': 'ghanaian cedis',
        'UGX': 'ugandan shillings',
        'TZS': 'tanzanian shillings',
        'RWF': 'rwandan francs',
        'ETB': 'ethiopian birr',
        'MAD': 'moroccan dirhams',
        'TND': 'tunisian dinars',
        'DZD': 'algerian dinars',
        'LYD': 'libyan dinars',
        'XAF': 'central african francs',
        'XOF': 'west african francs',
        
        // Americas
        'BRL': 'brazilian reais',
        'ARS': 'argentine pesos',  // Confirmed supported
        'CLP': 'chilean pesos',
        'COP': 'colombian pesos',
        'PEN': 'peruvian soles',
        'BOB': 'bolivian bolivianos',
        'UYU': 'uruguayan pesos',
        'PYG': 'paraguayan guaranis',
        'VES': 'venezuelan bolivars',
        'GYD': 'guyanese dollars',
        'SRD': 'surinamese dollars',
        'TTD': 'trinidad and tobago dollars',
        'JMD': 'jamaican dollars',
        'BBD': 'barbadian dollars',
        'BZD': 'belize dollars',
        'GTQ': 'guatemalan quetzals',
        'HNL': 'honduran lempiras',
        'NIO': 'nicaraguan cordobas',
        'CRC': 'costa rican colons',
        'PAB': 'panamanian balboas',
        'DOP': 'dominican pesos',
        'HTG': 'haitian gourdes',
        'CUP': 'cuban pesos',
        'MXN': 'mexican pesos',
        
        // Asia Pacific
        'KRW': 'korean won',
        '₩': 'korean won',
        'TWD': 'taiwan dollars',
        'HKD': 'hong kong dollars',
        'SGD': 'singapore dollars',
        'MYR': 'malaysian ringgit',
        'THB': 'thai baht',
        'VND': 'vietnamese dong',
        'IDR': 'indonesian rupiah',
        'PHP': 'philippine pesos',
        'BND': 'brunei dollars',
        'KHR': 'cambodian riels',
        'LAK': 'lao kips',
        'MMK': 'myanmar kyats',
        'BDT': 'bangladeshi taka',
        'LKR': 'sri lankan rupees',
        'MVR': 'maldivian rufiyaa',
        'NPR': 'nepalese rupees',
        'BTN': 'bhutanese ngultrum',
        'PKR': 'pakistani rupees',
        'AFN': 'afghan afghanis',
        'UZS': 'uzbek som',
        'KZT': 'kazakhstani tenge',
        'KGS': 'kyrgyzstani som',
        'TJS': 'tajikistani somoni',
        'TMT': 'turkmen manat',
        'MNT': 'mongolian tugriks',
        'RUB': 'russian rubles',
        'BYN': 'belarusian rubles',
        'UAH': 'ukrainian hryvnias',
        'MDL': 'moldovan leu',
        'GEL': 'georgian lari',
        'AMD': 'armenian drams',
        'AZN': 'azerbaijani manat',
        
        // Additional Pacific
        'FJD': 'fijian dollars',
        'TOP': 'tongan paanga',
        'WST': 'samoan tala',
        'VUV': 'vanuatu vatu',
        'SBD': 'solomon islands dollars',
        'PGK': 'papua new guinea kina'
    };
    
    return currencyMap[currency] || 'dollars';
}

function formatGiftCount(count, giftType) {
    if (!count || count === 0) return `0 ${giftType.toLowerCase()}s`;
    
    // Special handling for "Bits" and cheermote types -> "bit" singular conversion
    if (count === 1) {
        // Handle regular "Bits" (lowercase for comparison)
        if (giftType.toLowerCase() === 'bits') {
            return '1 bit';
        }
        // Handle cheermote types like "ShowLove Bits" -> preserve case
        if (giftType.toLowerCase().endsWith(' bits')) {
            const cheermoteType = giftType.replace(/ bits$/i, ''); // Preserve original case
            return `1 ${cheermoteType} bit`;
        }
        // Handle other gift types
        const singularName = giftType.toLowerCase();
        return `1 ${singularName}`;
    }
    
    // Handle plural forms
    // Handle regular "Bits"
    if (giftType.toLowerCase() === 'bits') {
        return `${count} bits`;
    }
    // Handle cheermote types like "ShowLove Bits" -> preserve case
    if (giftType.toLowerCase().endsWith(' bits')) {
        const cheermoteType = giftType.replace(/ bits$/i, ''); // Preserve original case
        return `${count} ${cheermoteType} bits`;
    }
    // Handle other gift types
    let pluralGiftType = giftType.toLowerCase();
    if (!pluralGiftType.endsWith('s')) {
        pluralGiftType += 's';
    }
    
    return `${count} ${pluralGiftType}`;
}

function formatGiftCountForDisplay(count, giftType) {
    if (!count || count === 0) return `${giftType} x 0`;
    if (count === 1) return giftType; // No count for single gifts
    
    return `${giftType} x ${count}`;
}

function formatViewerCount(count) {
    if (!count || count === 0) return '0 viewers';
    return count === 1 ? '1 viewer' : `${count} viewers`;
}

function formatMonths(months) {
    if (!months || months === 0) return '0 months';
    return months === 1 ? '1 month' : `${months} months`;
}

function formatTierDisplay(tier) {
    if (!tier) return '';
    
    switch (tier) {
        case '1000':
            return ''; // Hide Tier 1 - it's the default
        case '2000': 
            return ' (Tier 2)';
        case '3000':
            return ' (Tier 3)';
        default:
            return tier !== '1000' ? ` (Tier ${tier})` : '';
    }
}

// Enrich paypiggy data with platform-aware wording for template interpolation
function enrichPaypiggyData(data) {
    if (!data || typeof data !== 'object') {
        return {};
    }

    const shouldEnrich = data.type === 'paypiggy' || data.sourceType === 'paypiggy';
    if (!shouldEnrich) {
        return data;
    }

    const copy = resolvePaypiggyCopy(data);
    return { ...data, ...copy };
}

function interpolateTemplate(template, data) {
    if (!template || typeof template !== 'string') {
        throw new Error('Template must be a string');
    }

    let safeData;
    try {
        const enrichedData = enrichPaypiggyData(data);
        safeData = sanitizeDataForInterpolation(enrichedData);
    } catch {
        throw new Error('Failed to sanitize data for interpolation');
    }

    return template.replace(/\{(\w+)\}/g, (match, variable) => {
        if (!Object.prototype.hasOwnProperty.call(safeData, variable) ||
            safeData[variable] === null ||
            safeData[variable] === undefined) {
            throw new Error(`Missing template value for ${variable}`);
        }

        const converted = convertValueToString(safeData[variable]);
        if (converted === '[object Object]') {
            throw new Error(`Invalid template value for ${variable}`);
        }

        return converted;
    });
}

function sanitizeDataForInterpolation(data) {
    if (!data || typeof data !== 'object') {
        return {};
    }
    
    const sanitized = {};
    const seen = new WeakSet();
    
    function sanitizeValue(value, depth = 0) {
        // Prevent infinite recursion
        if (depth > 10) {
            return '';
        }
        
        // Handle primitives
        if (value === null || value === undefined) {
            return value;
        }
        
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return sanitizeStringValue(value);
        }
        
        // Handle objects and arrays
        if (typeof value === 'object') {
            // Check for circular references
            if (seen.has(value)) {
                return '';
            }
            seen.add(value);
            
            // Convert complex objects to simple representations
            if (Array.isArray(value)) {
                return value.length > 0 ? value[0] : '';
            }
            
            // Extract meaningful string from object
            if (value.toString && typeof value.toString === 'function') {
                try {
                    const stringValue = value.toString();
                    if (stringValue !== '[object Object]') {
                        return sanitizeStringValue(stringValue);
                    }
                } catch {
                    // toString failed, continue with other extraction methods
                }
            }
            
            // Try to extract meaningful properties
            if (value.name) return sanitizeStringValue(value.name);
            if (value.username) return sanitizeStringValue(value.username);
            if (value.value) return sanitizeStringValue(value.value);
            if (value.text) return sanitizeStringValue(value.text);
            
            // For complex objects without meaningful properties, return empty string
            return '';
        }
        
        // Handle functions and other types
        return '';
    }
    
    // Sanitize each property
    for (const [key, value] of Object.entries(data)) {
        // Skip prototype pollution attempts
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            continue;
        }
        
        const sanitizedValue = sanitizeValue(value);
        
        // Ensure we never set a property to an object that could become [object Object]
        if (typeof sanitizedValue === 'object' && sanitizedValue !== null) {
            // If it's still an object after sanitization, convert it to a meaningful string or empty
            const stringified = convertValueToString(sanitizedValue);
            sanitized[key] = stringified || ''; // Empty string if no meaningful content found
        } else {
            sanitized[key] = sanitizedValue;
        }
    }
    
    return sanitized;
}

function sanitizeStringValue(value) {
    if (value === null || value === undefined) {
        return '';
    }
    
    let stringValue = String(value);
    
    // Remove template injection attempts
    stringValue = stringValue.replace(/\{[^}]*\}/g, '');
    
    // Remove script injection attempts
    stringValue = stringValue.replace(/<script[^>]*>.*?<\/script>/gi, '');
    stringValue = stringValue.replace(/javascript:/gi, '');
    stringValue = stringValue.replace(/data:text\/html/gi, '');
    
    // Remove SQL injection patterns
    stringValue = stringValue.replace(/(['"])\s*;\s*DROP\s+TABLE/gi, '$1');
    stringValue = stringValue.replace(/UNION\s+SELECT/gi, '');
    
    // Remove path traversal attempts
    stringValue = stringValue.replace(/\.\.[\/\\]/g, '');
    
    // Remove prototype pollution attempts
    stringValue = stringValue.replace(/__proto__/gi, '');
    stringValue = stringValue.replace(/constructor\.prototype/gi, '');
    
    // Limit length to prevent DoS
    if (stringValue.length > 1000) {
        stringValue = stringValue.substring(0, 1000);
    }
    
    return stringValue;
}

function convertValueToString(value) {
    if (value === null || value === undefined) {
        return '';
    }
    
    if (typeof value === 'string') {
        return value;
    }
    
    if (typeof value === 'number') {
        // Sanitize numeric values to prevent NaN/Infinity in user content
        if (isNaN(value) || !isFinite(value)) {
            return '';
        }
        return String(value);
    }
    
    if (typeof value === 'boolean') {
        return String(value);
    }
    
    if (typeof value === 'object') {
        // Handle arrays
        if (Array.isArray(value)) {
            if (value.length === 0) return '';
            if (value.length === 1) return convertValueToString(value[0]);
            return `${convertValueToString(value[0])} and ${value.length - 1} more`;
        }
        
        // Handle dates
        if (value instanceof Date) {
            return value.toISOString();
        }
        
        // Handle objects with meaningful properties (drill down more deeply)
        if (value.name && typeof value.name === 'string') return value.name;
        if (value.username && typeof value.username === 'string') return value.username;
        if (value.value && typeof value.value === 'string') return value.value;
        if (value.text && typeof value.text === 'string') return value.text;
        if (value.title && typeof value.title === 'string') return value.title;
        
	        // Handle deeply nested objects - extract meaningful content recursively
	        try {
	            const seen = new WeakSet();
	            // Try to find meaningful string values in nested objects (up to 3 levels deep)
	            function extractFromNestedObject(obj, depth = 0) {
	                if (depth > 3 || !obj || typeof obj !== 'object' || Array.isArray(obj)) {
	                    return '';
	                }
                
                // Prevent circular references
                if (seen.has(obj)) {
                    return '';
                }
                seen.add(obj);
                
                for (const val of Object.values(obj)) {
                    try {
                        if (typeof val === 'string' && val.trim()) {
                            return val;
                        }
                        if (typeof val === 'number' && isFinite(val)) {
                            return String(val);
                        }
                        if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
                            const nestedResult = extractFromNestedObject(val, depth + 1);
                            if (nestedResult) {
                                return nestedResult;
                            }
                        }
                    } catch {
                        // Skip this property if it causes issues
                        continue;
                    }
                }
                return '';
            }
            
            const extracted = extractFromNestedObject(value);
            if (extracted) {
                return extracted;
            }
        } catch {
            // Failed to traverse object
        }
        
        // Handle objects with toString that returns something meaningful
        try {
            const stringValue = value.toString();
            if (stringValue && stringValue !== '[object Object]') {
                return stringValue;
            }
        } catch {
            // toString failed
        }
        
        // Last resort: try JSON.stringify with error handling
        try {
            const jsonString = JSON.stringify(value);
            if (jsonString && jsonString !== '{}' && jsonString.length < 100) {
                return jsonString;
            }
        } catch {
            // JSON.stringify failed (circular reference, etc.)
        }
        
        // Final fallback for complex objects - return empty to prevent [object Object]
        return '';
    }
    
    // Handle functions and other exotic types
    return '';
}

function getValidNumber(value) {
    if (value === null || value === undefined) {
        return null;
    }
    
    // Convert to number safely
    const num = Number(value);
    
    // Check for NaN and Infinity - these should not appear in user content
    if (isNaN(num) || !isFinite(num)) {
        return null;
    }
    
    // Return non-negative numbers only
    return Math.max(0, num);
}

module.exports = {
    interpolateTemplate,
    formatCoins,
    formatSuperChatAmount,
    formatCurrencyForTTS,
    getCurrencyWord,
    getSingularCurrency,
    formatGiftCount,
    formatGiftCountForDisplay,
    formatViewerCount,
    formatMonths,
    formatTierDisplay,
    NOTIFICATION_TEMPLATES
}; 
