import type { RowPresentationOverride } from '../core/row-presentation';

type DisplayQueueMessagePart = Record<string, unknown> & {
    text?: unknown;
};

type DisplayQueueMessage = string | (Record<string, unknown> & {
    text?: unknown;
    parts?: DisplayQueueMessagePart[];
});

type DisplayQueueItemData = Record<string, unknown> & {
    username?: string | undefined;
    userId?: string | undefined;
    avatarUrl?: unknown;
    message?: unknown;
    timestamp?: unknown;
    displayMessage?: unknown;
    ttsMessage?: unknown;
    logMessage?: unknown;
    amount?: unknown;
    currency?: unknown;
    giftType?: unknown;
    giftCount?: unknown;
    repeatCount?: unknown;
    tier?: unknown;
    months?: unknown;
    isError?: boolean;
    goalProcessed?: boolean;
    goalOutcome?: 'applied' | 'not-applied' | 'failed';
    badgeImages?: unknown;
    isPaypiggy?: boolean;
    isStreamSupporter?: boolean;
    presentationOverride?: RowPresentationOverride;
};

type NotificationQueueItemData = DisplayQueueItemData & {
    displayMessage: string;
};

type DisplayQueueVfxConfig = Record<string, unknown> & {
    command?: string;
    commandKey?: string;
    filename?: string;
    mediaSource?: string;
    vfxFilePath?: string;
    duration?: number;
    triggerWord?: string;
};

type DisplayQueueItem = {
    eventId?: string;
    type: string;
    platform: string;
    data: DisplayQueueItemData;
    priority?: number;
    holdDurationMs?: number;
    vfxConfig?: DisplayQueueVfxConfig | null;
    secondaryVfxConfig?: DisplayQueueVfxConfig | null;
    [key: string]: unknown;
};

type DisplayQueueSequence = {
    type: '__display_queue_sequence__';
    priority: number;
    children: DisplayQueueItem[];
};

type NotificationQueueItem = DisplayQueueItem & {
    priority: number;
    data: NotificationQueueItemData;
};

// Admission receipts retain child references; they do not report presentation completion.
type DisplayQueueWriter = {
    addItem(item: DisplayQueueItem): readonly DisplayQueueItem[];
};

type DisplayQueueSequenceWriter = DisplayQueueWriter & {
    addSequence(items: DisplayQueueItem[]): readonly DisplayQueueItem[];
};

type DisplayQueueLengthReader = {
    getQueueLength(): number;
};

type DisplayQueueDependency = DisplayQueueWriter & DisplayQueueLengthReader;

export type {
    DisplayQueueDependency,
    DisplayQueueItem,
    DisplayQueueSequence,
    DisplayQueueItemData,
    DisplayQueueLengthReader,
    DisplayQueueMessage,
    DisplayQueueMessagePart,
    DisplayQueueSequenceWriter,
    DisplayQueueVfxConfig,
    DisplayQueueWriter,
    NotificationQueueItem,
    NotificationQueueItemData
};
