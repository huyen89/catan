/**
 * Fuzz: interleave malformed and illegal actions (wrong seat, wrong phase, garbage ids, bad counts,
 * NaN, extra fields, unknown types, non-objects) with random legal play, for 3–6 players and both
 * variants. Checks that the engine never throws, that every rejection leaves the state untouched,
 * that anything accepted was advertised by getLegal, and that whole-state invariants always hold.
 *
 * FUZZ_RUNS (default 20) scales the number of games, e.g. `FUZZ_RUNS=500 pnpm test:prop` nightly.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createGame, normalizeConfig } from './game';
import { graphFor } from './hex/topology';
import { getLegal } from './legal';
import { getPendingActors } from './pending';
import { applyAction } from './reducer';
import { violations } from './test/invariants';
import { buildAction, pick, randomLegalAction, seededRandom, type Rnd } from './test/randomPlay';
import {
  RESOURCES,
  type Action,
  type ActionType,
  type GameEvent,
  type GameState,
  type VariantId,
} from './types';
import { redactEvent, toPlayerView } from './view';

const RUNS = Number(process.env.FUZZ_RUNS ?? 20);
const STEPS = Number(process.env.FUZZ_STEPS ?? 400);

const ACTION_TYPES: ActionType[] = [
  'PLACE_SETTLEMENT',
  'PLACE_ROAD',
  'ROLL',
  'DISCARD',
  'MOVE_ROBBER',
  'STEAL',
  'BUILD_ROAD',
  'BUILD_SETTLEMENT',
  'BUILD_CITY',
  'BUY_DEV',
  'PLAY_KNIGHT',
  'PLAY_ROAD_BUILDING',
  'PLAY_YEAR_OF_PLENTY',
  'PLAY_MONOPOLY',
  'MARITIME_TRADE',
  'OFFER_TRADE',
  'RESPOND_TRADE',
  'CONFIRM_TRADE',
  'CANCEL_TRADE',
  'END_TURN',
  'PASS_SPECIAL_BUILD',
];

/** Payload fields per action type (all fields any handler reads). */
const FIELDS: Record<ActionType, string[]> = {
  PLACE_SETTLEMENT: ['vertex'],
  PLACE_ROAD: ['edge'],
  ROLL: [],
  DISCARD: ['resources'],
  MOVE_ROBBER: ['hex'],
  STEAL: ['victim'],
  BUILD_ROAD: ['edge'],
  BUILD_SETTLEMENT: ['vertex'],
  BUILD_CITY: ['vertex'],
  BUY_DEV: [],
  PLAY_KNIGHT: [],
  PLAY_ROAD_BUILDING: [],
  PLAY_YEAR_OF_PLENTY: ['resources'],
  PLAY_MONOPOLY: ['resource'],
  MARITIME_TRADE: ['give', 'get'],
  OFFER_TRADE: ['give', 'want', 'to', 'counterTo'],
  RESPOND_TRADE: ['offerId', 'response'],
  CONFIRM_TRADE: ['offerId', 'with'],
  CANCEL_TRADE: ['offerId'],
  END_TURN: [],
  PASS_SPECIAL_BUILD: [],
};

// ---------------------------------------------------------------- garbage generators

/** Values that are wrong for almost any field. */
const SCALAR_JUNK: unknown[] = [
  undefined,
  null,
  NaN,
  Infinity,
  -Infinity,
  -1,
  -0,
  0,
  1.5,
  2 ** 31,
  Number.MAX_SAFE_INTEGER,
  1e308,
  '',
  '0',
  '1',
  'x',
  '__proto__',
  'constructor',
  'toString',
  'hasOwnProperty',
  'brick ',
  'BRICK',
  true,
  false,
  [],
  [0],
  {},
  { length: 2 },
  ['brick'],
  ['brick', 'brick', 'brick'],
  ['brick', 'nope'],
  'accept ',
];

/** A ResourceCounts-shaped object with at least one bad entry. */
function junkCounts(rnd: Rnd): unknown {
  const c: Record<string, unknown> = {};
  for (const r of RESOURCES) c[r] = Math.floor(rnd() * 3);
  const bad: unknown[] = [-1, -5, NaN, Infinity, 1e9, 2 ** 53, 0.5, '1', null, undefined, [], {}];
  switch (Math.floor(rnd() * 5)) {
    case 0:
      c[pick(rnd, RESOURCES)] = pick(rnd, bad);
      break;
    case 1:
      delete c[pick(rnd, RESOURCES)];
      break;
    case 2:
      c['gold'] = 1;
      c['__proto__'] = { brick: 1 };
      break;
    case 3:
      // Huge but well-formed: must fail on affordability, never overflow anything.
      c[pick(rnd, RESOURCES)] = 1e9;
      break;
    default:
      return pick(rnd, bad);
  }
  return c;
}

/** A value for `field`: sometimes plausible (a real id, seat, resource), usually garbage. */
function junkValue(state: GameState, field: string, rnd: Rnd): unknown {
  const graph = graphFor(state.board);
  const x = rnd();
  if (x < 0.35) return pick(rnd, SCALAR_JUNK);
  switch (field) {
    case 'vertex':
      return x < 0.7 ? pick(rnd, graph.vertices) : `${pick(rnd, graph.hexIds)},X`;
    case 'edge':
      return x < 0.7 ? pick(rnd, graph.edges) : `${pick(rnd, graph.vertices)}E`;
    case 'hex':
      return x < 0.7 ? pick(rnd, graph.hexIds) : '99,99';
    case 'victim':
    case 'with':
      return x < 0.7 ? Math.floor(rnd() * state.players.length) : pick(rnd, [-1, 6, 7, 2.5]);
    case 'give':
    case 'want':
      // A Resource for MARITIME_TRADE, ResourceCounts for OFFER_TRADE: try both shapes.
      if (rnd() < 0.5) return junkCounts(rnd);
      return x < 0.7 ? pick(rnd, RESOURCES) : pick(rnd, ['gold', 'desert', 'any']);
    case 'resource':
    case 'get':
      return x < 0.7 ? pick(rnd, RESOURCES) : pick(rnd, ['gold', 'desert', 'any']);
    case 'resources':
      if (rnd() < 0.5) return junkCounts(rnd);
      return [pick(rnd, [...RESOURCES, 'gold']), pick(rnd, [...RESOURCES, 'sea'])];
    case 'to':
      return pick(rnd, [null, [], [0], [0, 0], [1, 2], [state.turn.current], [-1], [9], 'all']);
    case 'counterTo':
    case 'offerId': {
      const ids = state.trades.map((t) => t.id);
      return x < 0.7 && ids.length > 0 ? pick(rnd, ids) : pick(rnd, [0, -1, 1e9, NaN, '1', null]);
    }
    case 'response':
      return pick(rnd, ['accept', 'reject', 'maybe', 'ACCEPT', null]);
    default:
      return pick(rnd, SCALAR_JUNK);
  }
}

/** A seat that is usually valid (pending or not) and sometimes not a seat at all. */
function junkSeat(state: GameState, rnd: Rnd): number {
  const x = rnd();
  if (x < 0.1) return pick(rnd, [-1, state.players.length, 99, 1.5, NaN, Infinity, -0]);
  if (x < 0.5) return pick(rnd, getPendingActors(state).length ? getPendingActors(state) : [0]);
  return Math.floor(rnd() * state.players.length);
}

/** An adversarial action: garbage, a corrupted legal action, or a legal action by the wrong seat. */
function junkAction(state: GameState, rnd: Rnd): { seat: number; action: unknown } {
  const mode = rnd();
  if (mode < 0.08) {
    // Not an action object at all, or an unknown/prototype type.
    const action = pick(rnd, [
      null,
      undefined,
      42,
      'ROLL',
      [],
      [{ type: 'ROLL' }],
      {},
      { type: 'roll' },
      { type: 'NUKE' },
      { type: '__proto__' },
      { type: 'constructor' },
      { type: 'toString' },
      { type: 'hasOwnProperty' },
      { type: ['ROLL'] },
      { type: null },
      Object.create(null),
    ]);
    return { seat: junkSeat(state, rnd), action };
  }
  if (mode < 0.35) {
    // A legal action from a pending actor, then corrupted or sent by someone else.
    const actors = getPendingActors(state);
    const seat = pick(rnd, actors.length ? actors : [0]);
    const legal = randomLegalAction(state, seat, rnd) as Record<string, unknown> | null;
    if (legal) {
      const action: Record<string, unknown> = { ...legal };
      const how = rnd();
      const fields = FIELDS[action.type as ActionType];
      if (how < 0.4) return { seat: junkSeat(state, rnd), action };
      if (how < 0.6) {
        action[pick(rnd, ['extra', 'seat', 'version', '__proto__', 'type2'])] = pick(
          rnd,
          SCALAR_JUNK,
        );
        return { seat, action };
      }
      if (fields.length > 0) {
        const f = pick(rnd, fields);
        const v = action[f];
        // Same value, wrong type ("2" for 2, 2.0000001), else garbage.
        if (typeof v === 'number' && rnd() < 0.5) action[f] = rnd() < 0.5 ? String(v) : v + 1e-9;
        else action[f] = junkValue(state, f, rnd);
      }
      return { seat, action };
    }
  }
  // Any action type (mostly wrong phase), with each field plausible or garbage.
  const type = pick(rnd, ACTION_TYPES);
  const action: Record<string, unknown> = { type };
  for (const f of FIELDS[type]) if (rnd() < 0.9) action[f] = junkValue(state, f, rnd);
  return { seat: junkSeat(state, rnd), action };
}

// ---------------------------------------------------------------- the fuzz loop

/** What the adversarial actions hit, to make sure the fuzz keeps exercising the rejection paths. */
const stats = { accepted: 0, rejected: new Set<string>() };

function assertInvariants(s: GameState, what: string): void {
  const bad = violations(s);
  if (bad.length > 0) expect.fail(`${what} → ${bad.join('; ')}`);
}

/** Apply one adversarial action and check the engine's contract for it. Returns the next state. */
function fuzzStep(state: GameState, seat: number, action: unknown, label: string): GameState {
  const before = structuredClone(state);
  let res: ReturnType<typeof applyAction>;
  try {
    res = applyAction(state, seat, action as Action);
  } catch (e) {
    return expect.fail(`${label} threw: ${(e as Error).stack}`);
  }
  // Never mutate the input, whatever the outcome.
  expect(state, `${label} mutated its input`).toEqual(before);
  if (!res.ok) {
    expect(typeof res.error.code, label).toBe('string');
    stats.rejected.add(res.error.code);
    return state;
  }
  // Accepted: it must have been advertised as legal for this seat.
  const type = (action as { type: ActionType }).type;
  expect(getLegal(state, seat).actions, `${label} accepted but not listed`).toContain(type);
  expect(res.state.version, label).toBe(state.version + 1);
  assertInvariants(res.state, label);
  assertEventsWellFormed(res.state, res.events, label);
  stats.accepted++;
  return res.state;
}

const SEAT_FIELDS = ['seat', 'thief', 'victim', 'a', 'b', 'winner', 'holder'];

/** Garbage in an accepted action must never leak into events (e.g. a seat given as "1"). */
function assertEventsWellFormed(s: GameState, events: GameEvent[], label: string): void {
  for (const e of events) {
    const rec = e as unknown as Record<string, unknown>;
    for (const f of SEAT_FIELDS) {
      if (!(f in rec) || rec[f] === null) continue;
      const v = rec[f];
      const ok = typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < s.players.length;
      if (!ok) expect.fail(`${label}: event ${e.type}.${f} = ${safeJson(v)}`);
    }
  }
}

function fuzzGame(seed: string, players: number, variant: VariantId, junkRate: number): void {
  let state = createGame(normalizeConfig({ players, variant }), seed);
  const rnd = seededRandom(`${seed}/fuzz`);
  for (let step = 0; step < STEPS && state.phase.kind !== 'gameOver'; step++) {
    if (rnd() < junkRate) {
      const { seat, action } = junkAction(state, rnd);
      const label = `step ${step} [${state.phase.kind}] seat ${seat} ${safeJson(action)}`;
      state = fuzzStep(state, seat, action, label);
      continue;
    }
    const actors = getPendingActors(state);
    expect(actors.length, `no pending actor in ${state.phase.kind}`).toBeGreaterThan(0);
    const seat = pick(rnd, actors);
    const action = randomLegalAction(state, seat, rnd);
    expect(action, `seat ${seat} stuck in ${state.phase.kind}`).not.toBeNull();
    const res = applyAction(state, seat, action!);
    if (!res.ok) expect.fail(`legal ${safeJson(action)} rejected: ${res.error.message}`);
    assertInvariants(res.state, `step ${step} ${safeJson(action)}`);
    assertEventsWellFormed(res.state, res.events, `step ${step} ${safeJson(action)}`);
    for (const e of res.events) for (const v of [null, 0, seat]) redactEvent(e, v);
    state = res.state;
    if (step % 25 === 0) {
      for (const v of [null, ...state.players.map((p) => p.seat), 99, -1]) toPlayerView(state, v);
    }
  }
}

function safeJson(x: unknown): string {
  try {
    return JSON.stringify(x, (_k, v: unknown) =>
      typeof v === 'number' && !Number.isFinite(v) ? String(v) : v,
    );
  } catch {
    return String(x);
  }
}

const configArb = fc.oneof(
  fc.record({ players: fc.constantFrom(3, 4), variant: fc.constant<VariantId>('base') }),
  fc.record({ players: fc.constantFrom(3, 4, 5, 6), variant: fc.constant<VariantId>('ext56') }),
);

describe('engine fuzz', () => {
  it(
    'property: malformed and illegal actions interleaved with legal play never break the engine',
    () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 1_000_000 }).map((n) => `fuzz-${n}`),
          configArb,
          fc.double({ min: 0.2, max: 0.6, noNaN: true }),
          (seed, { players, variant }, junkRate) => fuzzGame(seed, players, variant, junkRate),
        ),
        { numRuns: RUNS },
      );
      // Sanity: the adversary reached the main rejection paths and sometimes got lucky.
      for (const code of ['NOT_YOUR_TURN', 'WRONG_PHASE', 'INVALID_ACTION', 'ILLEGAL_LOCATION']) {
        expect([...stats.rejected]).toContain(code);
      }
    },
    60_000 + RUNS * STEPS * 3,
  );

  it('the junk generator covers every action type and field', () => {
    // Guard against the fuzz silently drifting from the Action union.
    expect(Object.keys(FIELDS).sort()).toEqual([...ACTION_TYPES].sort());
  });

  it('getLegal / toPlayerView / getPendingActors tolerate invalid viewers', () => {
    const s = createGame(normalizeConfig({ players: 4 }), 'viewers');
    for (const v of [-1, 4, 99, 1.5, NaN]) {
      expect(getLegal(s, v).actions).toEqual([]);
      expect(toPlayerView(s, v).legal?.actions ?? []).toEqual([]);
    }
    expect(buildAction(s, 0, 'PLACE_SETTLEMENT', seededRandom('x'))).not.toBeNull();
  });
});
