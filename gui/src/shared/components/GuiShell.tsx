import React, { useLayoutEffect, useMemo, useRef } from 'react'
import { AnimatePresence, motion, MotionConfig } from 'motion/react'

import { DEFAULT_GUI_APPEARANCE, type GuiAppearance } from '../appearance'
import type { GuiGiftAnimationCompletionReason, GuiGiftAnimationEffectEnvelope, GuiRowDto } from '../types'
import { GiftAnimationLayer } from './GiftAnimationLayer'
import { GuiRow } from './GuiRow'

const DOCK_PINNED_BOTTOM_THRESHOLD_PX = 8
const OVERLAY_ROW_TRANSITION = { duration: 0.25, ease: 'easeOut' } as const

function isDockNearBottom(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number
): boolean {
  const distanceFromBottom = scrollHeight - (scrollTop + clientHeight)
  return distanceFromBottom <= DOCK_PINNED_BOTTOM_THRESHOLD_PX
}

interface GuiShellProps {
  rows: GuiRowDto[]
  mode: 'dock' | 'overlay' | 'tiktok-animations'
  overlayMaxLinesPerMessage: number
  activeEffect?: GuiGiftAnimationEffectEnvelope | null
  onEffectComplete?: (playbackId: string, reason: GuiGiftAnimationCompletionReason) => void
  appearance?: GuiAppearance
}

interface GuiShellRowEntry {
  row: GuiRowDto
  key: string
}

export function resolveGuiRowRenderKey(
  row: GuiRowDto,
  getFallbackKey: (row: GuiRowDto) => string
): string {
  const eventId = typeof row.eventId === 'string' ? row.eventId.trim() : ''
  return eventId ? `event:${eventId}` : getFallbackKey(row)
}

export function GuiShell({
  rows,
  mode,
  overlayMaxLinesPerMessage,
  activeEffect = null,
  onEffectComplete,
  appearance = DEFAULT_GUI_APPEARANCE
}: GuiShellProps) {
  const rowMode = mode === 'overlay' ? 'overlay' : 'dock'
  const handleEffectComplete = typeof onEffectComplete === 'function'
    ? onEffectComplete
    : (_playbackId: string, _reason: GuiGiftAnimationCompletionReason) => undefined
  const shellStyle = mode === 'overlay'
    ? ({ '--overlay-line-clamp': String(overlayMaxLinesPerMessage) } as React.CSSProperties)
    : mode === 'dock'
      ? ({ height: '100vh', overflowY: 'auto', overscrollBehavior: 'contain' } as React.CSSProperties)
      : ({
          position: 'relative',
          height: '100vh',
          overflow: 'hidden',
          padding: 0,
          maxWidth: 'none',
          background: 'transparent'
        } as React.CSSProperties)
  const shellRef = useRef<HTMLElement | null>(null)
  const isDockPinnedToBottomRef = useRef(true)
  const rowRenderKeyByRef = useRef(new WeakMap<GuiRowDto, string>())
  const rowRenderKeyCounterRef = useRef(0)

  const rowEntries = useMemo<GuiShellRowEntry[]>(() => {
    return rows.map((row) => {
      let key = rowRenderKeyByRef.current.get(row)
      if (!key) {
        rowRenderKeyCounterRef.current += 1
        key = `row:${rowRenderKeyCounterRef.current}`
        rowRenderKeyByRef.current.set(row, key)
      }

      return {
        row,
        key: resolveGuiRowRenderKey(row, () => key)
      }
    })
  }, [rows])

  useLayoutEffect(() => {
    if (mode !== 'dock') {
      isDockPinnedToBottomRef.current = true
      return
    }

    const shellElement = shellRef.current
    if (!shellElement) {
      return
    }

    const updatePinnedState = () => {
      isDockPinnedToBottomRef.current = isDockNearBottom(
        shellElement.scrollTop,
        shellElement.clientHeight,
        shellElement.scrollHeight
      )
    }

    shellElement.addEventListener('scroll', updatePinnedState)
    return () => shellElement.removeEventListener('scroll', updatePinnedState)
  }, [mode])

  useLayoutEffect(() => {
    if (mode !== 'dock' || !isDockPinnedToBottomRef.current) {
      return
    }

    const scrollDockToBottom = () => {
      if (!shellRef.current) {
        return
      }

      shellRef.current.scrollTop = shellRef.current.scrollHeight
      isDockPinnedToBottomRef.current = true
    }

    scrollDockToBottom()
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(scrollDockToBottom)
    }
  }, [mode, rowEntries])

  const renderedRows = mode === 'overlay'
    ? (
        <AnimatePresence initial={false} mode="popLayout">
          {rowEntries.map((entry) => (
            <motion.div
              key={entry.key}
              layout="position"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={OVERLAY_ROW_TRANSITION}
            >
              <GuiRow
                row={entry.row}
                mode="overlay"
                appearance={appearance}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      )
    : rowEntries.map((entry) => (
        <GuiRow
          key={entry.key}
          row={entry.row}
          mode={rowMode}
          appearance={appearance}
        />
      ))

  return (
    <MotionConfig reducedMotion="user">
      <main
        className={`gui-shell gui-shell--${mode}${appearance.profile === 'minimal' ? ' gui-shell--minimal' : ''}${appearance.profile === 'minimal' && appearance.settings.compactRows ? ' gui-shell--compact' : ''}`}
        style={shellStyle}
        ref={shellRef}
        aria-label="Livestream activity"
      >
        <GiftAnimationLayer
          effect={activeEffect}
          onComplete={handleEffectComplete}
        />
        {mode === 'tiktok-animations' ? null : renderedRows}
      </main>
    </MotionConfig>
  )
}
