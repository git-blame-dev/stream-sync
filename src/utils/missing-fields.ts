function normalizeMissingFields(missingFields: unknown = []): string[] {
    if (!Array.isArray(missingFields)) {
        return [];
    }

    const seen = new Set<string>();
    const normalized: string[] = [];

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

function collectMissingFields(fieldPresence: unknown = {}): string[] {
    if (!fieldPresence || typeof fieldPresence !== 'object') {
        return [];
    }

    const missingFields: string[] = [];
    for (const [fieldName, isPresent] of Object.entries(fieldPresence)) {
        if (!isPresent) {
            missingFields.push(fieldName);
        }
    }

    return normalizeMissingFields(missingFields);
}

function mergeMissingFieldsMetadata(
    metadata: unknown = {},
    missingFields: unknown = [],
    additionalMetadata: Record<string, unknown> = {}
): Record<string, unknown> {
    const baseMetadata = metadata && typeof metadata === 'object'
        ? { ...(metadata as Record<string, unknown>) }
        : {};
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

function getMissingFields(metadata: unknown = {}): string[] {
    if (!metadata || typeof metadata !== 'object') {
        return [];
    }

    return normalizeMissingFields((metadata as { missingFields?: unknown }).missingFields);
}

function allowsYouTubeJewelsMissingUserId(input: {
    type?: unknown;
    platform?: unknown;
    currency?: unknown;
    metadata?: unknown;
} = {}): boolean {
    const normalizedType = typeof input.type === 'string' ? input.type.trim() : '';
    const normalizedPlatform = typeof input.platform === 'string' ? input.platform.trim().toLowerCase() : '';
    const normalizedCurrency = typeof input.currency === 'string' ? input.currency.trim().toLowerCase() : '';

    if (normalizedType !== 'platform:gift' || normalizedPlatform !== 'youtube' || normalizedCurrency !== 'jewels') {
        return false;
    }

    return getMissingFields(input.metadata).includes('userId');
}

export {
    allowsYouTubeJewelsMissingUserId,
    collectMissingFields,
    getMissingFields,
    mergeMissingFieldsMetadata,
    normalizeMissingFields
};
