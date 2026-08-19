import {
  isRowTheme,
  isRowVisualEffectId,
  type RowTheme,
  type RowVisualEffectId,
} from '../../../src/core/row-presentation'

export type Control = {
  key: string
  label: string
  enabled: boolean
  overridden: boolean
}

export type OperatorState = { revision: number; controls: Control[] }
export type AppearanceSettings = {
  compactRows: boolean
  rowBackgroundsEnabled: boolean
  maxDisplayableBadges: number
  streamSupporterChatEffectsEnabled: boolean
  memberRowTheme: RowTheme
  memberRowEffects: readonly RowVisualEffectId[]
}
export type AppearanceValue = AppearanceSettings[keyof AppearanceSettings]
export type AppearanceState = { revision: number; settings: AppearanceSettings; overriddenKeys: string[] }
export type LogEntry = { id: number; timestamp: string; level: string; message: string; source: string; data?: unknown }
export const CONTROL_KEYS = [
  'messagesEnabled',
  'commandsEnabled',
  'greetingsEnabled',
  'farewellsEnabled',
  'followsEnabled',
  'giftsEnabled',
  'paypiggiesEnabled',
  'raidsEnabled',
  'sharesEnabled',
] as const
export const LOG_LEVELS = ['debug', 'info', 'console', 'warn', 'error', 'emergency'] as const
export const MAX_LOG_ROWS = 200
export const APPEARANCE_KEYS = ['compactRows', 'rowBackgroundsEnabled', 'maxDisplayableBadges', 'streamSupporterChatEffectsEnabled', 'memberRowTheme', 'memberRowEffects'] as const

const controlKeys = new Set<string>(CONTROL_KEYS)
const logLevels = new Set<string>(LOG_LEVELS)
const appearanceKeys = new Set<string>(APPEARANCE_KEYS)

export function parseOperatorState(value: unknown): OperatorState | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { revision?: unknown; controls?: unknown }
  if (typeof candidate.revision !== 'number' || !Number.isFinite(candidate.revision) || !Array.isArray(candidate.controls)) return null
  const controls = candidate.controls.filter((control): control is Control => {
    if (!control || typeof control !== 'object') return false
    const item = control as Record<string, unknown>
    return typeof item.key === 'string'
      && controlKeys.has(item.key)
      && typeof item.label === 'string'
      && typeof item.enabled === 'boolean'
      && typeof item.overridden === 'boolean'
  })
  return controls.length === CONTROL_KEYS.length
    && controls.length === candidate.controls.length
    && new Set(controls.map((control) => control.key)).size === CONTROL_KEYS.length
    ? { revision: candidate.revision, controls }
    : null
}

export function parseAppearanceState(value: unknown): AppearanceState | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const settings = candidate.settings
  if (
    typeof candidate.revision !== 'number'
    || !Number.isFinite(candidate.revision)
    || !settings
    || typeof settings !== 'object'
    || !Array.isArray(candidate.overriddenKeys)
  ) return null
  const item = settings as Record<string, unknown>
  const compactRows = item.compactRows
  const rowBackgroundsEnabled = item.rowBackgroundsEnabled
  const maxDisplayableBadges = item.maxDisplayableBadges
  const streamSupporterChatEffectsEnabled = item.streamSupporterChatEffectsEnabled
  const memberRowTheme = item.memberRowTheme
  const memberRowEffects = item.memberRowEffects
  const isValid = typeof compactRows === 'boolean'
    && typeof rowBackgroundsEnabled === 'boolean'
    && typeof maxDisplayableBadges === 'number'
    && Number.isSafeInteger(maxDisplayableBadges)
    && maxDisplayableBadges >= 0
    && typeof streamSupporterChatEffectsEnabled === 'boolean'
    && isRowTheme(memberRowTheme)
    && Array.isArray(memberRowEffects)
    && memberRowEffects.length <= 2
    && new Set(memberRowEffects).size === memberRowEffects.length
    && memberRowEffects.every(isRowVisualEffectId)
    && candidate.overriddenKeys.every((key) => typeof key === 'string' && appearanceKeys.has(key))
    && new Set(candidate.overriddenKeys).size === candidate.overriddenKeys.length
  if (!isValid || typeof compactRows !== 'boolean' || typeof rowBackgroundsEnabled !== 'boolean' || typeof maxDisplayableBadges !== 'number') return null
  return {
    revision: candidate.revision,
    settings: {
      compactRows,
      rowBackgroundsEnabled,
      maxDisplayableBadges,
      streamSupporterChatEffectsEnabled,
      memberRowTheme,
      memberRowEffects: [...memberRowEffects] as RowVisualEffectId[],
    },
    overriddenKeys: [...candidate.overriddenKeys],
  }
}

export function parseLogEntry(value: unknown): LogEntry | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  return (typeof item.id === 'number' && Number.isSafeInteger(item.id) && item.id >= 0)
    && typeof item.timestamp === 'string'
    && typeof item.level === 'string'
    && logLevels.has(item.level)
    && typeof item.message === 'string'
    && typeof item.source === 'string'
    ? { id: item.id, timestamp: item.timestamp, level: item.level, message: item.message, source: item.source, data: item.data }
    : null
}

export function appendLogRow(rows: LogEntry[], entry: LogEntry): LogEntry[] {
  if (rows.some((row) => row.id >= entry.id)) return rows
  return [...rows, entry].slice(-MAX_LOG_ROWS)
}

export function selectNewestState(current: OperatorState | null, next: OperatorState): OperatorState {
  return !current || next.revision >= current.revision ? next : current
}

export function selectNewestAppearance(current: AppearanceState | null, next: AppearanceState): AppearanceState {
  return !current || next.revision >= current.revision ? next : current
}

export function formatLogData(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2) ?? String(data)
  } catch {
    return '[Unserializable log data]'
  }
}

export function toggleLevel(levels: Set<string>, level: string): Set<string> {
  const next = new Set(levels)
  if (next.has(level)) next.delete(level)
  else next.add(level)
  return next
}
