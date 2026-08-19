# 📡 Stream Sync

[![CI](https://github.com/git-blame-dev/stream-sync/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/git-blame-dev/stream-sync/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/git-blame-dev/stream-sync?label=release)](https://github.com/git-blame-dev/stream-sync/releases/latest)
![Linux x64](https://img.shields.io/badge/Linux-x64-2ea44f)
![Windows x64](https://img.shields.io/badge/Windows-x64-0078D4)

Combine YouTube, TikTok, and Twitch chat, donation alerts, TTS, viewer counts, and OBS overlays into one local stream-control layer.

![Stream Sync demo overlay showing YouTube, TikTok, and Twitch chat messages with a donation alert](demo.webp)

## 🔎 Overview

Stream Sync is a local livestream automation layer for combining multi-platform chat and stream events into consistent notifications, speech output, viewer-count updates, and OBS-facing overlays. It is aimed at streamers who broadcast across YouTube, TikTok, and Twitch and want one configurable control path instead of separate per-platform display logic.

The project emphasizes clear platform boundaries, config-driven runtime behavior, and behavior-focused tests for the event pipeline and startup flow.

## ✨ Features

- Unified chat and command handling across YouTube, TikTok, and Twitch.
- Donation and monetization-style alerts, including YouTube gifts/super chats, Twitch cheers/sub events, and TikTok gifts.
- OBS WebSocket integration for chat, alerts, TTS text, platform logos, viewer counts, and goals.
- Local GUI/overlay assets built with Vite and React for browser or OBS browser-source use.
- Per-platform enablement and filtering through `config.ini`, including message types, viewer counts, data logging, and stream detection.

## 🛠️ Tech Stack

- **Runtime / tooling:** Bun, TypeScript, and Vite.
- **Frontend GUI:** React 19.
- **YouTube integration:** `youtubei.js` plus optional YouTube API key support.
- **TikTok integration:** custom `ws` WebSocket client connecting through EulerStream.
- **Twitch integration:** direct EventSub WebSocket and Helix API integration.
- **OBS integration:** `obs-websocket-js`.
- **Quality / CI:** Bun test coverage, ESLint, TypeScript project checks, Knip, actionlint, and GitHub Actions.

## 🧠 Engineering Highlights

- Platform adapters normalize different event shapes before they reach the notification and display queues.
- Viewer-count polling is separated from platform startup so YouTube, TikTok, and Twitch counts can be enabled and tested independently.
- Config templates keep secrets in `.env` while non-secret behavior lives in `config.ini`.
- CI verifies workflow linting, source linting, typechecking, coverage tests, GUI build output, and Linux/Windows packaging checks.
- Release publishing verifies packaged executables, config templates, environment examples, bundled GUI assets, and SHA256 checksums before upload.

## 🏗️ Architecture

```text
YouTube / TikTok / Twitch
        │
        ▼
Platform adapters and event normalizers
        │
        ▼
Notification, command, monetization, and viewer-count services
        │
        ├── OBS WebSocket outputs
        ├── TTS text output
        ├── GUI / browser overlay transport
        └── logs and optional local data files
```

Key directories:

- `src/platforms/` - platform clients, connection lifecycle, event factories, and event normalizers.
- `src/notifications/` - notification formatting and dispatch behavior.
- `src/obs/` - OBS WebSocket connection and source updates.
- `src/services/` - runtime orchestration and feature services.
- `gui/` - local overlay/dock UI built with React and Vite.
- `tests/` - unit, integration, and smoke E2E coverage around observable behavior.

## 🚀 Getting Started

### Prerequisites

- Bun 1.3.x.
- OBS with [obs-websocket](https://github.com/obsproject/obs-websocket) enabled if OBS output is used.
- Platform credentials for the services you enable.
- `unzip` if TikTok gift animation asset extraction is used.

### Install from source

```bash
bun install --frozen-lockfile
cp config.example.ini config.ini
cp .env.example .env
```

Edit `config.ini` from [`config.example.ini`](config.example.ini) and `.env` from [`.env.example`](.env.example) before starting. Keep secrets in `.env`; do not commit local credentials, logs, token stores, or generated data files.

```bash
bun run start
```

Useful development commands:

```bash
bun run start:debug
bun run build
bun run verify
```

### OBS launchers and browser sources

Stream Sync includes small local HTML launchers under `obs/`. The viewer-facing
Browser Sources are `obs/overlay.html`, `obs/notifications.html`,
`obs/tiktok-animations.html`, and the related animation/demo launchers. They
load from disk, wait for the local GUI health check, then open their selected
route. This avoids manually reloading sources when OBS starts before Stream Sync
or the GUI server.

`obs/dock.html` is different: it is the private OBS Custom Browser Dock for the
operator, not a viewer-facing source. The launchers use unique files so the dock
can keep its own OBS zoom isolation without changing the viewer-facing sources.
The dock shows chat received after it connects; it does not replay earlier chat.
Use the launcher files rather than direct HTTP URLs when independent OBS zoom is
required.

Use one of these local files in OBS:

```text
<repo>\obs\overlay.html
<repo>\obs\dock.html
<repo>\obs\notifications.html
<repo>\obs\demo.html
<repo>\obs\tiktok-animations.html
```

The default GUI origin is `http://127.0.0.1:3399`.

The `/notifications` route is enabled with `enableNotifications = true` in the
`[gui]` section. `dockFeedMode` and `overlayFeedMode` accept `all`, `chat`, or
`non-chat`. The `/notifications` OBS launcher is fixed to the `non-chat` feed:
commands, greetings, farewells, follows, shares, raids, gifts,
Paypiggies/memberships, gift-Paypiggies, and envelopes. Global `show*` settings
remain the master gates for their corresponding notification types.

```ini
[gui]
enableNotifications = true
dockFeedMode = all
dockMaxMessages = 200
overlayFeedMode = chat
```

### Local GUI preview

Run `bun run gui:preview` to start the local GUI transport and feed a deterministic
scenario through the production ingest, notification, and display-queue pipeline.
After the scenario finishes, the transport remains available for inspection until
you press Ctrl+C (SIGINT) or stop the process (SIGTERM). Use `bun run gui:preview:once`
for the finite scenario-only command.
It prints Dock, Overlay, and Notifications URLs and visibly exercises ordinary
chat rows plus monetization rows. The canonical preview uses the same overlay
appearance as production: chat is shown on the overlay, while the dock receives
all rows and the notifications route receives non-chat rows.

Rows play serially without overlap. While no successor is waiting, ordinary
notifications remain for at least 5 seconds and monetization notifications remain
for at least 30 seconds. A waiting successor bypasses the remaining idle hold only
after tracked effects finish; the current row then gets its full 1-second exit
before the next row starts. Tracked effects and the TTS handoff remain in the
production pipeline, but preview TTS is disabled so the command is safe to run
locally.
Enable each route you use with its `[gui]` flag: `enableOverlay`, `enableDock`, or `enableNotifications`.

Append `?appearance=minimal` to an overlay, dock, or notifications launcher URL to use the operator-managed compact presentation. Each overlay source can also retain a different number of rows with `maxMessages`, for example:

```text
http://127.0.0.1:3399/overlay?appearance=minimal&maxMessages=8
<repo>\obs\overlay.html?appearance=minimal&maxMessages=8
```

The row count is an upper bound; the overlay still shows only rows that physically fit its browser-source height. The dock remains a scrolling feed bounded by `dockMaxMessages`, while notifications remains a single latest non-chat activity row. The `maxMessages` URL parameter applies only to `/overlay`.

### Local operator console

Enable the operator console in `config.ini`:

```ini
[gui]
enableOperator = true
host = 127.0.0.1
port = 3399
```

Start Stream Sync, then open `http://127.0.0.1:3399/operator` on the same computer. The page shows the structured application output written to the console, provides live global controls for chat messages, commands, greetings, farewells, follows, gifts, Paypiggies, raids, and shares, and configures the minimal appearance used by opted-in browser sources.

Controls suppress viewer-facing rows, TTS, VFX, media, and animations while preserving platform ingestion, raw logging, tracking, and monetization goal accounting. Turning a control off removes matching items still waiting in the display queue; the active item or sequence finishes. Changes are saved atomically in `data/operator-control-overrides.json`, survive restarts, and never rewrite `config.ini`. Use **Restore config defaults** to clear those overrides.

Minimal appearance overrides are saved separately in `data/operator-appearance-overrides.json`. They update open minimal sources live and control compact rows, row backgrounds, and the maximum number of displayed username badges. A badge limit of zero hides all badges. Standard sources are unchanged.

Operator routes require a loopback GUI host and reject cross-origin mutations. The console is intentionally local-only; do not expose the GUI port through a proxy or port-forward.

### Read-only integration feed

Stream Sync can publish a separate normalized chat stream for local applications.
This integration feed is independent from the built-in dock and overlay, which use
`/gui/events`. Enable the opt-in feed in `config.ini`:

```ini
[gui]
enableChatFeed = true
```

When enabled, connect an SSE client to `http://127.0.0.1:3399/api/v1/chat/events`. Windows applications can use this localhost address when Stream Sync runs in WSL. The feed is loopback-only, has no CORS support or authentication, and does not replay events; consumers receive events published after they connect.

Each `chat.message` event has `schemaVersion: 1` and JSON data with `type`, `eventId`, `platform`, `occurredAt`, `receivedAt`, `user`, and `message` fields. `user` includes `displayName`, `isModerator`, and `isBroadcaster`; `message` includes `text`. Treat the versioned payload as the contract and own all parsing, validation, and reconnect behavior in the consumer.

### Run a release archive

Download the Linux or Windows archive from [GitHub Releases](https://github.com/git-blame-dev/stream-sync/releases). Release assets are named like `stream-sync-vYYYY.MM.DD.N-linux-x64.tar.gz` and `stream-sync-vYYYY.MM.DD.N-windows-x64.zip`.

Linux:

```bash
tar -xzf stream-sync-vYYYY.MM.DD.N-linux-x64.tar.gz
cd stream-sync-linux-x64
cp config.example.ini config.ini
cp .env.example .env
# edit config.ini and .env
./stream-sync
```

Windows PowerShell:

```powershell
Expand-Archive stream-sync-vYYYY.MM.DD.N-windows-x64.zip -DestinationPath .
Set-Location stream-sync-windows-x64
Copy-Item config.example.ini config.ini
Copy-Item .env.example .env
# edit config.ini and .env
.\stream-sync.exe
```

## ✅ Testing

The test suite focuses on observable stream-control behavior rather than live network calls. It includes unit, integration, and smoke E2E tests for platform event routing, viewer counts, OBS integration boundaries, GUI transport, startup wiring, and secret-manager flows.

Run individual checks while developing, or use `bun run verify` as the aggregate local gate:

```bash
bun run lint
bun run typecheck:all
bun run test:coverage
bun run build
bun run verify
```

CI runs these checks on pushes and pull requests, then packages Linux and Windows release artifacts after lint, typecheck, tests, and GUI build pass.

## 📦 Releases / Artifacts

[GitHub Releases](https://github.com/git-blame-dev/stream-sync/releases) publish:

- `stream-sync-vYYYY.MM.DD.N-linux-x64.tar.gz`
- `stream-sync-vYYYY.MM.DD.N-windows-x64.zip`
- `SHA256SUMS`

Each archive includes the executable, bundled GUI assets, [`config.example.ini`](config.example.ini), [`.env.example`](.env.example), and writable runtime folders such as `logs/` and `data/`.

## ⚠️ Limitations

- This is a local stream-control project; platform APIs, chat availability, and event payloads can change outside the repo.
- `.env`, `config.ini`, `logs/`, token stores, and generated `data/` files may contain sensitive or personal stream data and should stay out of commits and public screenshots.
- TikTok connectivity depends on the EulerStream WebSocket path and any required API key configuration.
- OBS output requires matching source names in `config.ini`; mismatched scene/source names will prevent overlay updates.
- Platform features are disabled by default in `config.example.ini`; only enable the services you have configured.

## 🧯 Troubleshooting

- **No platform events appear:** confirm the platform is enabled in `config.ini`, required credentials are present in `.env`, and the channel/username values match the target account.
- **OBS sources do not update:** check that OBS is running, obs-websocket is enabled, `OBS_PASSWORD` matches, and configured source names exist in the active scene collection.
- **TikTok gifts or animations fail:** ensure `TIKTOK_API_KEY` is set when the integration requires it and `unzip` is available on the host.
- **Viewer counts stay empty:** verify the platform-specific `viewerCountEnabled` setting and source name for the OBS text source.
- **Release binary will not start:** copy both `config.example.ini` and `.env.example`, edit them locally, then run the binary from inside the extracted archive folder.
