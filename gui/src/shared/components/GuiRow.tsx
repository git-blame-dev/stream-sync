import React from 'react'

import type { GuiRowDto } from '../types'
import { getPlatformIconUrl } from '../platform-icon-map'
import { DEFAULT_GUI_APPEARANCE, selectDisplayableBadges, type GuiAppearance } from '../appearance'
import { MemberParticleCanvas } from './MemberParticleCanvas'

export const GUI_AVATAR_FALLBACK_URL = '/gui/assets/preview/avatar-fallback.svg'
const RAYQUAZA_IMAGE_URL = 'https://img.pokemondb.net/sprites/black-white/anim/normal/rayquaza.gif'
const ARCEUS_IMAGE_URL = 'https://img.pokemondb.net/sprites/black-white/anim/normal/arceus.gif'
const MONETIZATION_NOTIFICATION_TYPES = new Set([
  'platform:gift',
  'platform:paypiggy',
  'platform:giftpaypiggy',
  'platform:envelope'
])

interface GuiRowProps {
  row: GuiRowDto
  mode: 'dock' | 'overlay'
  className?: string
  onAnimationEnd?: React.AnimationEventHandler<HTMLDivElement>
  appearance?: GuiAppearance
}

export function GuiRow({ row, mode, className, onAnimationEnd, appearance = DEFAULT_GUI_APPEARANCE }: GuiRowProps) {
  const [failedAvatarUrl, setFailedAvatarUrl] = React.useState<string | null>(null)
  const handleAvatarError = () => {
    setFailedAvatarUrl((currentUrl) => currentUrl === row.avatarUrl ? currentUrl : row.avatarUrl)
  }
  const avatarUrl = failedAvatarUrl === row.avatarUrl ? GUI_AVATAR_FALLBACK_URL : row.avatarUrl
  const isMinimal = appearance.profile === 'minimal'
  const isCompact = isMinimal && appearance.settings.compactRows
  const appearanceSettings = appearance.settings
  const platformIconUrl = getPlatformIconUrl(row.platform)
  const hasParts = Array.isArray(row.parts) && row.parts.length > 0
  const allBadgeImages = Array.isArray(row.badgeImages) ? row.badgeImages : []
  const badgeImages = isMinimal
    ? selectDisplayableBadges(allBadgeImages, appearanceSettings.maxDisplayableBadges)
    : allBadgeImages
  const isMemberChatRow = row.kind === 'chat' && row.isPaypiggy === true
  const hasRedMemberTheme = isMemberChatRow && row.memberTheme === 'red'
  const hasStreamSupporterEffects = row.kind === 'chat'
    && row.isStreamSupporter === true
    && appearanceSettings.streamSupporterChatEffectsEnabled !== false
    && !hasRedMemberTheme
  const hasMemberEffects = isMemberChatRow && !hasStreamSupporterEffects
  const hasChatParticles = hasRedMemberTheme || hasStreamSupporterEffects
  const isMonetizationNotification = row.kind === 'notification' && MONETIZATION_NOTIFICATION_TYPES.has(row.type)
  const usesMonetizationTreatment = isMonetizationNotification || hasStreamSupporterEffects
  const badgeSummary = badgeImages.map((badge) => badge.label).filter(Boolean).join(', ')
  const textClass = [
    'gui-row__text',
    hasMemberEffects ? 'gui-row__text--member-chat' : '',
    row.kind === 'notification' ? 'gui-row__text--notification' : '',
    mode === 'overlay' ? 'gui-row__text--overlay-clamp' : ''
  ]
    .filter(Boolean)
    .join(' ')

  const createRowClass = (additionalClasses: string[]) => {
    return [
      'gui-row',
      `gui-row--${row.kind}`,
      isMemberChatRow ? 'gui-row--paypiggy' : '',
      hasMemberEffects ? 'gui-row--member-chat' : '',
      hasRedMemberTheme ? 'gui-row--member-theme-red' : '',
      usesMonetizationTreatment ? 'gui-row--monetization' : '',
      isMinimal ? 'gui-row--minimal' : '',
      isMinimal && !appearanceSettings.rowBackgroundsEnabled ? 'gui-row--background-off' : '',
      isCompact ? 'gui-row--compact' : '',
      mode === 'overlay' ? 'gui-row--overlay-enter' : '',
      ...additionalClasses
    ]
      .filter(Boolean)
      .join(' ')
  }

  const rowClass = createRowClass([className || ''])

  const renderRowContent = () => {
    return (
      <>
        <span className="gui-row__avatar-wrapper" aria-hidden="true">
          <img className="gui-row__avatar gui-row__avatar--circle" src={avatarUrl} alt="" onError={handleAvatarError} />
          {platformIconUrl ? <img className="gui-row__platform-icon" src={platformIconUrl} alt="" /> : null}
        </span>
        <div className={[
          "gui-row__content",
          hasMemberEffects ? 'gui-row__content--member-chat' : '',
          usesMonetizationTreatment ? 'gui-row__content--monetization' : ''
        ].filter(Boolean).join(' ')}>
          {usesMonetizationTreatment ? (
            <span className="gui-row__monetization-image-clip" aria-hidden="true">
              <img
                className="gui-row__monetization-image"
                src={ARCEUS_IMAGE_URL}
                alt=""
                decoding="async"
              />
            </span>
          ) : null}
          {hasMemberEffects ? (
            <span className="gui-row__member-image-clip" aria-hidden="true">
              <img
                className="gui-row__member-image"
                src={row.memberSpriteUrl || RAYQUAZA_IMAGE_URL}
                alt=""
                loading="lazy"
                decoding="async"
              />
            </span>
          ) : null}
          <div className="gui-row__copy">
            <div className={["gui-row__header", hasMemberEffects ? 'gui-row__header--member-chat' : ''].filter(Boolean).join(' ')}>
              {isMemberChatRow ? <span className="gui-row__member-tag">MEMBER</span> : null}
              <span className={["gui-row__username", hasMemberEffects ? 'gui-row__username--member-chat' : ''].filter(Boolean).join(' ')}>{row.username}</span>
              {badgeImages.length > 0 ? (
                <span className="gui-row__badges" aria-label={badgeSummary || undefined}>
                  {badgeImages.map((badge, index) => (
                    <img
                      key={`${badge.imageUrl}-${index}`}
                      className="gui-row__badge"
                      src={badge.imageUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  ))}
                </span>
              ) : null}
              {isCompact ? <span className="gui-row__minimal-separator" aria-hidden="true">:</span> : null}
            </div>
            <span className={[...textClass.split(' '), isCompact ? 'gui-row__text--minimal' : ''].filter(Boolean).join(' ')}>
              {hasParts
                ? row.parts?.map((part, index) => {
                    if (part.type === 'emote') {
                      return (
                        <img
                          key={`emote-${part.emoteId}-${index}`}
                          className="gui-row__emote"
                          src={part.imageUrl}
                          alt={part.emoteId}
                          loading="lazy"
                          decoding="async"
                        />
                      )
                    }

                    return <React.Fragment key={`text-${index}`}>{part.text}</React.Fragment>
                  })
                : row.text}
            </span>
          </div>
        </div>
      </>
    )
  }

  return (
    <div className={rowClass} onAnimationEnd={onAnimationEnd} data-row-type={row.type} role="article">
      {hasChatParticles ? (
        <MemberParticleCanvas
          seed={row.eventId || `${row.platform.trim().toLowerCase()}:${row.username}:${row.timestamp || ''}:${row.text}`}
        />
      ) : null}
      {renderRowContent()}
    </div>
  )
}
