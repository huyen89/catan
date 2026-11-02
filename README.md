# Hexhaven

A private, self-hosted web board game for 3–6 friends: a hex-island trading and building game
with voice chat, AI players, Google or guest login, and automatic AI takeover when someone's
connection drops.

## Features

- 3–4 players on the 19-hex board. 5–6 players on the 30-hex board with the Special Building Phase.
- Random boards: shuffled terrain and number tokens (no adjacent 6/8), and shuffled or random ports.
- Every in-game interaction:
  - setup snake draft, dice, the robber, discards and steals
  - roads, settlements and cities
  - all development cards
  - longest road and largest army
  - bank and port trades, and player trades with counter-offers
- Turn timer and game log.
- In-browser voice chat (WebRTC). Mic on/off, speaking indicators and per-player volume.
- AI players (easy/normal/hard) fill empty seats. A player who disconnects is covered by the AI until they come back.
- Google sign-in (optional email allow-list) or guest mode (optional invite code).
- SQLite persistence: a game in progress survives a server restart.

## Quick start (development)

```bash
pnpm install
pnpm build                       # web bundle
cp .env.example .env             # then set SESSION_SECRET, PUBLIC_ORIGIN=http://localhost:3000
pnpm start                       # http://localhost:3000
```

For hot reload, use `pnpm dev` (server :3000, Vite :5173).

To host the game for friends over the internet with Docker and a Cloudflare Tunnel, see
**[docs/DEPLOY.md](docs/DEPLOY.md)**.

## Project docs

- [docs/ROADMAP.md](docs/ROADMAP.md): phases, value/effort assessment, status
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/RULES.md](docs/RULES.md)
- [docs/REVIEW_PROCESS.md](docs/REVIEW_PROCESS.md): how changes reach `main` (CI, AI code and security review)
- [CLAUDE.md](CLAUDE.md): guide for AI agents working on the repo

## Tests

```bash
pnpm verify   # lint, format, typecheck, unit + property tests, 200 bot-vs-bot games
pnpm e2e      # Playwright: lobby, full game vs bots, trade, reconnect/AI takeover, voice
```
