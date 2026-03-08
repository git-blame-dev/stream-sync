import React from 'react'

import type { GuiRowDto } from '../types'

interface GuiRowProps {
  row: GuiRowDto
  mode: 'dock' | 'overlay'
}

export function GuiRow({ row, mode }: GuiRowProps) {
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
    <div className={rowClass} data-row-type={row.type}>
      <img className="gui-row__avatar gui-row__avatar--circle" src={row.avatarUrl} alt="" />
      <div className="gui-row__content">
        <span className="gui-row__username">{row.username}</span>
        <span className={textClass}>{row.text}</span>
      </div>
    </div>
  )
}
