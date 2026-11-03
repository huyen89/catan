import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { getLegal } from './legal';
import { getPendingActors } from './pending';
import { applyAction } from './reducer';
import { totalResources } from './resources';
import { violations } from './test/invariants';
import { buildAction, playRandomGame, seededRandom } from './test/randomPlay';
import { SCENARIOS, type ScenarioId } from './board/layouts';
import type { ActionType, GameConfig } from './types';
import { toPlayerView } from './view';

const seedArb = fc.integer({ min: 0, max: 1_000_000 }).map((n) => `prop-${n}`);
const playersArb = fc.constantFrom(3, 4, 5, 6);

/** Every Open Seas scenario with every player count it supports. */
const SEA_GAMES: Array<{ players: number; config: Partial<GameConfig> }> = (
  Object.keys(SCENARIOS) as ScenarioId[]
).flatMap((scenario) => {
  const { minPlayers = 3, maxPlayers = 6 } = SCENARIOS[scenario];
  return Array.from({ length: maxPlayers - minPlayers + 1 }, (_, i) => ({
    players: minPlayers + i,
    config: { variant: 'seafarers' as const, scenario },
  }));
});

/** Default variant for 3-6 players, or an Open Seas scenario (about half the samples). */
const gameArb = fc.oneof(
  playersArb.map((players) => ({ players, config: {} as Partial<GameConfig> })),
  fc.constantFrom(...SEA_GAMES),
);

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
  it('property: random games (3-6 players, all variants) keep invariants and never throw', () => {
    fc.assert(
      fc.property(seedArb, gameArb, (seed, { players, config }) => {
        const game = playRandomGame(
          seed,
          players,
          300,
          (s, step) => {
            const bad = violations(s);
            if (bad.length > 0) expect.fail(`${JSON.stringify(step)} → ${bad.join('; ')}`);
          },
          config,
        );
        expect(game.state.phase.kind === 'gameOver' || game.log.length === 300).toBe(true);
      }),
      { numRuns: 40 },
    );
  }, 60_000);

  it('property: long Open Seas games keep invariants and use every sea rule', () => {
    const seen = new Set<string>();
    for (const { players, config } of SEA_GAMES) {
      for (const seed of ['a', 'b']) {
        playRandomGame(
          `sea-${config.scenario}-${players}-${seed}`,
          players,
          3000,
          (s, step) => {
            seen.add(step.action.type);
            if (s.phase.kind === 'steal') seen.add(`steal:${s.phase.via}`);
            if (s.phase.kind === 'goldChoice') seen.add(`gold:${s.phase.resume.kind}`);
            if (Object.values(s.players).some((p) => p.bonusVP > 0)) seen.add('islandBonus');
            if (s.version % 5 !== 0) return;
            const bad = violations(s);
            if (bad.length > 0) expect.fail(`${JSON.stringify(step)} → ${bad.join('; ')}`);
          },
          config,
        );
      }
    }
    for (const what of [
      'PLACE_SHIP',
      'BUILD_SHIP',
      'MOVE_SHIP',
      'MOVE_PIRATE',
      'CHOOSE_GOLD',
      'steal:pirate',
      'gold:main',
      'islandBonus',
    ]) {
      expect([...seen], what).toContain(what);
    }
  }, 120_000);

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

  it('regression: a settlement joining own road and ship lines refreshes the trade route', () => {
    // These games build such a settlement; the award used to go stale (cached trail too short).
    for (const seed of ['sf-1']) {
      playRandomGame(
        seed,
        4,
        700,
        (s, step) => {
          const bad = violations(s);
          if (bad.length > 0) expect.fail(`${seed} ${JSON.stringify(step)} → ${bad.join('; ')}`);
        },
        { variant: 'seafarers', scenario: 'archipelago' },
      );
    }
  }, 60_000);

  it('property: random Open Seas games reach gameOver', () => {
    const MAX_STEPS = 8000;
    let finished = 0;
    for (const { players, config } of SEA_GAMES) {
      const game = playRandomGame(
        `sea-end-${config.scenario}-${players}`,
        players,
        MAX_STEPS,
        undefined,
        config,
      );
      if (game.state.phase.kind !== 'gameOver') continue;
      finished++;
      expect(game.state.winner).toBe(game.state.phase.winner);
    }
    expect(finished / SEA_GAMES.length).toBeGreaterThanOrEqual(0.8);
  }, 60_000);

  it('property: every action listed by getLegal for a pending actor succeeds', () => {
    fc.assert(
      fc.property(seedArb, gameArb, (seed, { players, config }) => {
        const rnd = seededRandom(`${seed}/legal`);
        let step = 0;
        const check = (s: Parameters<typeof violations>[0]) => {
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
        };
        playRandomGame(seed, players, 300, check, config);
      }),
      { numRuns: 14 },
    );
  }, 60_000);

  it('property: same seed + same actions → identical state', () => {
    fc.assert(
      fc.property(seedArb, gameArb, (seed, { players, config }) => {
        const game = playRandomGame(seed, players, 300, undefined, config);
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
      fc.property(seedArb, gameArb, (seed, { players, config }) => {
        let step = 0;
        const check = (s: Parameters<typeof violations>[0]) => {
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
        };
        playRandomGame(seed, players, 300, check, config);
      }),
      { numRuns: 8 },
    );
  }, 30_000);
});
