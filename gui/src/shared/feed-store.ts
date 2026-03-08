import type { GuiRowDto } from './types'

const EMPTY_ROW: GuiRowDto = {
  type: '',
  kind: 'chat',
  platform: '',
  username: '',
  text: '',
  avatarUrl: '',
  timestamp: null
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeRow(input: unknown): GuiRowDto {
  const row = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const kind = normalizeString(row.kind)

  if (
    kind !== 'chat' &&
    kind !== 'command' &&
    kind !== 'greeting' &&
    kind !== 'farewell' &&
    kind !== 'notification'
  ) {
    return { ...EMPTY_ROW }
  }

  return {
    type: normalizeString(row.type),
    kind,
    platform: normalizeString(row.platform),
    username: normalizeString(row.username),
    text: normalizeString(row.text),
    avatarUrl: normalizeString(row.avatarUrl),
    timestamp: row.timestamp === null ? null : normalizeString(row.timestamp)
  }
}

export interface GuiFeedStoreOptions {
  maxRows?: number
}

function normalizeMaxRows(value: unknown): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0
}

export function createGuiFeedStore(options: GuiFeedStoreOptions = {}) {
  let rows: GuiRowDto[] = []
  const maxRows = normalizeMaxRows(options.maxRows)

  const pushEvent = (event: unknown): void => {
    const row = normalizeRow(event)
    if (!row.type || !row.avatarUrl) {
      return
    }

    rows = [...rows, row]

    if (maxRows > 0 && rows.length > maxRows) {
      rows = rows.slice(rows.length - maxRows)
    }
  }

  const getRows = (): GuiRowDto[] => rows

  return {
    pushEvent,
    getRows
  }
}
