import { RESOURCES, emptyResources, totalResources, type ResourceCounts } from '@hexhaven/engine';

/**
 * Upper bound per resource while choosing `count` resources from gold: what is still to pick
 * plus what is already picked, never more than the bank holds.
 */
export function goldLimits(
  selection: ResourceCounts,
  count: number,
  bank: ResourceCounts,
): ResourceCounts {
  const left = Math.max(0, count - totalResources(selection));
  const out = emptyResources();
  for (const r of RESOURCES) out[r] = Math.max(0, Math.min(bank[r], selection[r] + left));
  return out;
}

/** A gold choice is complete with exactly `count` resources, all available in the bank. */
export function goldReady(selection: ResourceCounts, count: number, bank: ResourceCounts): boolean {
  return (
    count > 0 &&
    totalResources(selection) === count &&
    RESOURCES.every((r) => selection[r] >= 0 && selection[r] <= bank[r])
  );
}
