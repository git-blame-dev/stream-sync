import React, { useEffect, useMemo, useRef, useState } from 'react'

import { createEventFeed } from './create-event-feed'
import { createGuiFeedStore } from './feed-store'
import { GuiShell } from './components/GuiShell'
import { ActivityBar } from './components/ActivityBar'
import { isLocalGiftAnimationAssetUrl } from './components/GiftAnimationLayer'
import { matchesGuiFeedMode } from './feed-mode'
import { DEFAULT_GUI_APPEARANCE, parseGuiAppearanceEvent, type GuiAppearance } from './appearance'
import type {
  GuiAppMode,
  GuiFeedMode,
  GuiGiftAnimationCompletionReason,
  GuiGiftAnimationEffectEnvelope,
  GuiNotificationLifecycleEnvelope,
  GuiRowDto
} from './types'

interface AppProps {
  mode: GuiAppMode
  feedMode?: GuiFeedMode | undefined
  initialAppearance?: GuiAppearance
  eventsPath?: string
  overlayMaxMessages?: number
  dockMaxMessages?: number
  overlayMaxLinesPerMessage?: number
  notificationTransitionMs?: number
  createEventFeedImpl?: typeof createEventFeed
  sendGiftAnimationAckImpl?: typeof sendGiftAnimationAck
}

type GuiFeedStore = ReturnType<typeof createGuiFeedStore>
type GuiConnectionStatus = 'connecting' | 'connected' | 'reconnecting'

interface RowState {
  store: GuiFeedStore
  rows: GuiRowDto[]
}

interface EffectState {
  store: GuiFeedStore
  queue: GuiGiftAnimationEffectEnvelope[]
}

interface NotificationState {
  store: GuiFeedStore
  queue: GuiRowDto[]
  exitingEventIds: Set<string>
}

export async function sendGiftAnimationAck(
  playbackId: string,
  reason: GuiGiftAnimationCompletionReason,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const response = await fetchImpl('/api/v1/gui/gift-animations/ack', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-Stream-Sync-Request': '1'
    },
    body: JSON.stringify({ playbackId, reason })
  })
  if (!response.ok) {
    throw new Error(`Gift animation acknowledgement failed with status ${response.status}`)
  }
}

function readPositiveInteger(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function resolveOverlayLimits(
  mode: GuiAppMode,
  overlayMaxMessages: unknown,
  overlayMaxLinesPerMessage: unknown
): { maxRows: number, maxLinesPerMessage: number } {
  if (mode !== 'overlay') {
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
    isLocalGiftAnimationAssetUrl(effect.assetUrl) &&
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

function isGuiEffectEnvelope(payload: unknown): boolean {
  return !!payload &&
    typeof payload === 'object' &&
    (payload as { __guiEvent?: string }).__guiEvent === 'effect'
}

function isNotificationLifecycleEnvelope(payload: unknown): payload is GuiNotificationLifecycleEnvelope {
  const lifecycle = payload as GuiNotificationLifecycleEnvelope
  return !!lifecycle &&
    lifecycle.__guiEvent === 'notification-lifecycle' &&
    typeof lifecycle.eventId === 'string' &&
    lifecycle.eventId.length > 0 &&
    (lifecycle.phase === 'started' || lifecycle.phase === 'exit-started')
}

function parseAppearanceEvent(payload: unknown): GuiAppearance | null {
  return parseGuiAppearanceEvent(payload)
}

export function App({
  mode,
  eventsPath = '/gui/events',
  overlayMaxMessages,
  overlayMaxLinesPerMessage,
  dockMaxMessages = 200,
  notificationTransitionMs = 1000,
  createEventFeedImpl = createEventFeed,
  sendGiftAnimationAckImpl = sendGiftAnimationAck,
  feedMode = 'all',
  initialAppearance = DEFAULT_GUI_APPEARANCE
}: AppProps) {
  const [appearance, setAppearance] = useState(initialAppearance)
  const effectiveFeedMode = mode === 'notifications' ? 'non-chat' : feedMode
  const overlayLimits = useMemo(
    () => resolveOverlayLimits(mode, overlayMaxMessages, overlayMaxLinesPerMessage),
    [mode, overlayMaxMessages, overlayMaxLinesPerMessage]
  )
  const maxRows = mode === 'dock' ? dockMaxMessages : mode === 'overlay' ? overlayLimits.maxRows : 0

  const store = useMemo(
    () => createGuiFeedStore({
      maxRows,
      retainRows: mode !== 'notifications',
      inclusionPredicate: (row) =>
        matchesGuiFeedMode(row, effectiveFeedMode) &&
        (mode !== 'notifications' || !!row.eventId)
    }),
    [createEventFeedImpl, effectiveFeedMode, eventsPath, mode, maxRows]
  )
  const lifetimeRef = useRef(0)
  const [lifetime, setLifetime] = useState(0)
  const [connectionStatus, setConnectionStatus] = useState<GuiConnectionStatus>('connecting')
  const [rowState, setRowState] = useState<RowState>(() => ({ store, rows: [] }))
  const [effectState, setEffectState] = useState<EffectState>(() => ({ store, queue: [] }))
  const [notificationState, setNotificationState] = useState<NotificationState>(() => ({
    store,
    queue: [],
    exitingEventIds: new Set()
  }))
  const rows = rowState.store === store ? rowState.rows : []
  const effectQueue = effectState.store === store ? effectState.queue : []
  const activeEffect = effectQueue[0] ?? null
  const notificationQueue = notificationState.store === store ? notificationState.queue : []
  const activeNotification = notificationQueue[0] ?? null
  const notificationExitRequested = !!activeNotification?.eventId &&
    notificationState.store === store &&
    notificationState.exitingEventIds.has(activeNotification.eventId)
  const showsGiftAnimationEffects = mode === 'dock'
    || mode === 'tiktok-animations'
    || (mode === 'overlay' && appearance.profile === 'minimal')

  useEffect(() => {
    // SSE has no transient presentation replay. A new connection must retire
    // visuals whose exit/completion may have been missed, including child state.
    const resetTransientLifetime = () => {
      lifetimeRef.current += 1
      setLifetime(lifetimeRef.current)
      setEffectState({ store, queue: [] })
      setNotificationState({ store, queue: [], exitingEventIds: new Set() })
    }
    resetTransientLifetime()
    const dispose = createEventFeedImpl({
      url: eventsPath,
      onOpen: () => {
        resetTransientLifetime()
        setConnectionStatus('connected')
      },
      onError: () => setConnectionStatus('reconnecting'),
      onEvent: (payload) => {
        const nextAppearance = parseAppearanceEvent(payload)
        if (nextAppearance) {
          setAppearance((current) => nextAppearance.sessionId !== current.sessionId || nextAppearance.revision > current.revision
            ? { ...nextAppearance, profile: current.profile }
            : current)
          return
        }
        if (isGuiEffectEnvelope(payload)) {
          if (showsGiftAnimationEffects && isGiftAnimationEffectEnvelope(payload)) {
            setEffectState((current) => ({
              store,
              queue: [...(current.store === store ? current.queue : []), payload]
            }))
          }
          return
        }

        if (isNotificationLifecycleEnvelope(payload)) {
          if (mode === 'notifications' && payload.phase === 'exit-started') {
            setNotificationState((current) => {
              const currentState = current.store === store
                ? current
                : { store, queue: [], exitingEventIds: new Set<string>() }
              if (!currentState.queue.some((row) => row.eventId === payload.eventId)) {
                return currentState
              }
              const exitingEventIds = new Set(currentState.exitingEventIds)
              exitingEventIds.add(payload.eventId)
              return { ...currentState, exitingEventIds }
            })
          }
          return
        }

        if (mode === 'tiktok-animations') {
          return
        }

        const accepted = store.pushEvent(payload)
        if (!accepted) return
        if (mode === 'notifications') {
          setNotificationState((current) => ({
            store,
            queue: [...(current.store === store ? current.queue : []), accepted],
            exitingEventIds: current.store === store ? current.exitingEventIds : new Set()
          }))
          return
        }
        setRowState({ store, rows: store.getRows() })
      }
    })

    return () => {
      lifetimeRef.current += 1
      dispose()
    }
  }, [createEventFeedImpl, eventsPath, mode, showsGiftAnimationEffects, store])

  if (mode === 'notifications') {
    return (
      <ActivityBar
        key={lifetime}
        row={activeNotification}
        exitRequested={notificationExitRequested}
        transitionMs={notificationTransitionMs}
        appearance={appearance}
        onExitComplete={(eventId) => {
          if (lifetime !== lifetimeRef.current) return
          setNotificationState((current) => {
            if (current.store !== store) return current
            const first = current.queue[0]
            if (!first || first.eventId !== eventId) return current
            const exitingEventIds = new Set(current.exitingEventIds)
            exitingEventIds.delete(eventId)
            return { store, queue: current.queue.slice(1), exitingEventIds }
          })
        }}
      />
    )
  }

  const dockStatus = mode !== 'dock'
    ? null
    : connectionStatus === 'reconnecting'
      ? 'Reconnecting...'
      : connectionStatus === 'connecting'
        ? 'Connecting...'
        : rows.length === 0
          ? 'Connected - waiting for chat'
          : null

  return (
    <GuiShell
      rows={rows}
      mode={mode}
      status={dockStatus}
      overlayMaxLinesPerMessage={overlayLimits.maxLinesPerMessage}
      activeEffect={activeEffect}
      appearance={appearance}
      onEffectComplete={(playbackId, reason) => {
        if (lifetime !== lifetimeRef.current) return
        setEffectState((current) => {
          const currentQueue = current.store === store ? current.queue : []
          if (currentQueue.length === 0) {
            return current.store === store ? current : { store, queue: [] }
          }

          const nextEffect = currentQueue[0]
          if (!nextEffect || nextEffect.playbackId !== playbackId) {
            return current
          }

          return { store, queue: currentQueue.slice(1) }
        })
        void sendGiftAnimationAckImpl(playbackId, reason).catch(() => undefined)
      }}
    />
  )
}
