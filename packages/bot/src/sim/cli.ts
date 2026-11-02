/* Bot-vs-bot simulator: `pnpm sim -- --games 200 [--players 3,4,5,6] [--seed prefix]` */
import { SimError, simulateGame, type SimResult } from './simulate';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const games = Number(arg('games', '200'));
const playerCounts = arg('players', '3,4,5,6').split(',').map(Number);
const prefix = arg('seed', 'sim');

const results: SimResult[] = [];
const failures: string[] = [];
const started = Date.now();

for (let i = 0; i < games; i++) {
  const players = playerCounts[i % playerCounts.length]!;
  const seed = `${prefix}-${i}`;
  try {
    results.push(simulateGame(seed, players));
  } catch (e) {
    const where = e instanceof SimError ? ` (step ${e.step})` : '';
    failures.push(`${seed} [${players}p]${where}: ${(e as Error).message}`);
  }
}

const finished = results.filter((r) => r.finished);
const stalled = results.length - finished.length;
const avgTurns = finished.reduce((n, r) => n + r.turns, 0) / Math.max(1, finished.length);
const byCount = playerCounts.map((p) => {
  const rs = finished.filter((r) => r.players === p);
  const avg = rs.reduce((n, r) => n + r.turns, 0) / Math.max(1, rs.length);
  return `${p}p: ${rs.length} games, avg ${avg.toFixed(1)} turns`;
});
const winsBySeat = new Map<number, number>();
for (const r of finished) winsBySeat.set(r.winner!, (winsBySeat.get(r.winner!) ?? 0) + 1);

console.log(`Simulated ${games} games in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`finished ${finished.length}, stalled ${stalled}, errors ${failures.length}`);
console.log(`avg turns ${avgTurns.toFixed(1)} | ${byCount.join(' | ')}`);
console.log(
  `wins by seat: ${[...winsBySeat.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([s, n]) => `${s}:${n}`)
    .join(' ')}`,
);
for (const f of failures.slice(0, 20)) console.error(`ERROR ${f}`);

const stallRate = stalled / Math.max(1, games);
if (failures.length > 0 || stallRate > 0.01) {
  console.error(`FAILED: errors=${failures.length} stallRate=${(stallRate * 100).toFixed(1)}%`);
  process.exit(1);
}
