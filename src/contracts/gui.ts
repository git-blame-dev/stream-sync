import type { RowPresentationOverride } from '../core/row-presentation'

export type { RowPresentationOverride, RowTheme, RowVisualEffectId } from '../core/row-presentation'

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
  eventId?: string
  type: string
  kind: GuiRowKind
  platform: string
  username: string
  text: string
  parts?: GuiMessagePart[]
  badgeImages?: GuiBadgeImage[]
  isPaypiggy?: boolean
  isStreamSupporter?: boolean
  presentationRole?: 'ordinary' | 'member' | 'supporter' | 'monetization'
  presentationOverride?: RowPresentationOverride
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

export type GuiGiftAnimationCompletionReason = 'ended' | 'media-error' | 'play-rejected' | 'canvas-unavailable' | 'timeout'
export type GuiNotificationLifecyclePhase = 'started' | 'exit-started'
export interface GuiNotificationLifecycleEnvelope {
  __guiEvent: 'notification-lifecycle'
  eventId: string
  phase: GuiNotificationLifecyclePhase
}
