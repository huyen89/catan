# Review checklist

Tick every item that applies before merging.

## All PRs

- [ ] `pnpm verify` is green; CI is green.
- [ ] Tests cover the new behavior, including edge cases and rejection paths.
- [ ] No files outside the workstream's ownership changed (or it is a `contract:` PR).
- [ ] No secrets, tokens, or personal emails committed. New config is documented in `.env.example`.
- [ ] No trademarked names or official artwork.
- [ ] No dead code, debug logging, or leftover TODOs without an owner.

## Engine

- [ ] Pure: no `Date`, `Math.random`, or IO. The input state is not mutated.
- [ ] Illegal actions return an `EngineError` and leave the state untouched.
- [ ] Each new `GameState` field is classified as public or private in `view.ts`.
- [ ] Determinism: the same seed and actions produce the same state (replay test passes).

## Server

- [ ] Every socket and REST input is zod-validated.
- [ ] Every game action checks that the socket's user owns the seat and that the seat is human-controlled.
- [ ] Every response sent to a client goes through `toPlayerView` and `redactEvent`.
- [ ] DB changes ship with a migration. Writes for a single action run in one transaction.
- [ ] Timers and listeners are cleaned up (no leaks on room close or disconnect).
- [ ] Rate limits and size limits are in place for user-controlled input such as chat and signaling.

## Web

- [ ] Works at 1280×720 and on a phone in landscape.
- [ ] The UI never assumes an action succeeded: it waits for the ack or a state update.
- [ ] Interactive controls are keyboard accessible and have labels.

## Voice

- [ ] Signals are relayed only between members of the same room's voice channel.
- [ ] TURN credentials are short-lived and issued only to authenticated users.
