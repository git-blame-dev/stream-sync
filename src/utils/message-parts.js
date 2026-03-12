function getMessagePartsFromPayload(data = {}) {
    if (Array.isArray(data?.message?.parts)) {
        return data.message.parts;
    }

    if (Array.isArray(data?.messageParts)) {
        return data.messageParts;
    }

    if (Array.isArray(data?.metadata?.messageParts)) {
        return data.metadata.messageParts;
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

module.exports = {
    getMessagePartsFromPayload,
    isValidMessagePart,
    getValidMessageParts
};
