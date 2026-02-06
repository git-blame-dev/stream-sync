const {
    sanitizeDataForInterpolation,
    convertValueToString
} = require('./notification-string-sanitizer');

function resolvePaypiggyCopy(data = {}) {
    const platform = (data.platform || '').toLowerCase();
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

module.exports = {
    interpolateTemplate,
    enrichPaypiggyData
};
