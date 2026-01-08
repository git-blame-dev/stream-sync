function createYouTubeEventDispatchTable(platform) {
    return {
        // Super Chat events
        LiveChatPaidMessage: (chatItem) => platform.handleSuperChat(chatItem),

        // Super Sticker events
        LiveChatPaidSticker: (chatItem) => platform.handleSuperSticker(chatItem),

        // Membership events
        LiveChatMembershipItem: (chatItem) => platform.handleMembership(chatItem),

        // Gift membership purchase announcements
        LiveChatSponsorshipsGiftPurchaseAnnouncement: (chatItem) => platform.handleGiftMembershipPurchase(chatItem),

        LiveChatSponsorshipsGiftRedemptionAnnouncement: (chatItem) => platform.handleGiftMembershipRedemption(chatItem),

        // ========== LOW-PRIORITY EVENT NO-OPS (Intentionally ignored) ==========
        // These events occur in production but are not critical for core functionality.
        // We handle them as no-ops to prevent "UNKNOWN_EVENT" logging.

        // System viewer engagement messages - not needed for core functionality
        LiveChatViewerEngagementMessage: (chatItem) => platform.handleLowPriorityEvent(chatItem, 'LiveChatViewerEngagementMessage'),

        // Extended SuperChat ticker display - not needed for core functionality
        LiveChatTickerPaidMessageItem: (chatItem) => platform.handleLowPriorityEvent(chatItem, 'LiveChatTickerPaidMessageItem'),

        // Membership milestone ticker display - not needed for core functionality
        LiveChatTickerSponsorItem: (chatItem) => platform.handleLowPriorityEvent(chatItem, 'LiveChatTickerSponsorItem'),

        // Auto-moderated message notifications - not needed for core functionality
        LiveChatAutoModMessage: (chatItem) => platform.handleLowPriorityEvent(chatItem, 'LiveChatAutoModMessage'),

        // Chat mode change notifications - not needed for core functionality
        LiveChatModeChangeMessage: (chatItem) => platform.handleLowPriorityEvent(chatItem, 'LiveChatModeChangeMessage'),

        // Live poll banner notifications - not needed for core functionality
        LiveChatBannerPoll: (chatItem) => platform.handleLowPriorityEvent(chatItem, 'LiveChatBannerPoll'),

        // ========== END LOW-PRIORITY NO-OPS ==========

        // Extended SuperSticker ticker display - additional event for $5+ SuperStickers (not needed)
        LiveChatTickerPaidStickerItem: (chatItem) => platform.handleLowPriorityEvent(chatItem, 'LiveChatTickerPaidStickerItem'),

        // ========== RENDERER VARIANT HANDLERS (NO-OP to prevent unknown events) ==========
        // These are duplicate/alternative formats of existing events that we don't need to process
        // but we handle them to prevent "UNKNOWN_EVENT" logging.

        // SuperSticker renderer variant (alternative to LiveChatPaidSticker)
        LiveChatPaidStickerRenderer: (chatItem) => platform.handleRendererVariant(chatItem, 'LiveChatPaidStickerRenderer'),

        // Membership renderer variant (alternative to LiveChatMembershipItem)
        LiveChatMembershipItemRenderer: (chatItem) => platform.handleRendererVariant(chatItem, 'LiveChatMembershipItemRenderer'),

        // Ticker SuperSticker renderer variant (alternative to LiveChatTickerPaidStickerItem)
        LiveChatTickerPaidStickerItemRenderer: (chatItem) => platform.handleRendererVariant(chatItem, 'LiveChatTickerPaidStickerItemRenderer'),

        // Gift purchase renderer variant (alternative to LiveChatSponsorshipsGiftPurchaseAnnouncement)
        LiveChatSponsorshipsGiftPurchaseAnnouncementRenderer: (chatItem) => platform.handleRendererVariant(chatItem, 'LiveChatSponsorshipsGiftPurchaseAnnouncementRenderer'),

        // Ticker SuperChat renderer variant (alternative to LiveChatTickerPaidMessageItem)
        LiveChatTickerPaidMessageItemRenderer: (chatItem) => platform.handleRendererVariant(chatItem, 'LiveChatTickerPaidMessageItemRenderer'),

        // Ticker sponsorship renderer variant (alternative to LiveChatTickerSponsorItem)
        LiveChatTickerSponsorshipsItemRenderer: (chatItem) => platform.handleRendererVariant(chatItem, 'LiveChatTickerSponsorshipsItemRenderer'),

        // ========== END RENDERER VARIANTS ==========

        // Regular chat messages route through unified handler
        LiveChatTextMessage: (chatItem) => {
            const authorName = chatItem.author?.name || chatItem.item?.author?.name || null;
            if (!authorName || !authorName.trim()) {
                platform.logger?.warn?.('Skipping chat message: missing author name', 'youtube', {
                    eventType: chatItem.item?.type || chatItem.type || null
                });
                return;
            }
            platform._processRegularChatMessage(chatItem, authorName);
        }
    };
}

module.exports = {
    createYouTubeEventDispatchTable
};
