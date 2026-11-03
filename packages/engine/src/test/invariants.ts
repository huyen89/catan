/** Whole-state invariants shared by the property and fuzz tests. */
import { graphFor } from '../hex/topology';
import { longestTrail } from '../rules/awards';
import { totalVP } from '../rules/victory';
import { RESOURCES, type GameState } from '../types';
import { variantFor } from '../variants';

const isCount = (n: unknown): boolean => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/**
 * Invariant violations in `s` (empty when all hold). Plain loops keep per-step cost low.
 * Covers resource conservation, non-negative integer counts, piece counts, award holders, the
 * cached longest-road lengths, VP/winner consistency and phase sanity.
 */
export function violations(s: GameState): string[] {
  const out: string[] = [];
  const check = (ok: boolean, msg: string) => {
    if (!ok) out.push(msg);
  };
  const variant = variantFor(s.config);
  const n = s.players.length;
  const isSeat = (x: unknown) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < n;

  // Resources: integer, non-negative, conserved between bank and hands.
  for (const r of RESOURCES) {
    check(isCount(s.bank[r]), `bank ${r} = ${s.bank[r]}`);
    let held = s.bank[r];
    for (const p of s.players) {
      check(isCount(p.resources[r]), `seat ${p.seat} ${r} = ${p.resources[r]}`);
      held += p.resources[r];
    }
    check(held === variant.bankPerResource, `${r} not conserved (${held})`);
  }
  for (const p of s.players) {
    check(
      Object.keys(p.resources).length === RESOURCES.length,
      `seat ${p.seat} has extra resource keys`,
    );
  }
  check(Object.keys(s.bank).length === RESOURCES.length, 'bank has extra keys');

  // Pieces on the board match the supply.
  const roads = new Array<number>(n).fill(0);
  const settlements = new Array<number>(n).fill(0);
  const cities = new Array<number>(n).fill(0);
  for (const owner of Object.values(s.roads)) {
    check(isSeat(owner), `road owner ${owner}`);
    if (isSeat(owner)) roads[owner]!++;
  }
  for (const b of Object.values(s.buildings)) {
    check(isSeat(b.owner), `building owner ${b.owner}`);
    if (!isSeat(b.owner)) continue;
    if (b.kind === 'city') cities[b.owner]!++;
    else settlements[b.owner]!++;
  }
  const graph = graphFor(s.board);
  for (const v of Object.keys(s.buildings))
    check(Object.hasOwn(graph.vertexHexes, v), `bad vertex ${v}`);
  for (const e of Object.keys(s.roads))
    check(Object.hasOwn(graph.edgeVertices, e), `bad edge ${e}`);
  for (const p of s.players) {
    check(
      isCount(p.roadsLeft) && isCount(p.settlementsLeft) && isCount(p.citiesLeft),
      `seat ${p.seat} pieces < 0`,
    );
    check(p.roadsLeft + roads[p.seat]! === variant.pieces.roads, `seat ${p.seat} roads`);
    // An upgraded city gives its settlement piece back.
    check(
      p.settlementsLeft + settlements[p.seat]! === variant.pieces.settlements,
      `seat ${p.seat} settlements`,
    );
    check(p.citiesLeft + cities[p.seat]! === variant.pieces.cities, `seat ${p.seat} cities`);
    check(isCount(p.playedKnights), `seat ${p.seat} knights`);
  }

  // Cached longest-road lengths are fresh; award holders deserve their award.
  for (const p of s.players) {
    const fresh = longestTrail(s, graph, p.seat);
    check(
      p.longestRoadLength === fresh,
      `seat ${p.seat} cached road ${p.longestRoadLength} ≠ ${fresh}`,
    );
  }
  const maxRoad = Math.max(...s.players.map((p) => p.longestRoadLength));
  const roadLeaders = s.players.filter((p) => p.longestRoadLength === maxRoad);
  if (s.longestRoad !== null) {
    check(isSeat(s.longestRoad), 'longest road holder not a seat');
    const holder = s.players[s.longestRoad]?.longestRoadLength ?? 0;
    check(holder >= 5, 'longest road holder below 5');
    check(holder === maxRoad, 'longest road holder not longest');
  }
  if (maxRoad >= 5 && roadLeaders.length === 1) {
    check(s.longestRoad === roadLeaders[0]!.seat, 'unique longest road does not hold the award');
  }
  const maxArmy = Math.max(...s.players.map((p) => p.playedKnights));
  if (s.largestArmy !== null) {
    check(isSeat(s.largestArmy), 'largest army holder not a seat');
    const holder = s.players[s.largestArmy]?.playedKnights ?? 0;
    check(holder >= 3, 'largest army holder below 3');
    check(holder === maxArmy, 'largest army holder not largest');
  } else {
    check(maxArmy < 3, 'nobody holds largest army despite 3+ knights');
  }

  // Dev cards never multiply.
  const devs =
    s.devDeck.length + s.players.reduce((k, p) => k + p.devCards.length + p.newDevCards.length, 0);
  const deckSize = Object.values(variant.devDeck).reduce((a, b) => a + b, 0);
  check(devs <= deckSize, 'more dev cards than the deck holds');

  // Winner / VP consistency.
  const ph = s.phase;
  check((ph.kind === 'gameOver') === (s.winner !== null), 'winner set iff gameOver');
  if (ph.kind === 'gameOver') {
    check(ph.winner === s.winner, 'phase winner ≠ state winner');
    check(totalVP(s, ph.winner) >= s.config.vpToWin, 'winner below vpToWin');
  } else if (ph.kind !== 'setup' && ph.kind !== 'specialBuild') {
    check(totalVP(s, s.turn.current) < s.config.vpToWin, 'current player should have won');
  }

  // Phase sanity.
  check(isSeat(s.turn.current), 'turn.current not a seat');
  switch (ph.kind) {
    case 'discard':
      check(Object.keys(ph.pending).length > 0, 'empty discard phase');
      for (const [seat, owe] of Object.entries(ph.pending)) {
        check(isSeat(Number(seat)) && isCount(owe) && owe > 0, `discard pending ${seat}=${owe}`);
      }
      break;
    case 'steal':
      check(ph.candidates.length > 1, 'steal phase with < 2 candidates');
      check(!ph.candidates.includes(s.turn.current), 'can steal from self');
      break;
    case 'roadBuilding':
      check(ph.remaining === 1 || ph.remaining === 2, `road building remaining ${ph.remaining}`);
      break;
    case 'specialBuild':
      check(ph.seat !== s.turn.current, 'special build by the player who ended the turn');
      break;
  }
  for (const t of s.trades) {
    check(isSeat(t.from), `trade ${t.id} from`);
    check(!Object.hasOwn(t.responses, String(t.from)), `trade ${t.id} addressed to its maker`);
  }
  // Offers stay open through a knight or road building played mid-turn, never past END_TURN.
  const tradeOk = ['main', 'moveRobber', 'steal', 'roadBuilding', 'gameOver'].includes(ph.kind);
  check(s.trades.length === 0 || tradeOk, `open trades during ${ph.kind}`);
  return out;
}
