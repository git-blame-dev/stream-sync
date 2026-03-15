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

function normalizeParts(value: unknown): GuiRowDto['parts'] {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined
  }

  const parts = value
    .filter((part): part is Record<string, unknown> => !!part && typeof part === 'object')
    .map((part) => {
      const partType = normalizeString(part.type)
      if (partType === 'emote') {
        const emoteId = normalizeString(part.emoteId)
        const imageUrl = normalizeString(part.imageUrl)
        if (!emoteId || !imageUrl) {
          return null
        }
        return {
          type: 'emote' as const,
          platform: normalizeString(part.platform),
          emoteId,
          imageUrl
        }
      }

      if (partType === 'text') {
        const text = typeof part.text === 'string' ? part.text : ''
        if (!text) {
          return null
        }
        return {
          type: 'text' as const,
          text
        }
      }

      return null
    })
    .filter((part): part is NonNullable<typeof part> => part !== null)

  return parts.length > 0 ? parts : undefined
}

function normalizeBadgeImages(value: unknown): GuiRowDto['badgeImages'] {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined
  }

  const seen = new Set<string>()
  const badges = value
    .filter((badge): badge is Record<string, unknown> => !!badge && typeof badge === 'object')
    .map((badge) => ({
      imageUrl: normalizeString(badge.imageUrl),
      source: normalizeString(badge.source),
      label: typeof badge.label === 'string' ? badge.label : ''
    }))
    .filter((badge) => {
      if (!badge.imageUrl || seen.has(badge.imageUrl)) {
        return false
      }
      seen.add(badge.imageUrl)
      return true
    })

  return badges.length > 0 ? badges : undefined
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
    parts: normalizeParts(row.parts),
    badgeImages: normalizeBadgeImages(row.badgeImages),
    isPaypiggy: typeof row.isPaypiggy === 'boolean' ? row.isPaypiggy : undefined,
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
