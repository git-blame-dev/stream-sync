type MessagePartsPayload = {
    message?: {
        parts?: unknown;
    } | null;
};

type MessagePartCandidate = {
    type?: unknown;
    emoteId?: unknown;
    imageUrl?: unknown;
    text?: unknown;
    platform?: unknown;
    [key: string]: unknown;
};

type BadgeImageCandidate = {
    imageUrl?: unknown;
    source?: unknown;
    label?: unknown;
};

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

function getMessagePartsFromPayload(data: MessagePartsPayload = {}): MessagePartCandidate[] {
    const parts = data.message?.parts;
    if (Array.isArray(parts)) {
        return parts as MessagePartCandidate[];
    }

    return [];
}

function isValidMessagePart(part: unknown, options: MessagePartValidationOptions = {}): part is MessagePart {
    const { allowWhitespaceText = false } = options;

    if (!part || typeof part !== 'object') {
        return false;
    }

    const partRecord = part as MessagePartCandidate;

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

function getValidMessageParts(data: MessagePartsPayload = {}, options: MessagePartValidationOptions = {}): MessagePart[] {
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

        const badgeRecord = badge as BadgeImageCandidate;
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
