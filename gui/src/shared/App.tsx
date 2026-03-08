import React, { useEffect, useMemo, useState } from 'react'

import { createEventFeed } from './create-event-feed'
import { createGuiFeedStore } from './feed-store'
import { GuiShell } from './components/GuiShell'
import type { GuiRowDto } from './types'

interface AppProps {
  mode: 'dock' | 'overlay'
  eventsPath?: string
  overlayMaxMessages?: number
  overlayMaxLinesPerMessage?: number
  createEventFeedImpl?: typeof createEventFeed
}

function readPositiveInteger(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function resolveOverlayLimits(
  mode: 'dock' | 'overlay',
  overlayMaxMessages: unknown,
  overlayMaxLinesPerMessage: unknown
): { maxRows: number, maxLinesPerMessage: number } {
  if (mode === 'dock') {
    return {
      maxRows: 0,
      maxLinesPerMessage: 3
    }
  }

  const maxRows = readPositiveInteger(overlayMaxMessages)
  const maxLinesPerMessage = readPositiveInteger(overlayMaxLinesPerMessage)

  if (maxRows === null || maxLinesPerMessage === null) {
    throw new Error('Overlay mode requires positive integer overlay limits')
  }

  return {
    maxRows,
    maxLinesPerMessage
  }
}

export function App({
  mode,
  eventsPath = '/gui/events',
  overlayMaxMessages,
  overlayMaxLinesPerMessage,
  createEventFeedImpl = createEventFeed
}: AppProps) {
  const overlayLimits = useMemo(
    () => resolveOverlayLimits(mode, overlayMaxMessages, overlayMaxLinesPerMessage),
    [mode, overlayMaxMessages, overlayMaxLinesPerMessage]
  )

  const store = useMemo(
    () => createGuiFeedStore({ maxRows: overlayLimits.maxRows }),
    [overlayLimits.maxRows]
  )
  const [rows, setRows] = useState<GuiRowDto[]>([])

  useEffect(() => {
    const dispose = createEventFeedImpl({
      url: eventsPath,
      onEvent: (payload) => {
        store.pushEvent(payload)
        setRows(store.getRows())
      }
    })

    return () => {
      dispose()
    }
  }, [createEventFeedImpl, eventsPath, store])

  return (
    <GuiShell
      rows={rows}
      mode={mode}
      overlayMaxLinesPerMessage={overlayLimits.maxLinesPerMessage}
    />
  )
}
