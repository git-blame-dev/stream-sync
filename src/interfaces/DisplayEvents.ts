export const DISPLAY_EVENT_TYPES = {
    NOTIFICATION_LIFECYCLE: 'display:notification-lifecycle',
    GIFT_ANIMATION_SETTLED: 'display:gift-animation-settled'
} as const;

export type DisplayNotificationLifecyclePhase = 'started' | 'exit-started';

export type DisplayLifecyclePayload = {
    eventId: string;
    phase: DisplayNotificationLifecyclePhase;
    type: string;
    platform?: string;
    timestamp: number;
};

export type GiftAnimationSettledReason =
    | 'ended'
    | 'media-error'
    | 'play-rejected'
    | 'canvas-unavailable'
    | 'timeout';

export type GiftAnimationSettledPayload = {
    playbackId: string;
    reason: GiftAnimationSettledReason;
};
