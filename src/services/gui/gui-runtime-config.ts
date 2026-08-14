type TransportRecord = Record<string, unknown>;

type GuiRuntimeConfig = {
    overlayMaxMessages: number;
    overlayMaxLinesPerMessage: number;
    dockFeedMode: 'all' | 'chat' | 'non-chat';
    overlayFeedMode: 'all' | 'chat' | 'non-chat';
    notificationIdleHoldMs: number;
    monetizationIdleHoldMs: number;
    notificationTransitionMs: number;
};

const DEFAULT_OVERLAY_MAX_MESSAGES = 3;
const DEFAULT_OVERLAY_MAX_LINES_PER_MESSAGE = 3;
const DEFAULT_NOTIFICATION_IDLE_HOLD_MS = 5000;
const DEFAULT_MONETIZATION_IDLE_HOLD_MS = 30000;
const DEFAULT_NOTIFICATION_TRANSITION_MS = 1000;
const FEED_MODES = ['all', 'chat', 'non-chat'] as const;
type FeedMode = typeof FEED_MODES[number];

function toTransportRecord(value: unknown): TransportRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    return { ...value };
}

function parsePositiveInteger(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : fallback;
}

function parseFeedMode(value: unknown): FeedMode {
    return typeof value === 'string' && (FEED_MODES as readonly string[]).includes(value)
        ? value as FeedMode
        : 'all';
}

function buildGuiRuntimeConfig(guiConfig: TransportRecord): GuiRuntimeConfig {
    return {
        overlayMaxMessages: parsePositiveInteger(guiConfig.overlayMaxMessages, DEFAULT_OVERLAY_MAX_MESSAGES),
        overlayMaxLinesPerMessage: parsePositiveInteger(
            guiConfig.overlayMaxLinesPerMessage,
            DEFAULT_OVERLAY_MAX_LINES_PER_MESSAGE
        ),
        dockFeedMode: parseFeedMode(guiConfig.dockFeedMode),
        overlayFeedMode: parseFeedMode(guiConfig.overlayFeedMode),
        notificationIdleHoldMs: parseNonNegativeInteger(guiConfig.notificationIdleHoldMs, DEFAULT_NOTIFICATION_IDLE_HOLD_MS),
        monetizationIdleHoldMs: parseNonNegativeInteger(guiConfig.monetizationIdleHoldMs, DEFAULT_MONETIZATION_IDLE_HOLD_MS),
        notificationTransitionMs: parseNonNegativeInteger(guiConfig.notificationTransitionMs, DEFAULT_NOTIFICATION_TRANSITION_MS)
    };
}

function parseNonNegativeInteger(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function isGuiActive(config: unknown = {}): boolean {
    const gui = toTransportRecord(toTransportRecord(config).gui);
    return gui.enableDock === true || gui.enableOverlay === true || gui.enableNotifications === true || gui.enableOperator === true;
}

export { buildGuiRuntimeConfig, isGuiActive, toTransportRecord };
export type { GuiRuntimeConfig, TransportRecord };
