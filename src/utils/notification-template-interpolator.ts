function sanitizeStringValue(value) {
    if (value === null || value === undefined) {
        return '';
    }

    let stringValue = String(value);

    stringValue = stringValue.replace(/\{[^}]*\}/g, '');

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
        if (isNaN(value) || !isFinite(value)) {
            return '';
        }
        return String(value);
    }

    if (typeof value === 'boolean') {
        return String(value);
    }

    if (typeof value === 'object') {
        if (Array.isArray(value)) {
            if (value.length === 0) return '';
            if (value.length === 1) return convertValueToString(value[0]);
            return `${convertValueToString(value[0])} and ${value.length - 1} more`;
        }

        if (value instanceof Date) {
            return value.toISOString();
        }

        if (value.name && typeof value.name === 'string') return value.name;
        if (value.username && typeof value.username === 'string') return value.username;
        if (value.value && typeof value.value === 'string') return value.value;
        if (value.text && typeof value.text === 'string') return value.text;
        if (value.title && typeof value.title === 'string') return value.title;

        try {
            const seen = new WeakSet();
            function extractFromNestedObject(obj, depth = 0) {
                if (depth > 3 || !obj || typeof obj !== 'object' || Array.isArray(obj)) {
                    return '';
                }

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
                        continue;
                    }
                }
                return '';
            }

            const extracted = extractFromNestedObject(value);
            if (extracted) {
                return extracted;
            }
        } catch { /* noop */ }

        try {
            const stringValue = value.toString();
            if (stringValue && stringValue !== '[object Object]') {
                return stringValue;
            }
        } catch { /* noop */ }

        try {
            const jsonString = JSON.stringify(value);
            if (jsonString && jsonString !== '{}' && jsonString.length < 100) {
                return jsonString;
            }
        } catch { /* noop */ }

        return '';
    }

    return '';
}

function sanitizeDataForInterpolation(data) {
    if (!data || typeof data !== 'object') {
        return {};
    }

    const sanitized = {};
    const seen = new WeakSet();

    function sanitizeValue(value) {
        if (value === null || value === undefined) {
            return value;
        }

        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return sanitizeStringValue(value);
        }

        if (typeof value === 'object') {
            if (seen.has(value)) {
                return '';
            }
            seen.add(value);

            if (Array.isArray(value)) {
                if (value.length === 0) return '';
                const first = value[0];
                return (typeof first === 'string' || typeof first === 'number' || typeof first === 'boolean')
                    ? sanitizeStringValue(first)
                    : '';
            }

            if (value.toString && typeof value.toString === 'function') {
                try {
                    const stringValue = value.toString();
                    if (stringValue !== '[object Object]') {
                        return sanitizeStringValue(stringValue);
                    }
                } catch { /* noop */ }
            }

            if (value.name) return sanitizeStringValue(value.name);
            if (value.username) return sanitizeStringValue(value.username);
            if (value.value) return sanitizeStringValue(value.value);
            if (value.text) return sanitizeStringValue(value.text);

            return '';
        }

        return '';
    }

    for (const [key, value] of Object.entries(data)) {
        sanitized[key] = sanitizeValue(value);
    }

    return sanitized;
}

function resolvePaypiggyCopy(data) {
    const safeData = data || {};
    const platform = (safeData.platform || '').toLowerCase();
    const isSuperfan = safeData.tier === 'superfan';

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

function enrichPaypiggyData(data) {
    if (!data || typeof data !== 'object') {
        return {};
    }

    if (data.type !== 'platform:paypiggy') {
        return data;
    }

    const copy = resolvePaypiggyCopy(data);
    return { ...data, ...copy };
}

function interpolateTemplate(template, data) {
    if (!template || typeof template !== 'string') {
        throw new Error('Template must be a string');
    }

    const enrichedData = enrichPaypiggyData(data);
    const safeData = sanitizeDataForInterpolation(enrichedData);

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

export {
    interpolateTemplate,
    sanitizeDataForInterpolation,
    convertValueToString
};
