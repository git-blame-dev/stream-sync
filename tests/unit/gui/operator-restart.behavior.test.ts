import { expect, test, spyOn } from 'bun:test'
import React from 'react'
import TestRenderer from 'react-test-renderer'
import { OperatorApp } from '../../../gui/src/operator/main'
import { createOperatorControlService, OPERATOR_CONTROL_KEYS } from '../../../src/services/operator/operator-control-service'
import { createOperatorAppearanceService } from '../../../src/services/operator/operator-appearance-service'
import { buildOperatorState, buildOperatorAppearance } from '../../../src/services/gui/operator-api'
import { buildGuiRuntimeConfig } from '../../../src/services/gui/gui-runtime-config'
import { parseGuiAppearanceEvent, parseGuiAppearanceSnapshot } from '../../../gui/src/shared/appearance'
import { parseOperatorState, parseAppearanceState, selectNewestState, selectNewestAppearance } from '../../../gui/src/operator/model'

// Only persistence and browser I/O are substituted; service ownership, DTOs,
// parsers, selection and React update ordering use production implementations.
function memoryFs() {
  let persisted = '{}'
  let temporary = '{}'
  return {
    readFile: async () => persisted,
    mkdir: async () => {},
    writeFile: async (_path: string, data: string) => { temporary = data },
    rename: async () => { persisted = temporary },
    unlink: async () => {},
  }
}
async function owners() {
  const controlFs = memoryFs()
  const appearanceFs = memoryFs()
  const options = { defaults: Object.fromEntries(OPERATOR_CONTROL_KEYS.map((key) => [key, true])) as Record<typeof OPERATOR_CONTROL_KEYS[number], boolean>, fs: controlFs }
  const appearanceOptions = { defaults: { compactRows: false, rowBackgroundsEnabled: true, maxDisplayableBadges: 3 }, fs: appearanceFs }
  const oldControl = await createOperatorControlService(options)
  const oldAppearance = await createOperatorAppearanceService(appearanceOptions)
  await oldControl.setEnabled('giftsEnabled', false)
  await oldControl.setEnabled('messagesEnabled', false)
  await oldAppearance.set('compactRows', true)
  await oldAppearance.set('maxDisplayableBadges', 1)
  return {
    oldControl, oldAppearance,
    newControl: await createOperatorControlService(options),
    newAppearance: await createOperatorAppearanceService(appearanceOptions),
  }
}

test('real restarted owners preserve overrides with fresh sessions and accept revisions zero then one', async () => {
  const { oldControl, oldAppearance, newControl, newAppearance } = await owners()
  expect(oldControl.sessionId).not.toBe(newControl.sessionId)
  expect(oldAppearance.sessionId).not.toBe(newAppearance.sessionId)
  expect(newControl.controls).toEqual(oldControl.controls)
  expect(newAppearance.settings).toEqual(oldAppearance.settings)
  const oldState = parseOperatorState(buildOperatorState(oldControl))!
  const freshState = parseOperatorState(buildOperatorState(newControl))!
  const oldStyle = parseAppearanceState(buildOperatorAppearance(oldAppearance.snapshot))!
  const freshStyle = parseAppearanceState(buildOperatorAppearance(newAppearance.snapshot))!
  expect(freshState.revision).toBe(0)
  expect(freshStyle.revision).toBe(0)
  expect(selectNewestState(oldState, freshState, 'stream')).toBe(freshState)
  expect(selectNewestAppearance(oldStyle, freshStyle, 'stream')).toBe(freshStyle)
  expect(selectNewestState(freshState, oldState)).toBe(freshState)
  expect(selectNewestAppearance(freshStyle, oldStyle)).toBe(freshStyle)
  await newControl.setEnabled('messagesEnabled', true)
  await newAppearance.set('compactRows', false)
  const nextState = parseOperatorState(buildOperatorState(newControl))!
  const nextStyle = parseAppearanceState(buildOperatorAppearance(newAppearance.snapshot))!
  expect(selectNewestState(freshState, nextState)).toBe(nextState)
  expect(selectNewestAppearance(freshStyle, nextStyle)).toBe(nextStyle)
  expect(selectNewestState(nextState, freshState, 'stream')).toBe(nextState)
  expect(selectNewestAppearance(nextStyle, freshStyle, 'stream')).toBe(nextStyle)
  const runtime = buildGuiRuntimeConfig({}, newAppearance.snapshot).appearance
  expect(parseGuiAppearanceSnapshot(runtime).sessionId).toBe(newAppearance.sessionId)
  expect(parseGuiAppearanceEvent({ __guiEvent: 'appearance', ...runtime })?.sessionId).toBe(newAppearance.sessionId)
  for (const sessionId of ['', 3, null]) {
    expect(parseOperatorState({ ...nextState, sessionId })).toBeNull()
    expect(parseAppearanceState({ ...nextStyle, sessionId })).toBeNull()
    expect(parseGuiAppearanceEvent({ __guiEvent: 'appearance', ...runtime, sessionId })).toBeNull()
  }
})

class TestEventSource {
  static sources: TestEventSource[] = []
  handlers = new Map<string, EventListener>()
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(readonly url: string) { TestEventSource.sources.push(this) }
  addEventListener(event: string, handler: EventListener) { this.handlers.set(event, handler) }
  removeEventListener(event: string) { this.handlers.delete(event) }
  close() {}
  emit(event: string, value: unknown) { this.handlers.get(event)?.(new MessageEvent(event, { data: JSON.stringify(value) })) }
}

for (const mutation of ['controls', 'appearance', 'funding'] as const) {
  test(`actual operator ignores late initial and ${mutation} HTTP responses after SSE owner replacement and retires callbacks`, async () => {
    const { oldControl, oldAppearance, newControl, newAppearance } = await owners()
    const previousSource = globalThis.EventSource
    const previousFetch = globalThis.fetch
    const silenceError = spyOn(console, 'error').mockImplementation(() => {})
    const silenceWarn = spyOn(console, 'warn').mockImplementation(() => {})
    const pending: Array<{ url: string; finish: (value: unknown) => void }> = []
    globalThis.EventSource = TestEventSource as unknown as typeof EventSource
    globalThis.fetch = ((_url: string | URL | Request) => new Promise<Response>((resolve) => {
      pending.push({ url: String(_url), finish: (value) => resolve(Response.json(value)) })
    })) as typeof fetch
    TestEventSource.sources = []
    let renderer: TestRenderer.ReactTestRenderer | undefined
    const oldFunding = { enabled: true, id: 'test-goal', sessionId: 'test-old-owner', revision: 2, label: 'Test old goal', labelOverridden: false, currentUsd: 2, targetUsd: 100, completed: false }
    const newFunding = { ...oldFunding, sessionId: 'test-new-owner', revision: 0, label: 'Test new goal', currentUsd: 0 }
    const checked = (label: string) => renderer!.root.findAllByType('input').find((input) => input.parent?.findAllByType('strong').some((strong) => strong.children.join('') === label))!.props.checked as boolean
    try {
      await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(OperatorApp)) })
      const stream = TestEventSource.sources.find((source) => source.url.includes('/operator/'))!
      await TestRenderer.act(async () => {
        stream.emit('state', buildOperatorState(oldControl))
        stream.emit('appearance', buildOperatorAppearance(oldAppearance.snapshot))
        stream.emit('funding-goal', oldFunding)
      })
      // A mutation begun with the old owner may finish after restart too.
      await TestRenderer.act(async () => {
        if (mutation === 'funding') {
          renderer!.root.findAllByType('button').find((button) => button.children.join('') === '+$1')!.props.onClick()
        } else {
          const label = mutation === 'controls' ? 'Chat messages' : 'Compact rows'
          const input = renderer!.root.findAllByType('input').find((item) => item.parent?.findAllByType('strong').some((strong) => strong.children.join('') === label))!
          input.props.onChange({ target: { checked: true } })
        }
      })
      await TestRenderer.act(async () => {
        stream.emit('state', buildOperatorState(newControl))
        stream.emit('appearance', buildOperatorAppearance(newAppearance.snapshot))
        stream.emit('funding-goal', newFunding)
        await newControl.setEnabled('messagesEnabled', true)
        await newAppearance.set('compactRows', false)
        stream.emit('state', buildOperatorState(newControl))
        stream.emit('appearance', buildOperatorAppearance(newAppearance.snapshot))
        stream.emit('funding-goal', { ...newFunding, revision: 1, currentUsd: 1 })
      })
      expect(checked('Chat messages')).toBe(true)
      expect(checked('Compact rows')).toBe(false)
      await TestRenderer.act(async () => {
        for (const response of pending) response.finish(response.url.includes('appearance') ? buildOperatorAppearance(oldAppearance.snapshot) : response.url.includes('funding-goal') ? oldFunding : buildOperatorState(oldControl))
      })
      expect(checked('Chat messages')).toBe(true)
      expect(checked('Compact rows')).toBe(false)
      expect(JSON.stringify(renderer!.toJSON())).toContain('Test new goal')
      expect(JSON.stringify(renderer!.toJSON())).not.toContain('Test old goal')
      const retired = stream.handlers.get('state')!
      const retiredOpen = stream.onopen!
      const retiredError = stream.onerror!
      await TestRenderer.act(async () => { renderer!.unmount() })
      // Even a callback captured before listener removal must not parse its payload.
      let reads = 0
      retired({ get data() { reads++; return '{}' } } as MessageEvent)
      retiredOpen()
      retiredError()
      expect(reads).toBe(0)
    } finally {
      if (renderer) await TestRenderer.act(async () => { renderer!.unmount() })
      globalThis.fetch = previousFetch
      globalThis.EventSource = previousSource
      silenceError.mockRestore()
      silenceWarn.mockRestore()
    }
  })
}

for (const boundary of ['headers', 'body'] as const) {
  test(`actual operator releases pending and reconciles committed funding after lost ${boundary}`, async () => {
    const { newControl, newAppearance } = await owners()
    const oldSource = globalThis.EventSource
    const oldFetch = globalThis.fetch
    const silenceError = spyOn(console, 'error').mockImplementation(() => {})
    const silenceWarn = spyOn(console, 'warn').mockImplementation(() => {})
    const deadlineCallbacks = new Map<ReturnType<typeof setTimeout>, () => void>()
    const nativeTimeout = globalThis.setTimeout
    const timers = spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void, delay: number) => {
      if (delay !== 10_000) return nativeTimeout(callback, delay)
      const handle = nativeTimeout(() => {}, 60_000)
      deadlineCallbacks.set(handle, callback)
      return handle
    }) as typeof setTimeout)
    let funding = { enabled: true, id: 'test-goal', sessionId: 'test-goal-owner', revision: 0, label: 'Test goal', labelOverridden: false, currentUsd: 0, targetUsd: 100, completed: false }
    let mutations = 0
    let mutationSignal: AbortSignal | null | undefined
    let releaseBody: ((value: unknown) => void) | undefined
    globalThis.EventSource = TestEventSource as unknown as typeof EventSource
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        mutations++
        mutationSignal = init.signal
        funding = { ...funding, revision: 1, currentUsd: 1 }
        if (boundary === 'headers') return await new Promise<Response>(() => {})
        return { ok: true, json: () => new Promise(resolve => { releaseBody = resolve }) } as Response
      }
      return Response.json(String(url).includes('funding-goal') ? funding : String(url).includes('appearance') ? buildOperatorAppearance(newAppearance.snapshot) : buildOperatorState(newControl))
    }) as typeof fetch
    TestEventSource.sources = []
    let renderer: TestRenderer.ReactTestRenderer | undefined
    try {
      await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(OperatorApp)) })
      const add = () => renderer!.root.findAllByType('button').find(button => button.children.join('') === '+$1')!
      await TestRenderer.act(async () => { add().props.onClick() })
      expect(add().props.disabled).toBe(true)
      await TestRenderer.act(async () => {
        for (const callback of deadlineCallbacks.values()) callback()
      })
      expect(mutationSignal?.aborted).toBe(true)
      expect(add().props.disabled).toBe(false)
      expect(mutations).toBe(1)
      expect(JSON.stringify(renderer!.toJSON())).toContain('Outcome uncertain')
      expect(JSON.stringify(renderer!.toJSON())).toContain('$1.00')
      await TestRenderer.act(async () => { releaseBody?.({ ...funding, currentUsd: 999 }) })
      expect(JSON.stringify(renderer!.toJSON())).not.toContain('$999.00')
      expect(mutations).toBe(1)
    } finally {
      if (renderer) await TestRenderer.act(async () => { renderer!.unmount() })
      for (const handle of deadlineCallbacks.keys()) clearTimeout(handle)
      timers.mockRestore()
      globalThis.fetch = oldFetch
      globalThis.EventSource = oldSource
      silenceError.mockRestore()
      silenceWarn.mockRestore()
    }
  })
}

test('actual operator aborts held initial bodies and mutation on unmount', async () => {
  const { newControl, newAppearance } = await owners()
  const oldSource = globalThis.EventSource
  const oldFetch = globalThis.fetch
  const silenceError = spyOn(console, 'error').mockImplementation(() => {})
  const silenceWarn = spyOn(console, 'warn').mockImplementation(() => {})
  const signals: AbortSignal[] = []
  const funding = { enabled: true, id: 'test-goal', sessionId: 'test-owner', revision: 0, label: 'Test goal', labelOverridden: false, currentUsd: 0, targetUsd: 100, completed: false }
  globalThis.EventSource = TestEventSource as unknown as typeof EventSource
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    signals.push(init!.signal!)
    return { ok: true, json: () => new Promise(() => {}) } as unknown as Response
  }) as typeof fetch
  TestEventSource.sources = []
  let renderer: TestRenderer.ReactTestRenderer | undefined
  try {
    await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(OperatorApp)) })
    await TestRenderer.act(async () => {
      const stream = TestEventSource.sources.find(source => source.url.includes('/operator/'))!
      stream.emit('state', buildOperatorState(newControl))
      stream.emit('appearance', buildOperatorAppearance(newAppearance.snapshot))
      stream.emit('funding-goal', funding)
    })
    await TestRenderer.act(async () => {
      renderer!.root.findAllByType('button').find(button => button.children.join('') === '+$1')!.props.onClick()
    })
    expect(signals).toHaveLength(4)
    await TestRenderer.act(async () => { renderer!.unmount() })
    expect(signals.every(signal => signal.aborted)).toBe(true)
  } finally {
    if (renderer) await TestRenderer.act(async () => { renderer!.unmount() })
    globalThis.fetch = oldFetch
    globalThis.EventSource = oldSource
    silenceError.mockRestore()
    silenceWarn.mockRestore()
  }
})
