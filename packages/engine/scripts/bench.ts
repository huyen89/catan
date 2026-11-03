/**
 * Non-asserting micro-benchmark for the read paths the server and bots call after every action
 * (getLegal, toPlayerView, getPendingActors) on deterministic late-game states.
 *
 *   pnpm --filter @hexhaven/engine bench            # default ~1 s per case
 *   BENCH_MS=3000 pnpm --filter @hexhaven/engine bench
 *
 * Lives outside src/ because it reads the wall clock, which the engine itself must not.
 */
import { getLegal } from '../src/legal';
import { getPendingActors } from '../src/pending';
import { applyAction } from '../src/reducer';
import { lateGameState } from '../src/test/lateGame';
import type { GameState } from '../src/types';
import { toPlayerView } from '../src/view';

const BUDGET_MS = Number(process.env.BENCH_MS ?? 1000);

function run(name: string, fn: () => void): void {
  for (let i = 0; i < 50; i++) fn(); // warm-up
  let n = 0;
  const start = performance.now();
  let elapsed = 0;
  while (elapsed < BUDGET_MS) {
    for (let i = 0; i < 20; i++) fn();
    n += 20;
    elapsed = performance.now() - start;
  }
  const us = (elapsed * 1000) / n;
  console.log(`  ${name.padEnd(40)} ${us.toFixed(1).padStart(9)} µs/op  (${n} ops)`);
}

function describeState(s: GameState): string {
  const roads = Object.keys(s.roads).length;
  const buildings = Object.keys(s.buildings).length;
  return `turn ${s.turn.number}, ${roads} roads, ${buildings} buildings, ${s.trades.length} offers`;
}

for (const [players, variant] of [
  [6, 'ext56'],
  [4, 'base'],
] as const) {
  const s = lateGameState(players, variant);
  console.log(`\n${players} players (${variant}) — ${describeState(s)}`);
  run('getLegal (current seat)', () => getLegal(s, s.turn.current));
  run('getLegal (every seat)', () => {
    for (const p of s.players) getLegal(s, p.seat);
  });
  run('toPlayerView (every seat + spectator)', () => {
    toPlayerView(s, null);
    for (const p of s.players) toPlayerView(s, p.seat);
  });
  run('getPendingActors', () => getPendingActors(s));
  run('applyAction (rejected BUILD_CITY)', () =>
    applyAction(s, s.turn.current, { type: 'BUILD_CITY', vertex: 'nope' }),
  );
  run('applyAction (END_TURN)', () => applyAction(s, s.turn.current, { type: 'END_TURN' }));
}
