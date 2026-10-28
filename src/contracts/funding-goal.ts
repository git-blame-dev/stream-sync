export interface FundingGoalSnapshot {
    readonly enabled: boolean;
    readonly id: string;
    readonly label: string;
    readonly labelOverridden: boolean;
    readonly currentUsd: number;
    readonly targetUsd: number;
    readonly completed: boolean;
    readonly revision: number;
    readonly sessionId: string;
}
