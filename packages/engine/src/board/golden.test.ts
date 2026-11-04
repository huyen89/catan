import { describe, expect, it } from 'vitest';
import { createGame, normalizeConfig } from '../game';
import { seedRng } from '../rng';
import type { GameConfig, NumberMode, PortMode, VariantId } from '../types';
import { variantFor } from '../variants';
import { generateBoard } from './generate';
import { BASE_LAYOUT, EXT56_LAYOUT, SCENARIO_IDS, SCENARIOS } from './layouts';

/** FNV-1a 32-bit over a string. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const MODES: Array<Pick<GameConfig, 'numberMode' | 'portMode'>> = (
  ['random', 'spiral'] as NumberMode[]
).flatMap((numberMode) =>
  (['fixed', 'random'] as PortMode[]).map((portMode) => ({ numberMode, portMode })),
);
const SEEDS = ['golden-a', 'golden-b', 'golden-c'];

/**
 * Base and ext56 boards must stay bit-identical across generator changes: saved games and replays
 * regenerate the board from the seed. These hashes were computed on the generator as it was
 * before the Open Seas scenario work (main at the Open Seas contract merge). A mismatch means
 * existing seeds would now get a different board.
 */
const GOLDEN: Record<string, string> = {
  'base19/random/fixed/golden-a': '3e538b30',
  'base19/random/fixed/golden-b': 'd2006749',
  'base19/random/fixed/golden-c': 'a7bdaa4c',
  'base19/random/random/golden-a': '368818b4',
  'base19/random/random/golden-b': 'df700c65',
  'base19/random/random/golden-c': '7b793f95',
  'base19/spiral/fixed/golden-a': '794105c3',
  'base19/spiral/fixed/golden-b': 'bd55ba17',
  'base19/spiral/fixed/golden-c': 'd59d21e8',
  'base19/spiral/random/golden-a': '11f536c0',
  'base19/spiral/random/golden-b': '200a6819',
  'base19/spiral/random/golden-c': '185324c8',
  'ext30/random/fixed/golden-a': 'd74a383f',
  'ext30/random/fixed/golden-b': 'a542f397',
  'ext30/random/fixed/golden-c': 'c1a9ac11',
  'ext30/random/random/golden-a': '6d9700d8',
  'ext30/random/random/golden-b': '2ca08ca6',
  'ext30/random/random/golden-c': 'b2e9599d',
  'ext30/spiral/fixed/golden-a': 'd74a383f',
  'ext30/spiral/fixed/golden-b': 'a542f397',
  'ext30/spiral/fixed/golden-c': 'c1a9ac11',
  'ext30/spiral/random/golden-a': '6d9700d8',
  'ext30/spiral/random/golden-b': '2ca08ca6',
  'ext30/spiral/random/golden-c': 'b2e9599d',
  'game/base/4/golden-a': '28ae31b4',
  'game/base/4/golden-b': '3cb7c4cf',
  'game/base/4/golden-c': 'd4ef292b',
  'game/ext56/6/golden-a': '4005ab45',
  'game/ext56/6/golden-b': 'e0fc3002',
  'game/ext56/6/golden-c': 'dcbcc0f6',
};

function hashes(): Record<string, string> {
  const got: Record<string, string> = {};
  for (const layout of [BASE_LAYOUT, EXT56_LAYOUT])
    for (const mode of MODES)
      for (const seed of SEEDS) {
        const rng = seedRng(seed);
        const board = generateBoard(layout, mode, rng);
        got[`${layout.id}/${mode.numberMode}/${mode.portMode}/${seed}`] = fnv1a(
          JSON.stringify({ board, rng }),
        );
      }
  const games: Array<[VariantId, number]> = [
    ['base', 4],
    ['ext56', 6],
  ];
  for (const [variant, players] of games)
    for (const seed of SEEDS)
      got[`game/${variant}/${players}/${seed}`] = fnv1a(
        JSON.stringify(createGame(normalizeConfig({ players, variant }), seed)),
      );
  return got;
}

describe('generateBoard golden output (base, ext56)', () => {
  it('boards, RNG state out and initial games are unchanged for fixed seeds', () => {
    expect(hashes()).toEqual(GOLDEN);
  });
});

/**
 * Open Seas scenario boards and initial games, pinned once the scenario generator landed (main at
 * the Open Seas rules merge). Replays and recovered games regenerate the board from the seed, so a
 * mismatch means finished games would replay on a different board. Change a scenario map or the
 * generator only on purpose, and then update these hashes knowing old seeds get new boards.
 */
const SCENARIO_GOLDEN: Record<string, string> = {
  'archipelago/random/fixed/golden-a': '0b8c1207',
  'archipelago/random/fixed/golden-b': '57a9e7e8',
  'archipelago/random/fixed/golden-c': '4e1f0694',
  'archipelago/random/random/golden-a': '0b1256e8',
  'archipelago/random/random/golden-b': 'c870d8a4',
  'archipelago/random/random/golden-c': 'fdbbba78',
  'archipelago/spiral/fixed/golden-a': '0b8c1207',
  'archipelago/spiral/fixed/golden-b': '57a9e7e8',
  'archipelago/spiral/fixed/golden-c': '4e1f0694',
  'archipelago/spiral/random/golden-a': '0b1256e8',
  'archipelago/spiral/random/golden-b': 'c870d8a4',
  'archipelago/spiral/random/golden-c': 'fdbbba78',
  'game/archipelago/3/golden-a': 'b1428b52',
  'game/archipelago/3/golden-b': 'da8cd17a',
  'game/archipelago/3/golden-c': 'f722d717',
  'game/archipelago/4/golden-a': '54476584',
  'game/archipelago/4/golden-b': 'f2ff7d8c',
  'game/archipelago/4/golden-c': '8f1349a7',
  'game/grandVoyage/5/golden-a': '57efc0ae',
  'game/grandVoyage/5/golden-b': 'c71e3012',
  'game/grandVoyage/5/golden-c': '846e584a',
  'game/grandVoyage/6/golden-a': '1597e8f2',
  'game/grandVoyage/6/golden-b': 'e44a524c',
  'game/grandVoyage/6/golden-c': '89d5e80c',
  'game/newShores/3/golden-a': 'cd730b92',
  'game/newShores/3/golden-b': 'a662e305',
  'game/newShores/3/golden-c': 'b16be0ba',
  'game/newShores/4/golden-a': 'b15e489c',
  'game/newShores/4/golden-b': 'd89bd359',
  'game/newShores/4/golden-c': '5eac7530',
  'grandVoyage/random/fixed/golden-a': '29113f08',
  'grandVoyage/random/fixed/golden-b': '1b658e8a',
  'grandVoyage/random/fixed/golden-c': '45af65ec',
  'grandVoyage/random/random/golden-a': 'd059d656',
  'grandVoyage/random/random/golden-b': 'db545c60',
  'grandVoyage/random/random/golden-c': '7922b570',
  'grandVoyage/spiral/fixed/golden-a': '29113f08',
  'grandVoyage/spiral/fixed/golden-b': '1b658e8a',
  'grandVoyage/spiral/fixed/golden-c': '45af65ec',
  'grandVoyage/spiral/random/golden-a': 'd059d656',
  'grandVoyage/spiral/random/golden-b': 'db545c60',
  'grandVoyage/spiral/random/golden-c': '7922b570',
  'newShores/random/fixed/golden-a': 'a05efd62',
  'newShores/random/fixed/golden-b': '7f0b0150',
  'newShores/random/fixed/golden-c': 'd9a60031',
  'newShores/random/random/golden-a': 'ec4b4ec8',
  'newShores/random/random/golden-b': 'e84ab741',
  'newShores/random/random/golden-c': '343c104e',
  'newShores/spiral/fixed/golden-a': 'a05efd62',
  'newShores/spiral/fixed/golden-b': '7f0b0150',
  'newShores/spiral/fixed/golden-c': 'd9a60031',
  'newShores/spiral/random/golden-a': 'ec4b4ec8',
  'newShores/spiral/random/golden-b': 'e84ab741',
  'newShores/spiral/random/golden-c': '343c104e',
};

function scenarioHashes(): Record<string, string> {
  const got: Record<string, string> = {};
  for (const scenario of SCENARIO_IDS) {
    const layout = SCENARIOS[scenario];
    for (const mode of MODES)
      for (const seed of SEEDS) {
        const rng = seedRng(seed);
        const board = generateBoard(layout, mode, rng);
        got[`${scenario}/${mode.numberMode}/${mode.portMode}/${seed}`] = fnv1a(
          JSON.stringify({ board, rng }),
        );
      }
    const { minPlayers, maxPlayers } = variantFor({ variant: 'seafarers', scenario });
    for (let players = minPlayers; players <= maxPlayers; players++)
      for (const seed of SEEDS)
        got[`game/${scenario}/${players}/${seed}`] = fnv1a(
          JSON.stringify(
            createGame(normalizeConfig({ players, variant: 'seafarers', scenario }), seed),
          ),
        );
  }
  return got;
}

describe('generateBoard golden output (Open Seas scenarios)', () => {
  it('scenario boards, RNG state out and initial games are unchanged for fixed seeds', () => {
    expect(scenarioHashes()).toEqual(SCENARIO_GOLDEN);
  });
});
