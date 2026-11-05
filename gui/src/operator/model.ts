import {
  isRowTheme,
  isRowVisualEffectId,
  type RowTheme,
  type RowVisualEffectId,
} from '../../../src/core/row-presentation'
import { validateFundingGoalLabel } from '../../../src/core/funding-goal-label'
import {
  parseFundingGoalSnapshot,
  selectNewestFundingGoal,
  type FundingGoalSnapshot,
} from '../shared/funding-goal'

export { parseFundingGoalSnapshot, selectNewestFundingGoal, type FundingGoalSnapshot }

export type Control = {
  key: string
  label: string
  enabled: boolean
  overridden: boolean
}

export type OperatorState = { sessionId?: string; revision: number; controls: Control[] }
export type AppearanceSettings = {
  compactRows: boolean
  rowBackgroundsEnabled: boolean
  maxDisplayableBadges: number
  streamSupporterChatEffectsEnabled: boolean
  memberRowTheme: RowTheme
  memberRowEffects: readonly RowVisualEffectId[]
}
export type AppearanceValue = AppearanceSettings[keyof AppearanceSettings]
export type AppearanceState = { sessionId?: string; revision: number; settings: AppearanceSettings; overriddenKeys: string[] }
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
  'repostsEnabled',
] as const
export const LOG_LEVELS = ['debug', 'info', 'console', 'warn', 'error', 'emergency'] as const
export const MAX_LOG_ROWS = 200
export const APPEARANCE_KEYS = ['compactRows', 'rowBackgroundsEnabled', 'maxDisplayableBadges', 'streamSupporterChatEffectsEnabled', 'memberRowTheme', 'memberRowEffects'] as const
export const FUNDING_ADJUSTMENTS_USD = [1, 10, -1] as const

export function parseFundingGoalLabelDraft(value: string): string | null {
  try {
    return validateFundingGoalLabel(value)
  } catch {
    return null
  }
}

const controlKeys = new Set<string>(CONTROL_KEYS)
const logLevels = new Set<string>(LOG_LEVELS)
const appearanceKeys = new Set<string>(APPEARANCE_KEYS)

export function parseOperatorState(value: unknown): OperatorState | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { sessionId?: unknown; revision?: unknown; controls?: unknown }
  if (candidate.sessionId !== undefined && (typeof candidate.sessionId !== 'string' || !candidate.sessionId.trim())) return null
  if (typeof candidate.revision !== 'number' || !Number.isSafeInteger(candidate.revision) || candidate.revision < 0 || !Array.isArray(candidate.controls)) return null
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
    ? { ...(candidate.sessionId ? { sessionId: candidate.sessionId as string } : {}), revision: candidate.revision, controls }
    : null
}

export function parseAppearanceState(value: unknown): AppearanceState | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (candidate.sessionId !== undefined && (typeof candidate.sessionId !== 'string' || !candidate.sessionId.trim())) return null
  const settings = candidate.settings
  if (
    typeof candidate.revision !== 'number'
    || !Number.isSafeInteger(candidate.revision)
    || candidate.revision < 0
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
    ...(candidate.sessionId ? { sessionId: candidate.sessionId as string } : {}),
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

// Only ordered snapshots from the active event stream may establish a new owner.
// HTTP responses can arrive after that owner has already been replaced.
export function selectSessionSnapshot<T extends { sessionId?: string; revision: number }>(
  current: T | null, next: T, source: 'http' | 'stream' = 'http',
): T {
  if (!current) return next
  if (current.sessionId !== next.sessionId) return source === 'stream' ? next : current
  return next.revision >= current.revision ? next : current
}

export function selectNewestState(current: OperatorState | null, next: OperatorState, source: 'http' | 'stream' = 'http'): OperatorState {
  return selectSessionSnapshot(current, next, source)
}

export function selectNewestAppearance(current: AppearanceState | null, next: AppearanceState, source: 'http' | 'stream' = 'http'): AppearanceState {
  return selectSessionSnapshot(current, next, source)
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
