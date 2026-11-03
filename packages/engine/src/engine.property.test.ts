import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { getLegal } from './legal';
import { getPendingActors } from './pending';
import { applyAction } from './reducer';
import { totalResources } from './resources';
import { violations } from './test/invariants';
import { buildAction, playRandomGame, seededRandom } from './test/randomPlay';
import type { ActionType } from './types';
import { toPlayerView } from './view';

const seedArb = fc.integer({ min: 0, max: 1_000_000 }).map((n) => `prop-${n}`);
const playersArb = fc.constantFrom(3, 4, 5, 6);

/** Action types that take no payload: if not listed by getLegal they must be rejected. */
const NO_ARG: ActionType[] = [
  'ROLL',
  'BUY_DEV',
  'PLAY_KNIGHT',
  'PLAY_ROAD_BUILDING',
  'END_TURN',
  'PASS_SPECIAL_BUILD',
];

describe('engine property tests', () => {
  it('property: random games (3-6 players) keep invariants and never throw', () => {
    fc.assert(
      fc.property(seedArb, playersArb, (seed, players) => {
        const game = playRandomGame(seed, players, 300, (s, step) => {
          const bad = violations(s);
          if (bad.length > 0) expect.fail(`${JSON.stringify(step)} → ${bad.join('; ')}`);
        });
        expect(game.state.phase.kind === 'gameOver' || game.log.length === 300).toBe(true);
      }),
      { numRuns: 30 },
    );
  }, 30_000);

  it('property: random games for 3, 4, 5 and 6 players reach gameOver', () => {
    // Most sampled games (>= 80%) must actually finish; the rest may hit the step cap.
    const MAX_STEPS = 6000;
    let finished = 0;
    let total = 0;
    for (const players of [3, 4, 5, 6]) {
      fc.assert(
        fc.property(seedArb, (seed) => {
          const game = playRandomGame(seed, players, MAX_STEPS);
          total++;
          if (game.state.phase.kind !== 'gameOver') return;
          finished++;
          expect(game.state.winner).toBe(game.state.phase.winner);
          expect(game.events.at(-1)?.type).toBe('gameOver');
        }),
        { numRuns: 3 },
      );
    }
    expect(finished / total).toBeGreaterThanOrEqual(0.8);
  }, 30_000);

  it('property: every action listed by getLegal for a pending actor succeeds', () => {
    fc.assert(
      fc.property(seedArb, playersArb, (seed, players) => {
        const rnd = seededRandom(`${seed}/legal`);
        let step = 0;
        playRandomGame(seed, players, 300, (s) => {
          // Check every early (setup) step, then a sample of the rest.
          if (step++ > 30 && step % 4 !== 0) return;
          for (const seat of getPendingActors(s)) {
            const legal = getLegal(s, seat);
            expect(legal.actions.length).toBeGreaterThan(0);
            for (const type of legal.actions) {
              const action = buildAction(s, seat, type, rnd, legal);
              expect(action, `${type} payload`).not.toBeNull();
              const res = applyAction(s, seat, action!);
              expect(res.ok, `${type} by ${seat} in ${s.phase.kind}`).toBe(true);
            }
            for (const type of NO_ARG) {
              if (legal.actions.includes(type)) continue;
              expect(applyAction(s, seat, { type } as never).ok, `${type} unlisted`).toBe(false);
            }
          }
        });
      }),
      { numRuns: 10 },
    );
  }, 30_000);

  it('property: same seed + same actions → identical state', () => {
    fc.assert(
      fc.property(seedArb, playersArb, (seed, players) => {
        const game = playRandomGame(seed, players, 300);
        let s = structuredClone(game.initial);
        for (const { seat, action } of game.log) {
          const res = applyAction(s, seat, action);
          if (!res.ok) throw new Error(res.error.message);
          s = res.state;
        }
        expect(JSON.stringify(s)).toBe(JSON.stringify(game.state));
      }),
      { numRuns: 10 },
    );
  }, 30_000);

  it("property: views never reveal opponents' hands, dev cards, the rng or the deck", () => {
    fc.assert(
      fc.property(seedArb, playersArb, (seed, players) => {
        let step = 0;
        playRandomGame(seed, players, 300, (s) => {
          if (step++ % 10 !== 0 || s.phase.kind === 'gameOver') return;
          for (const viewer of [null, ...s.players.map((p) => p.seat)]) {
            const json = JSON.stringify(toPlayerView(s, viewer));
            expect(json).not.toContain('"rng"');
            expect(json).not.toContain('"devDeck":');
            const view = JSON.parse(json) as ReturnType<typeof toPlayerView>;
            for (const p of view.players) {
              if (p.seat === viewer) {
                expect(p.resources).toEqual(s.players[p.seat]!.resources);
                continue;
              }
              expect(Object.keys(p)).not.toContain('resources');
              expect(Object.keys(p)).not.toContain('devCards');
              expect(Object.keys(p)).not.toContain('newDevCards');
              expect(Object.keys(p)).not.toContain('totalVP');
              expect(p.resourceCount).toBe(totalResources(s.players[p.seat]!.resources));
            }
          }
        });
      }),
      { numRuns: 8 },
    );
  }, 30_000);
});
