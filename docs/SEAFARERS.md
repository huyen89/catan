# M5 — "Open Seas" variant (Seafarers-style rules)

In-product name: **Open Seas**. Variant id: `seafarers`. Original scenario names and art only.

## Rules summary (what the engine implements)

- **Board**:
  - Land hexes plus **sea** hexes, framed by sea.
  - **Gold** hexes carry number tokens. They produce no fixed resource: each gold yield lets the owner **choose** any resource (1 per settlement, 2 per city).
  - Islands are the connected components of land hexes. A scenario marks some islands as **home** islands.
- **Ships** (cost lumber + wool, 15 per player):
  - A ship sits on an edge that touches at least one sea hex.
  - A ship must connect to your own settlement or city, or to your own ship. A ship and a road connect only through your own settlement or city at the shared vertex.
  - During setup, the second piece next to a settlement may be a ship instead of a road (edge rules apply).
  - Road Building lets you place each of its 2 free pieces as a road or a ship.
- **Moving a ship**:
  - Once per turn, after rolling, you may move one ship that sits at the open end of a shipping line. Its far vertex has neither your building nor another of your ships continuing the line.
  - You can't move a ship you placed this turn, or one adjacent to the pirate.
  - You place the ship on any legal ship edge, as if building it, but not back on its old edge.
- **Pirate**:
  - Sits on a sea hex.
  - On a 7 or a knight, the mover chooses to move the **robber** (land) or the **pirate** (sea).
  - The pirate blocks building or moving ships on the edges of its hex.
  - Stealing after a pirate move targets players with a **ship** on an edge of that hex.
  - The robber and pirate start where the scenario says.
- **Settlement placement**:
  - Settlements may be placed only on vertices that touch at least one land hex.
  - Roads go only on edges with at least one land hex. An edge between two land hexes is road-only. A coast edge (land|sea) can take a road or a ship.
- **Setup**: setup settlements must be placed on a home island.
- **Island bonus**: the first time you build a settlement on an island that isn't home (a "new island" for you), you get the scenario's `islandBonusVP` (usually 2). You get it once per island per player.
- **Longest trade route**:
  - Your longest trail counts roads and ships together.
  - Passing from a road to a ship, or from a ship to a road, is allowed only at a vertex with your own building.
  - An opponent's building blocks the trail, as in the base game.
- **Victory**: the scenario default is 14 VP, configurable.
- **5–6 players**: the larger scenario and the special build phase. During the special build you may also build ships, but may not move one.

## Contract changes (`contract:` PR)

### Types (`types.ts`)

- `VariantId |= 'seafarers'`. `GameConfig.scenario?: string` names the scenario for seafarers and is ignored otherwise.
- `Port` stays the same. Ports sit on land|sea edges.
- New `GameState` fields, all initialised for every variant:
  - `ships: Record<EdgeId, Seat>`
  - `pirate: HexId | null`
  - `islandBonus: Record<string, Seat[]>`: island index → seats that already got the bonus.
- `TurnState` gains:
  - `shipMoved: boolean`
  - `newShips: EdgeId[]`: ships placed this turn. They can't be moved.
- `PlayerState` gains:
  - `shipsLeft: number`
  - `bonusVP: number`: island bonuses. Public.
- `Phase`:
  - `moveRobber` gains `allowPirate: boolean`.
  - `steal` gains `via: 'robber' | 'pirate'`.
  - new `{ kind: 'goldChoice'; pending: Record<string, number>; returnTo: 'preRoll' | 'main' | 'setup' }`. Gold from a production roll is chosen right after the roll, and every owner chooses at the same time, like the discard phase.
- `Action`:
  - `PLACE_SHIP {edge}` (setup)
  - `BUILD_SHIP {edge}`
  - `MOVE_SHIP {from, to}`
  - `MOVE_PIRATE {hex}`
  - `CHOOSE_GOLD {resources}`
- `GameEvent`:
  - `built.kind`, `setupPlaced.kind` and `awardChanged` widen to allow `'ship'`
  - `shipMoved`
  - `pirateMoved`
  - `goldChosen`
  - `islandBonus {seat, island, vp}`
  - `produced` may include `gold: Record<string, number>`: pending gold choices per seat
- `LegalSummary`:
  - `shipEdges: EdgeId[]`
  - `shipMoves: Record<EdgeId, EdgeId[]>`
  - `pirateHexes: HexId[]`
  - `goldCount: number`
  - `canAfford.ship`
- `PublicPlayer`: `shipsLeft`, `bonusVP`.
- `PlayerView`: `ships`, `pirate`, `islandBonus`.
- `COSTS.ship = { lumber: 1, wool: 1 }`.

### Layouts and variants

- `LayoutDef` gains optional `fixedHexes?: Array<{q, r, terrain, token?}>`. These hexes keep their terrain and token, and are excluded from `terrainPool` and `tokenPool`. All other fields are unchanged: pools cover the remaining hexes.
- Also new on `LayoutDef`:
  - `homeHexes?: HexId[]`: islands that contain any of these are home islands.
  - `robberStart?: HexId`, `pirateStart?: HexId`
  - `islandBonusVP?: number`, `defaultVpToWin?: number`
- `VariantDef` gains:
  - `ships: number`, which is 0 for base and ext56
  - `scenarios?: Record<string, LayoutDef>` and `defaultScenario?: string`
- Scenarios:
  - **`newShores`** (3–4 players): a main island plus 3–4 small islands, 14 VP.
  - **`archipelago`** (3–4 players): four mid-size islands, all home, plus a gold islet.
  - **`grandVoyage`** (5–6 players): a larger frame with special build.
- `BoardGraph` gains:
  - `landHexes: HexId[]`
  - `islandOf: Record<HexId, number>`
  - `landVertices: VertexId[]`, `roadEdges: EdgeId[]`, `seaEdges: EdgeId[]`
  - Existing boards have no sea hexes, so these sets equal the full vertex and edge sets and base behaviour is unchanged. For a sea-framed board, `coastEdges` is the land|sea edges in walk order.
- `ENGINE_VERSION` bump. `upgradeState(state)` fills the new fields with defaults on old snapshots, and the server calls it on load.

## Workstreams after the contract merges

| ID        | Scope                                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------------- |
| GEN       | `fixedHexes` / sea-frame generation, gold tokens, ports on land/sea edges, scenario invariants (seeds × scenarios)      |
| ENG       | ships, ship moves, pirate, gold choice, island bonus, trade-route longest trail, legal/pending/view, property tests     |
| BOT       | ship expansion toward islands, gold choice, pirate vs robber, ship moves (only legal ones), sim includes seafarers      |
| WEB       | sea/gold rendering, ships, pirate, gold dialog, robber/pirate choice, ship move mode, scenario picker in lobby          |
| SRV + INT | scenario setting validation (shared `roomSettings.scenario`), upgradeState on recovery, e2e: one Open Seas game vs bots |
