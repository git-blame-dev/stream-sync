import React, { useEffect, useState } from 'react'

import { GuiShell } from '../shared/components/GuiShell'
import {
  advanceDemoFeed,
  createInitialDemoFeedState,
  type DemoFeedState
} from './demo-feed'

export const DEMO_FEED_INTERVAL_MS = 1600

interface DemoScheduler {
  setInterval: (handler: () => void, intervalMs: number) => unknown
  clearInterval: (intervalId: unknown) => void
}

interface ChatDemoProps {
  scheduler?: DemoScheduler
}

const DEFAULT_DEMO_SCHEDULER: DemoScheduler = {
  setInterval: (handler, intervalMs) => globalThis.setInterval(handler, intervalMs),
  clearInterval: (intervalId) => globalThis.clearInterval(intervalId as ReturnType<typeof globalThis.setInterval>)
}

export function ChatDemo({ scheduler = DEFAULT_DEMO_SCHEDULER }: ChatDemoProps): React.JSX.Element {
  const [feedState, setFeedState] = useState<DemoFeedState>(() => advanceDemoFeed(createInitialDemoFeedState()))

  useEffect(() => {
    const intervalId = scheduler.setInterval(() => {
      setFeedState((currentState) => advanceDemoFeed(currentState))
    }, DEMO_FEED_INTERVAL_MS)

    return () => {
      scheduler.clearInterval(intervalId)
    }
  }, [scheduler])

  return (
    <GuiShell
      rows={feedState.rows}
      mode="overlay"
      overlayMaxLinesPerMessage={3}
    />
  )
}
