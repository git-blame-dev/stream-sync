import type { UnknownRecord } from '../../../utils/record-contracts';

const GIFT_PURCHASE_EVENT_TYPE = 'LiveChatSponsorshipsGiftPurchaseAnnouncement';
type NormalizedEventStructure = 'wrapped' | 'direct' | null;

interface NormalizeYouTubeEventResult {
    normalizedChatItem: UnknownRecord | null;
    eventType?: string | null;
    debugMetadata: UnknownRecord;
}

const asRecord = (value: unknown): UnknownRecord | null => {
    if (!value || typeof value !== 'object') {
        return null;
    }

    return value as UnknownRecord;
};

const asEventType = (value: unknown): string | null => {
    return typeof value === 'string' ? value : null;
};

const asTrimmedString = (value: unknown): string => {
    return typeof value === 'string' ? value.trim() : '';
};

function normalizeYouTubeEvent(chatItem: unknown): NormalizeYouTubeEventResult {
    const rawChatItem = asRecord(chatItem);
    if (!rawChatItem) {
        return {
            normalizedChatItem: null,
            debugMetadata: {
                reason: 'invalid_chat_item',
                chatItemType: typeof chatItem
            }
        };
    }

    let normalizedChatItem: UnknownRecord | null = null;
    let eventType: string | null = null;
    let structure: NormalizedEventStructure = null;

    const wrappedItem = asRecord(rawChatItem.item);
    if (wrappedItem) {
        normalizedChatItem = rawChatItem;
        eventType = asEventType(wrappedItem.type);
        structure = 'wrapped';
    } else if (rawChatItem.type) {
        normalizedChatItem = { item: rawChatItem };
        eventType = asEventType(rawChatItem.type);
        structure = 'direct';
    }

    if (!normalizedChatItem || !eventType) {
        return {
            normalizedChatItem: null,
            debugMetadata: {
                reason: 'unrecognized_structure',
                hasItem: !!rawChatItem.item,
                hasType: !!rawChatItem.type,
                keys: Object.keys(rawChatItem)
            }
        };
    }

    normalizedChatItem = hydrateWrapperFields(normalizedChatItem, rawChatItem);

    if (eventType === GIFT_PURCHASE_EVENT_TYPE) {
        const hydratedGiftPurchase = hydrateGiftPurchaseAuthor(normalizedChatItem);
        if (!hydratedGiftPurchase) {
            return {
                normalizedChatItem: null,
                eventType,
                debugMetadata: {
                    reason: 'missing_gift_purchase_author',
                    eventType,
                    structure
                }
            };
        }
        return {
            normalizedChatItem: hydratedGiftPurchase,
            eventType,
            debugMetadata: {
                structure,
                eventType
            }
        };
    }

    return {
        normalizedChatItem,
        eventType,
        debugMetadata: {
            structure,
            eventType
        }
    };
}

function hydrateWrapperFields(normalizedChatItem: UnknownRecord, rawChatItem: UnknownRecord): UnknownRecord {
    const rawItem = asRecord(rawChatItem.item);
    if (!rawItem) {
        return normalizedChatItem;
    }

    const normalizedItem = asRecord(normalizedChatItem.item);

    const wrapperId = rawChatItem.id;
    const wrapperTimestampUsec = rawChatItem.timestamp_usec;
    const wrapperTimestamp = rawChatItem.timestamp;
    const shouldHydrateId = wrapperId !== undefined && wrapperId !== null && !normalizedItem?.id;
    const shouldHydrateTimestampUsec = wrapperTimestampUsec !== undefined && wrapperTimestampUsec !== null
        && !normalizedItem?.timestamp_usec;
    const shouldHydrateTimestamp = !shouldHydrateTimestampUsec
        && wrapperTimestamp !== undefined
        && wrapperTimestamp !== null
        && !normalizedItem?.timestamp;

    if (!shouldHydrateId && !shouldHydrateTimestampUsec && !shouldHydrateTimestamp) {
        return normalizedChatItem;
    }

    return {
        ...normalizedChatItem,
        item: {
            ...(normalizedItem || {}),
            ...(shouldHydrateId ? { id: wrapperId } : {}),
            ...(shouldHydrateTimestampUsec ? { timestamp_usec: wrapperTimestampUsec } : {}),
            ...(shouldHydrateTimestamp ? { timestamp: wrapperTimestamp } : {})
        }
    };
}

function hydrateGiftPurchaseAuthor(normalizedChatItem: UnknownRecord): UnknownRecord | null {
    const item = asRecord(normalizedChatItem.item);
    if (!item) {
        return null;
    }

    const authorRecord = asRecord(item.author);
    const authorId = asTrimmedString(authorRecord?.id);
    const authorName = asTrimmedString(authorRecord?.name);
    if (authorId && authorName) {
        return normalizedChatItem;
    }

    const header = asRecord(item.header);
    const headerAuthorName = asRecord(header?.author_name);
    const headerName = asTrimmedString(headerAuthorName?.text);
    const headerId = asTrimmedString(item.author_external_channel_id);

    if (!headerName || !headerId) {
        return null;
    }

    const headerPhoto = Array.isArray(header?.author_photo) ? header.author_photo : [];
    const headerBadges = Array.isArray(header?.author_badges) ? header.author_badges : [];
    const hydratedAuthor = {
        id: headerId,
        name: headerName,
        thumbnails: headerPhoto,
        badges: headerBadges
    };

    return {
        ...normalizedChatItem,
        item: {
            ...item,
            author: hydratedAuthor
        }
    };
}

export { normalizeYouTubeEvent };
