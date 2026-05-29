interface GuiEventSourceLike {
  onmessage: ((event: MessageEvent<string>) => void) | null
  close: () => void
}

interface GuiEventFeedOptions {
  url: string
  onEvent: (payload: unknown) => void
  eventSourceFactory?: (url: string) => GuiEventSourceLike
}

export function createEventFeed(options: GuiEventFeedOptions) {
  const createSource = options.eventSourceFactory || ((url: string): GuiEventSourceLike => new EventSource(url))
  const source = createSource(options.url)

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
