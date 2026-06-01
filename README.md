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

### OBS browser sources

Stream Sync includes small local HTML launchers for OBS Browser Sources under `obs/`. They load from disk, wait for the local GUI health check, then open the selected overlay route. This avoids manually reloading OBS browser sources when OBS starts before the Stream Sync app or GUI server.

Use one of these local files in OBS:

```text
<repo>\obs\overlay.html
<repo>\obs\dock.html
<repo>\obs\demo.html
<repo>\obs\tiktok-animations.html
```

The default GUI origin is `http://127.0.0.1:3399`.

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
