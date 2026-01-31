# StreamSync

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
bun install
cp config.example.ini config.ini
# edit config.ini (and .env if needed)
npm start
```

## Development Commands
```bash
bun lint
bun test
npm run start:debug
```

## Configuration
- `config.example.ini` is the template; copy it to `config.ini`.
- Secrets can be provided via `.env` (optional) and should never be committed.

## Testing Approach
StreamSync follows a strict TDD workflow and emphasizes behavior-first tests. The suite is fixture-driven, deterministic, and avoids real network/OBS usage in CI while still covering end-to-end flows through smoke E2E tests.

## Tech Stack
- Node.js (runtime), Bun (test runner)
- Twitch: EventSub WebSocket + Helix API
- YouTube: youtubei.js
- TikTok: tiktok-live-connector
- OBS: obs-websocket-js
