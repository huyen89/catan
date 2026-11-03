import { RESOURCES, type Resource, type ResourceCounts } from './types';

export const emptyResources = (): ResourceCounts => ({
  brick: 0,
  lumber: 0,
  wool: 0,
  grain: 0,
  ore: 0,
});

export const resourcesOf = (partial: Partial<ResourceCounts>): ResourceCounts => ({
  ...emptyResources(),
  ...partial,
});

export const totalResources = (r: ResourceCounts): number =>
  RESOURCES.reduce((n, k) => n + r[k], 0);

export const hasResources = (have: ResourceCounts, need: ResourceCounts): boolean =>
  RESOURCES.every((k) => have[k] >= need[k]);

/** Mutates `to`. */
export function addResources(to: ResourceCounts, r: ResourceCounts): void {
  for (const k of RESOURCES) to[k] += r[k];
}

/** Mutates `from`. Caller must check hasResources first. */
export function subtractResources(from: ResourceCounts, r: ResourceCounts): void {
  for (const k of RESOURCES) from[k] -= r[k];
}

export const isValidCounts = (r: unknown): r is ResourceCounts =>
  typeof r === 'object' &&
  r !== null &&
  RESOURCES.every((k) => {
    const v = (r as Record<string, unknown>)[k];
    return typeof v === 'number' && Number.isInteger(v) && v >= 0;
  });

export const COSTS: Record<'road' | 'settlement' | 'city' | 'devCard' | 'ship', ResourceCounts> = {
  road: resourcesOf({ brick: 1, lumber: 1 }),
  ship: resourcesOf({ lumber: 1, wool: 1 }),
  settlement: resourcesOf({ brick: 1, lumber: 1, wool: 1, grain: 1 }),
  city: resourcesOf({ grain: 2, ore: 3 }),
  devCard: resourcesOf({ wool: 1, grain: 1, ore: 1 }),
};

export function single(res: Resource, n = 1): ResourceCounts {
  return resourcesOf({ [res]: n });
}
