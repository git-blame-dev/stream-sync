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

    if (chatItem.item) {
        return {
            normalizedChatItem: chatItem,
            eventType: chatItem.item.type,
            debugMetadata: {
                structure: 'wrapped',
                eventType: chatItem.item.type
            }
        };
    }

    if (chatItem.type) {
        return {
            normalizedChatItem: { item: chatItem },
            eventType: chatItem.type,
            debugMetadata: {
                structure: 'direct',
                eventType: chatItem.type
            }
        };
    }

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

module.exports = {
    normalizeYouTubeChatItem
};

