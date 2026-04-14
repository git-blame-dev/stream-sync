function normalizeMissingFields(missingFields = []) {
    if (!Array.isArray(missingFields)) {
        return [];
    }

    const seen = new Set();
    const normalized = [];

    for (const field of missingFields) {
        if (typeof field !== 'string') {
            continue;
        }

        const trimmedField = field.trim();
        if (!trimmedField || seen.has(trimmedField)) {
            continue;
        }

        seen.add(trimmedField);
        normalized.push(trimmedField);
    }

    return normalized;
}

function collectMissingFields(fieldPresence = {}) {
    if (!fieldPresence || typeof fieldPresence !== 'object') {
        return [];
    }

    const missingFields = [];
    for (const [fieldName, isPresent] of Object.entries(fieldPresence)) {
        if (!isPresent) {
            missingFields.push(fieldName);
        }
    }

    return normalizeMissingFields(missingFields);
}

function mergeMissingFieldsMetadata(metadata = {}, missingFields = [], additionalMetadata = {}) {
    const baseMetadata = metadata && typeof metadata === 'object' ? { ...metadata } : {};
    const normalizedMissingFields = normalizeMissingFields(missingFields);

    if (normalizedMissingFields.length > 0) {
        baseMetadata.missingFields = normalizedMissingFields;
    } else {
        delete baseMetadata.missingFields;
    }

    for (const [key, value] of Object.entries(additionalMetadata)) {
        if (value === undefined) {
            continue;
        }
        baseMetadata[key] = value;
    }

    return baseMetadata;
}

function getMissingFields(metadata = {}) {
    return normalizeMissingFields(metadata?.missingFields);
}

function allowsYouTubeJewelsMissingUserId({ type, platform, currency, metadata } = {}) {
    const normalizedType = typeof type === 'string' ? type.trim() : '';
    const normalizedPlatform = typeof platform === 'string' ? platform.trim().toLowerCase() : '';
    const normalizedCurrency = typeof currency === 'string' ? currency.trim().toLowerCase() : '';

    if (normalizedType !== 'platform:gift' || normalizedPlatform !== 'youtube' || normalizedCurrency !== 'jewels') {
        return false;
    }

    return getMissingFields(metadata).includes('userId');
}

module.exports = {
    allowsYouTubeJewelsMissingUserId,
    collectMissingFields,
    getMissingFields,
    mergeMissingFieldsMetadata,
    normalizeMissingFields
};
