export interface MonetizationValuesConfig {
    readonly tiktokGiftUnitUsd: number;
    readonly twitchBitUsd: number;
    readonly youtubeJewelUsd: number;
    readonly tiktokMembershipUsd: number;
    readonly twitchMembershipUsd: number;
    readonly youtubeMembershipUsd: number;
}

export type SynchronousUsdConverter = (amount: number, currency: string) => number | null;

export function membershipNativeUnits(value: unknown, unitUsd: unknown): number {
    const amount = Number(value);
    const unit = Number(unitUsd);
    return Number.isFinite(amount) && amount > 0 && Number.isFinite(unit) && unit > 0 ? amount / unit : 0;
}
