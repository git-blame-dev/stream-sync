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

export interface GuiGiftAnimationConfig {
  profileName: string
  sourceWidth: number
  sourceHeight: number
  renderWidth: number
  renderHeight: number
  rgbFrame: [number, number, number, number]
  aFrame: [number, number, number, number] | null
}

export interface GuiGiftAnimationEffectEnvelope {
  __guiEvent: 'effect'
  effectType: 'tiktok-gift-animation'
  playbackId: string
  durationMs: number
  assetUrl: string
  config: GuiGiftAnimationConfig
}
