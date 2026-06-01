type TransportRecord = Record<string, unknown>;

type GuiRuntimeConfig = {
    overlayMaxMessages: number;
    overlayMaxLinesPerMessage: number;
    uiCompareMode: boolean;
};

const DEFAULT_OVERLAY_MAX_MESSAGES = 3;
const DEFAULT_OVERLAY_MAX_LINES_PER_MESSAGE = 3;

function toTransportRecord(value: unknown): TransportRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    return { ...value };
}

function parsePositiveInteger(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : fallback;
}

function buildGuiRuntimeConfig(guiConfig: TransportRecord): GuiRuntimeConfig {
    return {
        overlayMaxMessages: parsePositiveInteger(guiConfig.overlayMaxMessages, DEFAULT_OVERLAY_MAX_MESSAGES),
        overlayMaxLinesPerMessage: parsePositiveInteger(
            guiConfig.overlayMaxLinesPerMessage,
            DEFAULT_OVERLAY_MAX_LINES_PER_MESSAGE
        ),
        uiCompareMode: guiConfig.uiCompareMode === true
    };
}

function isGuiActive(config: unknown = {}): boolean {
    const gui = toTransportRecord(toTransportRecord(config).gui);
    return gui.enableDock === true || gui.enableOverlay === true;
}

export { buildGuiRuntimeConfig, isGuiActive, toTransportRecord };
export type { GuiRuntimeConfig, TransportRecord };
