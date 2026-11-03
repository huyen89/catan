/* Bot-vs-bot simulator:
 * `pnpm sim -- --games 200 [--players 3,4,5,6] [--seed prefix] [--difficulty normal|easy,hard,…]
 *   [--variant base|ext56|seafarers] [--scenario newShores|archipelago|grandVoyage]`
 * (one difficulty for every seat, or a comma list assigned by seat).
 *
 * Without --variant the mix is the classic game with every fourth block of four games played
 * as Open Seas (so 1/4 of games, across all player counts): 3-4 players alternate New Shores and
 * Archipelago, 5-6 players play Grand Voyage. With --variant seafarers and no --players, the
 * player counts default to the scenario's range (or 3-6 when no scenario is given). */
import { SCENARIOS, type ScenarioId, type VariantId } from '@hexhaven/engine';
import type { BotDifficulty } from '../index';
import { SimError, simulateGame, type SimResult } from './simulate';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const has = (name: string) => process.argv.includes(`--${name}`);

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

const games = Number(arg('games', '200'));
if (!Number.isInteger(games) || games <= 0)
  fail(`--games must be a positive integer, got ${arg('games', '200')}`);
const variantArg = has('variant') ? arg('variant', '') : null;
if (variantArg !== null && !['base', 'ext56', 'seafarers'].includes(variantArg))
  fail(`--variant must be base|ext56|seafarers, got ${variantArg}`);
const scenarioArg = has('scenario') ? arg('scenario', '') : null;
if (scenarioArg !== null) {
  if (!Object.hasOwn(SCENARIOS, scenarioArg))
    fail(`--scenario must be one of ${Object.keys(SCENARIOS).join('|')}, got ${scenarioArg}`);
  if (variantArg !== null && variantArg !== 'seafarers')
    fail('--scenario needs --variant seafarers');
}
const variant = (variantArg ?? (scenarioArg ? 'seafarers' : null)) as VariantId | null;
const scenarioDef = scenarioArg ? SCENARIOS[scenarioArg as ScenarioId] : null;
const defaultPlayers = scenarioDef
  ? Array.from(
      { length: (scenarioDef.maxPlayers ?? 6) - (scenarioDef.minPlayers ?? 3) + 1 },
      (_, i) => (scenarioDef.minPlayers ?? 3) + i,
    ).join(',')
  : '3,4,5,6';
const playerCounts = arg('players', defaultPlayers).split(',').map(Number);
const prefix = arg('seed', 'sim');
const levels = arg('difficulty', 'normal').split(',');
if (!levels.every((d) => d === 'easy' || d === 'normal' || d === 'hard'))
  fail(`--difficulty must list easy|normal|hard, got ${levels.join(',')}`);
const difficulty = Array.from(
  { length: 6 },
  (_, seat) => levels[seat % levels.length] as BotDifficulty,
);

/** Variant and scenario of game `i` (see the header for the default mix). */
function gameSetup(i: number, players: number): { variant?: VariantId; scenario?: string } {
  if (variant === 'seafarers') {
    if (scenarioArg) return { variant, scenario: scenarioArg };
    return { variant, scenario: players >= 5 ? 'grandVoyage' : seaScenario(i) };
  }
  if (variant) return { variant };
  if (Math.floor(i / 4) % 4 !== 3) return {};
  return { variant: 'seafarers', scenario: players >= 5 ? 'grandVoyage' : seaScenario(i) };
}
const seaScenario = (i: number) => (Math.floor(i / 16) % 2 === 0 ? 'newShores' : 'archipelago');

const results: SimResult[] = [];
const failures: string[] = [];
const started = Date.now();

for (let i = 0; i < games; i++) {
  const players = playerCounts[i % playerCounts.length]!;
  const seed = `${prefix}-${i}`;
  const setup = gameSetup(i, players);
  try {
    results.push(simulateGame(seed, players, { difficulty, ...setup }));
  } catch (e) {
    const where = e instanceof SimError ? ` (step ${e.step})` : '';
    const label = setup.scenario ?? setup.variant ?? 'default';
    failures.push(`${seed} [${players}p ${label}]${where}: ${(e as Error).message}`);
  }
}

const finished = results.filter((r) => r.finished);
const capped = results.filter((r) => r.turnCapped).length;
const avg = (rs: SimResult[], f: (r: SimResult) => number) =>
  rs.reduce((n, r) => n + f(r), 0) / Math.max(1, rs.length);
const byCount = playerCounts.map((p) => {
  const rs = finished.filter((r) => r.players === p);
  return `${p}p: ${rs.length} games, avg ${avg(rs, (r) => r.turns).toFixed(1)} turns`;
});
const perGame = (f: (r: SimResult) => number) => avg(results, f).toFixed(2);
const winsBySeat = new Map<number, number>();
for (const r of finished) winsBySeat.set(r.winner!, (winsBySeat.get(r.winner!) ?? 0) + 1);

console.log(`Simulated ${games} games in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`finished ${finished.length}, turn-capped ${capped}, errors ${failures.length}`);
console.log(`avg turns ${avg(finished, (r) => r.turns).toFixed(1)} | ${byCount.join(' | ')}`);
console.log(
  `trades per game: offered ${perGame((r) => r.tradesOffered)}, ` +
    `countered ${perGame((r) => r.countersOffered)}, completed ${perGame((r) => r.tradesCompleted)} ` +
    `(of which counters ${perGame((r) => r.countersCompleted)})`,
);
const groups = new Map<string, SimResult[]>();
for (const r of results) {
  const key = r.scenario ? `seafarers/${r.scenario}` : r.variant;
  groups.set(key, [...(groups.get(key) ?? []), r]);
}
for (const [key, rs] of [...groups.entries()].sort()) {
  const done = rs.filter((r) => r.finished);
  const line = [
    `${key}: ${rs.length} games`,
    `avg turns ${avg(done, (r) => r.turns).toFixed(1)}`,
    `turn-capped ${rs.filter((r) => r.turnCapped).length}`,
  ];
  if (rs[0]!.variant === 'seafarers') {
    const withBonus = rs.filter((r) => r.islandBonuses > 0).length;
    line.push(
      `ships/game ${avg(rs, (r) => r.shipsBuilt).toFixed(2)}`,
      `ship moves/game ${avg(rs, (r) => r.shipMoves).toFixed(2)}`,
      `island bonuses/game ${avg(rs, (r) => r.islandBonuses).toFixed(2)}`,
      `games with a bonus ${((withBonus / rs.length) * 100).toFixed(0)}%`,
      `pirate moves/game ${avg(rs, (r) => r.pirateMoves).toFixed(2)}`,
    );
  }
  console.log(`  ${line.join(' | ')}`);
}
console.log(
  `wins by seat: ${[...winsBySeat.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([s, n]) => `${s}:${n}`)
    .join(' ')}`,
);
for (const f of failures.slice(0, 20)) console.error(`ERROR ${f}`);

// Stalls throw a SimError, so they are among the failures. A turn-capped game is a very slow
// one: tolerate at most 1%.
const capRate = capped / Math.max(1, games);
if (failures.length > 0 || capRate > 0.01) {
  console.error(`FAILED: errors=${failures.length} turnCapRate=${(capRate * 100).toFixed(1)}%`);
  process.exit(1);
}
