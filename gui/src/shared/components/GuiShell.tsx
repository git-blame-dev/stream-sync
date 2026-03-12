import React, { useLayoutEffect, useMemo, useRef } from 'react'

import { GuiRow } from './GuiRow'
import type { GuiRowDto } from '../types'
import { applyOverlayRowShiftMotion } from '../overlay-row-motion'

const ROW_SLIDE_ANIMATION_MS = 1000
const DOCK_PINNED_BOTTOM_THRESHOLD_PX = 8

function isDockNearBottom(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number
): boolean {
  const distanceFromBottom = scrollHeight - (scrollTop + clientHeight)
  return distanceFromBottom <= DOCK_PINNED_BOTTOM_THRESHOLD_PX
}

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
    : mode === 'dock'
      ? ({ height: '100vh', overflowY: 'auto', overscrollBehavior: 'contain' } as React.CSSProperties)
      : undefined
  const shellRef = useRef<HTMLElement | null>(null)
  const isDockPinnedToBottomRef = useRef(true)
  const rowElementsByKeyRef = useRef(new Map<string, HTMLDivElement>())
  const previousTopByKeyRef = useRef(new Map<string, number>())
  const rowEntries = useMemo(() => {
    const rowOccurrences = new Map<string, number>()
    return rows.map((row) => {
      const signature = buildRowKeySignature(row)
      const nextOccurrence = (rowOccurrences.get(signature) || 0) + 1
      rowOccurrences.set(signature, nextOccurrence)

      return {
        row,
        key: buildRowRenderKey(row, nextOccurrence)
      }
    })
  }, [rows])

  useLayoutEffect(() => {
    if (mode !== 'dock') {
      isDockPinnedToBottomRef.current = true
      return
    }

    if (!shellRef.current) {
      return
    }

    const shellElement = shellRef.current
    const updatePinnedState = () => {
      isDockPinnedToBottomRef.current = isDockNearBottom(
        shellElement.scrollTop,
        shellElement.clientHeight,
        shellElement.scrollHeight
      )
    }

    shellElement.addEventListener('scroll', updatePinnedState)

    return () => {
      shellElement.removeEventListener('scroll', updatePinnedState)
    }
  }, [mode])

  useLayoutEffect(() => {
    previousTopByKeyRef.current = applyOverlayRowShiftMotion({
      rowKeys: rowEntries.map((entry) => entry.key),
      rowElementsByKey: rowElementsByKeyRef.current,
      previousTopByKey: previousTopByKeyRef.current,
      durationMs: ROW_SLIDE_ANIMATION_MS
    })

    if (mode !== 'dock') {
      return
    }

    if (!shellRef.current) {
      return
    }

    const shouldPinDockToBottom = isDockPinnedToBottomRef.current

    const scrollDockToBottom = () => {
      if (!shellRef.current) {
        return
      }

      shellRef.current.scrollTop = shellRef.current.scrollHeight
      isDockPinnedToBottomRef.current = true
    }

    if (!shouldPinDockToBottom) {
      return
    }

    scrollDockToBottom()

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(scrollDockToBottom)
    }
  }, [mode, rowEntries])

  return (
    <main className={`gui-shell gui-shell--${mode}`} style={shellStyle} ref={shellRef}>
      {rowEntries.map((entry) => {
        return (
          <GuiRow
            key={entry.key}
            row={entry.row}
            mode={mode}
            rowRef={(element) => {
              if (element) {
                rowElementsByKeyRef.current.set(entry.key, element)
                return
              }
              rowElementsByKeyRef.current.delete(entry.key)
            }}
          />
        )
      })}
    </main>
  )
}
