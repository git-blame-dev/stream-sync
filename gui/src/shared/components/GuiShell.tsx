import React from 'react'

import { GuiRow } from './GuiRow'
import type { GuiRowDto } from '../types'

interface GuiShellProps {
  rows: GuiRowDto[]
  mode: 'dock' | 'overlay'
}

export function GuiShell({ rows, mode }: GuiShellProps) {
  return (
    <main className={`gui-shell gui-shell--${mode}`}>
      {rows.map((row, index) => (
        <GuiRow key={`${row.timestamp || 'no-ts'}-${index}`} row={row} />
      ))}
    </main>
  )
}
