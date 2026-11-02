import { z } from 'zod';
import type { Action } from '@hexhaven/engine';

const count = z.number().int().min(0).max(99);
export const resourceSchema = z.enum(['brick', 'lumber', 'wool', 'grain', 'ore']);
export const resourceCountsSchema = z.strictObject({
  brick: count,
  lumber: count,
  wool: count,
  grain: count,
  ore: count,
});
const seat = z.number().int().min(0).max(5);
const id = z
  .string()
  .min(3)
  .max(16)
  .regex(/^-?\d+,-?\d+,(N|S|NE|NW|W)$|^-?\d+,-?\d+$/);

/** Runtime validation of untrusted client actions. Must stay in sync with engine `Action`. */
export const actionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('PLACE_SETTLEMENT'), vertex: id }),
  z.strictObject({ type: z.literal('PLACE_ROAD'), edge: id }),
  z.strictObject({ type: z.literal('ROLL') }),
  z.strictObject({ type: z.literal('DISCARD'), resources: resourceCountsSchema }),
  z.strictObject({ type: z.literal('MOVE_ROBBER'), hex: id }),
  z.strictObject({ type: z.literal('STEAL'), victim: seat }),
  z.strictObject({ type: z.literal('BUILD_ROAD'), edge: id }),
  z.strictObject({ type: z.literal('BUILD_SETTLEMENT'), vertex: id }),
  z.strictObject({ type: z.literal('BUILD_CITY'), vertex: id }),
  z.strictObject({ type: z.literal('BUY_DEV') }),
  z.strictObject({ type: z.literal('PLAY_KNIGHT') }),
  z.strictObject({ type: z.literal('PLAY_ROAD_BUILDING') }),
  z.strictObject({
    type: z.literal('PLAY_YEAR_OF_PLENTY'),
    resources: z.tuple([resourceSchema, resourceSchema]),
  }),
  z.strictObject({ type: z.literal('PLAY_MONOPOLY'), resource: resourceSchema }),
  z.strictObject({ type: z.literal('MARITIME_TRADE'), give: resourceSchema, get: resourceSchema }),
  z.strictObject({
    type: z.literal('OFFER_TRADE'),
    give: resourceCountsSchema,
    want: resourceCountsSchema,
    to: z.array(seat).max(5).nullable(),
    counterTo: z.number().int().positive().nullable(),
  }),
  z.strictObject({
    type: z.literal('RESPOND_TRADE'),
    offerId: z.number().int().positive(),
    response: z.enum(['accept', 'reject']),
  }),
  z.strictObject({
    type: z.literal('CONFIRM_TRADE'),
    offerId: z.number().int().positive(),
    with: seat,
  }),
  z.strictObject({ type: z.literal('CANCEL_TRADE'), offerId: z.number().int().positive() }),
  z.strictObject({ type: z.literal('END_TURN') }),
  z.strictObject({ type: z.literal('PASS_SPECIAL_BUILD') }),
]);

// Compile-time check that the schema and the engine union agree in both directions.
type SchemaAction = z.infer<typeof actionSchema>;
type Assert<T extends true> = T;
export type _ActionSchemaMatches = Assert<
  [SchemaAction] extends [Action] ? ([Action] extends [SchemaAction] ? true : false) : false
>;
