// Keep the existing funding identity and valuation inputs, not provider payloads.
const SOURCE_FIELDS = [
    'id', 'timestamp', 'userId', 'tier', 'membershipLevel', 'months',
    'giftCount', 'giftType', 'amount', 'currency', 'isRenewal', 'isAnonymous', 'isError'
] as const;

export type NotificationContribution = Readonly<{
    platform: string;
    type: string;
    data: Readonly<Record<string, string | number | boolean | null>>;
}>;

export function createNotificationContribution(platform: string, type: string, data: Record<string, unknown>): NotificationContribution {
    const source: Record<string, string | number | boolean | null> = {};
    for (const field of SOURCE_FIELDS) {
        const value = data[field];
        if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            source[field] = value;
        }
    }
    return Object.freeze({ platform, type, data: Object.freeze(source) });
}

export function copyNotificationContributions(contributions: readonly NotificationContribution[]) {
    return Object.freeze(contributions.map(source => createNotificationContribution(source.platform, source.type, source.data)));
}
