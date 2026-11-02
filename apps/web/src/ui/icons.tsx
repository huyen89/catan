import type { Resource, Terrain } from '@hexhaven/engine';

/** Simple original glyphs, drawn in a 24×24 box centred on (0,0). */
export type Glyph = Resource | 'desert';

export const TERRAIN_GLYPH: Partial<Record<Terrain, Glyph>> = {
  hills: 'brick',
  forest: 'lumber',
  pasture: 'wool',
  fields: 'grain',
  mountains: 'ore',
  desert: 'desert',
};

export function GlyphShape({ glyph, color = 'currentColor' }: { glyph: Glyph; color?: string }) {
  switch (glyph) {
    case 'lumber':
      return (
        <g fill={color}>
          <rect x={-1.6} y={5} width={3.2} height={6} rx={0.8} />
          <path d="M0,-11 L7,-2 L3.5,-2 L9,6 L-9,6 L-3.5,-2 L-7,-2 Z" />
        </g>
      );
    case 'brick':
      return (
        <g fill={color}>
          <rect x={-11} y={-7} width={10} height={6} rx={1} />
          <rect x={1} y={-7} width={10} height={6} rx={1} />
          <rect x={-5} y={1} width={10} height={6} rx={1} />
          <rect x={-11} y={1} width={5} height={6} rx={1} />
          <rect x={6} y={1} width={5} height={6} rx={1} />
        </g>
      );
    case 'wool':
      return (
        <g fill={color}>
          <circle cx={-5} cy={-1} r={5} />
          <circle cx={1} cy={-4} r={5.5} />
          <circle cx={5} cy={1} r={5} />
          <circle cx={-1} cy={3} r={5} />
          <circle cx={9.5} cy={-4} r={2.6} />
          <rect x={-5} y={6} width={2} height={5} rx={1} />
          <rect x={3} y={6} width={2} height={5} rx={1} />
        </g>
      );
    case 'grain':
      return (
        <g fill={color}>
          <rect x={-0.9} y={-4} width={1.8} height={15} rx={0.9} />
          <ellipse cx={0} cy={-8} rx={2.2} ry={3.6} />
          {[-3, 2].map((y) => (
            <g key={y}>
              <ellipse cx={-3.4} cy={y} rx={2.1} ry={3.4} transform={`rotate(-35 -3.4 ${y})`} />
              <ellipse cx={3.4} cy={y} rx={2.1} ry={3.4} transform={`rotate(35 3.4 ${y})`} />
            </g>
          ))}
        </g>
      );
    case 'ore':
      return (
        <g>
          <path d="M-12,10 L-3,-8 L2,1 L5,-3 L12,10 Z" fill={color} />
          <path d="M-3,-8 L-6.2,-1.6 L-3.5,-3 L-1.2,-1 L0.6,-1.6 Z" fill="#f4f4f4" opacity={0.85} />
        </g>
      );
    case 'desert':
      return (
        <g fill={color}>
          <circle cx={3} cy={-4} r={5} />
          <path d="M-12,9 Q-6,2 0,7 Q6,11 12,5 L12,10 L-12,10 Z" />
        </g>
      );
  }
}

/** Standalone resource icon for HTML contexts. */
export function ResourceIcon({ res, size = 18 }: { res: Resource; size?: number }) {
  return (
    <svg
      className="res-icon"
      width={size}
      height={size}
      viewBox="-13 -13 26 26"
      aria-hidden="true"
      focusable="false"
    >
      <circle r={13} fill={`var(--res-${res})`} />
      <g transform="scale(0.72)">
        <GlyphShape glyph={res} color="var(--res-glyph)" />
      </g>
    </svg>
  );
}

/** A die face with pips. */
export function Die({ value, size = 34 }: { value: number; size?: number }) {
  const P: Record<number, Array<[number, number]>> = {
    1: [[0, 0]],
    2: [
      [-1, -1],
      [1, 1],
    ],
    3: [
      [-1, -1],
      [0, 0],
      [1, 1],
    ],
    4: [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ],
    5: [
      [-1, -1],
      [1, -1],
      [0, 0],
      [-1, 1],
      [1, 1],
    ],
    6: [
      [-1, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [-1, 1],
      [1, 1],
    ],
  };
  return (
    <svg width={size} height={size} viewBox="-12 -12 24 24" role="img" aria-label={`Die ${value}`}>
      <rect x={-11} y={-11} width={22} height={22} rx={4} className="die-face" />
      {(P[value] ?? []).map(([x, y], i) => (
        <circle key={i} cx={x * 5.5} cy={y * 5.5} r={2.2} className="die-pip" />
      ))}
    </svg>
  );
}

const small = {
  width: 14,
  height: 14,
  viewBox: '0 0 16 16',
  'aria-hidden': true,
  focusable: false,
  className: 'ico',
} as const;

export function MicIcon({ muted }: { muted: boolean }) {
  return (
    <svg {...small}>
      <rect x={5.5} y={1.5} width={5} height={8.5} rx={2.5} fill="currentColor" />
      <path
        d="M3.5,7.5 a4.5,4.5 0 0 0 9,0 M8,12 v2.5"
        stroke="currentColor"
        fill="none"
        strokeWidth={1.4}
      />
      {muted && <path d="M2,2 L14,14" stroke="var(--danger)" strokeWidth={2} />}
    </svg>
  );
}

export function CardsIcon() {
  return (
    <svg {...small}>
      <rect
        x={1.5}
        y={3}
        width={8}
        height={11}
        rx={1.5}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.3}
      />
      <rect x={6.5} y={1.5} width={8} height={11} rx={1.5} fill="currentColor" />
    </svg>
  );
}

export function DevIcon() {
  return (
    <svg {...small}>
      <rect
        x={3}
        y={1.5}
        width={10}
        height={13}
        rx={1.5}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.3}
      />
      <path
        d="M8,4.5 L9.2,7.2 L12,7.4 L9.8,9.2 L10.5,12 L8,10.4 L5.5,12 L6.2,9.2 L4,7.4 L6.8,7.2 Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function KnightIcon() {
  return (
    <svg {...small}>
      <path
        d="M8,1.5 L14,3.5 V8 C14,11.5 11,13.8 8,14.8 C5,13.8 2,11.5 2,8 V3.5 Z"
        fill="currentColor"
      />
    </svg>
  );
}
