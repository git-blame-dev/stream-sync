export type GuiRowKind = 'chat' | 'command' | 'greeting' | 'farewell' | 'notification'

export type GuiMessagePart =
  | { type: 'text'; text: string }
  | { type: 'emote'; platform: string; emoteId: string; imageUrl: string }

export interface GuiBadgeImage {
  imageUrl: string
  source: string
  label: string
}

export interface GuiRowDto {
  type: string
  kind: GuiRowKind
  platform: string
  username: string
  text: string
  parts?: GuiMessagePart[]
  badgeImages?: GuiBadgeImage[]
  isPaypiggy?: boolean
  avatarUrl: string
  timestamp: string | null
}
