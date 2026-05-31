type TemplateRecord = Record<string, unknown>;

function isTemplateRecord(value: unknown): value is TemplateRecord {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeStringValue(value: unknown): string {
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

function convertValueToString(value: unknown): string {
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

        const record = value as TemplateRecord;
        if (typeof record.name === 'string') return record.name;
        if (typeof record.username === 'string') return record.username;
        if (typeof record.value === 'string') return record.value;
        if (typeof record.text === 'string') return record.text;
        if (typeof record.title === 'string') return record.title;

        try {
            const seen = new WeakSet<object>();
            function extractFromNestedObject(obj: unknown, depth = 0): string {
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
        } catch { /* fall through to scalar conversion */ }

        try {
            const stringValue = value.toString();
            if (stringValue && stringValue !== '[object Object]') {
                return stringValue;
            }
        } catch { /* fall through to JSON conversion */ }

        try {
            const jsonString = JSON.stringify(value);
            if (jsonString && jsonString !== '{}' && jsonString.length < 100) {
                return jsonString;
            }
        } catch { /* fall through to empty placeholder */ }

        return '';
    }

    return '';
}

function sanitizeDataForInterpolation(data: unknown): TemplateRecord {
    if (!isTemplateRecord(data)) {
        return {};
    }

    const sanitized: TemplateRecord = {};
    const seen = new WeakSet<object>();

    function sanitizeValue(value: unknown): unknown {
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
                } catch { /* fall through to record fields */ }
            }

            const record = value as TemplateRecord;
            if (record.name) return sanitizeStringValue(record.name);
            if (record.username) return sanitizeStringValue(record.username);
            if (record.value) return sanitizeStringValue(record.value);
            if (record.text) return sanitizeStringValue(record.text);

            return '';
        }

        return '';
    }

    for (const [key, value] of Object.entries(data)) {
        sanitized[key] = sanitizeValue(value);
    }

    return sanitized;
}

function resolvePaypiggyCopy(data: TemplateRecord) {
    const platform = typeof data.platform === 'string' ? data.platform.toLowerCase() : '';
    const isSuperfan = data.tier === 'superfan';

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

function enrichPaypiggyData(data: unknown): TemplateRecord {
    if (!isTemplateRecord(data)) {
        return {};
    }

    if (data.type !== 'platform:paypiggy') {
        return data;
    }

    const copy = resolvePaypiggyCopy(data);
    return { ...data, ...copy };
}

function interpolateTemplate(template: unknown, data: unknown): string {
    if (!template || typeof template !== 'string') {
        throw new Error('Template must be a string');
    }

    const enrichedData = enrichPaypiggyData(data);
    const safeData = sanitizeDataForInterpolation(enrichedData);

    return template.replace(/\{(\w+)\}/g, (_match: string, variable: string) => {
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
