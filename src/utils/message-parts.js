function getMessagePartsFromPayload(data = {}) {
    if (Array.isArray(data?.message?.parts)) {
        return data.message.parts;
    }

    return [];
}

function isValidMessagePart(part, options = {}) {
    const { allowWhitespaceText = false } = options;

    if (!part || typeof part !== 'object') {
        return false;
    }

    if (part.type === 'emote') {
        return typeof part.emoteId === 'string' && part.emoteId.trim().length > 0
            && typeof part.imageUrl === 'string' && part.imageUrl.trim().length > 0;
    }

    if (part.type === 'text') {
        if (typeof part.text !== 'string') {
            return false;
        }

        return allowWhitespaceText
            ? part.text.length > 0
            : part.text.trim().length > 0;
    }

    return false;
}

function getValidMessageParts(data = {}, options = {}) {
    return getMessagePartsFromPayload(data)
        .filter((part) => isValidMessagePart(part, options));
}

function normalizeBadgeImages(value) {
    if (!Array.isArray(value) || value.length === 0) {
        return [];
    }

    const seen = new Set();
    const result = [];

    for (const badge of value) {
        if (!badge || typeof badge !== 'object') {
            continue;
        }

        const imageUrl = typeof badge.imageUrl === 'string' ? badge.imageUrl.trim() : '';
        if (!imageUrl || seen.has(imageUrl)) {
            continue;
        }

        seen.add(imageUrl);
        result.push({
            imageUrl,
            source: typeof badge.source === 'string' ? badge.source.trim() : '',
            label: typeof badge.label === 'string' ? badge.label : ''
        });
    }

    return result;
}

module.exports = {
    getMessagePartsFromPayload,
    isValidMessagePart,
    getValidMessageParts,
    normalizeBadgeImages
};
