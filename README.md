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
- OBS WebSocket integration for chat, alerts, VFX media, viewer counts, and goals, paired with local Neural-TTS speech output.
- Local GUI/overlay assets built with Vite and React for browser or OBS browser-source use.
- Per-platform enablement and filtering through `config.ini`, including message types, viewer counts, data logging, and stream detection.

## 🛠️ Tech Stack

- **Runtime / tooling:** Bun, TypeScript, and Vite.
- **Frontend GUI:** React 19.
- **YouTube integration:** `youtubei.js` for chat, stream detection, and viewer counts. YouTube Data API selectors (`enableAPI=true` or either method set to `api`) are unsupported; use `youtubei`. No YouTube API key is needed.
- **TikTok integration:** `tiktok-live-connector` connects directly to TikTok using EulerStream signing; the platform adapter owns readiness and retries.
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
        ├── Neural-TTS speech output
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

### Install from source

```bash
bun install --frozen-lockfile
cp config.example.ini config.ini
cp .env.example .env
```

Edit `config.ini` from [`config.example.ini`](config.example.ini) and `.env` from [`.env.example`](.env.example) before starting. Keep secrets in `.env`; do not commit local credentials, logs, token stores, or generated data files.

To receive YouTube subscriber alerts through StreamElements, set `enabled = true`
in `[streamelements]` and supply `STREAMELEMENTS_JWT_TOKEN` in `.env`. The JWT
scopes the account; copy it while the YouTube account is selected in the
StreamElements dashboard. No channel IDs are needed. StreamElements handles only YouTube
subscriber alerts; Twitch follows use the native Twitch integration. Optional
`dataLoggingEnabled` and `dataLoggingPath` configure local raw-event logging
(disabled by default, with `./logs` as the default directory).

Operational logs rotate at 20 MiB or a UTC date change. New plain-text archives have a 100 MiB budget and 14-day age limit, configured under `[logging]`. Opt-in raw capture rotates each file at 20 MiB and shares a 100 MiB archive budget per capture directory, with a two-day age limit. Retention runs on first use and rotation; idle directories are not continuously expired. Existing historical archives and oversized inherited active files are preserved outside these budgets. Emergency logs keep a 1 MiB active file and one backup; oversized inherited history is preserved separately. Unhandled rejections are reported through the emergency logger and terminate with exit code 1.

Prompted credentials are persisted only when their representation roundtrips through the supported env-file loaders. Values with dollar expansion, backslashes, control characters or all three quoting delimiters remain available for the current process, with a notice that they were not persisted. Supply those values through your process environment for subsequent launches.

```bash
bun run start
```

Useful development commands:

```bash
bun run start:debug
bun run build
bun --no-env-file run verify
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

Controls suppress viewer-facing rows, TTS, VFX, media, and animations while preserving platform ingestion, raw logging, and tracking. Native monetization goals and USD funding accounting advance only when the backend starts presenting a notification, not on ingestion or queue admission. This does not require a browser acknowledgement or prove physical OBS visibility. Turning a control off removes matching items still waiting in the display queue without crediting them; the active presentation finishes without retroactively undoing its credit. Existing saved funding balances remain unchanged, and manual funding adjustments remain separate operator actions. Changes are saved atomically in `data/operator-control-overrides.json`, survive restarts, and never rewrite `config.ini`. Use **Restore config defaults** to clear those overrides.

Appearance overrides are saved separately in `data/operator-appearance-overrides.json` and update open GUI sources live. Compact rows, row backgrounds, and badge limits apply to minimal sources; member theme and effect controls apply to decorated member rows in both appearance profiles. A badge limit of zero hides all badges.

Command cooldowns advance only when the command is admitted to the display queue. First-greeting eligibility is consumed by an admitted greeting or first command; source chat alone does not consume it. Cancelling output after admission does not refund that state.

The live log view resets when its backend restarts, including while paused. Pause remains enabled, and resuming shows only the current backend's logs. Log SSE cursors are scoped to the backend session; old numeric cursors trigger a fresh replay.

### Member presentation

Configure the default member-row presentation in `[gui]`. Themes are `green`, `red`, or `gold`; effects are ordered and comma-separated, with an empty value meaning none:

```ini
[gui]
memberRowTheme = green
memberRowEffects = sheen, particles

[profile.example-user]
identities = tiktok:example-user|youtube:example-user-channel|twitch:example-user
greetingCommand = !example-user
rowTheme = red
rowEffects = particles
rowSpriteUrl = https://example.invalid/example-user-sprite.gif
```

Each `[profile.<id>]` value overrides the corresponding global member value only for matching member chat identities. Profile identities use TikTok `uniqueId`/handle, Twitch login/username, and YouTube normalized author name/handle; opaque Twitch/YouTube provider IDs are not accepted by this schema. Supporter and monetization/gift notifications use an internal gold presentation and are not separately configurable here. Gift video playback remains separate. The operator console can change the global member theme and effect selection live; persisted operator overrides reset to the config defaults with **Restore config defaults**.

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

Use `--no-env-file` on the outer Bun invocation to prevent automatic local dotenv loading. Shared test fixtures also disable application env-file reads and writes; tests of those policies explicitly opt in using owned temporary files.

Run individual checks while developing, or use `bun --no-env-file run verify` as the aggregate local gate:

```bash
bun run lint
bun run typecheck:all
bun --no-env-file run test:coverage
bun run build
bun --no-env-file run verify
```

CI runs these checks on pushes and pull requests, then packages Linux and Windows release artifacts after lint, typecheck, tests, and GUI build pass.

### Browser verification

Browser acceptance tests run separately from `bun run verify`. With Bun and Node 24 installed, install the locked dependencies and Playwright Chromium, then run:

```bash
bun install --frozen-lockfile
bun run playwright install chromium
bun --no-env-file run test:browser
```

The fixture builds temporary production GUI assets and serves them through the real local transport using synthetic test data. It does not require `config.ini`, credentials, OBS, or live platform providers.

The media cases use the synthetic `tests/fixtures/synthetic-red.mp4`: a silent, two-second, 32×32 red H.264/yuv420p clip. Tests read these fixed bytes, so an encoder is not required. To regenerate the fixture when intentionally changing it, use an FFmpeg build with libx264:

```bash
ffmpeg -y -nostdin -hide_banner -loglevel error -f lavfi -i color=c=red:s=32x32:r=20:d=2 -an -c:v libx264 -pix_fmt yuv420p -movflags +faststart tests/fixtures/synthetic-red.mp4
```

The independent Ubuntu 24.04 CI job installs Chromium with its required system libraries using `bun run playwright install --with-deps chromium`, then runs with one worker and one retry. Failed tests retain traces under `test-results/browser`; CI uploads `trace.zip` files as the `stream-sync-browser-failure-traces` artifact for seven days.

## 📦 Releases / Artifacts

[GitHub Releases](https://github.com/git-blame-dev/stream-sync/releases) publish:

- `stream-sync-vYYYY.MM.DD.N-linux-x64.tar.gz`
- `stream-sync-vYYYY.MM.DD.N-windows-x64.zip`
- `SHA256SUMS`

Each archive includes the executable, bundled GUI assets, [`config.example.ini`](config.example.ini), [`.env.example`](.env.example), and writable runtime folders such as `logs/` and `data/`.

## ⚠️ Limitations

- This is a local stream-control project; platform APIs, chat availability, and event payloads can change outside the repo.
- `.env`, `config.ini`, `logs/`, token stores, and generated `data/` files may contain sensitive or personal stream data and should stay out of commits and public screenshots.
- TikTok connectivity depends on TikTok availability and EulerStream signing with the configured API key. Start scripts use Bun; running the connector under Node requires Node 22 or newer.
- OBS output requires matching source names in `config.ini`; mismatched scene/source names will prevent overlay updates.
- OBS media completion events (`MediaInputPlaybackEnded`) identify the media input by source name rather than an individual playback token, and bound the completion event wait to 10 seconds from restart dispatch; a delayed completion from a superseded playback on the same source cannot be distinguished by the OBS WebSocket protocol.
- TikTok gift animations are extracted in-process into `<os.tmpdir()>/stream-sync-tiktok-gift-animation` (for example `/tmp/stream-sync-tiktok-gift-animation` on Linux or `%TEMP%\stream-sync-tiktok-gift-animation` on Windows) and retained as immutable published entries (bounded by default to 12 entries and 512 MiB). When the cache reaches capacity, existing cached animations remain playable and new downloads are declined while gift notifications continue normally without animation. Clear the cache directory only when Stream Sync and all browser playback sources are stopped.
- Platform features are disabled by default in `config.example.ini`; only enable the services you have configured.

## 🧭 Troubleshooting

- **No platform events appear:** confirm the platform is enabled in `config.ini`, required credentials are present in `.env`, and the channel/username values match the target account.
- **OBS sources do not update:** check that OBS is running, obs-websocket is enabled, `OBS_PASSWORD` matches, and configured source names exist in the active scene collection.
- **TikTok gifts or animations fail:** ensure `TIKTOK_API_KEY` is set when the integration requires it and check whether `<os.tmpdir()>/stream-sync-tiktok-gift-animation` has reached its entry or byte quota.
- **Viewer counts stay empty:** verify the platform-specific `viewerCountEnabled` setting and source name for the OBS text source.
- **Release binary will not start:** copy both `config.example.ini` and `.env.example`, edit them locally, then run the binary from inside the extracted archive folder.
