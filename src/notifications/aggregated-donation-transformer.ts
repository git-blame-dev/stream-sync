import { copyNotificationContributions, type NotificationContribution } from './notification-contribution';

type AggregatedDonation = {
    userId: string;
    username: string;
    giftTypes: string[];
    totalGifts: number;
    totalCoins: number;
    message: string;
    currency?: string;
    avatarUrl?: string;
    contributions?: readonly NotificationContribution[];
};

function createSyntheticGiftFromAggregated(aggregatedData: AggregatedDonation) {
    const avatarUrl = typeof aggregatedData.avatarUrl === 'string' ? aggregatedData.avatarUrl.trim() : '';
    return {
        userId: aggregatedData.userId,
        username: aggregatedData.username,
        giftType: `Multiple Gifts (${aggregatedData.giftTypes.join(', ')})`,
        giftCount: aggregatedData.totalGifts,
        amount: aggregatedData.totalCoins,
        currency: aggregatedData.currency ?? 'coins',
        ...(avatarUrl ? { avatarUrl } : {}),
        ...(aggregatedData.contributions ? { contributions: copyNotificationContributions(aggregatedData.contributions) } : {}),
        message: aggregatedData.message,
        isAggregated: true
    };
}

export {
    createSyntheticGiftFromAggregated
};
