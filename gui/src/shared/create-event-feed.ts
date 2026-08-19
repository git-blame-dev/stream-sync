interface GuiEventSourceLike {
  onmessage: ((event: MessageEvent<string>) => void) | null
  close: () => void
  onopen?: ((event: Event) => void) | null
  onerror?: ((event: Event) => void) | null
}

interface GuiEventFeedOptions {
  url: string
  onEvent: (payload: unknown) => void
  eventSourceFactory?: (url: string) => GuiEventSourceLike
  onOpen?: () => void
  onError?: () => void
}

export function createEventFeed(options: GuiEventFeedOptions) {
  const createSource = options.eventSourceFactory || ((url: string): GuiEventSourceLike => new EventSource(url))
  const source = createSource(options.url)
  source.onopen = () => options.onOpen?.()
  source.onerror = () => options.onError?.()

  source.onmessage = (event) => {
    let payload: unknown
    try {
      payload = JSON.parse(event.data)
    } catch {
      return
    }
    options.onEvent(payload)
  }

  return () => {
    source.close()
  }
}
