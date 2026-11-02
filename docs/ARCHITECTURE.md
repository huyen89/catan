# Architecture

```
browser (React + SVG board, WebRTC audio mesh)
   │  HTTPS + WebSocket (same origin, cookie session)
   ▼
Cloudflare Tunnel ──► apps/server (Fastify + Socket.IO, SQLite)
                        │ uses
                        ├─ packages/engine  (pure rules, seeded RNG, redacted views)
                        ├─ packages/bot     (heuristic AI on PlayerView)
                        └─ packages/shared  (zod wire schemas)
Voice: browsers ⇄ browsers (WebRTC); signaling over Socket.IO; TURN via Cloudflare (UDP doesn't go through the tunnel)
```

## Hex model

- Hexes are pointy-top with axial coordinates `(q,r)`.
- **Vertices:** every vertex is the `N` or `S` corner of exactly one hex. Ids look like `"q,r,N"`.
- **Edges:** every edge is the `NE`, `NW` or `W` side of exactly one hex. Ids look like `"q,r,NE"`.
- `hex/coords.ts` holds the corner and side tables. `hex/topology.ts` builds the adjacency graph, which is memoized per layout.
- Expected sizes:
  - base board: 54 vertices, 72 edges, 30 coastal edges
  - 5–6 player board: 80 vertices, 109 edges, 38 coastal edges

## Game flow on the server

1. A client emits `game:action {expectedVersion, action}`.
2. The server validates the payload with zod and checks seat ownership.
3. The action goes onto a per-game serial queue, where `applyAction` runs.
4. The server persists the action and its events (one SQLite transaction), plus a snapshot every turn.
5. It emits `game:state` per seat, using `toPlayerView` and `redactEvent`.
6. The scheduler runs bots and timers for the pending actors.

## Disconnects

- A disconnected human seat gets a grace period. After it, the seat's `controller` becomes `bot`.
- When the player reconnects (same user id, via cookie), control returns to them.
- If no human is connected, the game pauses.

## Persistence

- SQLite in WAL mode stores `games` (seed and config), `game_actions` (append-only) and `game_snapshots`.
- On boot, the server loads the latest snapshot and replays the actions after it.
