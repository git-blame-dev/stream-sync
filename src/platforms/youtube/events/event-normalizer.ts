const GIFT_PURCHASE_EVENT_TYPE = 'LiveChatSponsorshipsGiftPurchaseAnnouncement';

type UnknownRecord = Record<string, unknown>;

interface NormalizeYouTubeEventResult {
    normalizedChatItem: UnknownRecord | null;
    eventType?: string | null;
    debugMetadata: UnknownRecord;
}

function normalizeYouTubeEvent(chatItem: unknown): NormalizeYouTubeEventResult {
    if (!chatItem || typeof chatItem !== 'object') {
        return {
            normalizedChatItem: null,
            debugMetadata: {
                reason: 'invalid_chat_item',
                chatItemType: typeof chatItem
            }
        };
    }

    const rawChatItem = chatItem as UnknownRecord;
    let normalizedChatItem: UnknownRecord | null = null;
    let eventType: string | null = null;
    let structure: 'wrapped' | 'direct' | null = null;

    if (rawChatItem.item && typeof rawChatItem.item === 'object') {
        normalizedChatItem = rawChatItem as UnknownRecord;
        const wrappedType = (rawChatItem.item as UnknownRecord).type;
        eventType = typeof wrappedType === 'string' ? wrappedType : null;
        structure = 'wrapped';
    } else if (rawChatItem.type) {
        normalizedChatItem = { item: rawChatItem };
        eventType = typeof rawChatItem.type === 'string' ? rawChatItem.type : null;
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
    const rawItem = rawChatItem.item;
    if (!rawItem || typeof rawItem !== 'object') {
        return normalizedChatItem;
    }

    const normalizedItem = normalizedChatItem.item && typeof normalizedChatItem.item === 'object'
        ? normalizedChatItem.item as UnknownRecord
        : null;

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
    const item = normalizedChatItem.item as UnknownRecord | undefined;
    if (!item || typeof item !== 'object') {
        return null;
    }

    const author = item.author;
    const authorRecord = (author && typeof author === 'object') ? author as UnknownRecord : null;
    const authorId = typeof authorRecord?.id === 'string' ? authorRecord.id.trim() : '';
    const authorName = typeof authorRecord?.name === 'string' ? authorRecord.name.trim() : '';
    if (authorId && authorName) {
        return normalizedChatItem;
    }

    const header = item.header && typeof item.header === 'object' ? item.header as UnknownRecord : null;
    const headerAuthorName = header?.author_name && typeof header.author_name === 'object'
        ? header.author_name as UnknownRecord
        : null;
    const headerName = typeof headerAuthorName?.text === 'string'
        ? headerAuthorName.text.trim()
        : '';
    const headerId = typeof item.author_external_channel_id === 'string'
        ? item.author_external_channel_id.trim()
        : '';

    if (!headerName || !headerId) {
        return null;
    }

    const headerPhoto = header && Array.isArray(header.author_photo) ? header.author_photo : [];
    const headerBadges = header && Array.isArray(header.author_badges) ? header.author_badges : [];
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
