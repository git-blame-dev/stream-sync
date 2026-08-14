export type GuiAppearanceProfile = 'standard' | 'minimal'

export interface GuiAppearanceSettings {
  compactRows: boolean
  rowBackgroundsEnabled: boolean
  maxDisplayableBadges: number
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
  },
}

export function selectDisplayableBadges<T>(badges: readonly T[] | undefined, limit: number): T[] {
  return Number.isSafeInteger(limit) && limit > 0 ? [...(badges ?? [])].slice(0, limit) : []
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
    },
  }
}

export function parseGuiAppearanceEvent(value: unknown): GuiAppearance | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const settings = candidate.settings
  if (
    candidate.__guiEvent !== 'appearance'
    || candidate.profile !== 'minimal'
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
  ) return null
  return {
    profile: 'minimal',
    revision: candidate.revision,
    settings: {
      compactRows: appearanceSettings.compactRows,
      rowBackgroundsEnabled: appearanceSettings.rowBackgroundsEnabled,
      maxDisplayableBadges: appearanceSettings.maxDisplayableBadges,
    },
  }
}
