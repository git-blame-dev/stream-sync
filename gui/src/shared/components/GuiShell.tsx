import React, { useLayoutEffect, useMemo, useRef, useState } from 'react'

import { GuiRow } from './GuiRow'
import type { GuiRowDto } from '../types'
import { applyOverlayRowShiftMotion } from '../overlay-row-motion'

const ROW_SLIDE_ANIMATION_MS = 1000
const DOCK_PINNED_BOTTOM_THRESHOLD_PX = 8
const OVERLAY_EXIT_BUFFER_PX = 2
const OVERLAY_ROW_GAP_PX = 10

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
  mode: 'dock' | 'overlay'
  overlayMaxLinesPerMessage: number
  uiCompareMode?: boolean
}

interface GuiShellRowEntry {
  row: GuiRowDto
  key: string
}

interface OverlayRowGeometry {
  top: number
  height: number
  visualTop: number
}

interface OverlayVisibilityResult {
  visibleKeys: string[]
  exitCandidateKeys: string[]
}

interface OverlayExitingRow {
  exitId: string
  rowKey: string
  row: GuiRowDto
  topPx: number
  travelPx: number
  entryShiftPx: number
}

function areOrderedStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }

  return true
}

function collectOverlayVisibility(
  rowEntries: GuiShellRowEntry[],
  geometryByKey: Map<string, OverlayRowGeometry>,
  shellHeight: number,
  suppressedRowKeys: Set<string>
): OverlayVisibilityResult {
  const visibleKeys: string[] = []

  const fallbackVisibleKeys = rowEntries
    .map((entry) => entry.key)
    .filter((key) => !suppressedRowKeys.has(key))

  for (let index = rowEntries.length - 1; index >= 0; index -= 1) {
    const key = rowEntries[index].key
    if (suppressedRowKeys.has(key)) {
      continue
    }

    const geometry = geometryByKey.get(key)
    if (!geometry) {
      return {
        visibleKeys: fallbackVisibleKeys,
        exitCandidateKeys: []
      }
    }

    const top = geometry.top
    const bottom = top + geometry.height
    const visualTop = geometry.visualTop
    const visualBottom = visualTop + geometry.height
    const isFullyVisible = top >= 0 && bottom <= shellHeight
    if (isFullyVisible) {
      visibleKeys.push(key)
      continue
    }

    const intersectsViewport = bottom > 0 && top < shellHeight
    const visualIntersectsViewport = visualBottom > 0 && visualTop < shellHeight
    if (intersectsViewport || visualIntersectsViewport) {
      const exitCandidateKeys: string[] = [key]

      for (let olderIndex = index - 1; olderIndex >= 0; olderIndex -= 1) {
        const olderKey = rowEntries[olderIndex].key
        if (suppressedRowKeys.has(olderKey)) {
          continue
        }

        const olderGeometry = geometryByKey.get(olderKey)
        if (!olderGeometry) {
          return {
            visibleKeys: fallbackVisibleKeys,
            exitCandidateKeys: []
          }
        }

        const olderLayoutTop = olderGeometry.top
        const olderLayoutBottom = olderLayoutTop + olderGeometry.height
        const olderLayoutIntersectsViewport = olderLayoutBottom > 0 && olderLayoutTop < shellHeight
        const olderVisualTop = olderGeometry.visualTop
        const olderVisualBottom = olderVisualTop + olderGeometry.height
        const olderVisualIntersectsViewport = olderVisualBottom > 0 && olderVisualTop < shellHeight
        const olderIntersectsViewport = olderLayoutIntersectsViewport || olderVisualIntersectsViewport
        if (!olderIntersectsViewport) {
          if (olderLayoutBottom <= 0 && olderVisualBottom <= 0) {
            break
          }

          continue
        }

        exitCandidateKeys.push(olderKey)
      }

      visibleKeys.reverse()
      return {
        visibleKeys,
        exitCandidateKeys
      }
    }

    break
  }

  visibleKeys.reverse()
  return {
    visibleKeys,
    exitCandidateKeys: []
  }
}

function createOverlayExitTravel(top: number, height: number): number {
  return Math.max(0, top + height + OVERLAY_EXIT_BUFFER_PX)
}

function createOverlayExitStyle(topPx: number, travelPx: number): React.CSSProperties {
  const style: React.CSSProperties & { [key: string]: string } = {
    top: `${topPx}px`,
    '--overlay-exit-travel': `${travelPx}px`
  }
  return style
}

export function GuiShell({ rows, mode, overlayMaxLinesPerMessage, uiCompareMode = false }: GuiShellProps) {
  const shellStyle = mode === 'overlay'
    ? ({ '--overlay-line-clamp': String(overlayMaxLinesPerMessage) } as React.CSSProperties)
    : mode === 'dock'
      ? ({ height: '100vh', overflowY: 'auto', overscrollBehavior: 'contain' } as React.CSSProperties)
      : undefined
  const shellRef = useRef<HTMLElement | null>(null)
  const isDockPinnedToBottomRef = useRef(true)
  const rowElementsByKeyRef = useRef(new Map<string, HTMLDivElement>())
  const rowRenderKeyByRef = useRef(new WeakMap<GuiRowDto, string>())
  const rowRenderKeyCounterRef = useRef(0)
  const previousTopByKeyRef = useRef(new Map<string, number>())
  const overlayPreviousRowsByKeyRef = useRef(new Map<string, GuiRowDto>())
  const overlayPreviousGeometryByKeyRef = useRef(new Map<string, OverlayRowGeometry>())
  const overlaySuppressedRowKeysRef = useRef(new Set<string>())
  const overlayExitSequenceRef = useRef(0)
  const [overlayVisibleRowKeys, setOverlayVisibleRowKeys] = useState<string[]>([])
  const [overlayExitingRows, setOverlayExitingRows] = useState<OverlayExitingRow[]>([])
  const [overlayVisibilityInputSignature, setOverlayVisibilityInputSignature] = useState('')
  const [overlayMeasurementToken, setOverlayMeasurementToken] = useState(0)

  const resolveRowRenderKey = (row: GuiRowDto): string => {
    const existingKey = rowRenderKeyByRef.current.get(row)
    if (existingKey) {
      return existingKey
    }

    rowRenderKeyCounterRef.current += 1
    const nextKey = `row:${rowRenderKeyCounterRef.current}`
    rowRenderKeyByRef.current.set(row, nextKey)
    return nextKey
  }

  const rowEntries = useMemo(() => {
    return rows.map((row) => {
      return {
        row,
        key: resolveRowRenderKey(row)
      }
    })
  }, [rows])
  const rowKeysSignature = useMemo(() => rowEntries.map((entry) => entry.key).join('|'), [rowEntries])
  const overlayInputSignature = `${overlayMeasurementToken}:${rowKeysSignature}`
  const isOverlayVisibilityReady = mode === 'overlay' && overlayVisibilityInputSignature === overlayInputSignature
  const overlayVisibleRowKeySet = useMemo(() => new Set(overlayVisibleRowKeys), [overlayVisibleRowKeys])
  const renderedRowEntries = useMemo(() => {
    if (mode !== 'overlay') {
      return rowEntries
    }

    if (!isOverlayVisibilityReady) {
      return rowEntries.filter((entry) => {
        return !overlaySuppressedRowKeysRef.current.has(entry.key)
      })
    }

    return rowEntries.filter((entry) => overlayVisibleRowKeySet.has(entry.key))
  }, [isOverlayVisibilityReady, mode, overlayVisibilityInputSignature, overlayVisibleRowKeySet, rowEntries])

  useLayoutEffect(() => {
    if (mode !== 'overlay') {
      return
    }

    if (overlayVisibilityInputSignature === overlayInputSignature) {
      return
    }

    if (!shellRef.current) {
      return
    }

    const currentRowsByKey = new Map<string, GuiRowDto>()
    for (const entry of rowEntries) {
      currentRowsByKey.set(entry.key, entry.row)
    }

    for (const suppressedKey of Array.from(overlaySuppressedRowKeysRef.current)) {
      if (currentRowsByKey.has(suppressedKey)) {
        continue
      }

      overlaySuppressedRowKeysRef.current.delete(suppressedKey)
    }

    const currentGeometryByKey = new Map<string, OverlayRowGeometry>()
    const shellRect = shellRef.current.getBoundingClientRect()
    for (const entry of rowEntries) {
      const element = rowElementsByKeyRef.current.get(entry.key)
      if (element) {
        const rect = element.getBoundingClientRect()
        currentGeometryByKey.set(entry.key, {
          top: element.offsetTop,
          height: rect.height || element.offsetHeight,
          visualTop: rect.top - shellRect.top
        })
      }
    }

    const shellHeight = shellRef.current.clientHeight
    const visibility = collectOverlayVisibility(
      rowEntries,
      currentGeometryByKey,
      shellHeight,
      overlaySuppressedRowKeysRef.current
    )
    const existingExitRowKeys = new Set(overlayExitingRows.map((entry) => entry.rowKey))
    const nextExitingRows: OverlayExitingRow[] = []

    for (const exitKey of visibility.exitCandidateKeys) {
      if (existingExitRowKeys.has(exitKey)) {
        continue
      }

      const row = currentRowsByKey.get(exitKey)
      const geometry = currentGeometryByKey.get(exitKey)
      if (!row || !geometry) {
        continue
      }

      const travelPx = createOverlayExitTravel(geometry.visualTop, geometry.height)
      if (travelPx <= 0) {
        continue
      }

      overlayExitSequenceRef.current += 1
      nextExitingRows.push({
        exitId: `${exitKey}:exit:${overlayExitSequenceRef.current}`,
        rowKey: exitKey,
        row,
        topPx: geometry.visualTop,
        travelPx,
        entryShiftPx: geometry.height + OVERLAY_ROW_GAP_PX
      })
      overlaySuppressedRowKeysRef.current.add(exitKey)
    }

    for (const [previousKey, previousRow] of overlayPreviousRowsByKeyRef.current) {
      if (currentRowsByKey.has(previousKey)) {
        continue
      }

      if (existingExitRowKeys.has(previousKey)) {
        continue
      }

      const previousGeometry = overlayPreviousGeometryByKeyRef.current.get(previousKey)
      if (!previousGeometry) {
        continue
      }

      const intersectsViewport =
        previousGeometry.visualTop + previousGeometry.height > 0 &&
        previousGeometry.visualTop < shellHeight
      if (!intersectsViewport) {
        continue
      }

      const travelPx = createOverlayExitTravel(previousGeometry.visualTop, previousGeometry.height)
      if (travelPx <= 0) {
        continue
      }

      overlayExitSequenceRef.current += 1
      nextExitingRows.push({
        exitId: `${previousKey}:exit:${overlayExitSequenceRef.current}`,
        rowKey: previousKey,
        row: previousRow,
        topPx: previousGeometry.visualTop,
        travelPx,
        entryShiftPx: previousGeometry.height + OVERLAY_ROW_GAP_PX
      })
    }

    overlayPreviousRowsByKeyRef.current = currentRowsByKey
    overlayPreviousGeometryByKeyRef.current = currentGeometryByKey

    setOverlayVisibilityInputSignature(overlayInputSignature)
    if (!areOrderedStringArraysEqual(overlayVisibleRowKeys, visibility.visibleKeys)) {
      setOverlayVisibleRowKeys(visibility.visibleKeys)
    }

    if (nextExitingRows.length > 0) {
      setOverlayExitingRows((currentRows) => [...currentRows, ...nextExitingRows])
    }
  }, [mode, overlayExitingRows, overlayInputSignature, overlayVisibilityInputSignature, overlayVisibleRowKeys, rowEntries])

  useLayoutEffect(() => {
    if (mode === 'overlay') {
      return
    }

    overlayPreviousRowsByKeyRef.current = new Map()
    overlayPreviousGeometryByKeyRef.current = new Map()
    overlaySuppressedRowKeysRef.current.clear()
    if (overlayExitingRows.length > 0) {
      setOverlayExitingRows([])
    }
  }, [mode, overlayExitingRows.length])

  useLayoutEffect(() => {
    if (mode !== 'overlay') {
      return
    }

    if (
      typeof window === 'undefined' ||
      typeof window.addEventListener !== 'function' ||
      typeof window.removeEventListener !== 'function'
    ) {
      return
    }

    const handleResize = () => {
      setOverlayMeasurementToken((currentValue) => currentValue + 1)
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [mode])

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
    if (mode === 'overlay' && !isOverlayVisibilityReady) {
      return
    }

    previousTopByKeyRef.current = applyOverlayRowShiftMotion({
      rowKeys: renderedRowEntries.map((entry) => entry.key),
      rowElementsByKey: rowElementsByKeyRef.current,
      previousTopByKey: previousTopByKeyRef.current,
      durationMs: ROW_SLIDE_ANIMATION_MS,
      fallbackEntryShiftPx: overlayExitingRows.reduce((maxShift, row) => {
        return row.entryShiftPx > maxShift ? row.entryShiftPx : maxShift
      }, 0)
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
  }, [isOverlayVisibilityReady, mode, overlayExitingRows, renderedRowEntries])

  return (
    <main className={`gui-shell gui-shell--${mode}`} style={shellStyle} ref={shellRef}>
      {mode === 'overlay'
        ? overlayExitingRows.map((exitRow) => {
            return (
              <GuiRow
                key={exitRow.exitId}
                row={exitRow.row}
                mode={mode}
                uiCompareMode={uiCompareMode}
                className="gui-row--overlay-exit"
                style={createOverlayExitStyle(exitRow.topPx, exitRow.travelPx)}
                onAnimationEnd={(event) => {
                  if (event.target !== event.currentTarget) {
                    return
                  }

                  setOverlayExitingRows((currentRows) =>
                    currentRows.filter((row) => row.exitId !== exitRow.exitId)
                  )
                }}
              />
            )
          })
        : null}
      {renderedRowEntries.map((entry) => {
        return (
          <GuiRow
            key={entry.key}
            row={entry.row}
            mode={mode}
            uiCompareMode={uiCompareMode}
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
