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

function applyShiftTransition(element: OverlayRowElement, shiftPx: number, durationMs: number): void {
  element.style.transition = 'none'
  element.style.transform = `translateY(${shiftPx}px)`
  void element.offsetHeight

  const applyTransition = () => {
    element.style.transition = `transform ${durationMs}ms ease-out`
    element.style.transform = 'translateY(0)'
  }

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(applyTransition)
    return
  }

  applyTransition()
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
  let synchronizedEntryShiftPx = 0

  for (const [key, deltaY] of deltas) {
    const element = rowElementsByKey.get(key)
    if (!element) {
      continue
    }

    if (deltaY > synchronizedEntryShiftPx) {
      synchronizedEntryShiftPx = deltaY
    }

    applyShiftTransition(element, deltaY, durationMs)
  }

  if (synchronizedEntryShiftPx <= 0) {
    return currentTopByKey
  }

  for (const key of newRowKeys) {
    const element = rowElementsByKey.get(key)
    if (!element) {
      continue
    }

    applyShiftTransition(element, synchronizedEntryShiftPx, durationMs)
  }

  return currentTopByKey
}
