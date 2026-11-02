# Roadmap

Target: a private game night with 3–6 remote friends, self-hosted, reached through Cloudflare Tunnel.
Phases are ordered by **real usage value**. A friends group needs a game that runs reliably every
session, which matters more than having many features.

## Value / effort assessment

| Phase | What                                                                                      | Usage value  | Effort | Notes                           |
| ----- | ----------------------------------------------------------------------------------------- | ------------ | ------ | ------------------------------- |
| M0    | Scaffold, contracts, CI, review process                                                   | enabler      | S      | Done first, sequential          |
| M1    | Engine rules, board generation, server, web UI, voice                                     | **critical** | L      | 5 parallel agents               |
| M2    | Bot AI + simulator; integration + e2e                                                     | **critical** | M      | needs the engine merged         |
| M3    | Hardening: timers/AFK, reconnect polish, fuzzing, security sweep, deploy docs             | high         | M      | what makes game night not break |
| M4    | Quality of life: rematch, game history/replay viewer, stats, sound effects, mobile layout | medium       | M      | after a few real sessions       |
| M5    | Seafarers variant (sea/ships/pirate/gold/scenarios)                                       | low–medium   | L      | new variant module + layouts    |
| M6    | Cities & Knights variant                                                                  | low          | XL     | biggest rules change, do last   |

## Workstreams (M1/M2) — parallel agents

Each workstream owns its directories exclusively (see `CLAUDE.md`), so branches merge without conflicts.

| ID  | Scope                                         | Depends on                       | Done when                                                                                                      |
| --- | --------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| ENG | `engine/rules/*`, `legal`, `pending`, `view`  | M0 contracts                     | all actions implemented, rule unit tests + property tests green                                                |
| GEN | `engine/board/generate.ts`                    | M0                               | no adjacent 6/8 (10k seeds), spiral mode, random ports, count invariants                                       |
| SRV | `apps/server`                                 | M0 (engine API, shared protocol) | auth, rooms, game runner, persistence, reconnect/bot takeover; integration tests with an injectable engine/bot |
| WEB | `apps/web`                                    | M0 (PlayerView, protocol)        | login, lobby, board, every in-game interaction, chat, log                                                      |
| VOX | voice client + server relay + ICE + `deploy/` | M0 stubs                         | 2 browsers connect audio via WebRTC; Docker compose with cloudflared                                           |
| BOT | `packages/bot`                                | ENG merged                       | every legal state gets a legal action; 200-game sim terminates with no errors                                  |
| INT | wiring + `e2e/`                               | all above                        | Playwright: lobby → full game vs bots; trade; reconnect; voice                                                 |

Critical path: M0 → ENG → BOT → INT → M3.

## Status

- [x] M0 bootstrap (#1)
- [x] M1 GEN (#2) · WEB (#3) · ENG (#4) · SRV (#5) · VOX (#6)
- [x] M2 BOT (#7) · INT (lobby → full game, trade, reconnect, voice e2e)
- [ ] M3 hardening. Known follow-ups:
  - require `PUBLIC_ORIGIN` in production
  - persist the room kick list
  - cap voice mesh size, include peer mute state in the `voice:join` ack
  - trim the web bundle (`@hexhaven/shared` pulls in zod)
  - cache views and graphs on the broadcast path
  - bots that open their own trade offers
  - verify Cloudflare TURN relay on a real network
- [ ] M4–M6 as above
