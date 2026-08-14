import type { GuiFeedMode, GuiRowDto } from './types'

export function isGuiFeedMode(value: unknown): value is GuiFeedMode {
  return value === 'all' || value === 'chat' || value === 'non-chat'
}

export function matchesGuiFeedMode(row: GuiRowDto, mode: GuiFeedMode): boolean {
  return mode === 'all' || (mode === 'chat' ? row.kind === 'chat' : row.kind !== 'chat')
}
