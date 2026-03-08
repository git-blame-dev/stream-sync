interface GuiEventFeedOptions {
  url: string
  onEvent: (payload: unknown) => void
  eventSourceFactory?: (url: string) => EventSource
}

export function createEventFeed(options: GuiEventFeedOptions) {
  const createSource = options.eventSourceFactory || ((url: string) => new EventSource(url))
  const source = createSource(options.url)

  source.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data)
      options.onEvent(payload)
    } catch {
    }
  }

  return () => {
    source.close()
  }
}
