const STRIPPED_FIELDS = [
    'type',
    'platform',
    'user',
    'displayName',
    'isSuperfan',
    'isGift',
    'isBits'
];

class NotificationPayloadBuilder {
    constructor(NotificationBuilder) {
        if (!NotificationBuilder || typeof NotificationBuilder.build !== 'function') {
            throw new Error('NotificationPayloadBuilder requires NotificationBuilder.build');
        }
        this.NotificationBuilder = NotificationBuilder;
    }

    buildPayload({ canonicalType, platform, data, originalType, isMonetizationType, normalizedData }) {
        const resolvedData = normalizedData ?? this.normalizeData(data, isMonetizationType);
        const resolvedSourceType = this._resolveSourceType(data, originalType, canonicalType);

        const notificationData = this.NotificationBuilder.build({
            type: canonicalType,
            platform,
            username: resolvedData.username,
            userId: resolvedData.userId,
            amount: resolvedData.amount,
            currency: resolvedData.currency,
            giftType: resolvedData.giftType,
            giftCount: resolvedData.giftCount,
            tier: resolvedData.tier,
            months: resolvedData.months,
            message: resolvedData.message,
            sticker: resolvedData.sticker,
            stickerName: resolvedData.stickerName,
            stickerEmoji: resolvedData.stickerEmoji,
            ...resolvedData,
            sourceType: resolvedSourceType
        });

        notificationData.type = canonicalType;

        if (resolvedSourceType !== undefined) {
            if (isMonetizationType) {
                notificationData.sourceType = resolvedSourceType;
            } else if (notificationData.metadata && typeof notificationData.metadata === 'object') {
                notificationData.metadata = { ...notificationData.metadata, sourceType: resolvedSourceType };
            } else {
                notificationData.metadata = { sourceType: resolvedSourceType };
            }
        }

        return { notificationData, normalizedData: resolvedData, resolvedSourceType };
    }

    normalizeData(data, isMonetizationType) {
        const normalized = { ...data };
        for (const key of STRIPPED_FIELDS) {
            if (normalized[key] !== undefined) {
                delete normalized[key];
            }
        }
        if (isMonetizationType && normalized.metadata !== undefined) {
            delete normalized.metadata;
        }
        return normalized;
    }

    _resolveSourceType(data, originalType, canonicalType) {
        if (data && data.sourceType !== undefined) {
            return data.sourceType;
        }
        if (originalType && originalType !== canonicalType) {
            return originalType;
        }
        return undefined;
    }
}

module.exports = {
    NotificationPayloadBuilder
};
