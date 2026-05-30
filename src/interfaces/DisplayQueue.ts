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
    type: string;
    platform: string;
    data: DisplayQueueItemData;
    priority?: number;
    holdDurationMs?: number;
    vfxConfig?: DisplayQueueVfxConfig | null;
    secondaryVfxConfig?: DisplayQueueVfxConfig | null;
    [key: string]: unknown;
};

type NotificationQueueItem = DisplayQueueItem & {
    priority: number;
    data: NotificationQueueItemData;
};

type DisplayQueueWriter = {
    addItem(item: DisplayQueueItem): void;
};

type DisplayQueueLengthReader = {
    getQueueLength(): number;
};

type DisplayQueueDependency = DisplayQueueWriter & DisplayQueueLengthReader;

export type {
    DisplayQueueDependency,
    DisplayQueueItem,
    DisplayQueueItemData,
    DisplayQueueLengthReader,
    DisplayQueueMessage,
    DisplayQueueMessagePart,
    DisplayQueueVfxConfig,
    DisplayQueueWriter,
    NotificationQueueItem,
    NotificationQueueItemData
};
