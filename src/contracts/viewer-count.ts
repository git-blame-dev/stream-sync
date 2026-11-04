/** Verified broadcasts observed by Stream Sync; anonymous discovery may miss others. */
export type ViewerMembershipSnapshot = {
    generation: number;
    videoIds: readonly string[];
    availability: 'unknown' | 'live' | 'offline';
    /** Coverage of the bounded discovery sources, separate from count validity. */
    discoveryComplete: boolean;
};

export type ViewerCountObservation =
    | { kind: 'complete'; count: number; membershipGeneration: number }
    | { kind: 'unavailable'; membershipGeneration: number; reason: 'membership_unknown' | 'capability_missing' | 'extraction_unavailable' | 'membership_changed' | 'retired' };

export type ViewerCountSnapshot = {
    count: number;
    hasCompleteObservation: boolean;
    lastCompleteAt: number | null;
    latestOutcome: 'unknown' | 'complete' | 'unavailable';
    membershipGeneration?: number;
};
