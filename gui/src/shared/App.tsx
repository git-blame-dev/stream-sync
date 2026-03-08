import React, { useEffect, useMemo, useState } from 'react'

import { createEventFeed } from './create-event-feed'
import { createGuiFeedStore } from './feed-store'
import { GuiShell } from './components/GuiShell'
import type { GuiRowDto } from './types'

interface AppProps {
  mode: 'dock' | 'overlay'
  eventsPath?: string
  createEventFeedImpl?: typeof createEventFeed
}

export function App({
  mode,
  eventsPath = '/gui/events',
  createEventFeedImpl = createEventFeed
}: AppProps) {
  const store = useMemo(() => createGuiFeedStore(), [])
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

  return <GuiShell rows={rows} mode={mode} />
}
