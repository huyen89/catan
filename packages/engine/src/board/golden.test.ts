import { describe, expect, it } from 'vitest';
import { createGame, normalizeConfig } from '../game';
import { seedRng } from '../rng';
import type { GameConfig, NumberMode, PortMode, VariantId } from '../types';
import { generateBoard } from './generate';
import { BASE_LAYOUT, EXT56_LAYOUT } from './layouts';

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
