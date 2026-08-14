import { describe, expect, it } from 'bun:test'

import { matchesGuiFeedMode } from '../../../gui/src/shared/feed-mode'
import type { GuiRowDto } from '../../../gui/src/shared/types'

const row = (kind: GuiRowDto['kind']): GuiRowDto => ({
  type: kind,
  kind,
  platform: 'test',
  username: 'viewer',
  text: 'payload',
  avatarUrl: 'https://example.test/avatar.png',
  timestamp: null
})

describe('GUI feed mode behavior', () => {
  it('partitions every normalized row kind into all, chat, and non-chat', () => {
    for (const kind of ['chat', 'command', 'greeting', 'farewell', 'notification'] as const) {
      expect(matchesGuiFeedMode(row(kind), 'all')).toBe(true)
      expect(matchesGuiFeedMode(row(kind), 'chat')).toBe(kind === 'chat')
      expect(matchesGuiFeedMode(row(kind), 'non-chat')).toBe(kind !== 'chat')
    }
  })
})
