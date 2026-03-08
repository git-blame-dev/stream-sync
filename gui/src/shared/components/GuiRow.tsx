import React from 'react'

import type { GuiRowDto } from '../types'

interface GuiRowProps {
  row: GuiRowDto
}

export function GuiRow({ row }: GuiRowProps) {
  const textClass = row.kind === 'notification'
    ? 'gui-row__text gui-row__text--notification'
    : 'gui-row__text'

  return (
    <div className={`gui-row gui-row--${row.kind}`} data-row-type={row.type}>
      <img className="gui-row__avatar gui-row__avatar--circle" src={row.avatarUrl} alt="" />
      <div className="gui-row__content">
        <span className="gui-row__username">{row.username}</span>
        <span className={textClass}>{row.text}</span>
      </div>
    </div>
  )
}
