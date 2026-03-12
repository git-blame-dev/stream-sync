import React from 'react'

import type { GuiRowDto } from '../types'
import { getPlatformIconUrl } from '../platform-icon-map'

interface GuiRowProps {
  row: GuiRowDto
  mode: 'dock' | 'overlay'
  rowRef?: (element: HTMLDivElement | null) => void
}

export function GuiRow({ row, mode, rowRef }: GuiRowProps) {
  const platformIconUrl = getPlatformIconUrl(row.platform)
  const hasParts = Array.isArray(row.parts) && row.parts.length > 0
  const textClass = [
    'gui-row__text',
    row.kind === 'notification' ? 'gui-row__text--notification' : '',
    mode === 'overlay' ? 'gui-row__text--overlay-clamp' : ''
  ]
    .filter(Boolean)
    .join(' ')

  const rowClass = [
    'gui-row',
    `gui-row--${row.kind}`,
    mode === 'overlay' ? 'gui-row--overlay-enter' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={rowClass} data-row-type={row.type} ref={rowRef}>
      <img className="gui-row__avatar gui-row__avatar--circle" src={row.avatarUrl} alt="" />
      <div className="gui-row__content">
        <div className="gui-row__header">
          {platformIconUrl ? <img className="gui-row__platform-icon" src={platformIconUrl} alt="" /> : null}
          <span className="gui-row__username">{row.username}</span>
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
    </div>
  )
}
