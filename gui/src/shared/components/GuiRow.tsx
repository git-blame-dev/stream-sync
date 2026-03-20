import React from 'react'

import type { GuiRowDto } from '../types'
import { getPlatformIconUrl } from '../platform-icon-map'

const RAYQUAZA_IMAGE_URL = 'https://img.pokemondb.net/sprites/black-white/anim/normal/rayquaza.gif'

function normalizePlatform(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

interface GuiRowProps {
  row: GuiRowDto
  mode: 'dock' | 'overlay'
  uiCompareMode?: boolean
  rowRef?: (element: HTMLDivElement | null) => void
  className?: string
  style?: React.CSSProperties
  onAnimationEnd?: React.AnimationEventHandler<HTMLDivElement>
}

export function GuiRow({ row, mode, uiCompareMode = false, rowRef, className, style, onAnimationEnd }: GuiRowProps) {
  const normalizedPlatform = normalizePlatform(row.platform)
  const platformIconUrl = getPlatformIconUrl(normalizedPlatform)
  const hasParts = Array.isArray(row.parts) && row.parts.length > 0
  const badgeImages = Array.isArray(row.badgeImages) ? row.badgeImages : []
  const isPaypiggyChatRow = row.kind === 'chat' && row.isPaypiggy === true
  const isMemberChatRow = isPaypiggyChatRow
  const shouldRenderUiComparison = mode === 'dock' && uiCompareMode
  const textClass = [
    'gui-row__text',
    isMemberChatRow ? 'gui-row__text--member-chat' : '',
    row.kind === 'notification' ? 'gui-row__text--notification' : '',
    mode === 'overlay' ? 'gui-row__text--overlay-clamp' : ''
  ]
    .filter(Boolean)
    .join(' ')

  const createRowClass = (additionalClasses: string[]) => {
    return [
      'gui-row',
      `gui-row--${row.kind}`,
      isPaypiggyChatRow ? 'gui-row--paypiggy' : '',
      isMemberChatRow ? 'gui-row--member-chat' : '',
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
        <img className="gui-row__avatar gui-row__avatar--circle" src={row.avatarUrl} alt="" />
        <div className={["gui-row__content", isMemberChatRow ? 'gui-row__content--member-chat' : ''].filter(Boolean).join(' ')}>
          {isMemberChatRow ? (
            <span className="gui-row__member-image-clip">
              <img
                className="gui-row__member-image"
                src={RAYQUAZA_IMAGE_URL}
                alt=""
                loading="lazy"
                decoding="async"
              />
            </span>
          ) : null}
          <div className={["gui-row__header", isMemberChatRow ? 'gui-row__header--member-chat' : ''].filter(Boolean).join(' ')}>
            {platformIconUrl ? <img className="gui-row__platform-icon" src={platformIconUrl} alt="" /> : null}
            <span className={["gui-row__username", isMemberChatRow ? 'gui-row__username--member-chat' : ''].filter(Boolean).join(' ')}>{row.username}</span>
            {badgeImages.length > 0 ? (
              <span className="gui-row__badges" aria-hidden="true">
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
            {isPaypiggyChatRow ? <span className="gui-row__member-tag">MEMBER</span> : null}
          </div>
          <span className={textClass}>
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
      </>
    )
  }

  if (shouldRenderUiComparison) {
    const compareShellClass = ['gui-row-compare-shell', className || '']
      .filter(Boolean)
      .join(' ')
    const baselineCardClass = createRowClass(['gui-row--compare-card', 'gui-row--compare-before'])
    const experimentCardClass = createRowClass(['gui-row--compare-card', 'gui-row--compare-after'])

    return (
      <div
        className={compareShellClass}
        style={style}
        onAnimationEnd={onAnimationEnd}
        data-row-type={row.type}
        ref={rowRef}
      >
        <div
          className={baselineCardClass}
          data-row-type={row.type}
          data-compare-label="baseline"
        >
          {renderRowContent()}
        </div>
        <div
          className={experimentCardClass}
          data-row-type={row.type}
          data-compare-label="experiment"
        >
          {renderRowContent()}
        </div>
      </div>
    )
  }

  return (
    <div className={rowClass} style={style} onAnimationEnd={onAnimationEnd} data-row-type={row.type} ref={rowRef}>
      {renderRowContent()}
    </div>
  )
}
