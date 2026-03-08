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

export function createGuiFeedStore() {
  let rows: GuiRowDto[] = []

  const pushEvent = (event: unknown): void => {
    const row = normalizeRow(event)
    if (!row.type || !row.avatarUrl) {
      return
    }

    rows = [...rows, row]
  }

  const getRows = (): GuiRowDto[] => rows

  return {
    pushEvent,
    getRows
  }
}
