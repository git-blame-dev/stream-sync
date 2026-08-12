import { describe, expect, test } from 'bun:test'
import {
  appendLogRow,
  CONTROL_KEYS,
  formatLogData,
  MAX_LOG_ROWS,
  parseLogEntry,
  parseOperatorState,
  selectNewestState,
  toggleLevel,
} from '../../../gui/src/operator/model'

describe('operator model behavior', () => {
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
    expect(parseOperatorState({ revision: 1, controls: [...controls, controls[0]] })).toBeNull()
    const current = { revision: 2, controls }
    expect(selectNewestState(current, { revision: 1, controls })).toBe(current)
  })

  test('formats unusual log data without throwing', () => {
    expect(formatLogData({ ok: true })).toContain('"ok": true')
    expect(formatLogData(1n)).toBe('[Unserializable log data]')
  })
})
