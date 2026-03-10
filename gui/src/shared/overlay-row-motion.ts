export function calculateOverlayRowShiftDeltas(
  previousTopByKey: Map<string, number>,
  currentTopByKey: Map<string, number>
): Map<string, number> {
  const deltas = new Map<string, number>()

  for (const [key, currentTop] of currentTopByKey) {
    const previousTop = previousTopByKey.get(key)
    if (typeof previousTop !== 'number') {
      continue
    }

    const deltaY = previousTop - currentTop
    if (deltaY !== 0) {
      deltas.set(key, deltaY)
    }
  }

  return deltas
}

interface OverlayRowElement {
  style: {
    transition: string
    transform: string
  }
  offsetHeight: number
  getBoundingClientRect: () => { top: number }
}

interface ApplyOverlayRowShiftMotionOptions {
  rowKeys: string[]
  rowElementsByKey: Map<string, OverlayRowElement>
  previousTopByKey: Map<string, number>
  durationMs: number
}

export function applyOverlayRowShiftMotion({
  rowKeys,
  rowElementsByKey,
  previousTopByKey,
  durationMs
}: ApplyOverlayRowShiftMotionOptions): Map<string, number> {
  const newRowKeys: string[] = []
  const currentTopByKey = new Map<string, number>()
  for (const key of rowKeys) {
    const element = rowElementsByKey.get(key)
    if (!element) {
      continue
    }

    if (!previousTopByKey.has(key)) {
      newRowKeys.push(key)
    }

    currentTopByKey.set(key, element.getBoundingClientRect().top)
  }

  const deltas = calculateOverlayRowShiftDeltas(previousTopByKey, currentTopByKey)
  for (const [key, deltaY] of deltas) {
    const element = rowElementsByKey.get(key)
    if (!element) {
      continue
    }

    element.style.transition = 'none'
    element.style.transform = `translateY(${deltaY}px)`
    void element.offsetHeight
    const applyTransition = () => {
      element.style.transition = `transform ${durationMs}ms ease-out`
      element.style.transform = 'translateY(0)'
    }

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(applyTransition)
      continue
    }

    applyTransition()
  }

  for (const key of newRowKeys) {
    const element = rowElementsByKey.get(key)
    if (!element) {
      continue
    }

    const rect = element.getBoundingClientRect()
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : rect.top + element.offsetHeight + 120
    const distanceToBottom = Math.max(0, viewportHeight - rect.top)
    const entryOffsetPx = Math.max(element.offsetHeight + 24, distanceToBottom + element.offsetHeight + 24)

    element.style.transition = 'none'
    element.style.transform = `translateY(${entryOffsetPx}px)`
    void element.offsetHeight
    const applyTransition = () => {
      element.style.transition = `transform ${durationMs}ms ease-out`
      element.style.transform = 'translateY(0)'
    }

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(applyTransition)
      continue
    }

    applyTransition()
  }

  return currentTopByKey
}
