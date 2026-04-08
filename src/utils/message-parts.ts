type UnknownRecord = Record<string, unknown>;

type MessagePart =
    | { type: 'emote'; emoteId: string; imageUrl: string; platform?: string }
    | { type: 'text'; text: string };

interface MessagePartValidationOptions {
    allowWhitespaceText?: boolean;
}

interface NormalizedBadgeImage {
    imageUrl: string;
    source: string;
    label: string;
}

function getMessagePartsFromPayload(data: UnknownRecord = {}): unknown[] {
    const message = data.message;
    if (message && typeof message === 'object' && Array.isArray((message as UnknownRecord).parts)) {
        return (message as UnknownRecord).parts as unknown[];
    }

    return [];
}

function isValidMessagePart(part: unknown, options: MessagePartValidationOptions = {}): part is MessagePart {
    const { allowWhitespaceText = false } = options;

    if (!part || typeof part !== 'object') {
        return false;
    }

    const partRecord = part as UnknownRecord;

    if (partRecord.type === 'emote') {
        return typeof partRecord.emoteId === 'string' && partRecord.emoteId.trim().length > 0
            && typeof partRecord.imageUrl === 'string' && partRecord.imageUrl.trim().length > 0;
    }

    if (partRecord.type === 'text') {
        if (typeof partRecord.text !== 'string') {
            return false;
        }

        return allowWhitespaceText
            ? partRecord.text.length > 0
            : partRecord.text.trim().length > 0;
    }

    return false;
}

function getValidMessageParts(data: UnknownRecord = {}, options: MessagePartValidationOptions = {}): MessagePart[] {
    return getMessagePartsFromPayload(data)
        .filter((part): part is MessagePart => isValidMessagePart(part, options));
}

function normalizeBadgeImages(value: unknown): NormalizedBadgeImage[] {
    if (!Array.isArray(value) || value.length === 0) {
        return [];
    }

    const seen = new Set<string>();
    const result: NormalizedBadgeImage[] = [];

    for (const badge of value) {
        if (!badge || typeof badge !== 'object') {
            continue;
        }

        const badgeRecord = badge as UnknownRecord;
        const imageUrl = typeof badgeRecord.imageUrl === 'string' ? badgeRecord.imageUrl.trim() : '';
        if (!imageUrl || seen.has(imageUrl)) {
            continue;
        }

        seen.add(imageUrl);
        result.push({
            imageUrl,
            source: typeof badgeRecord.source === 'string' ? badgeRecord.source.trim() : '',
            label: typeof badgeRecord.label === 'string' ? badgeRecord.label : ''
        });
    }

    return result;
}

export { getMessagePartsFromPayload, isValidMessagePart, getValidMessageParts, normalizeBadgeImages };
