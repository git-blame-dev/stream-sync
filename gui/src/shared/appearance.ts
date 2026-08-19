import {
  isRowTheme,
  isRowVisualEffectId,
  normalizeRowEffects,
  normalizeRowTheme,
  type RowTheme,
  type RowVisualEffectId,
} from '../../../src/core/row-presentation'

export type GuiAppearanceProfile = 'standard' | 'minimal'

export interface GuiAppearanceSettings {
  compactRows: boolean
  rowBackgroundsEnabled: boolean
  maxDisplayableBadges: number
  streamSupporterChatEffectsEnabled?: boolean
  memberRowTheme?: RowTheme
  memberRowEffects?: readonly RowVisualEffectId[]
}

export interface GuiAppearance {
  profile: GuiAppearanceProfile
  revision: number
  settings: GuiAppearanceSettings
}

export const DEFAULT_GUI_APPEARANCE: GuiAppearance = {
  profile: 'standard',
  revision: 0,
  settings: {
    compactRows: false,
    rowBackgroundsEnabled: true,
    maxDisplayableBadges: 3,
    streamSupporterChatEffectsEnabled: true,
    memberRowTheme: 'green',
    memberRowEffects: ['sheen'],
  },
}

export function selectDisplayableBadges<T>(badges: readonly T[] | undefined, limit: number): T[] {
  return Number.isSafeInteger(limit) && limit > 0 ? [...(badges ?? [])].slice(0, limit) : []
}

function parseEffects(value: unknown, fallback: readonly RowVisualEffectId[]): RowVisualEffectId[] {
  return normalizeRowEffects(value) ?? [...fallback]
}

export function parseGuiAppearanceSnapshot(value: unknown): GuiAppearance {
  if (!value || typeof value !== 'object') return DEFAULT_GUI_APPEARANCE
  const candidate = value as { profile?: unknown; revision?: unknown; settings?: unknown }
  const settings = candidate.settings && typeof candidate.settings === 'object'
    ? candidate.settings as Record<string, unknown>
    : {}
  const max = settings.maxDisplayableBadges
  return {
    profile: candidate.profile === 'minimal' ? 'minimal' : 'standard',
    revision: typeof candidate.revision === 'number' && Number.isSafeInteger(candidate.revision) && candidate.revision >= 0
      ? candidate.revision
      : 0,
    settings: {
      compactRows: settings.compactRows === true,
      rowBackgroundsEnabled: settings.rowBackgroundsEnabled !== false,
      maxDisplayableBadges: typeof max === 'number' && Number.isSafeInteger(max) && max >= 0
        ? max
        : DEFAULT_GUI_APPEARANCE.settings.maxDisplayableBadges,
      streamSupporterChatEffectsEnabled: settings.streamSupporterChatEffectsEnabled !== false,
      memberRowTheme: normalizeRowTheme(settings.memberRowTheme) ?? 'green',
      memberRowEffects: parseEffects(settings.memberRowEffects, ['sheen']),
    },
  }
}

export function parseGuiAppearanceEvent(value: unknown): GuiAppearance | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const settings = candidate.settings
  if (
    candidate.__guiEvent !== 'appearance'
    || (candidate.profile !== 'minimal' && candidate.profile !== 'standard')
    || typeof candidate.revision !== 'number'
    || !Number.isSafeInteger(candidate.revision)
    || candidate.revision < 0
    || !settings
    || typeof settings !== 'object'
  ) return null
  const appearanceSettings = settings as Record<string, unknown>
  if (
    typeof appearanceSettings.compactRows !== 'boolean'
    || typeof appearanceSettings.rowBackgroundsEnabled !== 'boolean'
    || typeof appearanceSettings.maxDisplayableBadges !== 'number'
    || !Number.isSafeInteger(appearanceSettings.maxDisplayableBadges)
    || appearanceSettings.maxDisplayableBadges < 0
    || typeof appearanceSettings.streamSupporterChatEffectsEnabled !== 'boolean'
    || !isRowTheme(appearanceSettings.memberRowTheme)
    || !Array.isArray(appearanceSettings.memberRowEffects)
    || appearanceSettings.memberRowEffects.length > 2
    || new Set(appearanceSettings.memberRowEffects).size !== appearanceSettings.memberRowEffects.length
    || appearanceSettings.memberRowEffects.some((effect) => !isRowVisualEffectId(effect))
  ) return null
  return {
    profile: candidate.profile as GuiAppearanceProfile,
    revision: candidate.revision,
    settings: {
      compactRows: appearanceSettings.compactRows,
      rowBackgroundsEnabled: appearanceSettings.rowBackgroundsEnabled,
      maxDisplayableBadges: appearanceSettings.maxDisplayableBadges,
      streamSupporterChatEffectsEnabled: appearanceSettings.streamSupporterChatEffectsEnabled,
      memberRowTheme: appearanceSettings.memberRowTheme,
      memberRowEffects: [...appearanceSettings.memberRowEffects] as RowVisualEffectId[],
    },
  }
}
