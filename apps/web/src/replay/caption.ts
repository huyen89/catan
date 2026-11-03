import type { Seat } from '@hexhaven/engine';
import { eventSeat, eventText, type EventTextContext } from '../game/eventText';
import type { FrameMeta } from './timeline';

export const SPEEDS = [0.5, 1, 2, 4, 8] as const;
/** Milliseconds per action at 1× speed. */
export const BASE_STEP_MS = 800;

export const stepDelay = (speed: number): number =>
  Math.round(BASE_STEP_MS / (speed > 0 ? speed : 1));

/** "END_TURN" → "end turn". */
export const humanizeAction = (type: string): string => type.toLowerCase().replace(/_/g, ' ');

export interface CaptionLine {
  text: string;
  /** Seat the line is about (colours its dot), if any. */
  seat: Seat | null;
}

/** Log lines for one frame: its events, or "<name>: <action>" when it produced none. */
export function frameCaption(meta: FrameMeta, ctx: EventTextContext): CaptionLine[] {
  if (meta.action === null) return [{ text: 'Game start', seat: null }];
  const lines = meta.events
    .map((e) => ({ text: eventText(e, ctx), seat: eventSeat(e) }))
    .filter((l) => l.text);
  if (lines.length) return lines;
  const who = meta.seat === null ? '' : `${ctx.name(meta.seat)}: `;
  return [{ text: `${who}${humanizeAction(meta.action.type)}`, seat: meta.seat }];
}

/** "Action 12 of 340" style position label, frame 0 being the start. */
export function positionLabel(frame: number, length: number): string {
  return frame === 0 ? `Start (${length - 1} actions)` : `Action ${frame} of ${length - 1}`;
}
