type AggregatedDonation = {
    userId: string;
    username: string;
    giftTypes: string[];
    totalGifts: number;
    totalCoins: number;
    message: string;
};

function createSyntheticGiftFromAggregated(aggregatedData: AggregatedDonation) {
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

export {
    createSyntheticGiftFromAggregated
};
