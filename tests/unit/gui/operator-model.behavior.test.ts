import { describe, expect, test } from 'bun:test'
import {
  appendLogRow,
  CONTROL_KEYS,
  formatLogData,
  FUNDING_ADJUSTMENTS_USD,
  MAX_LOG_ROWS,
  parseLogEntry,
  parseAppearanceState,
  selectNewestAppearance,
  parseOperatorState,
  parseFundingGoalLabelDraft,
  selectNewestState,
  parseFundingGoalSnapshot, selectNewestFundingGoal,
  toggleLevel,
} from '../../../gui/src/operator/model'

describe('operator model behavior', () => {
  test('exposes exactly the approved funding adjustments', () => {
    expect(FUNDING_ADJUSTMENTS_USD).toEqual([1, 10, -1])
  })

  test('keeps the newest bounded log rows', () => {
    const rows = Array.from({ length: MAX_LOG_ROWS }, (_, id) => ({ id, timestamp: '', level: 'info', message: '', source: '' }))
    expect(appendLogRow(rows, { id: MAX_LOG_ROWS, timestamp: '', level: 'info', message: '', source: '' })).toHaveLength(MAX_LOG_ROWS)
    expect(appendLogRow(rows, { id: MAX_LOG_ROWS, timestamp: '', level: 'info', message: '', source: '' })[0]?.id).toBe(1)
    const existing = rows[0]
    if (!existing) throw new Error('Expected an existing row')
    expect(appendLogRow(rows, existing)).toBe(rows)
    expect(appendLogRow(rows, { ...existing, id: -1 })).toBe(rows)
    expect(appendLogRow(rows, { ...existing, id: MAX_LOG_ROWS - 1 })).toBe(rows)
  })

  test('toggles a copied level set without mutating the source', () => {
    const original = new Set(['info'])
    expect([...toggleLevel(original, 'warn')]).toEqual(['info', 'warn'])
    expect(original).toEqual(new Set(['info']))
    expect(toggleLevel(original, 'info')).toEqual(new Set())
  })

  test('rejects malformed server payloads', () => {
    expect(parseOperatorState({ revision: 1, controls: [{ key: 'chat' }] })).toBeNull()
    expect(parseLogEntry({ id: 1, level: 'info' })).toBeNull()
    expect(parseLogEntry({ id: 1, timestamp: '', level: 'info', message: 'ok', source: 'test' })).not.toBeNull()
    expect(parseLogEntry({ id: 1, timestamp: '', level: 'trace', message: 'hidden', source: 'test' })).toBeNull()
    for (const id of ['1', -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseLogEntry({ id, timestamp: '', level: 'info', message: 'invalid', source: 'test' })).toBeNull()
    }
    expect(parseLogEntry({ id: 0, timestamp: '', level: 'info', message: 'valid', source: 'test' })).not.toBeNull()
    expect(parseLogEntry({ id: Number.MAX_SAFE_INTEGER, timestamp: '', level: 'info', message: 'valid', source: 'test' })).not.toBeNull()
  })

  test('accepts only one complete authoritative control set', () => {
    const controls = CONTROL_KEYS.map((key) => ({ key, label: key, enabled: true, overridden: false }))
    expect(parseOperatorState({ revision: 1, controls })).not.toBeNull()
    expect(parseOperatorState({ revision: -1, controls })).toBeNull()
    expect(parseOperatorState({ revision: 1.5, controls })).toBeNull()
    expect(parseOperatorState({ revision: 1, controls: [...controls, controls[0]] })).toBeNull()
    const current = { revision: 2, controls }
    expect(selectNewestState(current, { revision: 1, controls })).toBe(current)
  })

  test('strictly parses appearance and selects revisions independently', () => {
    const current = { revision: 3, settings: { compactRows: false, rowBackgroundsEnabled: true, maxDisplayableBadges: 2, streamSupporterChatEffectsEnabled: true, memberRowTheme: 'green' as const, memberRowEffects: ['sheen'] as const }, overriddenKeys: [] }
    const older = { ...current, revision: 2 }
    const newer = { ...current, revision: 4, settings: { ...current.settings, maxDisplayableBadges: 0 }, overriddenKeys: ['maxDisplayableBadges'] }
    expect(parseAppearanceState(newer)).toEqual(newer)
    expect(parseAppearanceState({ ...newer, revision: -1 })).toBeNull()
    expect(parseAppearanceState({ ...newer, revision: 1.5 })).toBeNull()
    expect(parseAppearanceState({ ...newer, settings: { ...newer.settings, maxDisplayableBadges: -1 } })).toBeNull()
    expect(selectNewestAppearance(current, older)).toBe(current)
    expect(selectNewestAppearance(current, newer)).toEqual(newer)
  })

  test('parses transport appearance events for either profile', async () => {
    const { parseGuiAppearanceEvent } = await import('../../../gui/src/shared/appearance')
    const settings = { compactRows: false, rowBackgroundsEnabled: true, maxDisplayableBadges: 3, streamSupporterChatEffectsEnabled: false, memberRowTheme: 'green', memberRowEffects: ['sheen'] } as const
    expect(parseGuiAppearanceEvent({ __guiEvent: 'appearance', profile: 'standard', revision: 2, settings })).toEqual({ profile: 'standard', revision: 2, settings })
    expect(parseGuiAppearanceEvent({ __guiEvent: 'appearance', profile: 'minimal', revision: 2, settings })?.profile).toBe('minimal')
  })

  test('formats unusual log data without throwing', () => {
    expect(formatLogData({ ok: true })).toContain('"ok": true')
    expect(formatLogData(1n)).toBe('[Unserializable log data]')
  })

  test('defensively parses funding snapshots and ignores stale revisions', () => {
    const snapshot = { enabled: true, id: 'goal', label: 'Goal', labelOverridden: false, currentUsd: 25, targetUsd: 100, completed: false, revision: 2, sessionId: 'session-1' }
    expect(parseFundingGoalSnapshot(snapshot)).toEqual(snapshot)
    expect(parseFundingGoalSnapshot({ ...snapshot, currentUsd: -1 })).toBeNull()
    expect(selectNewestFundingGoal(snapshot, { ...snapshot, revision: 1, currentUsd: 99 })).toBe(snapshot)
    expect(selectNewestFundingGoal(snapshot, { ...snapshot, revision: 0, sessionId: 'session-2', currentUsd: 0 })).toEqual(expect.objectContaining({ sessionId: 'session-2' }))
  })

  test('normalizes safe Unicode funding labels for operator mutations', () => {
    expect(parseFundingGoalLabelDraft('  🎮 New Controller  ')).toBe('🎮 New Controller')
    expect(parseFundingGoalLabelDraft('')).toBeNull()
    expect(parseFundingGoalLabelDraft('bad\nlabel')).toBeNull()
    expect(parseFundingGoalLabelDraft('hidden\u200Blabel')).toBeNull()
    expect(parseFundingGoalLabelDraft('x'.repeat(81))).toBeNull()
  })
})
