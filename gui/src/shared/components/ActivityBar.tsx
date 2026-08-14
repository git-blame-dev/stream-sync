import React from 'react'

import type { GuiRowDto } from '../types'
import { GuiRow } from './GuiRow'

export interface ActivityBarScheduler {
  setTimeout: (callback: () => void, delayMs: number) => unknown
  clearTimeout: (handle: unknown) => void
}

export interface ActivityBarProps {
  row: GuiRowDto | null
  exitRequested: boolean
  transitionMs?: number
  reducedMotion?: boolean
  scheduler?: ActivityBarScheduler
  onExitComplete?: (eventId: string) => void
}

const defaultScheduler: ActivityBarScheduler = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>)
}

function readsReducedMotionPreference(): boolean {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function ActivityBar({
  row,
  exitRequested,
  transitionMs = 1000,
  reducedMotion = readsReducedMotionPreference(),
  scheduler = defaultScheduler,
  onExitComplete
}: ActivityBarProps) {
  const [active, setActive] = React.useState<GuiRowDto | null>(null)
  const [phase, setPhase] = React.useState<'enter' | 'visible' | 'exit'>('visible')
  const completedEventIdRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (active || !row) return
    if (row.eventId && completedEventIdRef.current === row.eventId) return
    completedEventIdRef.current = null
    setActive(row)
    setPhase(reducedMotion ? 'visible' : 'enter')
  }, [active, reducedMotion, row])

  const finishExit = React.useCallback(() => {
    const eventId = active?.eventId
    if (!eventId || completedEventIdRef.current === eventId) return
    completedEventIdRef.current = eventId
    setActive(null)
    setPhase('visible')
    onExitComplete?.(eventId)
  }, [active, onExitComplete])

  React.useEffect(() => {
    if (!active || !exitRequested) return
    if (reducedMotion) {
      finishExit()
      return
    }
    setPhase('exit')
  }, [active, exitRequested, finishExit, reducedMotion])

  React.useEffect(() => {
    if (!active || phase === 'visible' || reducedMotion) return
    const timer = scheduler.setTimeout(() => {
      if (phase === 'enter') {
        setPhase('visible')
        return
      }
      finishExit()
    }, transitionMs)
    return () => scheduler.clearTimeout(timer)
  }, [active, finishExit, phase, reducedMotion, scheduler, transitionMs])

  const handleAnimationEnd = (event: React.AnimationEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    if (phase === 'enter' && event.animationName === 'gui-notification-row-enter') {
      setPhase('visible')
      return
    }
    if (phase === 'exit' && event.animationName === 'gui-notification-row-exit') {
      finishExit()
    }
  }

  const style = { '--notification-transition-ms': `${transitionMs}ms` } as React.CSSProperties
  return (
    <main className="gui-shell gui-shell--notifications" style={style} aria-live="polite">
      {active
        ? <GuiRow
            row={active}
            mode="overlay"
            className={phase === 'visible' ? '' : `gui-row--notification-${phase}`}
            onAnimationEnd={handleAnimationEnd}
          />
        : null}
    </main>
  )
}
