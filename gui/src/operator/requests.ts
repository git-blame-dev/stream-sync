// The deadline covers headers and the response body, including fetch implementations
// that do not settle when aborted. One owner retires every request on unmount.
export const OPERATOR_REQUEST_TIMEOUT_MS = 10_000

export class OperatorRequestError extends Error {
  constructor(message: string, readonly uncertain: boolean, readonly cancelled = false) { super(message) }
}

export function createOperatorRequests() {
  const controllers = new Set<AbortController>()
  let active = true
  return {
    get active() { return active },
    dispose() {
      active = false
      for (const controller of controllers) controller.abort()
      controllers.clear()
    },
    async request(url: string, init?: RequestInit): Promise<unknown> {
      if (!active) throw new OperatorRequestError('Request cancelled', false, true)
      const controller = new AbortController()
      controllers.add(controller)
      const mutation = !!init?.method && init.method !== 'GET'
      let timer: ReturnType<typeof globalThis.setTimeout> | undefined
      let abort: (() => void) | undefined
      try {
        return await Promise.race([
          (async () => {
            const response = await fetch(url, { ...init, signal: controller.signal })
            const payload = await response.json() as unknown
            if (!response.ok) {
              const message = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
                ? payload.error : `Request failed (${response.status})`
              throw new OperatorRequestError(message, false)
            }
            if (!active || controller.signal.aborted) throw new OperatorRequestError('Request cancelled', mutation, !active)
            return payload
          })(),
          new Promise<never>((_resolve, reject) => {
            abort = () => reject(new OperatorRequestError('Request cancelled or timed out', mutation, !active))
            controller.signal.addEventListener('abort', abort, { once: true })
            timer = globalThis.setTimeout(() => controller.abort(), OPERATOR_REQUEST_TIMEOUT_MS)
          }),
        ])
      } catch (error) {
        if (error instanceof OperatorRequestError) throw error
        throw new OperatorRequestError(error instanceof Error ? error.message : 'Request failed', mutation)
      } finally {
        if (timer !== undefined) globalThis.clearTimeout(timer)
        if (abort) controller.signal.removeEventListener('abort', abort)
        controllers.delete(controller)
      }
    },
  }
}
