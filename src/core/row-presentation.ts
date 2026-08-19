const ROW_THEMES = ['green', 'red', 'gold'] as const;
const ROW_VISUAL_EFFECT_IDS = ['sheen', 'particles'] as const;
const MAX_ROW_SPRITE_URL_LENGTH = 2048;

type RowTheme = (typeof ROW_THEMES)[number];
type RowVisualEffectId = (typeof ROW_VISUAL_EFFECT_IDS)[number];
type RowPresentationOverride = Readonly<{
    theme?: RowTheme;
    effects?: readonly RowVisualEffectId[];
    spriteUrl?: string;
}>;

function isRowTheme(value: unknown): value is RowTheme {
    return typeof value === 'string' && ROW_THEMES.includes(value as RowTheme);
}

function normalizeRowTheme(value: unknown): RowTheme | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim().toLowerCase();
    return isRowTheme(normalized) ? normalized : undefined;
}

function isRowVisualEffectId(value: unknown): value is RowVisualEffectId {
    return typeof value === 'string' && ROW_VISUAL_EFFECT_IDS.includes(value as RowVisualEffectId);
}

function normalizeRowEffects(value: unknown): RowVisualEffectId[] | undefined {
    if (!Array.isArray(value)) return undefined;
    if (value.some((effect) => !isRowVisualEffectId(effect))) return undefined;
    return [...new Set(value)];
}

function normalizeRowSpriteUrl(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const candidate = value.trim();
    if (!candidate) return undefined;

    try {
        const url = new URL(candidate);
        const canonicalUrl = url.toString();
        if (url.protocol !== 'https:' || url.username || url.password || url.hash) return undefined;
        return canonicalUrl.length <= MAX_ROW_SPRITE_URL_LENGTH ? canonicalUrl : undefined;
    } catch {
        return undefined;
    }
}

export {
    MAX_ROW_SPRITE_URL_LENGTH,
    ROW_THEMES,
    ROW_VISUAL_EFFECT_IDS,
    isRowTheme,
    isRowVisualEffectId,
    normalizeRowEffects,
    normalizeRowSpriteUrl,
    normalizeRowTheme
};
export type { RowPresentationOverride, RowTheme, RowVisualEffectId };
