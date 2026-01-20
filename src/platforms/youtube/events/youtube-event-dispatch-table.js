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

        // ========== LOW-PRIORITY EVENT NO-OPS (Intentionally ignored) ==========
        // These events occur in production but are not critical for core functionality.
        // We handle them as no-ops to prevent "UNKNOWN_EVENT" logging.

        // System viewer engagement messages - not needed for core functionality
        LiveChatViewerEngagementMessage: (chatItem) => platform.handleLowPriorityEvent(chatItem, 'LiveChatViewerEngagementMessage'),

        // Auto-moderated message notifications - not needed for core functionality
        LiveChatAutoModMessage: (chatItem) => platform.handleLowPriorityEvent(chatItem, 'LiveChatAutoModMessage'),

        // Chat mode change notifications - not needed for core functionality
        LiveChatModeChangeMessage: (chatItem) => platform.handleLowPriorityEvent(chatItem, 'LiveChatModeChangeMessage'),

        // Live poll banner notifications - not needed for core functionality
        LiveChatBannerPoll: (chatItem) => platform.handleLowPriorityEvent(chatItem, 'LiveChatBannerPoll'),

        // ========== END LOW-PRIORITY NO-OPS ==========

        // Regular chat messages route through unified handler
        LiveChatTextMessage: (chatItem) => {
            const authorName = platform._resolveChatItemAuthorName(chatItem);
            if (!authorName) {
                platform.logger?.warn?.('Skipping chat message: missing author name', 'youtube', {
                    eventType: chatItem.item?.type || null
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
