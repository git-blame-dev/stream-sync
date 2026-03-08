import React from 'react'

import { GuiRow } from './GuiRow'
import type { GuiRowDto } from '../types'

function buildRowKeySignature(row: GuiRowDto): string {
  return [row.type, row.kind, row.platform, row.username, row.avatarUrl, row.timestamp || '', row.text].join(':')
}

function buildRowRenderKey(row: GuiRowDto, occurrence: number): string {
  return `${buildRowKeySignature(row)}:${occurrence}`
}

interface GuiShellProps {
  rows: GuiRowDto[]
  mode: 'dock' | 'overlay'
  overlayMaxLinesPerMessage: number
}

export function GuiShell({ rows, mode, overlayMaxLinesPerMessage }: GuiShellProps) {
  const shellStyle = mode === 'overlay'
    ? ({ '--overlay-line-clamp': String(overlayMaxLinesPerMessage) } as React.CSSProperties)
    : undefined
  const rowOccurrences = new Map<string, number>()

  return (
    <main className={`gui-shell gui-shell--${mode}`} style={shellStyle}>
      {rows.map((row) => {
        const signature = buildRowKeySignature(row)
        const nextOccurrence = (rowOccurrences.get(signature) || 0) + 1
        rowOccurrences.set(signature, nextOccurrence)

        return <GuiRow key={buildRowRenderKey(row, nextOccurrence)} row={row} mode={mode} />
      })}
    </main>
  )
}
