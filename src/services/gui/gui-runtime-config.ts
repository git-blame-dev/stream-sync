type TransportRecord = Record<string, unknown>;

type GuiFeedMode = 'all' | 'chat' | 'non-chat';
type GuiPageKind = 'dock' | 'notifications' | 'overlay' | 'tiktok-animations';
type GuiAppearanceProfile = 'standard' | 'minimal';
type GuiAppearanceSettings = {
    compactRows: boolean;
    rowBackgroundsEnabled: boolean;
    maxDisplayableBadges: number;
};
type GuiAppearanceSnapshot = {
    revision: number;
    settings: GuiAppearanceSettings;
    overriddenKeys?: readonly string[];
};
type GuiRuntimeConfig = {
    overlayMaxMessages: number;
    overlayMaxLinesPerMessage: number;
    dockFeedMode: 'all' | 'chat' | 'non-chat';
    overlayFeedMode: 'all' | 'chat' | 'non-chat';
    notificationIdleHoldMs: number;
    monetizationIdleHoldMs: number;
    notificationTransitionMs: number;
    appearance: {
        profile: GuiAppearanceProfile;
        revision: number;
        settings: GuiAppearanceSettings;
    };
};

const DEFAULT_OVERLAY_MAX_MESSAGES = 3;
const DEFAULT_MINIMAL_OVERLAY_MAX_MESSAGES = 6;
const DEFAULT_OVERLAY_MAX_LINES_PER_MESSAGE = 3;
const DEFAULT_NOTIFICATION_IDLE_HOLD_MS = 5000;
const DEFAULT_MONETIZATION_IDLE_HOLD_MS = 30000;
const DEFAULT_NOTIFICATION_TRANSITION_MS = 1000;
const FEED_MODES = ['all', 'chat', 'non-chat'] as const;
type FeedMode = typeof FEED_MODES[number];
const MAX_OVERLAY_MESSAGES = 100;

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

function buildAppearanceSettings(guiConfig: TransportRecord): GuiAppearanceSettings {
    return {
        compactRows: guiConfig.minimalCompactRows !== false,
        rowBackgroundsEnabled: guiConfig.minimalRowBackgroundsEnabled === true,
        maxDisplayableBadges: parseNonNegativeInteger(guiConfig.minimalMaxDisplayableBadges, 3)
    };
}

function normalizeAppearanceSnapshot(
    guiConfig: TransportRecord,
    appearance?: GuiAppearanceSnapshot
): GuiAppearanceSnapshot {
    const defaults = buildAppearanceSettings(guiConfig);
    const settings = toTransportRecord(appearance?.settings);
    const revision = appearance && Number.isSafeInteger(appearance.revision) && appearance.revision >= 0
        ? appearance.revision
        : 0;
    return {
        revision,
        settings: {
            compactRows: typeof settings.compactRows === 'boolean'
                ? settings.compactRows
                : defaults.compactRows,
            rowBackgroundsEnabled: typeof settings.rowBackgroundsEnabled === 'boolean'
                ? settings.rowBackgroundsEnabled
                : defaults.rowBackgroundsEnabled,
            maxDisplayableBadges: parseNonNegativeInteger(
                settings.maxDisplayableBadges,
                defaults.maxDisplayableBadges
            )
        }
    };
}

function buildGuiRuntimeConfig(
    guiConfig: TransportRecord,
    appearance?: GuiAppearanceSnapshot
): GuiRuntimeConfig {
    const appearanceSnapshot = normalizeAppearanceSnapshot(guiConfig, appearance);
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
        notificationTransitionMs: parseNonNegativeInteger(guiConfig.notificationTransitionMs, DEFAULT_NOTIFICATION_TRANSITION_MS),
        appearance: {
            profile: 'standard',
            revision: appearanceSnapshot.revision,
            settings: appearanceSnapshot.settings
        }
    };
}

function parseAppearanceProfile(searchParams: URLSearchParams): GuiAppearanceProfile {
    const values = searchParams.getAll('appearance');
    return values.length === 1 && values[0] === 'minimal' ? 'minimal' : 'standard';
}

function parseOverlayMessageOverride(searchParams: URLSearchParams): number | null {
    const values = searchParams.getAll('maxMessages');
    if (values.length !== 1 || !/^[1-9]\d*$/.test(values[0] ?? '')) {
        return null;
    }
    const value = Number(values[0]);
    return Number.isSafeInteger(value) && value <= MAX_OVERLAY_MESSAGES ? value : null;
}

function parseMinimalOverlayMessages(value: unknown): number {
    const parsed = parsePositiveInteger(value, DEFAULT_MINIMAL_OVERLAY_MAX_MESSAGES);
    return parsed <= MAX_OVERLAY_MESSAGES ? parsed : DEFAULT_MINIMAL_OVERLAY_MAX_MESSAGES;
}

function resolveGuiPageRuntimeConfig(
    guiConfig: TransportRecord,
    pageKind: GuiPageKind,
    searchParams: URLSearchParams,
    appearance?: GuiAppearanceSnapshot
): GuiRuntimeConfig {
    const base = buildGuiRuntimeConfig(guiConfig, appearance);
    const profile = parseAppearanceProfile(searchParams);
    const configuredMinimalMaxMessages = parseMinimalOverlayMessages(guiConfig.minimalOverlayMaxMessages);
    const profileMaxMessages = profile === 'minimal'
        ? configuredMinimalMaxMessages
        : base.overlayMaxMessages;
    const urlMaxMessages = pageKind === 'overlay'
        ? parseOverlayMessageOverride(searchParams)
        : null;

    return {
        ...base,
        overlayMaxMessages: urlMaxMessages ?? (pageKind === 'overlay' ? profileMaxMessages : base.overlayMaxMessages),
        appearance: {
            ...base.appearance,
            profile
        }
    };
}

function parseNonNegativeInteger(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function isGuiActive(config: unknown = {}): boolean {
    const gui = toTransportRecord(toTransportRecord(config).gui);
    return gui.enableDock === true || gui.enableOverlay === true || gui.enableNotifications === true || gui.enableOperator === true;
}

export {
    buildGuiRuntimeConfig,
    isGuiActive,
    resolveGuiPageRuntimeConfig,
    toTransportRecord
};
export type {
    GuiAppearanceSettings,
    GuiAppearanceSnapshot,
    GuiFeedMode,
    GuiPageKind,
    GuiRuntimeConfig,
    TransportRecord
};
