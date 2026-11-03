# Hexhaven — agent guide

Private, self-hosted hex-island trading board game for 3–6 friends (Catan-style rules, original
names/art — never use the word "Catan" or official artwork in the product). TypeScript pnpm monorepo.

## Commands

```bash
pnpm install
pnpm verify          # lint + typecheck + unit/property tests + quick bot sim — must be green before any PR
pnpm test            # vitest (all projects); `pnpm vitest run --project engine` for one
pnpm sim             # 200 bot-vs-bot games (after workstream B)
pnpm build           # web bundle → apps/web/dist (served by the server)
pnpm e2e             # Playwright (Chromium is preinstalled; never run `playwright install` locally)
pnpm dev             # server :3000 + vite :5173 (proxy)
```

## Layout & ownership (one workstream owns a directory; don't edit others' files)

| Path                                                                                                     | Owner        | Notes                             |
| -------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------- |
| `packages/engine/src/{types,game,context,reducer,index}.ts`, `hex/`, `board/layouts.ts`, `variants/`     | **CONTRACT** | change only via a contract PR     |
| `packages/engine/src/rules/*`, `legal.ts`, `pending.ts`, `view.ts`                                       | ENG          | pure rules                        |
| `packages/engine/src/board/generate.ts` (+ new `board/*.ts`)                                             | GEN          | board randomisation               |
| `packages/shared/`                                                                                       | **CONTRACT** | zod schemas for all wire messages |
| `packages/bot/`                                                                                          | BOT          | heuristic AI + simulator          |
| `apps/server/` except voice files                                                                        | SRV          |                                   |
| `apps/server/src/realtime/handlers/voice.ts`, `apps/server/src/voice/`, `apps/web/src/voice/`, `deploy/` | VOX          |                                   |
| `apps/web/` except `src/voice/`                                                                          | WEB          |                                   |
| `e2e/`                                                                                                   | INT          | integration/e2e                   |

Interface stubs owned by one workstream and consumed by another (keep the exported signature):
`apps/server/src/realtime/types.ts` (SRV↔VOX), `apps/server/src/realtime/handlers/voice.ts`,
`apps/server/src/voice/ice.ts`, `apps/web/src/net/socket.ts` (WEB↔VOX), `apps/web/src/voice/store.ts`,
`apps/web/src/voice/VoiceBar.tsx`.

## Hard rules

- **Engine is pure**: no IO, no `Date`, no `Math.random` (use `rng.ts`), no Node imports — lint-enforced.
  `applyAction` never mutates its input; every successful action bumps `version`.
- **Server is authoritative**. Clients send intents (`game:action`); every payload is zod-validated
  (`@hexhaven/shared` `C2S`) and seat ownership is checked server-side.
- **Hidden information** leaves the server only via `toPlayerView`/`redactEvent`. Any new `GameState`
  field must be classified in `view.ts`.
  Sole exception: `GET /api/games/:id/replay` returns the seed + raw action log, only to participants of a
  **finished** game (hidden info is public by then).
- Bots see only `PlayerView` (no cheating).
- No secrets in the repo; config via env (`.env.example`).

## Contract-change protocol

1. Open a small PR touching only contract files (+ minimal call-site fixes), title `contract: …`.
2. Describe the change and affected workstreams; merge it first.
3. Other workstream branches rebase onto `main`.

## Git / PR workflow

- Branch from `main`: `claude/<topic>`. Small focused PRs. Squash-merge only.
- Before opening a PR: `pnpm verify`, self-review against `docs/REVIEW_CHECKLIST.md`.
- Before merging: CI green, `/code-review` findings fixed, `/security-review` for server/auth/socket/voice/view
  changes, review summary posted on the PR. See `docs/REVIEW_PROCESS.md`.
- Commit messages: imperative subject, body explains why.
