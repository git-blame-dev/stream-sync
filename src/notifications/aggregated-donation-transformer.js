function createSyntheticGiftFromAggregated(aggregatedData) {
    return {
        userId: aggregatedData.userId,
        username: aggregatedData.username,
        giftType: `Multiple Gifts (${aggregatedData.giftTypes.join(', ')})`,
        giftCount: aggregatedData.totalGifts,
        amount: aggregatedData.totalCoins,
        currency: 'coins',
        message: aggregatedData.message,
        isAggregated: true
    };
}

module.exports = { createSyntheticGiftFromAggregated };
