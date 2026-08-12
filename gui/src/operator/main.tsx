import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

import {
  appendLogRow,
  formatLogData,
  LOG_LEVELS,
  parseLogEntry,
  parseOperatorState,
  selectNewestState,
  toggleLevel,
  type LogEntry,
  type OperatorState,
} from './model'
import './operator.css'

type StreamStatus = 'Connecting' | 'Live' | 'Reconnecting' | 'Invalid data'

const mutationHeaders = {
  'Content-Type': 'application/json',
  'X-Stream-Sync-Request': '1',
}

function useEventStream(
  url: string,
  event: string,
  onData: (value: unknown) => void,
  onStatus: (value: StreamStatus) => void,
) {
  const dataRef = useRef(onData)
  const statusRef = useRef(onStatus)
  dataRef.current = onData
  statusRef.current = onStatus

  useEffect(() => {
    const source = new EventSource(url)
    const receive = (message: MessageEvent) => {
      try {
        dataRef.current(JSON.parse(message.data) as unknown)
      } catch {
        statusRef.current('Invalid data')
      }
    }
    source.addEventListener(event, receive)
    source.onopen = () => statusRef.current('Live')
    source.onerror = () => statusRef.current('Reconnecting')
    return () => source.close()
  }, [event, url])
}

async function request(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init)
  const payload = await response.json().catch(() => null) as unknown
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
      ? payload.error
      : `Request failed (${response.status})`
    throw new Error(message)
  }
  return payload
}

function OperatorApp() {
  const [state, setState] = useState<OperatorState | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [pausedLogs, setPausedLogs] = useState<LogEntry[] | null>(null)
  const [follow, setFollow] = useState(true)
  const [visible, setVisible] = useState(() => new Set<string>(LOG_LEVELS))
  const [, setStateStreamStatus] = useState<StreamStatus>('Connecting')
  const [, setLogStreamStatus] = useState<StreamStatus>('Connecting')
  const viewportRef = useRef<HTMLDivElement>(null)

  const receiveState = (value: unknown) => {
    const next = parseOperatorState(value)
    if (next) {
      setState((current) => selectNewestState(current, next))
    } else {
      setStateStreamStatus('Invalid data')
    }
  }
  const receiveLog = (value: unknown) => {
    const next = parseLogEntry(value)
    if (!next) {
      setLogStreamStatus('Invalid data')
    } else {
      setLogs((rows) => appendLogRow(rows, next))
    }
  }

  useEventStream('/api/v1/operator/events', 'state', receiveState, setStateStreamStatus)
  useEventStream('/api/v1/logs/events', 'log', receiveLog, setLogStreamStatus)

  useEffect(() => {
    request('/api/v1/operator/state')
      .then((value) => {
        const next = parseOperatorState(value)
        if (!next) throw new Error('Invalid operator state')
        setState((current) => selectNewestState(current, next))
      })
      .catch((requestError: unknown) => {
        setError(requestError instanceof Error ? requestError.message : 'Unable to load operator state')
      })
  }, [])

  useEffect(() => {
    if (follow && pausedLogs === null && viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight
    }
  }, [follow, logs, pausedLogs])

  async function applyMutation(url: string, init: RequestInit, fallbackMessage: string) {
    try {
      const next = parseOperatorState(await request(url, init))
      if (!next) throw new Error('Invalid operator state response')
      setState((current) => selectNewestState(current, next))
    } catch (mutationError: unknown) {
      setError(mutationError instanceof Error ? mutationError.message : fallbackMessage)
    }
  }

  async function change(key: string, enabled: boolean) {
    setPending(key)
    setError('')
    await applyMutation('/api/v1/operator/controls', {
      method: 'PATCH',
      headers: mutationHeaders,
      body: JSON.stringify({ key, enabled }),
    }, 'Unable to save control')
    setPending(null)
  }

  async function reset() {
    setPending('reset')
    setError('')
    await applyMutation('/api/v1/operator/controls/reset', {
      method: 'POST',
      headers: mutationHeaders,
      body: '{}',
    }, 'Unable to restore defaults')
    setPending(null)
  }

  const paused = pausedLogs !== null
  const visibleLogs = (pausedLogs ?? logs).filter((log) => visible.has(log.level))

  return (
    <main className="operator-console">
      {error && <p className="error" role="alert">{error}</p>}

      <div className="workspace">
        <section className="controls" aria-labelledby="controls-title">
          <div className="section-heading">
            <div>
              <span className="eyebrow">RUNTIME GATES</span>
              <h2 id="controls-title">Event controls</h2>
            </div>
            <button className="quiet" onClick={() => void reset()} disabled={pending !== null}>
              Restore config defaults
            </button>
          </div>
          <div className="control-list">
            {(state?.controls ?? []).map((control) => (
              <label className="control" key={control.key}>
                <span>
                  <strong>{control.label}</strong>
                  {control.overridden && <em>Persisted override</em>}
                </span>
                <input
                  type="checkbox"
                  checked={control.enabled}
                  disabled={pending !== null}
                  onChange={(event) => void change(control.key, event.target.checked)}
                />
                <span className="switch-track" aria-hidden="true" />
              </label>
            ))}
          </div>
        </section>

        <section className="logs" aria-labelledby="logs-title">
          <div className="section-heading">
            <div>
              <span className="eyebrow">OBSERVABILITY</span>
              <h2 id="logs-title">Live output</h2>
            </div>
            <div className="log-actions">
              {paused && <span className="paused-indicator" role="status">View paused</span>}
              <button className="quiet" onClick={() => setPausedLogs((current) => current ? null : logs)}>
                {paused ? 'Resume view' : 'Pause view'}
              </button>
              <button
                className="quiet"
                onClick={() => {
                  setLogs([])
                  setPausedLogs((current) => current === null ? null : [])
                }}
              >
                Clear view
              </button>
            </div>
          </div>
          <div className="filters" role="group" aria-label="Log filters">
            <button aria-pressed={follow} onClick={() => setFollow((value) => !value)}>↓ Follow output</button>
            {LOG_LEVELS.map((level) => (
              <button
                key={level}
                className={`level-${level}`}
                aria-pressed={visible.has(level)}
                onClick={() => setVisible((current) => toggleLevel(current, level))}
              >
                {level}
              </button>
            ))}
          </div>
          <div className="log-list" ref={viewportRef} role="log" aria-live="off" aria-labelledby="logs-title">
            {visibleLogs.map((log) => (
              <details className="log-row" key={log.id}>
                <summary>
                  <time>{log.timestamp}</time>
                  <b className={`level-${log.level}`}>{log.level}</b>
                  <span>{log.source}</span>
                  <strong>{log.message}</strong>
                </summary>
                {log.data !== undefined && <pre>{formatLogData(log.data)}</pre>}
              </details>
            ))}
            {visibleLogs.length === 0 && <p className="empty">{paused ? 'Output paused.' : 'Waiting for visible output…'}</p>}
          </div>
        </section>
      </div>
    </main>
  )
}

const root = document.getElementById('operator-root')
if (root) {
  createRoot(root).render(<OperatorApp />)
}

export { OperatorApp }
