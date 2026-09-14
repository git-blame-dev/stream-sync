import { normalizeRowEffects, normalizeRowSpriteUrl, normalizeRowTheme } from '../../../src/core/row-presentation'
import type { GuiRowDto, RowPresentationOverride } from './types'

const EMPTY_ROW: GuiRowDto = {
  presentationRole: 'ordinary',
  type: '',
  kind: 'chat',
  platform: '',
  username: '',
  text: '',
  avatarUrl: '',
  timestamp: null
}

const EVENT_ID_DEDUP_LIMIT = 1000

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizePresentationOverride(value: unknown): RowPresentationOverride | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Record<string, unknown>
  const theme = normalizeRowTheme(candidate.theme)
  const effects = normalizeRowEffects(candidate.effects)
  const spriteUrl = normalizeRowSpriteUrl(candidate.spriteUrl)
  if (!theme && !effects && !spriteUrl) return undefined
  return { ...(theme ? { theme } : {}), ...(effects ? { effects } : {}), ...(spriteUrl ? { spriteUrl } : {}) }
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

function normalizePresentationRole(
  kind: GuiRowDto['kind'],
  value: unknown
): NonNullable<GuiRowDto['presentationRole']> {
  if (value === 'ordinary') return value
  if (kind === 'notification' && value === 'monetization') return value
  if (kind === 'chat' && (value === 'member' || value === 'supporter')) return value
  return 'ordinary'
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

  const parts = normalizeParts(row.parts)
  const badgeImages = normalizeBadgeImages(row.badgeImages)
  const isPaypiggy = kind === 'chat' && typeof row.isPaypiggy === 'boolean' ? row.isPaypiggy : null
  const isStreamSupporter = kind === 'chat' && typeof row.isStreamSupporter === 'boolean'
    ? row.isStreamSupporter
    : null
  const presentationRole = normalizePresentationRole(kind, row.presentationRole)
  const presentationOverride = presentationRole === 'member'
    ? normalizePresentationOverride(row.presentationOverride)
    : undefined

  return {
    ...(normalizeString(row.eventId) ? { eventId: normalizeString(row.eventId) } : {}),
    type: normalizeString(row.type),
    kind,
    platform: normalizeString(row.platform),
    username: normalizeString(row.username),
    text: normalizeString(row.text),
    ...(parts ? { parts } : {}),
    ...(badgeImages ? { badgeImages } : {}),
    ...(isPaypiggy === null ? {} : { isPaypiggy }),
    ...(isStreamSupporter === null ? {} : { isStreamSupporter }),
    presentationRole,
    ...(presentationOverride ? { presentationOverride } : {}),
    avatarUrl: normalizeString(row.avatarUrl),
    timestamp: row.timestamp === null ? null : normalizeString(row.timestamp)
  }
}

export interface GuiFeedStoreOptions {
  maxRows?: number
  inclusionPredicate?: (row: GuiRowDto) => boolean
}

function normalizeMaxRows(value: unknown): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0
}

export function createGuiFeedStore(options: GuiFeedStoreOptions = {}) {
  let rows: GuiRowDto[] = []
  const maxRows = normalizeMaxRows(options.maxRows)
  const seenEventIds = new Set<string>()

  const pushEvent = (event: unknown): GuiRowDto | null => {
    const row = normalizeRow(event)
    if (!row.type || !row.avatarUrl) {
      return null
    }
    if (options.inclusionPredicate && !options.inclusionPredicate(row)) {
      return null
    }
    if (row.eventId) {
      if (seenEventIds.has(row.eventId)) return null
      seenEventIds.add(row.eventId)
      if (seenEventIds.size > Math.max(EVENT_ID_DEDUP_LIMIT, maxRows)) {
        const oldest = seenEventIds.values().next().value
        if (typeof oldest === 'string') seenEventIds.delete(oldest)
      }
    }

    rows = [...rows, row]

    if (maxRows > 0 && rows.length > maxRows) {
      rows = rows.slice(rows.length - maxRows)
    }
    return row
  }

  const getRows = (): GuiRowDto[] => rows

  return {
    pushEvent,
    getRows
  }
}
