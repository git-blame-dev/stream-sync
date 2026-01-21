const GIFT_PURCHASE_EVENT_TYPE = 'LiveChatSponsorshipsGiftPurchaseAnnouncement';

function normalizeYouTubeEvent(chatItem) {
    if (!chatItem || typeof chatItem !== 'object') {
        return {
            normalizedChatItem: null,
            debugMetadata: {
                reason: 'invalid_chat_item',
                chatItemType: typeof chatItem
            }
        };
    }

    let normalizedChatItem = null;
    let eventType = null;
    let structure = null;

    if (chatItem.item) {
        normalizedChatItem = chatItem;
        eventType = chatItem.item.type;
        structure = 'wrapped';
    } else if (chatItem.type) {
        normalizedChatItem = { item: chatItem };
        eventType = chatItem.type;
        structure = 'direct';
    }

    if (!normalizedChatItem || !eventType) {
        return {
            normalizedChatItem: null,
            debugMetadata: {
                reason: 'unrecognized_structure',
                hasItem: Boolean(chatItem.item),
                hasType: Boolean(chatItem.type),
                keys: Object.keys(chatItem)
            }
        };
    }

    normalizedChatItem = hydrateWrapperFields(normalizedChatItem, chatItem);

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

function hydrateWrapperFields(normalizedChatItem, rawChatItem) {
    if (!rawChatItem?.item || typeof rawChatItem.item !== 'object') {
        return normalizedChatItem;
    }

    const wrapperId = rawChatItem.id;
    const wrapperTimestamp = rawChatItem.timestampUsec;
    const shouldHydrateId = wrapperId !== undefined && wrapperId !== null && !normalizedChatItem.item?.id;
    const shouldHydrateTimestamp = wrapperTimestamp !== undefined && wrapperTimestamp !== null && !normalizedChatItem.item?.timestampUsec;

    if (!shouldHydrateId && !shouldHydrateTimestamp) {
        return normalizedChatItem;
    }

    return {
        ...normalizedChatItem,
        item: {
            ...normalizedChatItem.item,
            ...(shouldHydrateId ? { id: wrapperId } : {}),
            ...(shouldHydrateTimestamp ? { timestampUsec: wrapperTimestamp } : {})
        }
    };
}

function hydrateGiftPurchaseAuthor(normalizedChatItem) {
    const item = normalizedChatItem.item;
    if (!item || typeof item !== 'object') {
        return null;
    }

    const author = item.author;
    const authorId = typeof author === 'object' && typeof author.id === 'string' ? author.id.trim() : '';
    const authorName = typeof author === 'object' && typeof author.name === 'string' ? author.name.trim() : '';
    if (authorId && authorName) {
        return normalizedChatItem;
    }

    const header = item.header;
    const headerName = header && header.author_name && typeof header.author_name.text === 'string'
        ? header.author_name.text.trim()
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

module.exports = {
    normalizeYouTubeEvent
};
