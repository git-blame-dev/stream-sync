# 📡 Stream Sync

[![CI](https://github.com/git-blame-dev/stream-sync/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/git-blame-dev/stream-sync/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/git-blame-dev/stream-sync?label=release)](https://github.com/git-blame-dev/stream-sync/releases/latest)
![Linux x64](https://img.shields.io/badge/Linux-x64-2ea44f)
![Windows x64](https://img.shields.io/badge/Windows-x64-0078D4)

Combine YouTube, Twitch, and TikTok stream events, chat, TTS, and OBS overlays into one polished live-show control layer.

![StreamSync chat demo](demo.webp)

StreamSync is a multi-platform live chat and event pipeline for streamers. It normalizes Twitch, YouTube, and TikTok events and drives user-facing notifications, TTS, and OBS overlays with a consistent, test-driven architecture.

## Why StreamSync
- Unified event flow across platforms with clear, predictable outputs.
- OBS integration for real-time viewer count and on-screen notifications.
- Config-driven behavior with strict validation and safe defaults.
- Behavior-first tests across unit, integration, and smoke E2E paths.

## Architecture at a Glance
- `src/platforms/` platform adapters and event normalization.
- `src/notifications/` unified notification pipeline and formatting.
- `src/obs/` OBS WebSocket integration for overlays and scenes.
- `src/services/` runtime orchestration, lifecycle, and feature services.
- `src/utils/` shared helpers, validators, and data extraction.

## Getting Started
```bash
bun install --frozen-lockfile
cp config.example.ini config.ini
cp .env.example .env
# edit config.ini and .env
bun run start
```

## Release Binaries
When releases are published, download the Linux or Windows archive from [GitHub Releases](https://github.com/git-blame-dev/stream-sync/releases). Each release includes the StreamSync executable, GUI assets, config templates, and writable `logs/` and `data/` folders.

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

## Runtime Dependencies
- `unzip` is required for TikTok gift animation asset extraction.
- TikTok gift animation duration is derived from TikTok metadata in extracted asset config.

## Development Commands
```bash
bun run lint
bun run typecheck:all
bun run test:coverage
bun run build
bun run verify
bun run start:debug
```

## Configuration
- `config.example.ini` is the template; copy it to `config.ini`.
- Secrets can be provided via `.env` (optional) and should never be committed.

## Testing Approach
StreamSync follows a strict TDD workflow and emphasizes behavior-first tests. The suite is fixture-driven, deterministic, and avoids real network/OBS usage in CI while still covering end-to-end flows through smoke E2E tests.

## Tech Stack
- Bun (runtime, package manager, test runner, release binary compiler)
- Twitch: EventSub WebSocket + Helix API
- YouTube: youtubei.js
- TikTok: custom WebSocket client (`ws`) via EulerStream
- OBS: obs-websocket-js
