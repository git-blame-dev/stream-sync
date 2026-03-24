import React, { useEffect, useMemo, useState } from 'react'

import { createEventFeed } from './create-event-feed'
import { createGuiFeedStore } from './feed-store'
import { GuiShell } from './components/GuiShell'
import type { GuiGiftAnimationEffectEnvelope, GuiRowDto } from './types'

interface AppProps {
  mode: 'dock' | 'overlay'
  eventsPath?: string
  overlayMaxMessages?: number
  overlayMaxLinesPerMessage?: number
  uiCompareMode?: boolean
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

function isGiftAnimationEffectEnvelope(payload: unknown): payload is GuiGiftAnimationEffectEnvelope {
  const effect = payload as GuiGiftAnimationEffectEnvelope
  const config = effect?.config as GuiGiftAnimationEffectEnvelope['config']
  const hasValidFrame = (frame: unknown): frame is [number, number, number, number] => {
    return Array.isArray(frame)
      && frame.length === 4
      && frame.every((value) => Number.isFinite(Number(value)) && Number(value) >= 0)
  }

  return !!effect &&
    effect.__guiEvent === 'effect' &&
    effect.effectType === 'tiktok-gift-animation' &&
    typeof effect.playbackId === 'string' &&
    effect.playbackId.length > 0 &&
    typeof effect.assetUrl === 'string' &&
    effect.assetUrl.length > 0 &&
    typeof effect.durationMs === 'number' &&
    Number.isFinite(effect.durationMs) &&
    effect.durationMs > 0 &&
    !!config &&
    typeof config.profileName === 'string' &&
    config.profileName.length > 0 &&
    Number.isFinite(Number(config.sourceWidth)) &&
    Number(config.sourceWidth) > 0 &&
    Number.isFinite(Number(config.sourceHeight)) &&
    Number(config.sourceHeight) > 0 &&
    Number.isFinite(Number(config.renderWidth)) &&
    Number(config.renderWidth) > 0 &&
    Number.isFinite(Number(config.renderHeight)) &&
    Number(config.renderHeight) > 0 &&
    hasValidFrame(config.rgbFrame) &&
    (config.aFrame === null || hasValidFrame(config.aFrame))
}

export function App({
  mode,
  eventsPath = '/gui/events',
  overlayMaxMessages,
  overlayMaxLinesPerMessage,
  uiCompareMode = false,
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
  const [effectQueue, setEffectQueue] = useState<GuiGiftAnimationEffectEnvelope[]>([])
  const activeEffect = effectQueue.length > 0 ? effectQueue[0] : null

  useEffect(() => {
    const dispose = createEventFeedImpl({
      url: eventsPath,
      onEvent: (payload) => {
        if (isGiftAnimationEffectEnvelope(payload)) {
          setEffectQueue((currentQueue) => [...currentQueue, payload])
          return
        }

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
      uiCompareMode={uiCompareMode}
      activeEffect={activeEffect}
      onEffectComplete={(playbackId: string) => {
        setEffectQueue((currentQueue) => {
          if (currentQueue.length === 0) {
            return currentQueue
          }

          if (currentQueue[0].playbackId !== playbackId) {
            return currentQueue
          }

          return currentQueue.slice(1)
        })
      }}
    />
  )
}
