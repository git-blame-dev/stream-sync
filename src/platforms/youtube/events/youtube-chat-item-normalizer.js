const GIFT_PURCHASE_EVENT_TYPE = 'LiveChatSponsorshipsGiftPurchaseAnnouncement';

function normalizeYouTubeChatItem(chatItem) {
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

function hydrateGiftPurchaseAuthor(normalizedChatItem) {
    const item = normalizedChatItem.item;
    if (!item || typeof item !== 'object') {
        return null;
    }

    const authorId = typeof item.author?.id === 'string' ? item.author.id.trim() : '';
    const authorName = typeof item.author?.name === 'string' ? item.author.name.trim() : '';
    if (authorId && authorName) {
        return normalizedChatItem;
    }

    const header = item.header;
    const headerName = typeof header?.author_name?.text === 'string'
        ? header.author_name.text.trim()
        : '';
    const headerId = typeof item.author_external_channel_id === 'string'
        ? item.author_external_channel_id.trim()
        : '';

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

module.exports = {
    normalizeYouTubeChatItem
};
