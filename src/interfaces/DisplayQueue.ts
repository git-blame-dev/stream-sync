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
    badgeImages?: unknown;
    isPaypiggy?: boolean;
    memberSpriteUrl?: string;
    memberTheme?: 'red';
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

type DisplayQueueWriter = {
    addItem(item: DisplayQueueItem): void;
};

type DisplayQueueSequenceWriter = DisplayQueueWriter & {
    addSequence(items: DisplayQueueItem[]): void;
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
