export type GuiRowKind = 'chat' | 'command' | 'greeting' | 'farewell' | 'notification'

export interface GuiRowDto {
  type: string
  kind: GuiRowKind
  platform: string
  username: string
  text: string
  avatarUrl: string
  timestamp: string | null
}
