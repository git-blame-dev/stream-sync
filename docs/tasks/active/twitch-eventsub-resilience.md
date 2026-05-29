# Twitch EventSub Resilience

## Objective And Status

Fix Twitch EventSub startup/reconnect fragility so transient WebSocket failures do not leave Twitch failed for the full app run.

Status: implemented and smoke-verified; follow-up cleanup hardening implemented and smoke-verified.

## Decision Record

- Chosen: add bounded initial retry, cleanup partial failed starts, abort subscription setup when the socket/session is lost, and smoke-test after killing the current app instance.
- Deferred unless compact: full Twitch `session_reconnect` flow rewrite. It is related but larger than the latest startup failure.
- Rationale: latest logs show pre-welcome `socket hang up`; historical logs show setup continuing after disconnect. The smallest safe fix targets those two paths first.
- Follow-up chosen: preserve the closed EventSub session id until reconnect cleanup can delete that session's subscriptions.
- Follow-up rationale: actual `npm start` showed EventSub recovery works but can reconnect repeatedly; current close handling clears `sessionId` before reconnect cleanup reads it, so old session cleanup can be skipped during abnormal-close churn.

## Parallelization Matrix

| Lane | Owner | Boundary | Output |
|---|---|---|---|
| Test design | subagent | tests only, no edits | proposed tests and assertions |
| Code design | subagent | source inspection only, no edits | implementation sketch |
| Integration | main | source + tests | final coherent patch |
| Verification | main + subagent review | commands/diff review | pass/fail evidence |
| Follow-up cleanup | main | WebSocket lifecycle only | preserve closed session cleanup through reconnect |

## Chunk Checklist

- [x] Chunk A: Add regression tests for startup retry, failed-init cleanup, and subscription abort.
  - Proof: targeted tests fail before implementation or cover changed behavior.
  - Verification: targeted Bun tests.
  - Notes: targeted EventSub tests cover retry, cleanup, abort, and terminal dead-session results.

- [x] Chunk B: Implement initial retry and failed-init cleanup.
  - Proof: transient startup errors retry; final failure cleans up timers/socket/session/subscriptions.
  - Verification: targeted lifecycle tests.
  - Notes: transient errors retry up to three attempts; failed partial sessions close socket, clear timers/state, and best-effort delete session subscriptions.

- [x] Chunk C: Stop subscription setup after connection loss.
  - Proof: no additional subscription POST occurs after validation fails mid-loop or before retry.
  - Verification: targeted subscription manager/lifecycle tests.
  - Notes: connection loss and terminal dead-session errors return `aborted: true` with `connection-lost`.

- [x] Chunk D: Final review and smoke.
  - Proof: targeted tests/typecheck where feasible, diff review, then kill current app and smoke-start once.
  - Verification: smoke logs show Twitch initialized or report exact failing stage.
  - Notes: targeted tests pass; source typecheck passes; smoke start reached Twitch `session_welcome`, created `9/9` subscriptions, recovered from an abnormal close, and recreated `9/9` subscriptions. Full test typecheck still has pre-existing unrelated test typing failures.

- [x] Chunk E: Preserve closed session cleanup across abnormal reconnects.
  - Proof: lifecycle test shows an abnormal close clears active `sessionId` for connection state but reconnect still deletes subscriptions for the closed session.
  - Implementation: store the last disconnected session id before clearing state; reconnect cleanup consumes and clears it.
  - Verification: targeted WebSocket lifecycle test, targeted EventSub tests, source typecheck, actual `npm start` smoke.
  - Notes: regression failed before the fix and passes after it. Actual `npm start` first cleaned 18 stale websocket subscriptions from the prior run, then after an abnormal close reconnect deleted `9/9` subscriptions for the closed session before opening the next WebSocket. The next session stayed connected through repeated `session_keepalive` messages.

## Commit

Suggested commit: `fix(twitch): recover EventSub after transient disconnects`.
